// verify-centros.mjs
//
// Verificación empírica de los callables `crearCentro` y `actualizarCentro`
// contra los emulators Auth + Firestore + Functions (B11 Sesión 5).
//
// Requisitos previos: emulator arrancado (por ejemplo
// `npm --prefix apps/functions run serve`).
//
// Ejecución (desde la raíz del repo):
//   node apps/functions/scripts/verify-centros.mjs
//
// Sin dependencias nuevas: firebase-admin (ya en node_modules) + fetch nativo
// Node 20+. Las env vars de los emulators se setean ANTES de importar
// firebase-admin (dynamic import). Patrón establecido en verify-tenants.mjs
// (Bloque 9) y reusado aquí.
//
// Helpers locales (`signInWithCustomToken`, `invokeCallable`,
// `checkEmulatorsUp`, `record`, `expectError`) duplicados del verify
// existente — TODO[refactor-verify-helpers] sigue en deuda.
//
// expectedCode en UPPER_SNAKE_CASE (convención del proyecto B9): el wire
// protocol HTTPS Callable v2 serializa los códigos así.
//
// Seed específico de B11 (más complejo que verify-tenants por D4.6 cascada):
//   - 3 tenants (activo + suspendido + cancelado) para gates D5.1/D5.2.
//   - 3 centros (con-bloqueantes + sin-conductores + solo-baja-definitiva)
//     para casos D4.6 al inactivar.
//   - 5 conductores con distribución crítica:
//       * 3 bloqueantes (activo+baja_temporal+vacaciones) en centro "activo"
//       * 2 baja_definitiva en centro "solo_baja_definitiva"
//     La separación es deliberada: C15 verifica que la lista positiva
//     `ESTADOS_CONDUCTOR_BLOQUEANTES` funciona correctamente, así que el
//     centro "solo_baja_definitiva" NO debe contener ningún bloqueante.

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue, GeoPoint } = await import(
  "firebase-admin/firestore"
);

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const FIRESTORE_HOST = "127.0.0.1:8080";
const CALLABLE_URL_CREAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/crearCentro`;
const CALLABLE_URL_ACTUALIZAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/actualizarCentro`;
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

const SEED_USERS = [
  {
    uid: "admin_b11_uid",
    email: "admin-b11@albius.test",
    claims: { rol: "super_admin" },
  },
  {
    uid: "jefe_b11_uid",
    email: "jefe-b11@albius.test",
    claims: {
      rol: "jefe_trafico",
      tenantId: "tenant_seed_b11_activo",
      centroId: "centro_seed_b11_activo",
    },
  },
];

const SEED_TENANTS = [
  {
    id: "tenant_seed_b11_activo",
    data: {
      id: "tenant_seed_b11_activo",
      nombre: "Tenant B11 Activo SL",
      cif: "A11111110", // sintético, no se valida en este verify
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
    id: "tenant_seed_b11_suspendido",
    data: {
      id: "tenant_seed_b11_suspendido",
      nombre: "Tenant B11 Suspendido SA",
      cif: "A22222220",
      comunidadAutonoma: "Madrid",
      provincia: "Madrid",
      plan: "basico",
      estado: "suspendido",
      fechaAlta: FieldValue.serverTimestamp(),
      configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
  {
    id: "tenant_seed_b11_cancelado",
    data: {
      id: "tenant_seed_b11_cancelado",
      nombre: "Tenant B11 Cancelado SL",
      cif: "A33333330",
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
    id: "centro_seed_b11_activo",
    data: {
      id: "centro_seed_b11_activo",
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro B11 Activo (con conductores)",
      ciudad: "Madrid",
      provincia: "Madrid",
      estado: "activo",
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
  {
    id: "centro_seed_b11_sin_conductores",
    data: {
      id: "centro_seed_b11_sin_conductores",
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro B11 Sin Conductores",
      ciudad: "Madrid",
      provincia: "Madrid",
      estado: "activo",
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
  {
    id: "centro_seed_b11_solo_baja_definitiva",
    data: {
      id: "centro_seed_b11_solo_baja_definitiva",
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro B11 Solo Baja Definitiva",
      ciudad: "Madrid",
      provincia: "Madrid",
      estado: "activo",
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
];

// 5 conductores. Distribución crítica para D4.6:
//   - 3 BLOQUEANTES en centro_seed_b11_activo (activo + baja_temporal +
//     vacaciones): la query de assertNoConductoresActivosEnCentro
//     devolverá snap.size === 3 → mensaje "3 conductores" en C14.
//   - 2 NO BLOQUEANTES en centro_seed_b11_solo_baja_definitiva (ambos
//     en baja_definitiva): la query devolverá snap.empty → C15 OK.
//
// El centro centro_seed_b11_sin_conductores se queda vacío deliberadamente
// para C13 (caso happy-path de inactivación).
const ESTADO_FECHA_NEUTRA = new Date("2020-01-01T00:00:00Z");

function makeConductor(id, centroId, estado, numeroEmpleado) {
  return {
    id,
    tenantId: "tenant_seed_b11_activo",
    centroId,
    numeroEmpleado,
    nombre: `Conductor ${numeroEmpleado}`,
    apellidos: "Test B11",
    dni: `${numeroEmpleado}X`,
    categoria: "conductor",
    fechaAntiguedad: ESTADO_FECHA_NEUTRA,
    fechaIncorporacion: ESTADO_FECHA_NEUTRA,
    estado,
    lineasPreferentes: [],
    lineasSecundarias: [],
    tiposTurnoPermitidos: [],
    puedeSerReserva: false,
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
  };
}

const SEED_CONDUCTORES = [
  // 3 bloqueantes en centro_seed_b11_activo
  makeConductor(
    "cond_b11_activo",
    "centro_seed_b11_activo",
    "activo",
    "B11-001",
  ),
  makeConductor(
    "cond_b11_baja_temporal",
    "centro_seed_b11_activo",
    "baja_temporal",
    "B11-002",
  ),
  makeConductor(
    "cond_b11_vacaciones",
    "centro_seed_b11_activo",
    "vacaciones",
    "B11-003",
  ),
  // 2 no bloqueantes en centro_seed_b11_solo_baja_definitiva
  makeConductor(
    "cond_b11_baja_def_1",
    "centro_seed_b11_solo_baja_definitiva",
    "baja_definitiva",
    "B11-004",
  ),
  makeConductor(
    "cond_b11_baja_def_2",
    "centro_seed_b11_solo_baja_definitiva",
    "baja_definitiva",
    "B11-005",
  ),
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
  // Centros seed con id explícito
  for (const c of SEED_CENTROS) {
    await db.collection("centros").doc(c.id).set(c.data);
  }
  // Conductores seed con id explícito. A diferencia de TENANTS/CENTROS,
  // makeConductor devuelve el objeto plano directamente (sin envoltorio
  // {id, data}). Se usa `cd` completo como data y `cd.id` como clave.
  for (const cd of SEED_CONDUCTORES) {
    await db.collection("conductores").doc(cd.id).set(cd);
  }
  // Limpieza idempotente entre runs: borrar centros NO seed-b11 (e.g.
  // los auto-id creados por crearCentro de runs anteriores) y conductores
  // NO seed-b11. NO tocamos tenants con prefijos distintos para no
  // interferir con verify-tenants.mjs ni datos de otros verifies.
  const allCentros = await db.collection("centros").get();
  for (const c of allCentros.docs) {
    if (!c.id.startsWith("centro_seed_b11_")) {
      await c.ref.delete();
    }
  }
  const allConductores = await db.collection("conductores").get();
  for (const cd of allConductores.docs) {
    if (!cd.id.startsWith("cond_b11_")) {
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

// ============================================================================
//  Main: 22 casos
// ============================================================================

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_b11_uid");
  const tokenJefe = await getIdTokenFor("jefe_b11_uid");

  console.log("=== crearCentro ===\n");

  // ----- C1: super_admin + payload mínimo (sin direccion ni coordenadas) ---
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C1 (mínimo)",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record("C1 (super_admin + mínimo)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db.collection("centros").doc(r.body.centroId).get();
      const doc = snap.data() || {};
      const docOK =
        snap.exists &&
        doc.tenantId === "tenant_seed_b11_activo" &&
        doc.nombre === "Centro C1 (mínimo)" &&
        doc.ciudad === "Madrid" &&
        doc.provincia === "Madrid" &&
        doc.estado === "activo" &&
        doc.creadoPor === "admin_b11_uid" &&
        doc.actualizadoPor === undefined &&
        doc.actualizadoEn === undefined &&
        doc.direccion === undefined &&
        doc.coordenadas === undefined;
      record(
        "C1 (super_admin + mínimo)",
        "200 + doc con defaults D4.2 (estado=activo), creadoPor=admin_b11_uid, SIN actualizadoPor/En, SIN direccion/coordenadas",
        snap.exists
          ? `doc.id=${r.body.centroId}, estado=${doc.estado}, creadoPor=${doc.creadoPor}, direccion=${doc.direccion}, coordenadas=${doc.coordenadas}, actualizadoPor=${doc.actualizadoPor}`
          : "doc no creado",
        r.ok && docOK,
      );
    }
  }

  // ----- C2: super_admin + payload completo (con direccion + coordenadas) -
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C2 Completo",
      ciudad: "Barcelona",
      provincia: "Barcelona",
      direccion: "Av. Diagonal 123",
      coordenadas: { latitude: 41.3851, longitude: 2.1734 },
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record("C2 (completo con coordenadas)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db.collection("centros").doc(r.body.centroId).get();
      const doc = snap.data() || {};
      // GeoPoint del Admin SDK al leer: objeto con .latitude y .longitude
      const coord = doc.coordenadas;
      const coordOK =
        coord instanceof GeoPoint &&
        Math.abs(coord.latitude - 41.3851) < 1e-6 &&
        Math.abs(coord.longitude - 2.1734) < 1e-6;
      const docOK =
        snap.exists &&
        doc.direccion === "Av. Diagonal 123" &&
        doc.ciudad === "Barcelona" &&
        coordOK;
      record(
        "C2 (completo con coordenadas)",
        "doc con direccion + coordenadas GeoPoint(41.3851, 2.1734)",
        snap.exists
          ? `direccion=${doc.direccion}, coordenadas={lat:${coord?.latitude}, lon:${coord?.longitude}}, isGeoPoint=${coord instanceof GeoPoint}`
          : "no exists",
        docOK,
      );
    }
  }

  // ----- C3: tenantId inexistente → INVALID_ARGUMENT "no existe" -----
  {
    const payload = {
      tenantId: "tenant_inexistente_xxx_b11",
      nombre: "Centro C3",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C3 (tenant inexistente)", "INVALID_ARGUMENT", r, (res) =>
      /no existe/i.test(res.message)
        ? true
        : "mensaje no menciona 'no existe'",
    );
  }

  // ----- C4: tenant suspendido → FAILED_PRECONDITION "no está activo" -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_suspendido",
      nombre: "Centro C4",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError(
      "C4 (tenant suspendido)",
      "FAILED_PRECONDITION",
      r,
      (res) =>
        /no está activo/i.test(res.message)
          ? true
          : "mensaje no menciona 'no está activo'",
    );
  }

  // ----- C5: tenant cancelado → FAILED_PRECONDITION -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_cancelado",
      nombre: "Centro C5",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError(
      "C5 (tenant cancelado)",
      "FAILED_PRECONDITION",
      r,
      (res) =>
        /no está activo/i.test(res.message)
          ? true
          : "mensaje no menciona 'no está activo'",
    );
  }

  // ----- C6: jefe_trafico intenta crear → PERMISSION_DENIED -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C6",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenJefe);
    expectError("C6 (jefe intenta crear)", "PERMISSION_DENIED", r);
  }

  // ----- C7: anónimo → UNAUTHENTICATED -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C7",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, null);
    expectError("C7 (anónimo)", "UNAUTHENTICATED", r);
  }

  // ----- C8: payload sin nombre → INVALID_ARGUMENT "'nombre'" -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      ciudad: "Madrid",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C8 (sin nombre)", "INVALID_ARGUMENT", r, (res) =>
      /'nombre'/.test(res.message) ? true : "mensaje no menciona 'nombre'",
    );
  }

  // ----- C9: payload sin ciudad → INVALID_ARGUMENT "'ciudad'" -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C9",
      provincia: "Madrid",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C9 (sin ciudad)", "INVALID_ARGUMENT", r, (res) =>
      /'ciudad'/.test(res.message) ? true : "mensaje no menciona 'ciudad'",
    );
  }

  // ----- C10: latitude fuera de rango (91) → INVALID_ARGUMENT -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C10",
      ciudad: "Madrid",
      provincia: "Madrid",
      coordenadas: { latitude: 91, longitude: 0 },
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C10 (latitude fuera rango)", "INVALID_ARGUMENT", r, (res) =>
      /entre -90 y 90/.test(res.message)
        ? true
        : "mensaje no menciona 'entre -90 y 90'",
    );
  }

  // ----- C11: longitude no número → INVALID_ARGUMENT -----
  {
    const payload = {
      tenantId: "tenant_seed_b11_activo",
      nombre: "Centro C11",
      ciudad: "Madrid",
      provincia: "Madrid",
      coordenadas: { latitude: 40, longitude: "not-a-number" },
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("C11 (longitude no número)", "INVALID_ARGUMENT", r, (res) =>
      /entre -180 y 180/.test(res.message)
        ? true
        : "mensaje no menciona 'entre -180 y 180'",
    );
  }

  console.log("\n=== actualizarCentro ===\n");

  // ----- C12: actualizar nombre + auditoría D4.1 -----
  {
    const payload = {
      centroId: "centro_seed_b11_sin_conductores",
      nombre: "Centro Renombrado en C12",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record("C12 (actualizar nombre)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db
        .collection("centros")
        .doc("centro_seed_b11_sin_conductores")
        .get();
      const doc = snap.data() || {};
      const docOK =
        doc.nombre === "Centro Renombrado en C12" &&
        doc.actualizadoPor === "admin_b11_uid" &&
        doc.actualizadoEn !== undefined;
      record(
        "C12 (actualizar nombre)",
        "doc.nombre cambiado + actualizadoPor=admin_b11_uid + actualizadoEn presente",
        `doc.nombre=${doc.nombre}, actualizadoPor=${doc.actualizadoPor}, actualizadoEn=${doc.actualizadoEn !== undefined ? "presente" : "ausente"}`,
        docOK,
      );
    }
  }

  // ----- C13: inactivar centro_sin_conductores (D4.6 happy path) -----
  {
    const payload = {
      centroId: "centro_seed_b11_sin_conductores",
      estado: "inactivo",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record("C13 (inactivar sin conductores)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db
        .collection("centros")
        .doc("centro_seed_b11_sin_conductores")
        .get();
      const doc = snap.data() || {};
      const docOK = doc.estado === "inactivo";
      record(
        "C13 (inactivar sin conductores)",
        "doc.estado=inactivo",
        `doc.estado=${doc.estado}`,
        docOK,
      );
    }
  }

  // ----- C14: inactivar centro_activo con 3 conductores bloqueantes -----
  {
    const payload = {
      centroId: "centro_seed_b11_activo",
      estado: "inactivo",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError(
      "C14 (inactivar con 3 conductores bloqueantes)",
      "FAILED_PRECONDITION",
      r,
      (res) =>
        /3 conductores/.test(res.message)
          ? true
          : "mensaje no menciona el conteo '3 conductores'",
    );
  }

  // ----- C15: inactivar centro_solo_baja_definitiva (no bloquean) ---------
  {
    const payload = {
      centroId: "centro_seed_b11_solo_baja_definitiva",
      estado: "inactivo",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C15 (inactivar solo baja_definitiva)",
        "200 ok=true (baja_definitiva NO bloquea)",
        `error: ${r.message}`,
        false,
      );
    } else {
      const snap = await db
        .collection("centros")
        .doc("centro_seed_b11_solo_baja_definitiva")
        .get();
      const doc = snap.data() || {};
      const docOK = doc.estado === "inactivo";
      record(
        "C15 (inactivar solo baja_definitiva)",
        "doc.estado=inactivo (lista positiva ESTADOS_CONDUCTOR_BLOQUEANTES funciona)",
        `doc.estado=${doc.estado}`,
        docOK,
      );
    }
  }

  // ----- C16: reactivar centro inactivo → activo --------------------------
  // Reutilizamos centro_seed_b11_sin_conductores que C13 dejó inactivo.
  {
    const payload = {
      centroId: "centro_seed_b11_sin_conductores",
      estado: "activo",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record("C16 (reactivar)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db
        .collection("centros")
        .doc("centro_seed_b11_sin_conductores")
        .get();
      const doc = snap.data() || {};
      const docOK = doc.estado === "activo";
      record(
        "C16 (reactivar)",
        "doc.estado=activo",
        `doc.estado=${doc.estado}`,
        docOK,
      );
    }
  }

  // ----- C17: intentar cambiar tenantId → INVALID_ARGUMENT ----------------
  {
    const payload = {
      centroId: "centro_seed_b11_activo",
      tenantId: "tenant_seed_b11_suspendido",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError(
      "C17 (cambiar tenantId)",
      "INVALID_ARGUMENT",
      r,
      (res) =>
        /tenantId no es editable/i.test(res.message)
          ? true
          : "mensaje no menciona 'tenantId no es editable'",
    );
  }

  // ----- C18: intentar cambiar id → INVALID_ARGUMENT ----------------------
  {
    const payload = {
      centroId: "centro_seed_b11_activo",
      id: "otro_id_x",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError(
      "C18 (cambiar id)",
      "INVALID_ARGUMENT",
      r,
      (res) =>
        /'id'.*no es editable/i.test(res.message)
          ? true
          : "mensaje no menciona \"'id' no es editable\"",
    );
  }

  // ----- C19: payload solo con centroId → INVALID_ARGUMENT ----------------
  {
    const payload = { centroId: "centro_seed_b11_activo" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError(
      "C19 (solo centroId)",
      "INVALID_ARGUMENT",
      r,
      (res) =>
        /al menos un campo/i.test(res.message)
          ? true
          : "mensaje no menciona 'al menos un campo'",
    );
  }

  // ----- C20: centro inexistente → INVALID_ARGUMENT -----------------------
  {
    const payload = {
      centroId: "centro_inexistente_xxx_b11",
      nombre: "X",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError(
      "C20 (centro inexistente)",
      "INVALID_ARGUMENT",
      r,
      (res) =>
        /no existe/i.test(res.message)
          ? true
          : "mensaje no menciona 'no existe'",
    );
  }

  // ----- C21: jefe intenta actualizar → PERMISSION_DENIED -----------------
  {
    const payload = {
      centroId: "centro_seed_b11_activo",
      nombre: "Centro Tocado por Jefe",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenJefe);
    expectError("C21 (jefe actualiza)", "PERMISSION_DENIED", r);
  }

  // ----- C22: actualizar coordenadas (replace, GeoPoint nuevo) ------------
  {
    const payload = {
      centroId: "centro_seed_b11_activo",
      coordenadas: { latitude: 40.4168, longitude: -3.7038 },
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record("C22 (replace coordenadas)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const snap = await db
        .collection("centros")
        .doc("centro_seed_b11_activo")
        .get();
      const doc = snap.data() || {};
      const coord = doc.coordenadas;
      const coordOK =
        coord instanceof GeoPoint &&
        Math.abs(coord.latitude - 40.4168) < 1e-6 &&
        Math.abs(coord.longitude - (-3.7038)) < 1e-6;
      record(
        "C22 (replace coordenadas)",
        "doc.coordenadas = GeoPoint(40.4168, -3.7038)",
        `coordenadas={lat:${coord?.latitude}, lon:${coord?.longitude}}, isGeoPoint=${coord instanceof GeoPoint}`,
        coordOK,
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
