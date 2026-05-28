// verify-usuarios.mjs
//
// Verificación empírica del callable `actualizarUsuario` contra los emulators
// Auth + Firestore + Functions (B13 Sesión 6).
//
// Requisitos previos: emulator arrancado (por ejemplo
// `npm --prefix apps/functions run serve`).
//
// Ejecución (desde la raíz del repo):
//   node apps/functions/scripts/verify-usuarios.mjs
//
// Sin dependencias nuevas: firebase-admin (ya en node_modules) + fetch nativo
// Node 20+. Las env vars de los emulators se setean ANTES de importar
// firebase-admin (dynamic import). Patrón establecido en verify-tenants.mjs
// (B9) y verify-centros.mjs (B11), reusado aquí.
//
// Helpers locales (`signInWithCustomToken`, `invokeCallable`,
// `checkEmulatorsUp`, `record`, `expectError`) duplicados del verify
// existente — TODO[refactor-verify-helpers] sigue en deuda.
//
// expectedCode en UPPER_SNAKE_CASE (convención del proyecto B9): el wire
// protocol HTTPS Callable v2 serializa los códigos así.
//
// PARTICULARIDAD B13 (dual-homed Auth+Firestore): los targets se siembran con
// Auth user REAL (auth.createUser con email/displayName/emailVerified) + doc
// /usuarios, porque actualizarUsuario escribe en AMBOS sistemas (D5.4). Casos
// destacados:
//   - A3 verifica que cambiar email deja emailVerified=false en Auth (el seed
//     pone usuario_jefe_b13 con emailVerified=true para que el reset sea visible).
//   - A4/A5 verifican que suspender NO toca auth.disabled (DECISIÓN 4): se lee
//     disabled antes y después.
//   - A17 (email duplicado) verifica el orden Auth-primero (D5.4): el fallo
//     auth/email-already-exists aborta ANTES de tocar Firestore, así que el
//     doc.email NO cambia (sin rollback necesario).
//   - A22 (doc huérfano) tiene doc /usuarios SIN Auth user → el callable falla
//     en FASE 1.5 con failed-precondition.
//
// NO testeable en emulator: el rollback inverso cuando la escritura Firestore
// falla TRAS un Auth ya escrito (no se puede forzar el fallo de update sin
// hackear el SDK). Verificado por inspección de código + cabecera del callable.
// Precedente: caso 9 de B10, rollback de B11.

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
const CALLABLE_URL = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/actualizarUsuario`;
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

const TENANT_ID = "tenant_seed_b13_activo";
const CENTRO_ID = "centro_seed_b13";
const CONDUCTOR_ID = `${TENANT_ID}_EMP-B13-001`;

// Invocadores: admin (super_admin) + jefe (para A19).
const SEED_INVOCADORES = [
  {
    uid: "admin_b13_uid",
    email: "admin-b13@albius.test",
    claims: { rol: "super_admin" },
  },
  {
    uid: "jefe_b13_uid",
    email: "jefe-b13@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ID },
  },
];

// Targets con Auth user REAL (email/displayName/emailVerified). EXCLUYE el
// huérfano (que NO tiene Auth user).
const SEED_TARGETS_AUTH = [
  {
    uid: "usuario_jefe_b13",
    email: "target-jefe-b13@albius.test",
    displayName: "Jefe Target B13",
    emailVerified: true, // A3 verificará el reset a false tras cambiar email
  },
  {
    uid: "usuario_conductor_b13",
    email: "target-conductor-b13@albius.test",
    displayName: "Conductor Target B13",
    emailVerified: true,
  },
  {
    uid: "usuario_suspendible_b13",
    email: "suspendible-b13@albius.test",
    displayName: "Suspendible B13",
    emailVerified: true,
  },
  {
    uid: "usuario_email_ocupado_b13",
    email: "ocupado-b13@albius.test", // A17 intentará colisionar contra este
    displayName: "Ocupado B13",
    emailVerified: true,
  },
];

const HUERFANO_UID = "usuario_huerfano_b13";

// Todos los uid b13 que hay que limpiar de Auth entre runs.
const ALL_B13_UIDS = [
  ...SEED_INVOCADORES.map((u) => u.uid),
  ...SEED_TARGETS_AUTH.map((u) => u.uid),
  HUERFANO_UID,
];

function makeUsuarioDoc(uid, email, nombreCompleto, rol, extra = {}) {
  return {
    id: uid,
    email,
    nombreCompleto,
    rol,
    estado: "activo",
    passwordChangeRequired: false,
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
    ...extra,
  };
}

// /usuarios docs para los 5 targets (incluye el huérfano, doc-only).
const SEED_USUARIO_DOCS = [
  makeUsuarioDoc(
    "usuario_jefe_b13",
    "target-jefe-b13@albius.test",
    "Jefe Target B13",
    "jefe_trafico",
    { tenantId: TENANT_ID, centroId: CENTRO_ID, telefono: "600000001" },
  ),
  makeUsuarioDoc(
    "usuario_conductor_b13",
    "target-conductor-b13@albius.test",
    "Conductor Target B13",
    "conductor",
    {
      tenantId: TENANT_ID,
      centroId: CENTRO_ID,
      conductorId: CONDUCTOR_ID,
      telefono: "600000002",
    },
  ),
  makeUsuarioDoc(
    "usuario_suspendible_b13",
    "suspendible-b13@albius.test",
    "Suspendible B13",
    "jefe_trafico",
    { tenantId: TENANT_ID, centroId: CENTRO_ID },
  ),
  makeUsuarioDoc(
    "usuario_email_ocupado_b13",
    "ocupado-b13@albius.test",
    "Ocupado B13",
    "jefe_trafico",
    { tenantId: TENANT_ID, centroId: CENTRO_ID },
  ),
  // Huérfano: doc SIN Auth user (A22). Se crea aquí en Firestore directo.
  makeUsuarioDoc(
    HUERFANO_UID,
    "huerfano-b13@albius.test",
    "Huerfano B13",
    "jefe_trafico",
    { tenantId: TENANT_ID, centroId: CENTRO_ID },
  ),
];

const SEED_TENANT = {
  id: TENANT_ID,
  nombre: "Tenant B13 Activo SL",
  cif: "A13131310",
  comunidadAutonoma: "Madrid",
  provincia: "Madrid",
  plan: "basico",
  estado: "activo",
  fechaAlta: FieldValue.serverTimestamp(),
  configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
};

const SEED_CENTRO = {
  id: CENTRO_ID,
  tenantId: TENANT_ID,
  nombre: "Centro B13",
  ciudad: "Madrid",
  provincia: "Madrid",
  estado: "activo",
  fechaCreacion: FieldValue.serverTimestamp(),
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
};

const SEED_CONDUCTOR = {
  id: CONDUCTOR_ID,
  tenantId: TENANT_ID,
  centroId: CENTRO_ID,
  usuarioId: "usuario_conductor_b13",
  numeroEmpleado: "EMP-B13-001",
  nombre: "Conductor",
  apellidos: "Target B13",
  dni: "00000001T",
  categoria: "conductor",
  fechaAntiguedad: new Date("2020-01-01T00:00:00Z"),
  fechaIncorporacion: new Date("2020-01-01T00:00:00Z"),
  estado: "activo",
  lineasPreferentes: [],
  lineasSecundarias: [],
  tiposTurnoPermitidos: [],
  puedeSerReserva: false,
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
};

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  // 1. Limpiar Auth users b13 (todos, incluido huérfano por si quedó de un run
  //    anterior que lo hubiera creado).
  for (const uid of ALL_B13_UIDS) {
    await deleteUserIfExistsByUid(uid);
  }

  // 2. Crear Auth users: invocadores (con claims) + targets (con email,
  //    displayName, emailVerified). El huérfano NO se crea en Auth.
  for (const u of SEED_INVOCADORES) {
    await auth.createUser({ uid: u.uid, email: u.email });
    if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  }
  for (const u of SEED_TARGETS_AUTH) {
    await auth.createUser({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      emailVerified: u.emailVerified,
    });
  }

  // 3. Tenant + Centro + Conductor.
  await db.collection("tenants").doc(SEED_TENANT.id).set(SEED_TENANT);
  await db.collection("centros").doc(SEED_CENTRO.id).set(SEED_CENTRO);
  await db.collection("conductores").doc(SEED_CONDUCTOR.id).set(SEED_CONDUCTOR);

  // 4. /usuarios docs para los 5 targets (incluye el huérfano doc-only).
  for (const doc of SEED_USUARIO_DOCS) {
    await db.collection("usuarios").doc(doc.id).set(doc);
  }

  // 5. Limpieza idempotente: borrar /usuarios y /conductores b13 que NO sean
  //    de este seed (e.g. residuos de runs anteriores con otros ids). NO
  //    tocamos prefijos b11/b10 ni admin@albius.local para convivir con otros
  //    verifies.
  const seedUsuarioIds = new Set(SEED_USUARIO_DOCS.map((d) => d.id));
  const allUsuarios = await db.collection("usuarios").get();
  for (const u of allUsuarios.docs) {
    if (
      (u.id.startsWith("usuario_") && u.id.endsWith("_b13")) ||
      u.id.endsWith("_b13")
    ) {
      if (!seedUsuarioIds.has(u.id)) await u.ref.delete();
    }
  }
  const allConductores = await db.collection("conductores").get();
  for (const cd of allConductores.docs) {
    if (cd.id.startsWith(`${TENANT_ID}_`) && cd.id !== CONDUCTOR_ID) {
      await cd.ref.delete();
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

async function getUsuario(uid) {
  const snap = await db.collection("usuarios").doc(uid).get();
  return snap.data() || {};
}

// ============================================================================
//  Main: 22 casos
// ============================================================================

const A1_NOMBRE = "Jefe Renombrado A1";

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_b13_uid");
  const tokenJefe = await getIdTokenFor("jefe_b13_uid");

  console.log("=== actualizarUsuario ===\n");

  // ----- A1: super_admin cambia nombreCompleto (dual write) -----
  {
    const payload = {
      usuarioId: "usuario_jefe_b13",
      nombreCompleto: A1_NOMBRE,
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A1 (cambia nombreCompleto)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = await getUsuario("usuario_jefe_b13");
      const authUser = await auth.getUser("usuario_jefe_b13");
      const docOK =
        doc.nombreCompleto === A1_NOMBRE &&
        doc.actualizadoPor === "admin_b13_uid" &&
        doc.actualizadoEn !== undefined &&
        authUser.displayName === A1_NOMBRE;
      record(
        "A1 (cambia nombreCompleto)",
        "doc.nombreCompleto + Auth.displayName cambiados + actualizadoPor/En",
        `doc.nombreCompleto=${doc.nombreCompleto}, Auth.displayName=${authUser.displayName}, actualizadoPor=${doc.actualizadoPor}, actualizadoEn=${doc.actualizadoEn !== undefined ? "presente" : "ausente"}`,
        docOK,
      );
    }
  }

  // ----- A2: cambia telefono solo (NO toca Auth) -----
  {
    const payload = {
      usuarioId: "usuario_jefe_b13",
      telefono: "611111111",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A2 (cambia telefono solo)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = await getUsuario("usuario_jefe_b13");
      const authUser = await auth.getUser("usuario_jefe_b13");
      // displayName debe seguir siendo el de A1 (Auth intacto).
      const docOK =
        doc.telefono === "611111111" &&
        doc.nombreCompleto === A1_NOMBRE &&
        authUser.displayName === A1_NOMBRE;
      record(
        "A2 (cambia telefono solo)",
        "doc.telefono cambiado + Auth.displayName intacto (no toca Auth)",
        `doc.telefono=${doc.telefono}, doc.nombreCompleto=${doc.nombreCompleto}, Auth.displayName=${authUser.displayName}`,
        docOK,
      );
    }
  }

  // ----- A3: cambia email (dual write + emailVerified=false) -----
  {
    const payload = {
      usuarioId: "usuario_jefe_b13",
      email: "jefe-nuevo-b13@albius.test",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A3 (cambia email)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = await getUsuario("usuario_jefe_b13");
      const authUser = await auth.getUser("usuario_jefe_b13");
      const docOK =
        doc.email === "jefe-nuevo-b13@albius.test" &&
        authUser.email === "jefe-nuevo-b13@albius.test" &&
        authUser.emailVerified === false;
      record(
        "A3 (cambia email)",
        "doc.email + Auth.email cambiados + emailVerified=false (reset por updateUser)",
        `doc.email=${doc.email}, Auth.email=${authUser.email}, emailVerified=${authUser.emailVerified}`,
        docOK,
      );
    }
  }

  // ----- A4: suspende activo→suspendido (NO toca auth.disabled) -----
  {
    const before = await auth.getUser("usuario_suspendible_b13");
    const payload = {
      usuarioId: "usuario_suspendible_b13",
      estado: "suspendido",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A4 (suspende)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = await getUsuario("usuario_suspendible_b13");
      const after = await auth.getUser("usuario_suspendible_b13");
      const docOK =
        doc.estado === "suspendido" &&
        before.disabled === false &&
        after.disabled === false; // DECISIÓN 4: Auth.disabled intacto
      record(
        "A4 (suspende)",
        "doc.estado=suspendido + Auth.disabled sigue false (DECISIÓN 4)",
        `doc.estado=${doc.estado}, Auth.disabled antes=${before.disabled} despues=${after.disabled}`,
        docOK,
      );
    }
  }

  // ----- A5: reactiva suspendido→activo -----
  {
    const payload = {
      usuarioId: "usuario_suspendible_b13",
      estado: "activo",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A5 (reactiva)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = await getUsuario("usuario_suspendible_b13");
      record(
        "A5 (reactiva)",
        "doc.estado=activo",
        `doc.estado=${doc.estado}`,
        doc.estado === "activo",
      );
    }
  }

  // ----- A6: combinado (nombre + telefono + email) sobre conductor -----
  {
    const payload = {
      usuarioId: "usuario_conductor_b13",
      nombreCompleto: "Conductor Renombrado A6",
      telefono: "622222222",
      email: "conductor-nuevo-b13@albius.test",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A6 (combinado)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = await getUsuario("usuario_conductor_b13");
      const authUser = await auth.getUser("usuario_conductor_b13");
      const docOK =
        doc.nombreCompleto === "Conductor Renombrado A6" &&
        doc.telefono === "622222222" &&
        doc.email === "conductor-nuevo-b13@albius.test" &&
        authUser.displayName === "Conductor Renombrado A6" &&
        authUser.email === "conductor-nuevo-b13@albius.test";
      record(
        "A6 (combinado)",
        "doc + Auth: nombre + telefono + email aplicados",
        `doc.nombre=${doc.nombreCompleto}, doc.telefono=${doc.telefono}, doc.email=${doc.email}, Auth.displayName=${authUser.displayName}, Auth.email=${authUser.email}`,
        docOK,
      );
    }
  }

  // ----- A7: veto rol → INVALID_ARGUMENT "cambiarRolUsuario" -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", rol: "super_admin" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A7 (veto rol)", "INVALID_ARGUMENT", r, (res) =>
      /cambiarRolUsuario/.test(res.message)
        ? true
        : "mensaje no menciona 'cambiarRolUsuario'",
    );
  }

  // ----- A8: veto tenantId → INVALID_ARGUMENT "moverUsuario" -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", tenantId: "otro" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A8 (veto tenantId)", "INVALID_ARGUMENT", r, (res) =>
      /moverUsuario/.test(res.message)
        ? true
        : "mensaje no menciona 'moverUsuario'",
    );
  }

  // ----- A9: veto centroId → INVALID_ARGUMENT "moverUsuario" -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", centroId: "otro" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A9 (veto centroId)", "INVALID_ARGUMENT", r, (res) =>
      /moverUsuario/.test(res.message)
        ? true
        : "mensaje no menciona 'moverUsuario'",
    );
  }

  // ----- A10: veto conductorId → INVALID_ARGUMENT "identidad del conductor" -
  {
    const payload = { usuarioId: "usuario_jefe_b13", conductorId: "x_1" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A10 (veto conductorId)", "INVALID_ARGUMENT", r, (res) =>
      /identidad del conductor/i.test(res.message)
        ? true
        : "mensaje no menciona 'identidad del conductor'",
    );
  }

  // ----- A11: veto id → INVALID_ARGUMENT -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", id: "otro_id" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A11 (veto id)", "INVALID_ARGUMENT", r, (res) =>
      /'id' no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona \"'id' no es editable\"",
    );
  }

  // ----- A12: veto creadoPor → INVALID_ARGUMENT -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", creadoPor: "x" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A12 (veto creadoPor)", "INVALID_ARGUMENT", r, (res) =>
      /'creadoPor' no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona \"'creadoPor' no es editable\"",
    );
  }

  // ----- A13: veto passwordChangeRequired → INVALID_ARGUMENT -----
  {
    const payload = {
      usuarioId: "usuario_jefe_b13",
      passwordChangeRequired: true,
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError(
      "A13 (veto passwordChangeRequired)",
      "INVALID_ARGUMENT",
      r,
      (res) =>
        /marcarPasswordCambiada/.test(res.message)
          ? true
          : "mensaje no menciona 'marcarPasswordCambiada'",
    );
  }

  // ----- A14: solo usuarioId sin campos → INVALID_ARGUMENT -----
  {
    const payload = { usuarioId: "usuario_jefe_b13" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A14 (solo usuarioId)", "INVALID_ARGUMENT", r, (res) =>
      /al menos un campo/i.test(res.message)
        ? true
        : "mensaje no menciona 'al menos un campo'",
    );
  }

  // ----- A15: usuario inexistente → INVALID_ARGUMENT "no existe" -----
  {
    const payload = {
      usuarioId: "usuario_inexistente_b13",
      nombreCompleto: "X",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A15 (usuario inexistente)", "INVALID_ARGUMENT", r, (res) =>
      /no existe/i.test(res.message)
        ? true
        : "mensaje no menciona 'no existe'",
    );
  }

  // ----- A16: email formato inválido → INVALID_ARGUMENT "email" -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", email: "no-es-email" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A16 (email inválido)", "INVALID_ARGUMENT", r, (res) =>
      /'email'/.test(res.message) ? true : "mensaje no menciona 'email'",
    );
  }

  // ----- A17: email duplicado → ALREADY_EXISTS + doc.email NO cambia ------
  // Verifica el orden Auth-primero (D5.4): el fallo aborta antes de Firestore.
  {
    const docBefore = await getUsuario("usuario_jefe_b13");
    const payload = {
      usuarioId: "usuario_jefe_b13",
      email: "ocupado-b13@albius.test", // ya usado por usuario_email_ocupado_b13
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (r.ok) {
      record("A17 (email duplicado)", "error code=ALREADY_EXISTS", "OK inesperado", false);
    } else {
      const docAfter = await getUsuario("usuario_jefe_b13");
      const pass =
        r.code === "ALREADY_EXISTS" && docAfter.email === docBefore.email;
      record(
        "A17 (email duplicado)",
        "ALREADY_EXISTS + doc.email SIN cambiar (Auth-primero aborta antes de Firestore)",
        `code=${r.code}, doc.email antes=${docBefore.email} despues=${docAfter.email}`,
        pass,
      );
    }
  }

  // ----- A18: estado inválido (cancelado) → INVALID_ARGUMENT -----
  {
    const payload = { usuarioId: "usuario_jefe_b13", estado: "cancelado" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A18 (estado inválido)", "INVALID_ARGUMENT", r, (res) =>
      /'estado'/.test(res.message) ? true : "mensaje no menciona 'estado'",
    );
  }

  // ----- A19: jefe_trafico invoca → PERMISSION_DENIED -----
  {
    const payload = {
      usuarioId: "usuario_jefe_b13",
      nombreCompleto: "Tocado por jefe",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenJefe);
    expectError("A19 (jefe invoca)", "PERMISSION_DENIED", r);
  }

  // ----- A20: anónimo invoca → UNAUTHENTICATED -----
  {
    const payload = {
      usuarioId: "usuario_jefe_b13",
      nombreCompleto: "Tocado anónimo",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, null);
    expectError("A20 (anónimo)", "UNAUTHENTICATED", r);
  }

  // ----- A21: no-op estado (payload.estado === doc.estado) -----
  // usuario_jefe_b13 está en 'activo'; enviar estado='activo' → no-op pero
  // SÍ escribe auditoría. Verificamos estado igual + audit refrescado.
  {
    const before = await getUsuario("usuario_jefe_b13");
    const payload = { usuarioId: "usuario_jefe_b13", estado: "activo" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("A21 (no-op estado)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const after = await getUsuario("usuario_jefe_b13");
      const pass =
        after.estado === "activo" &&
        before.estado === "activo" &&
        after.actualizadoPor === "admin_b13_uid" &&
        after.actualizadoEn !== undefined;
      record(
        "A21 (no-op estado)",
        "doc.estado sigue 'activo' + auditoría escrita (actualizadoPor/En)",
        `estado antes=${before.estado} despues=${after.estado}, actualizadoPor=${after.actualizadoPor}, actualizadoEn=${after.actualizadoEn !== undefined ? "presente" : "ausente"}`,
        pass,
      );
    }
  }

  // ----- A22: doc huérfano (sin Auth) + cambio email → FAILED_PRECONDITION --
  {
    const payload = {
      usuarioId: HUERFANO_UID,
      email: "huerfano-nuevo-b13@albius.test",
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("A22 (doc huérfano + email)", "FAILED_PRECONDITION", r, (res) =>
      /cuenta de Firebase Auth|Doc huérfano/i.test(res.message)
        ? true
        : "mensaje no menciona doc huérfano / cuenta Auth",
    );
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
