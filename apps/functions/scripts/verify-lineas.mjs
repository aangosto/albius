// verify-lineas.mjs
//
// Verificación empírica de los callables `crearLinea` y `actualizarLinea`
// contra los emulators Auth + Firestore + Functions (B16 Sesión 7).
//
// Requisitos previos: emulator arrancado (por ejemplo
// `npm --prefix apps/functions run serve`, o `npx firebase emulators:start`).
//
// Ejecución (desde la raíz del repo):
//   node apps/functions/scripts/verify-lineas.mjs
//
// Sin dependencias nuevas: firebase-admin (ya en node_modules) + fetch nativo
// Node 20+. Helpers locales duplicados de verify-centros.mjs
// (TODO[refactor-verify-helpers] sigue en deuda).
//
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed específico de B16:
//   - 1 tenant activo (tenant_seed_b16).
//   - 3 centros: activo (centro del jefe) + inactivo (D5.2 failed-precondition)
//     + otro_activo (mismo tenant, para anti-cross-centro del jefe).
//   - 4 líneas seed con id explícito: existente ("10" en centro activo, para
//     colisión D6.3 + target de update), otrocentro ("10" en otro_activo,
//     demuestra unicidad POR centro), editable ("99", campos de update),
//     transiciones ("T1", las 3 transiciones de estado).
//   - 3 usuarios: super_admin, jefe (tenant+centro activo), conductor.

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
const CALLABLE_URL_CREAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/crearLinea`;
const CALLABLE_URL_ACTUALIZAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/actualizarLinea`;
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

const TENANT_ID = "tenant_seed_b16";
const CENTRO_ACTIVO = "centro_seed_b16_activo";
const CENTRO_INACTIVO = "centro_seed_b16_inactivo";
const CENTRO_OTRO = "centro_seed_b16_otro_activo";

const SEED_USERS = [
  {
    uid: "admin_b16_uid",
    email: "admin-b16@albius.test",
    claims: { rol: "super_admin" },
  },
  {
    uid: "jefe_b16_uid",
    email: "jefe-b16@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b16_uid",
    email: "conductor-b16@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
];

const SEED_TENANTS = [
  {
    id: TENANT_ID,
    data: {
      id: TENANT_ID,
      nombre: "Tenant B16 SL",
      cif: "A16161610",
      comunidadAutonoma: "Murcia",
      provincia: "Murcia",
      plan: "basico",
      estado: "activo",
      fechaAlta: FieldValue.serverTimestamp(),
      configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  },
];

function makeCentro(id, estado, nombre) {
  return {
    id,
    data: {
      id,
      tenantId: TENANT_ID,
      nombre,
      ciudad: "Cartagena",
      provincia: "Murcia",
      estado,
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "system-seed",
      creadoEn: FieldValue.serverTimestamp(),
    },
  };
}

const SEED_CENTROS = [
  makeCentro(CENTRO_ACTIVO, "activo", "Centro B16 Activo (del jefe)"),
  makeCentro(CENTRO_INACTIVO, "inactivo", "Centro B16 Inactivo"),
  makeCentro(CENTRO_OTRO, "activo", "Centro B16 Otro Activo"),
];

function makeLinea(id, centroId, codigo, nombre, estado = "activa") {
  return {
    id,
    tenantId: TENANT_ID,
    centroId,
    codigo,
    nombre,
    tipo: "urbana",
    esNocturna: false,
    estado,
    paradasIda: [],
    paradasVuelta: [],
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
  };
}

const SEED_LINEAS = [
  // "10" en centro activo → colisión D6.3 (L11) + target de algunos update.
  makeLinea("linea_seed_b16_existente", CENTRO_ACTIVO, "10", "Línea 10 seed"),
  // "10" en otro centro → demuestra unicidad POR centro (L12 alta de "10" en
  // CENTRO_OTRO debe colisionar; "10" en otro centro distinto del activo NO).
  makeLinea("linea_seed_b16_otrocentro", CENTRO_OTRO, "20", "Línea 20 seed"),
  // "99" en centro activo → campos editables (L19-L26).
  makeLinea("linea_seed_b16_editable", CENTRO_ACTIVO, "99", "Línea 99 seed"),
  // "T1" en centro activo → transiciones de estado (L27).
  makeLinea("linea_seed_b16_transiciones", CENTRO_ACTIVO, "T1", "Línea T1 seed"),
];

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  for (const u of SEED_USERS) {
    await deleteUserIfExistsByUid(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  }
  for (const t of SEED_TENANTS) {
    await db.collection("tenants").doc(t.id).set(t.data);
  }
  for (const c of SEED_CENTROS) {
    await db.collection("centros").doc(c.id).set(c.data);
  }
  for (const l of SEED_LINEAS) {
    await db.collection("lineas").doc(l.id).set(l);
  }
  // Limpieza idempotente: borrar líneas NO seed-b16 (auto-id de runs anteriores
  // de crearLinea) para que las colisiones de código no arrastren basura.
  const allLineas = await db.collection("lineas").get();
  for (const l of allLineas.docs) {
    if (!l.id.startsWith("linea_seed_b16_")) {
      await l.ref.delete();
    }
  }
  // Borrar centros NO seed-b16 (no interferir con verify-centros).
  const allCentros = await db.collection("centros").get();
  for (const c of allCentros.docs) {
    if (!c.id.startsWith("centro_seed_b16_")) {
      await c.ref.delete();
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
    record(name, `error code=${expectedCode}`, `OK inesperado (sin error)`, false);
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

async function getLinea(id) {
  const snap = await db.collection("lineas").doc(id).get();
  return snap.exists ? snap.data() : null;
}

// ============================================================================
//  Main
// ============================================================================

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_b16_uid");
  const tokenJefe = await getIdTokenFor("jefe_b16_uid");
  const tokenConductor = await getIdTokenFor("conductor_b16_uid");

  const base = {
    tenantId: TENANT_ID,
    centroId: CENTRO_ACTIVO,
    tipo: "urbana",
    esNocturna: false,
    estado: "activa",
  };

  console.log("=== crearLinea ===\n");

  // ----- L1: super_admin + alta mínima (paradas vacías default) -----
  {
    const payload = { ...base, codigo: "L1", nombre: "Línea L1 mínima" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record("L1 (alta mínima)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getLinea(r.body.lineaId)) || {};
      const ok =
        doc.codigo === "L1" &&
        doc.tipo === "urbana" &&
        doc.esNocturna === false &&
        doc.estado === "activa" &&
        Array.isArray(doc.paradasIda) &&
        doc.paradasIda.length === 0 &&
        Array.isArray(doc.paradasVuelta) &&
        doc.paradasVuelta.length === 0 &&
        doc.color === undefined &&
        doc.vigenciaDesde === undefined &&
        doc.observaciones === undefined &&
        doc.creadoPor === "admin_b16_uid" &&
        doc.actualizadoPor === undefined;
      record(
        "L1 (alta mínima)",
        "doc con paradas=[], estado=activa, creadoPor=admin, SIN color/vigencia/observaciones/actualizado*",
        `codigo=${doc.codigo}, paradasIda=${JSON.stringify(doc.paradasIda)}, color=${doc.color}, creadoPor=${doc.creadoPor}, actualizadoPor=${doc.actualizadoPor}`,
        ok,
      );
    }
  }

  // ----- L2: super_admin + alta completa (color, vigencia, observaciones) ---
  {
    const payload = {
      ...base,
      codigo: "L2",
      nombre: "Línea L2 completa",
      tipo: "interurbana",
      esNocturna: true,
      estado: "suspendida",
      color: "#1F77B4",
      paradasIda: ["p1", "p2"],
      paradasVuelta: ["p2", "p1"],
      vigenciaDesde: "2026-06-01T00:00:00Z",
      vigenciaHasta: "2026-09-30T00:00:00Z",
      observaciones: "Línea estacional de verano",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record("L2 (alta completa)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getLinea(r.body.lineaId)) || {};
      const ok =
        doc.color === "#1F77B4" &&
        doc.tipo === "interurbana" &&
        doc.esNocturna === true &&
        doc.estado === "suspendida" &&
        JSON.stringify(doc.paradasIda) === JSON.stringify(["p1", "p2"]) &&
        doc.vigenciaDesde !== undefined &&
        doc.vigenciaHasta !== undefined &&
        doc.observaciones === "Línea estacional de verano";
      record(
        "L2 (alta completa)",
        "doc con color HEX, tipo interurbana, vigencia Timestamps, observaciones",
        `color=${doc.color}, tipo=${doc.tipo}, vigenciaDesde=${doc.vigenciaDesde !== undefined ? "presente" : "ausente"}, observaciones=${doc.observaciones}`,
        ok,
      );
    }
  }

  // ----- L3: codigo vacío → INVALID_ARGUMENT 'codigo' -----
  {
    const payload = { ...base, codigo: "", nombre: "X" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L3 (codigo vacío)", "INVALID_ARGUMENT", r, (res) =>
      /'codigo'/.test(res.message) ? true : "mensaje no menciona 'codigo'",
    );
  }

  // ----- L4: nombre vacío → INVALID_ARGUMENT 'nombre' -----
  {
    const payload = { ...base, codigo: "L4", nombre: "" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L4 (nombre vacío)", "INVALID_ARGUMENT", r, (res) =>
      /'nombre'/.test(res.message) ? true : "mensaje no menciona 'nombre'",
    );
  }

  // ----- L5: tipo inválido → INVALID_ARGUMENT 'tipo' -----
  {
    const payload = { ...base, codigo: "L5", nombre: "X", tipo: "metro" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L5 (tipo inválido)", "INVALID_ARGUMENT", r, (res) =>
      /'tipo'/.test(res.message) ? true : "mensaje no menciona 'tipo'",
    );
  }

  // ----- L6: estado inválido → INVALID_ARGUMENT 'estado' -----
  {
    const payload = { ...base, codigo: "L6", nombre: "X", estado: "activo" }; // 'activo' no es válido (es 'activa')
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L6 (estado inválido)", "INVALID_ARGUMENT", r, (res) =>
      /'estado'/.test(res.message) ? true : "mensaje no menciona 'estado'",
    );
  }

  // ----- L7: color HEX malformado → INVALID_ARGUMENT 'color' -----
  {
    const payload = { ...base, codigo: "L7", nombre: "X", color: "azul" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L7 (color HEX malformado)", "INVALID_ARGUMENT", r, (res) =>
      /'color'/.test(res.message) ? true : "mensaje no menciona 'color'",
    );
  }

  // ----- L8: vigenciaDesde >= vigenciaHasta → INVALID_ARGUMENT -----
  {
    const payload = {
      ...base,
      codigo: "L8",
      nombre: "X",
      vigenciaDesde: "2026-09-30T00:00:00Z",
      vigenciaHasta: "2026-06-01T00:00:00Z",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L8 (vigenciaDesde>=Hasta)", "INVALID_ARGUMENT", r, (res) =>
      /anterior a 'vigenciaHasta'/.test(res.message)
        ? true
        : "mensaje no menciona 'anterior a vigenciaHasta'",
    );
  }

  // ----- L9: centro inexistente → INVALID_ARGUMENT 'no existe' -----
  {
    const payload = {
      ...base,
      centroId: "centro_inexistente_b16",
      codigo: "L9",
      nombre: "X",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L9 (centro inexistente)", "INVALID_ARGUMENT", r, (res) =>
      /no existe/i.test(res.message) ? true : "mensaje no menciona 'no existe'",
    );
  }

  // ----- L10: centro inactivo → FAILED_PRECONDITION 'no está activo' -----
  {
    const payload = {
      ...base,
      centroId: CENTRO_INACTIVO,
      codigo: "L10",
      nombre: "X",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L10 (centro inactivo)", "FAILED_PRECONDITION", r, (res) =>
      /no está activo/i.test(res.message)
        ? true
        : "mensaje no menciona 'no está activo'",
    );
  }

  // ----- L11: mismo codigo+centro (D6.3) → ALREADY_EXISTS -----
  {
    const payload = { ...base, codigo: "10", nombre: "Colisión con seed" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    expectError("L11 (codigo duplicado en centro)", "ALREADY_EXISTS", r, (res) =>
      /código '10'/.test(res.message)
        ? true
        : "mensaje no menciona \"código '10'\"",
    );
  }

  // ----- L12: mismo codigo distinto centro → OK (unicidad POR centro) -----
  {
    // "10" ya existe en CENTRO_ACTIVO pero NO en CENTRO_OTRO → debe permitirse.
    const payload = {
      ...base,
      centroId: CENTRO_OTRO,
      codigo: "10",
      nombre: "Línea 10 en otro centro",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenAdmin);
    if (!r.ok) {
      record(
        "L12 (mismo codigo distinto centro)",
        "200 ok=true (unicidad es POR centro)",
        `error: ${r.message}`,
        false,
      );
    } else {
      const doc = (await getLinea(r.body.lineaId)) || {};
      record(
        "L12 (mismo codigo distinto centro)",
        "doc creado con codigo=10 en CENTRO_OTRO",
        `codigo=${doc.codigo}, centroId=${doc.centroId}`,
        doc.codigo === "10" && doc.centroId === CENTRO_OTRO,
      );
    }
  }

  // ----- L13: jefe crea en SU centro → OK -----
  {
    const payload = { ...base, codigo: "J1", nombre: "Línea del jefe" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenJefe);
    if (!r.ok) {
      record("L13 (jefe en su centro)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getLinea(r.body.lineaId)) || {};
      record(
        "L13 (jefe en su centro)",
        "doc creado, creadoPor=jefe_b16_uid",
        `codigo=${doc.codigo}, creadoPor=${doc.creadoPor}`,
        doc.codigo === "J1" && doc.creadoPor === "jefe_b16_uid",
      );
    }
  }

  // ----- L14: jefe crea en OTRO centro (mismo tenant) → PERMISSION_DENIED -----
  {
    const payload = {
      ...base,
      centroId: CENTRO_OTRO,
      codigo: "J2",
      nombre: "X",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenJefe);
    expectError("L14 (jefe en otro centro)", "PERMISSION_DENIED", r, (res) =>
      /otro centro/i.test(res.message)
        ? true
        : "mensaje no menciona 'otro centro'",
    );
  }

  // ----- L15: jefe crea en OTRO tenant → PERMISSION_DENIED -----
  {
    const payload = {
      ...base,
      tenantId: "tenant_otro_b16",
      codigo: "J3",
      nombre: "X",
    };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenJefe);
    expectError("L15 (jefe en otro tenant)", "PERMISSION_DENIED", r, (res) =>
      /otro tenant/i.test(res.message)
        ? true
        : "mensaje no menciona 'otro tenant'",
    );
  }

  // ----- L16: conductor → PERMISSION_DENIED -----
  {
    const payload = { ...base, codigo: "L16", nombre: "X" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, tokenConductor);
    expectError("L16 (conductor)", "PERMISSION_DENIED", r);
  }

  // ----- L17: anónimo → UNAUTHENTICATED -----
  {
    const payload = { ...base, codigo: "L17", nombre: "X" };
    const r = await invokeCallable(CALLABLE_URL_CREAR, payload, null);
    expectError("L17 (anónimo)", "UNAUTHENTICATED", r);
  }

  console.log("\n=== actualizarLinea ===\n");

  // ----- L18: editar nombre + auditoría D4.1 -----
  {
    const payload = {
      lineaId: "linea_seed_b16_editable",
      nombre: "Línea 99 renombrada",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record("L18 (editar nombre)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getLinea("linea_seed_b16_editable")) || {};
      const ok =
        doc.nombre === "Línea 99 renombrada" &&
        doc.actualizadoPor === "admin_b16_uid" &&
        doc.actualizadoEn !== undefined;
      record(
        "L18 (editar nombre)",
        "nombre cambiado + actualizadoPor=admin + actualizadoEn presente",
        `nombre=${doc.nombre}, actualizadoPor=${doc.actualizadoPor}, actualizadoEn=${doc.actualizadoEn !== undefined ? "presente" : "ausente"}`,
        ok,
      );
    }
  }

  // ----- L19: veto centroId → INVALID_ARGUMENT -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", centroId: CENTRO_OTRO };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L19 (veto centroId)", "INVALID_ARGUMENT", r, (res) =>
      /centroId no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona 'centroId no es editable'",
    );
  }

  // ----- L20: veto tenantId → INVALID_ARGUMENT -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", tenantId: "otro" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L20 (veto tenantId)", "INVALID_ARGUMENT", r, (res) =>
      /tenantId no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona 'tenantId no es editable'",
    );
  }

  // ----- L21: veto id → INVALID_ARGUMENT -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", id: "otro_id" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L21 (veto id)", "INVALID_ARGUMENT", r, (res) =>
      /'id'.*no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona \"'id' no es editable\"",
    );
  }

  // ----- L22: veto creadoPor → INVALID_ARGUMENT -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", creadoPor: "x" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L22 (veto creadoPor)", "INVALID_ARGUMENT", r, (res) =>
      /'creadoPor' no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona 'creadoPor no es editable'",
    );
  }

  // ----- L23: veto creadoEn → INVALID_ARGUMENT -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", creadoEn: "x" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L23 (veto creadoEn)", "INVALID_ARGUMENT", r, (res) =>
      /'creadoEn' no es editable/i.test(res.message)
        ? true
        : "mensaje no menciona 'creadoEn no es editable'",
    );
  }

  // ----- L24: payload solo lineaId → INVALID_ARGUMENT 'al menos un campo' -----
  {
    const payload = { lineaId: "linea_seed_b16_editable" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L24 (solo lineaId)", "INVALID_ARGUMENT", r, (res) =>
      /al menos un campo/i.test(res.message)
        ? true
        : "mensaje no menciona 'al menos un campo'",
    );
  }

  // ----- L25: cambiar codigo a uno libre → OK (revalidación pasa) -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", codigo: "99B" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    if (!r.ok) {
      record("L25 (cambiar codigo libre)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getLinea("linea_seed_b16_editable")) || {};
      record(
        "L25 (cambiar codigo libre)",
        "doc.codigo=99B",
        `codigo=${doc.codigo}`,
        doc.codigo === "99B",
      );
    }
  }

  // ----- L26: cambiar codigo a uno colisionante ("10") → ALREADY_EXISTS -----
  {
    const payload = { lineaId: "linea_seed_b16_editable", codigo: "10" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L26 (cambiar codigo a duplicado)", "ALREADY_EXISTS", r, (res) =>
      /código '10'/.test(res.message)
        ? true
        : "mensaje no menciona \"código '10'\"",
    );
  }

  // ----- L27: 3 transiciones de estado activa→suspendida→inactiva→activa -----
  {
    const transiciones = [
      ["suspendida", "activa→suspendida"],
      ["inactiva", "suspendida→inactiva"],
      ["activa", "inactiva→activa"],
    ];
    for (const [estado, label] of transiciones) {
      const payload = { lineaId: "linea_seed_b16_transiciones", estado };
      const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
      if (!r.ok) {
        record(`L27 (${label})`, "200 ok=true", `error: ${r.message}`, false);
      } else {
        const doc = (await getLinea("linea_seed_b16_transiciones")) || {};
        record(
          `L27 (${label})`,
          `doc.estado=${estado}`,
          `doc.estado=${doc.estado}`,
          doc.estado === estado,
        );
      }
    }
  }

  // ----- L28: estado inválido en update → INVALID_ARGUMENT -----
  {
    const payload = { lineaId: "linea_seed_b16_transiciones", estado: "muerta" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L28 (estado inválido update)", "INVALID_ARGUMENT", r, (res) =>
      /'estado'/.test(res.message) ? true : "mensaje no menciona 'estado'",
    );
  }

  // ----- L29: línea inexistente → INVALID_ARGUMENT 'no existe' -----
  {
    const payload = { lineaId: "linea_inexistente_b16", nombre: "X" };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenAdmin);
    expectError("L29 (línea inexistente)", "INVALID_ARGUMENT", r, (res) =>
      /no existe/i.test(res.message) ? true : "mensaje no menciona 'no existe'",
    );
  }

  // ----- L30: jefe edita línea de SU centro → OK -----
  {
    const payload = {
      lineaId: "linea_seed_b16_existente",
      nombre: "Línea 10 tocada por jefe",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenJefe);
    if (!r.ok) {
      record("L30 (jefe edita su centro)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getLinea("linea_seed_b16_existente")) || {};
      record(
        "L30 (jefe edita su centro)",
        "nombre cambiado + actualizadoPor=jefe_b16_uid",
        `nombre=${doc.nombre}, actualizadoPor=${doc.actualizadoPor}`,
        doc.nombre === "Línea 10 tocada por jefe" &&
          doc.actualizadoPor === "jefe_b16_uid",
      );
    }
  }

  // ----- L31: jefe edita línea de OTRO centro → PERMISSION_DENIED -----
  {
    // linea_seed_b16_otrocentro vive en CENTRO_OTRO, no en el centro del jefe.
    const payload = {
      lineaId: "linea_seed_b16_otrocentro",
      nombre: "Intento del jefe",
    };
    const r = await invokeCallable(CALLABLE_URL_ACTUALIZAR, payload, tokenJefe);
    expectError("L31 (jefe edita otro centro)", "PERMISSION_DENIED", r, (res) =>
      /otro centro/i.test(res.message)
        ? true
        : "mensaje no menciona 'otro centro'",
    );
  }

  // ==========================================================================
  //  Resumen
  // ==========================================================================
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
