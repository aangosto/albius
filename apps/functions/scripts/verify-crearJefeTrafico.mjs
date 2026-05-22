// verify-crearJefeTrafico.mjs
//
// Verificación empírica del callable `crearJefeTrafico` contra los emulators
// Auth + Firestore + Functions. Diseño aprobado en sesión 3.2.c PASO 5.
//
// Requisitos previos: emulator arrancado (por ejemplo `npm --prefix apps/functions run serve`).
//
// Ejecución (desde la raíz del repo):
//   node apps/functions/scripts/verify-crearJefeTrafico.mjs
//
// Sin dependencias nuevas: firebase-admin (ya en node_modules) + fetch nativo Node 20+.
// Las env vars de los emulators se setean ANTES de importar firebase-admin (dynamic import).

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const CALLABLE_URL = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/crearJefeTrafico`;
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const auth = getAuth();
const db = getFirestore();

// ============================================================================
//  Pre-flight: ¿están los emulators arriba?
// ============================================================================

async function checkEmulatorsUp() {
  const probes = [
    { name: "Auth emulator", host: AUTH_HOST },
    { name: "Functions emulator", host: FUNCTIONS_HOST },
    { name: "Firestore emulator", host: "127.0.0.1:8080" },
  ];
  const errors = [];
  for (const p of probes) {
    try {
      await fetch(`http://${p.host}/`, { method: "GET" });
    } catch (e) {
      errors.push(`  - ${p.name} (${p.host}): ${e.message}`);
    }
  }
  if (errors.length > 0) {
    console.error("\nEmulators no responden:");
    console.error(errors.join("\n"));
    console.error(
      "\nArranca el emulator (en otra terminal):\n  npm --prefix apps/functions run serve\n  # o desde la raiz:  firebase emulators:start\n",
    );
    process.exit(2);
  }
}

// ============================================================================
//  Helpers: signIn + invokeCallable
// ============================================================================

async function signInWithCustomToken(customToken) {
  const resp = await fetch(AUTH_SIGNIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!resp.ok) {
    throw new Error(
      `signInWithCustomToken fallo: ${resp.status} ${await resp.text()}`,
    );
  }
  const json = await resp.json();
  return json.idToken;
}

async function getIdTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  return signInWithCustomToken(customToken);
}

/**
 * Invoca el callable. `idToken` puede ser null (sin auth).
 * Devuelve { ok, status, body, code, message } sin lanzar.
 *   - ok=true  : 200 con result valido.
 *   - ok=false : error; code/message extraidos del payload.
 */
async function invokeCallable(data, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  let resp;
  try {
    resp = await fetch(CALLABLE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ data }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      code: "network-error",
      message: e.message,
    };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (resp.ok && body && body.result !== undefined) {
    return {
      ok: true,
      status: resp.status,
      body: body.result,
      code: null,
      message: null,
    };
  }
  const err = (body && body.error) || {};
  return {
    ok: false,
    status: resp.status,
    body,
    code: err.status || err.code || `http-${resp.status}`,
    message: err.message || text,
  };
}

// ============================================================================
//  Seeds (idempotentes)
// ============================================================================

const SEED_USERS = [
  { uid: "admin_001", email: "admin@test.local", claims: { rol: "super_admin" } },
  {
    uid: "jefe_001",
    email: "jefe@test.local",
    claims: { rol: "jefe_trafico", tenantId: "tenant_001", centroId: "centro_001" },
  },
  { uid: "cond_001", email: "cond@test.local", claims: { rol: "conductor" } },
  { uid: "sin_rol_001", email: "sinrol@test.local", claims: null },
];

const SEED_TENANTS = [
  { id: "tenant_001", data: { nombre: "Tenant Test 1" } },
  { id: "tenant_002", data: { nombre: "Tenant Test 2" } },
];

const SEED_CENTROS = [
  { id: "centro_001", data: { tenantId: "tenant_001", nombre: "Centro A" } },
  { id: "centro_002", data: { tenantId: "tenant_002", nombre: "Centro B" } },
];

// Emails que el callable crearJefeTrafico intentara crear durante el test.
// Se limpian del Auth emulator antes de cada ejecucion para idempotencia.
const TEST_JEFE_EMAILS = ["nuevo-jefe-c1@test.local", "nuevo-jefe-c2@test.local"];

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function deleteUserIfExistsByEmail(email) {
  try {
    const u = await auth.getUserByEmail(email);
    await auth.deleteUser(u.uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  // Usuarios fijos: borrar y recrear
  for (const u of SEED_USERS) {
    await deleteUserIfExistsByUid(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  }
  // Emails que el callable creara: limpiar previas si existen
  for (const email of TEST_JEFE_EMAILS) {
    await deleteUserIfExistsByEmail(email);
  }
  // Tenants y centros (set sobreescribe)
  for (const t of SEED_TENANTS) {
    await db.collection("tenants").doc(t.id).set(t.data);
  }
  for (const c of SEED_CENTROS) {
    await db.collection("centros").doc(c.id).set(c.data);
  }
}

// ============================================================================
//  Runner de casos
// ============================================================================

const results = [];

function record(name, expected, actual, pass, extra = "") {
  const tag = pass ? "[OK]  " : "[FAIL]";
  console.log(`${tag} ${name}`);
  console.log(`       esperado: ${expected}`);
  console.log(`       recibido: ${actual}${extra ? "  -> " + extra : ""}`);
  results.push({ name, expected, actual, pass });
}

/**
 * Atajo para casos negativos: espera error con `expectedCode`.
 * `extraCheck` opcional: funcion(result) -> true | "razon del fallo".
 */
function expectError(name, expectedCode, result, extraCheck = null) {
  if (result.ok) {
    record(
      name,
      `error code=${expectedCode}`,
      `OK inesperado (sin error)`,
      false,
    );
    return;
  }
  let pass = result.code === expectedCode;
  let extra = "";
  if (pass && extraCheck) {
    const r = extraCheck(result);
    if (r !== true) {
      pass = false;
      extra = r;
    }
  }
  record(
    name,
    `error code=${expectedCode}`,
    `code=${result.code} msg="${result.message}"`,
    pass,
    extra,
  );
}

// ============================================================================
//  Main
// ============================================================================

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_001");
  const tokenJefe = await getIdTokenFor("jefe_001");
  const tokenCond = await getIdTokenFor("cond_001");
  const tokenSinRol = await getIdTokenFor("sin_rol_001");

  // ----- FELICES -----

  // C1: super_admin + payload completo (con telefono)
  {
    const payload = {
      email: "nuevo-jefe-c1@test.local",
      nombreCompleto: "Juan Test",
      telefono: "+34600111222",
      tenantId: "tenant_001",
      centroId: "centro_001",
    };
    const r = await invokeCallable(payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C1 (super_admin + payload completo)",
        "200 ok=true con usuarioId y linkPasswordReset",
        `error ${r.code}: ${r.message}`,
        false,
      );
    } else {
      const usuarioId = r.body.usuarioId;
      const linkOk =
        typeof r.body.linkPasswordReset === "string" &&
        r.body.linkPasswordReset.length > 0;
      const snap = await db.collection("usuarios").doc(usuarioId).get();
      const doc = snap.data() || {};
      const docOK =
        snap.exists &&
        doc.rol === "jefe_trafico" &&
        doc.tenantId === "tenant_001" &&
        doc.centroId === "centro_001" &&
        doc.email === payload.email &&
        doc.nombreCompleto === payload.nombreCompleto &&
        doc.telefono === payload.telefono &&
        doc.passwordChangeRequired === true &&
        doc.estado === "activo" &&
        doc.creadoPor === "admin_001" &&
        doc.creadoEn;
      const user = await auth.getUser(usuarioId);
      const c = user.customClaims || {};
      const claimsOK =
        c.rol === "jefe_trafico" &&
        c.tenantId === "tenant_001" &&
        c.centroId === "centro_001";
      const pass = r.ok && linkOk && docOK && claimsOK;
      record(
        "C1 (super_admin + payload completo)",
        "200 ok=true; doc /usuarios completo; custom claims aplicados",
        `ok=${r.ok} usuarioId=${usuarioId}`,
        pass,
        `link=${linkOk ? "OK" : "FAIL"} doc=${docOK ? "OK" : "FAIL"} claims=${claimsOK ? "OK" : "FAIL"}`,
      );
    }
  }

  // C2: super_admin + payload sin telefono
  {
    const payload = {
      email: "nuevo-jefe-c2@test.local",
      nombreCompleto: "Ana Test",
      tenantId: "tenant_001",
      centroId: "centro_001",
    };
    const r = await invokeCallable(payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C2 (super_admin sin telefono)",
        "200 ok=true; doc sin campo telefono",
        `error ${r.code}: ${r.message}`,
        false,
      );
    } else {
      const usuarioId = r.body.usuarioId;
      const snap = await db.collection("usuarios").doc(usuarioId).get();
      const doc = snap.data() || {};
      const sinTelefono = !("telefono" in doc);
      record(
        "C2 (super_admin sin telefono)",
        "doc sin campo telefono (no escrito como undefined)",
        sinTelefono
          ? "telefono ausente"
          : `telefono presente=${JSON.stringify(doc.telefono)}`,
        sinTelefono,
      );
    }
  }

  // ----- NEGATIVOS AUTH -----

  const payloadBase = {
    email: "x@test.local",
    nombreCompleto: "X",
    tenantId: "tenant_001",
    centroId: "centro_001",
  };

  // N1: sin auth
  expectError(
    "N1 (sin auth)",
    "UNAUTHENTICATED",
    await invokeCallable(payloadBase, null),
  );

  // N2: usuario sin claim rol
  expectError(
    "N2 (sin claim rol)",
    "PERMISSION_DENIED",
    await invokeCallable(payloadBase, tokenSinRol),
  );

  // N3: rol jefe_trafico
  expectError(
    "N3 (rol jefe_trafico)",
    "PERMISSION_DENIED",
    await invokeCallable(payloadBase, tokenJefe),
  );

  // N4: rol conductor
  expectError(
    "N4 (rol conductor)",
    "PERMISSION_DENIED",
    await invokeCallable(payloadBase, tokenCond),
  );

  // ----- NEGATIVOS VALIDATION -----

  // N5: data = null
  expectError(
    "N5 (data=null)",
    "INVALID_ARGUMENT",
    await invokeCallable(null, tokenAdmin),
  );

  // N6: data = []
  expectError(
    "N6 (data=[])",
    "INVALID_ARGUMENT",
    await invokeCallable([], tokenAdmin),
  );

  // N7: email omitido
  expectError(
    "N7 (email omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      { nombreCompleto: "X", tenantId: "tenant_001", centroId: "centro_001" },
      tokenAdmin,
    ),
  );

  // N8: email mal formado
  expectError(
    "N8 (email mal formado)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "no-es-email",
        nombreCompleto: "X",
        tenantId: "tenant_001",
        centroId: "centro_001",
      },
      tokenAdmin,
    ),
  );

  // N9: nombreCompleto solo espacios
  expectError(
    "N9 (nombreCompleto vacio tras trim)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "n9@test.local",
        nombreCompleto: "   ",
        tenantId: "tenant_001",
        centroId: "centro_001",
      },
      tokenAdmin,
    ),
  );

  // N10: tenantId omitido
  expectError(
    "N10 (tenantId omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "n10@test.local",
        nombreCompleto: "X",
        centroId: "centro_001",
      },
      tokenAdmin,
    ),
  );

  // N11: centroId omitido
  expectError(
    "N11 (centroId omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "n11@test.local",
        nombreCompleto: "X",
        tenantId: "tenant_001",
      },
      tokenAdmin,
    ),
  );

  // ----- NEGATIVOS REFS -----

  // N12: tenant no existe
  expectError(
    "N12 (tenant no existe)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "n12@test.local",
        nombreCompleto: "X",
        tenantId: "no-existe",
        centroId: "centro_001",
      },
      tokenAdmin,
    ),
    (rr) =>
      /tenant.*no existe/i.test(rr.message)
        ? true
        : `mensaje no menciona tenant: "${rr.message}"`,
  );

  // N13: centro no existe
  expectError(
    "N13 (centro no existe)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "n13@test.local",
        nombreCompleto: "X",
        tenantId: "tenant_001",
        centroId: "no-existe",
      },
      tokenAdmin,
    ),
    (rr) =>
      /centro.*no existe/i.test(rr.message)
        ? true
        : `mensaje no menciona centro: "${rr.message}"`,
  );

  // N14: cross-tenant (centro_002 pertenece a tenant_002)
  expectError(
    "N14 (cross-tenant)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      {
        email: "n14@test.local",
        nombreCompleto: "X",
        tenantId: "tenant_001",
        centroId: "centro_002",
      },
      tokenAdmin,
    ),
    (rr) =>
      /no pertenece/i.test(rr.message)
        ? true
        : `mensaje no menciona pertenencia: "${rr.message}"`,
  );

  // ----- COLISION -----

  // N15: repetir email de C1
  expectError(
    "N15 (email duplicado)",
    "ALREADY_EXISTS",
    await invokeCallable(
      {
        email: "nuevo-jefe-c1@test.local",
        nombreCompleto: "Duplicado",
        tenantId: "tenant_001",
        centroId: "centro_001",
      },
      tokenAdmin,
    ),
  );

  // ----- RESUMEN -----

  console.log("\n==========================================");
  const ok = results.filter((r) => r.pass).length;
  const fail = results.length - ok;
  console.log(`Total: ${results.length} | OK: ${ok} | FAIL: ${fail}`);
  if (fail > 0) {
    console.log("\nFallos:");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.name}`);
      console.log(`      esperado: ${r.expected}`);
      console.log(`      recibido: ${r.actual}`);
    }
  }
  console.log("==========================================\n");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\nError inesperado en el runner:", e);
  process.exit(3);
});
