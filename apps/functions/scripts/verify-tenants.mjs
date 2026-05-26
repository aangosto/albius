// verify-tenants.mjs
//
// Verificación empírica de los callables `crearTenant` y `actualizarTenant`
// contra los emulators Auth + Firestore + Functions (B9 Sesión 4).
//
// Requisitos previos: emulator arrancado (por ejemplo
// `npm --prefix apps/functions run serve`).
//
// Ejecución (desde la raíz del repo):
//   node apps/functions/scripts/verify-tenants.mjs
//
// Sin dependencias nuevas: firebase-admin (ya en node_modules) + fetch nativo
// Node 20+. Las env vars de los emulators se setean ANTES de importar
// firebase-admin (dynamic import). Patrón establecido en sub-bloque 3.2.c
// (verify-crearJefeTrafico.mjs) y reusado aquí.
//
// Helpers locales (`signInWithCustomToken`, `invokeCallable`,
// `checkEmulatorsUp`, `record`, `expectError`) duplicados del verify
// existente — TODO[refactor-verify-helpers] sigue en deuda; el cuarto verify
// (este) refuerza la oportunidad de refactor pero NO se aborda aquí (decisión
// del PASO 2 del Bloque 9).

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const FIRESTORE_HOST = "127.0.0.1:8080";
const CALLABLE_URL_CREAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/crearTenant`;
const CALLABLE_URL_ACTUALIZAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/actualizarTenant`;
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
    { name: "Firestore emulator", host: FIRESTORE_HOST },
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
      "\nArranca el emulator (en otra terminal):\n  npm --prefix apps/functions run serve\n",
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
 * Invoca un callable por URL completa (admite múltiples callables en el
 * mismo verify). `idToken` puede ser null (sin auth).
 * Devuelve { ok, status, body, code, message } sin lanzar.
 *   - ok=true  : 200 con result válido.
 *   - ok=false : error; code/message extraídos del payload.
 */
async function invokeCallable(url, data, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  let resp;
  try {
    resp = await fetch(url, {
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
  {
    uid: "admin_b9_uid",
    email: "admin-b9@albius.test",
    claims: { rol: "super_admin" },
  },
  {
    uid: "jefe_b9_uid",
    email: "jefe-b9@albius.test",
    claims: {
      rol: "jefe_trafico",
      tenantId: "tenant_seed_1",
      centroId: "centro_seed_1",
    },
  },
  {
    uid: "cond_b9_uid",
    email: "cond-b9@albius.test",
    claims: {
      rol: "conductor",
      tenantId: "tenant_seed_1",
      centroId: "centro_seed_1",
    },
  },
];

const SEED_TENANTS = [
  {
    id: "tenant_seed_1",
    data: {
      id: "tenant_seed_1",
      nombre: "Empresa Seed 1 SL",
      cif: "A28017895", // Telefónica, válido
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
      plan: "basico",
      estado: "activo",
      fechaAlta: FieldValue.serverTimestamp(),
      configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
  {
    id: "tenant_seed_2",
    data: {
      id: "tenant_seed_2",
      nombre: "Empresa Seed 2 (Cancelado) SA",
      cif: "Q2818014I", // UCM, válido
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
      plan: "basico",
      estado: "cancelado",
      fechaAlta: FieldValue.serverTimestamp(),
      fechaCancelacion: FieldValue.serverTimestamp(),
      configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
];

const SEED_CENTROS = [
  {
    id: "centro_seed_1",
    data: {
      id: "centro_seed_1",
      tenantId: "tenant_seed_1",
      nombre: "Centro Seed 1",
      ciudad: "Madrid",
      provincia: "Madrid",
      estado: "activo",
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
];

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  // Usuarios fijos: borrar y recrear con claims
  for (const u of SEED_USERS) {
    await deleteUserIfExistsByUid(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  }
  // Tenants seed con id explícito: set() sobreescribe estado completo
  for (const t of SEED_TENANTS) {
    await db.collection("tenants").doc(t.id).set(t.data);
  }
  for (const c of SEED_CENTROS) {
    await db.collection("centros").doc(c.id).set(c.data);
  }
  // Limpieza de tenants creados por ejecuciones previas vía crearTenant
  // (auto-id, no empiezan con tenant_seed_). Reduce ruido en /tenants
  // entre runs. Convive con TODO[verify-cleanup-docs-huerfanos].
  const allTenants = await db.collection("tenants").get();
  for (const t of allTenants.docs) {
    if (!t.id.startsWith("tenant_seed_")) {
      await t.ref.delete();
    }
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
//  Main: 19 casos
// ============================================================================

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_b9_uid");
  const tokenJefe = await getIdTokenFor("jefe_b9_uid");

  console.log("=== crearTenant ===\n");

  // ----- C1: super_admin + payload mínimo (CIF válido) -----
  {
    const payload = {
      nombre: "Tenant C1",
      cif: "A48010615", // BBVA, válido
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C1 (super_admin + minimo)",
        "200 ok=true",
        `error ${r.code}: ${r.message}`,
        false,
      );
    } else {
      const snap = await db.collection("tenants").doc(r.body.tenantId).get();
      const doc = snap.data() || {};
      const docOK =
        snap.exists &&
        doc.nombre === "Tenant C1" &&
        doc.cif === "A48010615" &&
        doc.comunidadAutonoma === "Madrid" &&
        doc.provincia === "Madrid" &&
        doc.plan === "basico" &&
        doc.estado === "activo" &&
        doc.configuracion &&
        doc.configuracion.zonaHoraria === "Europe/Madrid" &&
        doc.configuracion.idioma === "es" &&
        doc.creadoPor === "admin_b9_uid" &&
        doc.actualizadoPor === undefined &&
        doc.actualizadoEn === undefined;
      record(
        "C1 (super_admin + minimo)",
        "200 + doc con defaults D4.2 (estado=activo, plan=basico, configuracion=DEFAULTS), creadoPor=admin_b9_uid, SIN actualizadoPor/En",
        snap.exists
          ? `doc.id=${r.body.tenantId}, plan=${doc.plan}, estado=${doc.estado}, configuracion=${JSON.stringify(doc.configuracion)}, creadoPor=${doc.creadoPor}, actualizadoPor=${doc.actualizadoPor}`
          : "doc no creado",
        r.ok &&
          docOK &&
          r.body.cifNormalizado === "A48010615" &&
          r.body.cifValidacionForzada === false,
      );
    }
  }

  // ----- C2: super_admin + payload completo (overrides) -----
  {
    const payload = {
      nombre: "Tenant C2 Completo",
      nombreComercial: "C2 Comercial",
      cif: "B12345674", // sintético válido
      comunidadAutonoma: "Cataluña",
      provincia: "Barcelona",
      plan: "pro",
      configuracion: { zonaHoraria: "Europe/London", idioma: "en" },
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C2 (completo + overrides)",
        "200 ok=true",
        `error: ${r.message}`,
        false,
      );
    } else {
      const snap = await db.collection("tenants").doc(r.body.tenantId).get();
      const doc = snap.data() || {};
      const docOK =
        snap.exists &&
        doc.nombreComercial === "C2 Comercial" &&
        doc.plan === "pro" &&
        doc.configuracion &&
        doc.configuracion.zonaHoraria === "Europe/London" &&
        doc.configuracion.idioma === "en";
      record(
        "C2 (completo + overrides)",
        "plan=pro, configuracion overrides aplicados, nombreComercial presente",
        snap.exists
          ? `plan=${doc.plan}, zonaHoraria=${doc.configuracion.zonaHoraria}, nombreComercial=${doc.nombreComercial}`
          : "no exists",
        docOK,
      );
    }
  }

  // ----- C3: CIF inválido SIN forzar -----
  {
    const payload = {
      nombre: "Tenant C3",
      cif: "B12345678", // control-mismatch (verificado en B8.5)
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C3 (CIF invalido sin forzar)", "INVALID_ARGUMENT", r, (res) =>
      /no es válido/i.test(res.message)
        ? true
        : "mensaje no menciona 'no es válido'",
    );
  }

  // ----- C4: CIF inválido CON forzar -----
  {
    const payload = {
      nombre: "Tenant C4 Forzado",
      cif: "B12345678",
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
      forzarCIF: true,
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C4 (CIF invalido CON forzar)",
        "200 ok=true + cifValidacionForzada=true",
        `error: ${r.message}`,
        false,
      );
    } else {
      const snap = await db.collection("tenants").doc(r.body.tenantId).get();
      const doc = snap.data() || {};
      const docOK = snap.exists && doc.cifValidacionForzada === true;
      const returnOK = r.body.cifValidacionForzada === true;
      record(
        "C4 (CIF invalido CON forzar)",
        "doc.cifValidacionForzada=true + return.cifValidacionForzada=true",
        `doc.cifValidacionForzada=${doc.cifValidacionForzada}, return.cifValidacionForzada=${r.body.cifValidacionForzada}`,
        docOK && returnOK,
      );
    }
  }

  // ----- C5: CIF VÁLIDO + forzar (Opción C3 silenciosa) -----
  {
    const payload = {
      nombre: "Tenant C5 Forzado Innecesario",
      cif: "A58818501", // válido (verificado en B8.5)
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
      forzarCIF: true,
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C5 (CIF valido + forzar silencioso)",
        "200 ok=true",
        `error: ${r.message}`,
        false,
      );
    } else {
      const snap = await db.collection("tenants").doc(r.body.tenantId).get();
      const doc = snap.data() || {};
      // Doc NO debe tener el campo (omit pattern)
      const docOK = snap.exists && doc.cifValidacionForzada === undefined;
      // Return SÍ tiene el campo, en false explícito
      const returnOK = r.body.cifValidacionForzada === false;
      record(
        "C5 (CIF valido + forzar silencioso)",
        "doc SIN cifValidacionForzada (undefined) + return.cifValidacionForzada=false",
        `doc.cifValidacionForzada=${doc.cifValidacionForzada}, return.cifValidacionForzada=${r.body.cifValidacionForzada}`,
        docOK && returnOK,
      );
    }
  }

  // ----- C6: CIF duplicado de tenant_seed_1 -----
  {
    const payload = {
      nombre: "Tenant C6 Duplicado",
      cif: "A28017895", // mismo que tenant_seed_1
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C6 (CIF duplicado)", "ALREADY_EXISTS", r);
  }

  // ----- C7: jefe intenta crear -----
  {
    const payload = {
      nombre: "Tenant C7",
      cif: "A48010615",
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenJefe);
    expectError("C7 (jefe intenta crear)", "PERMISSION_DENIED", r);
  }

  // ----- C8: anonimo -----
  {
    const payload = {
      nombre: "Tenant C8",
      cif: "A48010615",
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, null);
    expectError("C8 (anonimo)", "UNAUTHENTICATED", r);
  }

  // ----- C9: payload sin nombre -----
  {
    const payload = {
      cif: "A48010615",
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C9 (sin nombre)", "INVALID_ARGUMENT", r, (res) =>
      /'nombre'/.test(res.message) ? true : "mensaje no menciona 'nombre'",
    );
  }

  // ----- C10: plan invalido -----
  {
    const payload = {
      nombre: "Tenant C10",
      cif: "A48010615",
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
      plan: "gold",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C10 (plan invalido)", "INVALID_ARGUMENT", r, (res) =>
      /plan/i.test(res.message) ? true : "mensaje no menciona 'plan'",
    );
  }

  console.log("\n=== actualizarTenant ===\n");

  // ----- C11: super_admin actualiza nombre de tenant_seed_1 -----
  {
    const payload = {
      tenantId: "tenant_seed_1",
      nombre: "Empresa Renombrada SL",
    };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    if (!r.ok) {
      record(
        "C11 (actualizar nombre)",
        "200 ok=true",
        `error: ${r.message}`,
        false,
      );
    } else {
      const snap = await db.collection("tenants").doc("tenant_seed_1").get();
      const doc = snap.data() || {};
      const docOK =
        doc.nombre === "Empresa Renombrada SL" &&
        doc.actualizadoPor === "admin_b9_uid" &&
        doc.actualizadoEn !== undefined;
      record(
        "C11 (actualizar nombre)",
        "doc.nombre renombrado + actualizadoPor=admin_b9_uid + actualizadoEn presente",
        `doc.nombre=${doc.nombre}, actualizadoPor=${doc.actualizadoPor}, actualizadoEn=${doc.actualizadoEn !== undefined ? "presente" : "ausente"}`,
        docOK,
      );
    }
  }

  // ----- C12: super_admin intenta editar cif -----
  {
    const payload = { tenantId: "tenant_seed_1", cif: "A48010615" };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    expectError("C12 (editar CIF)", "INVALID_ARGUMENT", r, (res) =>
      /no es editable|TODO\[edit-cif-procedimiento\]/i.test(res.message)
        ? true
        : "mensaje no menciona inmutabilidad del CIF",
    );
  }

  // ----- C13: cancelar tenant temporal sin centros activos -----
  {
    const createPayload = {
      nombre: "Tenant Temporal C13",
      cif: "J12345674", // flexible, válido
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
    };
    const createR = await invokeCallable(
      CALLABLE_URL_CREAR,
      createPayload,
      tokenAdmin,
    );
    if (!createR.ok) {
      record(
        "C13 (cancelar sin centros)",
        "creacion temporal OK + cancelacion OK",
        `creacion fallo: ${createR.message}`,
        false,
      );
    } else {
      const tempId = createR.body.tenantId;
      const updPayload = { tenantId: tempId, estado: "cancelado" };
      const updR = await invokeCallable(
        CALLABLE_URL_ACTUALIZAR,
        updPayload,
        tokenAdmin,
      );
      if (!updR.ok) {
        record(
          "C13 (cancelar sin centros)",
          "200 ok=true",
          `cancelacion fallo: ${updR.message}`,
          false,
        );
      } else {
        const snap = await db.collection("tenants").doc(tempId).get();
        const doc = snap.data() || {};
        const docOK =
          doc.estado === "cancelado" && doc.fechaCancelacion !== undefined;
        record(
          "C13 (cancelar sin centros)",
          "doc.estado=cancelado + fechaCancelacion presente",
          `doc.estado=${doc.estado}, fechaCancelacion=${doc.fechaCancelacion !== undefined ? "presente" : "ausente"}`,
          docOK,
        );
      }
    }
  }

  // ----- C14: cancelar tenant_seed_1 que tiene centro_seed_1 activo (D4.6) -----
  {
    const payload = { tenantId: "tenant_seed_1", estado: "cancelado" };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    expectError(
      "C14 (cancelar con centros activos)",
      "FAILED_PRECONDITION",
      r,
      (res) =>
        /centros activos/i.test(res.message)
          ? true
          : "mensaje no menciona 'centros activos'",
    );
  }

  // ----- C15: reactivar tenant_seed_2 (cancelado → activo) -----
  {
    const payload = { tenantId: "tenant_seed_2", estado: "activo" };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    if (!r.ok) {
      record("C15 (reactivar)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db.collection("tenants").doc("tenant_seed_2").get();
      const doc = snap.data() || {};
      const docOK =
        doc.estado === "activo" && doc.fechaCancelacion === undefined;
      record(
        "C15 (reactivar)",
        "doc.estado=activo + fechaCancelacion AUSENTE (FieldValue.delete)",
        `doc.estado=${doc.estado}, fechaCancelacion=${doc.fechaCancelacion === undefined ? "AUSENTE" : "presente (FAIL: no se borró)"}`,
        docOK,
      );
    }
  }

  // ----- C16: payload solo con tenantId -----
  {
    const payload = { tenantId: "tenant_seed_1" };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    expectError("C16 (solo tenantId)", "INVALID_ARGUMENT", r, (res) =>
      /al menos un campo/i.test(res.message)
        ? true
        : "mensaje no menciona 'al menos un campo'",
    );
  }

  // ----- C17: tenant inexistente -----
  {
    const payload = { tenantId: "tenant_inexistente_xxx", nombre: "X" };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    expectError("C17 (tenant inexistente)", "INVALID_ARGUMENT", r, (res) =>
      /no existe/i.test(res.message)
        ? true
        : "mensaje no menciona 'no existe'",
    );
  }

  // ----- C18: jefe intenta actualizar -----
  {
    const payload = { tenantId: "tenant_seed_1", nombre: "X" };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenJefe,
    );
    expectError("C18 (jefe actualizar)", "PERMISSION_DENIED", r);
  }

  // ----- C19: configuracion replace completo (D4.5 UPDATE) -----
  {
    const payload = {
      tenantId: "tenant_seed_1",
      configuracion: { zonaHoraria: "Europe/London", idioma: "en" },
    };
    const r = await invokeCallable(
      CALLABLE_URL_ACTUALIZAR,
      payload,
      tokenAdmin,
    );
    if (!r.ok) {
      record(
        "C19 (config replace)",
        "200 ok=true",
        `error: ${r.message}`,
        false,
      );
    } else {
      const snap = await db.collection("tenants").doc("tenant_seed_1").get();
      const doc = snap.data() || {};
      const docOK =
        doc.configuracion &&
        doc.configuracion.zonaHoraria === "Europe/London" &&
        doc.configuracion.idioma === "en";
      record(
        "C19 (config replace)",
        "configuracion={zonaHoraria:Europe/London, idioma:en}",
        `doc.configuracion=${JSON.stringify(doc.configuracion)}`,
        docOK,
      );
    }
  }

  // ============================================================================
  //  Resumen
  // ============================================================================
  console.log("\n=========================");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(
    `Resultados: ${pass}/${results.length} PASS, ${fail}/${results.length} FAIL`,
  );
  if (fail > 0) {
    console.log("\nCasos fallidos:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  - ${r.name}`);
    }
    process.exit(1);
  }
  console.log("\nTodos los casos PASS. Verify completado.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nError inesperado en main:", err);
  process.exit(1);
});
