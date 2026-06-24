// verify-cuadrante.mjs
//
// Verificación empírica de B26 (Cuadrante + Asignaciones) contra los emulators
// Auth + Firestore + Functions.
//
// Ejecución (desde la raíz, con el emulator arrancado):
//   node apps/functions/scripts/verify-cuadrante.mjs
//
// Helpers locales duplicados de verify-convenio.mjs (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed: 1 tenant + 3 centros (activo del jefe / inactivo / otro activo) +
// 3 usuarios (super_admin, jefe, conductor). Sin cuadrantes ni asignaciones
// sembrados: el ciclo de vida se ejerce desde los callables bajo prueba.

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
const url = (fn) => `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${fn}`;
const U_CREAR = url("crearCuadrante");
const U_PUBLICAR = url("publicarCuadrante");
const U_CERRAR = url("cerrarCuadrante");
const U_CREAR_ASIG = url("crearAsignacion");
const U_ACT_ASIG = url("actualizarAsignacion");
const U_DEL_ASIG = url("eliminarAsignacion");
const U_LOTE = url("crearAsignacionesLote");
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

async function checkEmulatorsUp() {
  const probes = [AUTH_HOST, FUNCTIONS_HOST, FIRESTORE_HOST];
  const errors = [];
  for (const h of probes) {
    try {
      await fetch(`http://${h}/`, { method: "GET" });
    } catch (e) {
      errors.push(`  - ${h}: ${e.message}`);
    }
  }
  if (errors.length > 0) {
    console.error("\nEmulators no responden:\n" + errors.join("\n"));
    process.exit(2);
  }
}

async function signInWithCustomToken(customToken) {
  const resp = await fetch(AUTH_SIGNIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!resp.ok)
    throw new Error(`signIn fallo: ${resp.status} ${await resp.text()}`);
  return (await resp.json()).idToken;
}
async function getIdTokenFor(uid) {
  return signInWithCustomToken(await auth.createCustomToken(uid));
}

async function invokeCallable(u, data, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  let resp;
  try {
    resp = await fetch(u, {
      method: "POST",
      headers,
      body: JSON.stringify({ data }),
    });
  } catch (e) {
    return { ok: false, code: "network-error", message: e.message };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (resp.ok && body && body.result !== undefined) {
    return { ok: true, body: body.result, code: null, message: null };
  }
  const err = (body && body.error) || {};
  return {
    ok: false,
    body,
    code: err.status || err.code || `http-${resp.status}`,
    message: err.message || text,
  };
}

// ============================================================================
//  Seed
// ============================================================================

const TENANT_ID = "tenant_seed_b26";
const CENTRO_ACTIVO = "centro_seed_b26_activo";
const CENTRO_INACTIVO = "centro_seed_b26_inactivo";
const CENTRO_OTRO = "centro_seed_b26_otro";

const SEED_USERS = [
  { uid: "admin_b26_uid", email: "admin-b26@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b26_uid",
    email: "jefe-b26@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b26_uid",
    email: "conductor-b26@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
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
  makeCentro(CENTRO_ACTIVO, "activo", "Centro B26 Activo (del jefe)"),
  makeCentro(CENTRO_INACTIVO, "inactivo", "Centro B26 Inactivo"),
  makeCentro(CENTRO_OTRO, "activo", "Centro B26 Otro Activo"),
];

async function delUser(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}
async function deleteCollection(name, field, value) {
  const snap = await db.collection(name).where(field, "==", value).get();
  for (const d of snap.docs) await d.ref.delete();
}
async function seed() {
  for (const u of SEED_USERS) {
    await delUser(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    await auth.setCustomUserClaims(u.uid, u.claims);
  }
  await db.collection("tenants").doc(TENANT_ID).set({
    id: TENANT_ID,
    nombre: "Tenant B26 SL",
    cif: "A26262620",
    comunidadAutonoma: "Murcia",
    provincia: "Murcia",
    plan: "basico",
    estado: "activo",
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
  });
  for (const c of SEED_CENTROS) await db.collection("centros").doc(c.id).set(c.data);
  // Limpieza idempotente de cuadrantes + asignaciones previas del seed.
  await deleteCollection("cuadrantes", "tenantId", TENANT_ID);
  await deleteCollection("asignaciones", "tenantId", TENANT_ID);
}

// ============================================================================
//  Runner
// ============================================================================

const results = [];
function record(name, expected, actual, pass) {
  console.log(`${pass ? "[OK]  " : "[FAIL]"} ${name}`);
  console.log(`       esperado: ${expected}`);
  console.log(`       recibido: ${actual}`);
  results.push({ name, pass });
}
function expectError(name, expectedCode, result, extraCheck = null) {
  if (result.ok) {
    record(name, `error code=${expectedCode}`, "OK inesperado", false);
    return;
  }
  let pass = result.code === expectedCode;
  if (pass && extraCheck && extraCheck(result) !== true) pass = false;
  record(name, `error code=${expectedCode}`, `code=${result.code} msg="${result.message}"`, pass);
}
async function getCuad(id) {
  const s = await db.collection("cuadrantes").doc(id).get();
  return s.exists ? s.data() : null;
}
async function getAsig(id) {
  const s = await db.collection("asignaciones").doc(id).get();
  return s.exists ? s.data() : null;
}
const cuadId = (centro, año, mes) => `cua_${centro}_${año}_${mes}`;

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tAdmin = await getIdTokenFor("admin_b26_uid");
  const tJefe = await getIdTokenFor("jefe_b26_uid");
  const tCond = await getIdTokenFor("conductor_b26_uid");

  // ==========================================================================
  console.log("=== Ciclo de vida del cuadrante ===\n");
  // ==========================================================================
  const ID_LIFE = cuadId(CENTRO_ACTIVO, 2026, 7);

  // L1 — crear borrador
  {
    const r = await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 7 }, tAdmin);
    if (!r.ok) record("L1 (crear borrador)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getCuad(ID_LIFE)) || {};
      const ok =
        r.body.cuadranteId === ID_LIFE &&
        d.estado === "borrador" &&
        d.versionActual === 1 &&
        d.generadoPor === "admin_b26_uid" &&
        d.creadoPor === "admin_b26_uid" &&
        d.modoGeneracion === "manual" &&
        d.creadoEn !== undefined &&
        d.actualizadoEn === undefined;
      record("L1 (crear borrador)", "id determinista, estado=borrador, v=1, modo=manual, creadoPor=admin",
        `id=${r.body.cuadranteId}, estado=${d.estado}, v=${d.versionActual}, modo=${d.modoGeneracion}, creadoPor=${d.creadoPor}`, ok);
    }
  }
  // L2 — duplicado
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 7 }, tAdmin)
    .then((r) => expectError("L2 (duplicado)", "ALREADY_EXISTS", r, (x) => /ya existe un cuadrante/i.test(x.message)));
  // L3 — publicar
  {
    const r = await invokeCallable(U_PUBLICAR, { cuadranteId: ID_LIFE }, tAdmin);
    if (!r.ok) record("L3 (publicar)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getCuad(ID_LIFE)) || {};
      const ok = d.estado === "publicado" && d.fechaPublicacion !== undefined && d.publicadoPor === "admin_b26_uid";
      record("L3 (publicar)", "estado=publicado, fechaPublicacion set, publicadoPor=admin",
        `estado=${d.estado}, fechaPub=${d.fechaPublicacion !== undefined}, publicadoPor=${d.publicadoPor}`, ok);
    }
  }
  // L4 — re-publicar
  await invokeCallable(U_PUBLICAR, { cuadranteId: ID_LIFE }, tAdmin)
    .then((r) => expectError("L4 (re-publicar)", "FAILED_PRECONDITION", r, (x) => /borrador/i.test(x.message)));
  // L5 — cerrar
  {
    const r = await invokeCallable(U_CERRAR, { cuadranteId: ID_LIFE }, tAdmin);
    if (!r.ok) record("L5 (cerrar)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getCuad(ID_LIFE)) || {};
      record("L5 (cerrar)", "estado=cerrado", `estado=${d.estado}`, d.estado === "cerrado");
    }
  }
  // L6 — re-cerrar
  await invokeCallable(U_CERRAR, { cuadranteId: ID_LIFE }, tAdmin)
    .then((r) => expectError("L6 (re-cerrar)", "FAILED_PRECONDITION", r, (x) => /publicado/i.test(x.message)));
  // L7 — publicar inexistente
  await invokeCallable(U_PUBLICAR, { cuadranteId: "cua_inexistente_b26" }, tAdmin)
    .then((r) => expectError("L7 (publicar inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));

  // ==========================================================================
  console.log("\n=== Validación de crearCuadrante ===\n");
  // ==========================================================================
  // V1 — mes 13
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 13 }, tAdmin)
    .then((r) => expectError("V1 (mes 13)", "INVALID_ARGUMENT", r, (x) => /mes/i.test(x.message)));
  // V2 — centro inexistente
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: "centro_inexistente_b26", año: 2026, mes: 5 }, tAdmin)
    .then((r) => expectError("V2 (centro inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // V3 — centro inactivo
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_INACTIVO, año: 2026, mes: 5 }, tAdmin)
    .then((r) => expectError("V3 (centro inactivo)", "FAILED_PRECONDITION", r, (x) => /no está activo/i.test(x.message)));
  // V4 — año fuera de rango
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 1999, mes: 5 }, tAdmin)
    .then((r) => expectError("V4 (año 1999)", "INVALID_ARGUMENT", r, (x) => /año/i.test(x.message)));

  // ==========================================================================
  console.log("\n=== Auth crearCuadrante (3 niveles + anti-cross) ===\n");
  // ==========================================================================
  const ID_JEFE = cuadId(CENTRO_ACTIVO, 2026, 8);
  // A1 — jefe su centro
  {
    const r = await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 8 }, tJefe);
    if (!r.ok) record("A1 (jefe su centro)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getCuad(ID_JEFE)) || {};
      record("A1 (jefe su centro)", "generadoPor=jefe", `generadoPor=${d.generadoPor}`, d.generadoPor === "jefe_b26_uid");
    }
  }
  // A2 — jefe otro centro
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_OTRO, año: 2026, mes: 8 }, tJefe)
    .then((r) => expectError("A2 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  // A3 — jefe otro tenant
  await invokeCallable(U_CREAR, { tenantId: "otro_tenant_b26", centroId: CENTRO_ACTIVO, año: 2026, mes: 8 }, tJefe)
    .then((r) => expectError("A3 (jefe otro tenant)", "PERMISSION_DENIED", r, (x) => /otro tenant/i.test(x.message)));
  // A4 — conductor
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 6 }, tCond)
    .then((r) => expectError("A4 (conductor)", "PERMISSION_DENIED", r));
  // A5 — anónimo
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 6 }, null)
    .then((r) => expectError("A5 (anónimo)", "UNAUTHENTICATED", r));

  // ==========================================================================
  console.log("\n=== Asignaciones (cuadrante en borrador) ===\n");
  // ==========================================================================
  const ID_BORR = cuadId(CENTRO_ACTIVO, 2026, 9);
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, año: 2026, mes: 9 }, tAdmin);

  const asigBase = {
    cuadranteId: ID_BORR,
    conductorId: "cond_test_b26",
    fecha: "2026-09-15",
    tipoAsignacion: "turno",
    tipoTurnoId: "tt_test_b26",
    horaInicio: "06:00",
    horaFin: "14:00",
  };

  let asigId = null;
  // AS1 — crear asignación turno
  {
    const r = await invokeCallable(U_CREAR_ASIG, { ...asigBase }, tAdmin);
    if (!r.ok) record("AS1 (crear turno)", "ok", `error: ${r.message}`, false);
    else {
      asigId = r.body.asignacionId;
      const d = (await getAsig(asigId)) || {};
      const ok =
        d.tenantId === TENANT_ID &&
        d.centroId === CENTRO_ACTIVO &&
        d.cuadranteId === ID_BORR &&
        d.tipoAsignacion === "turno" &&
        d.tipoTurnoId === "tt_test_b26" &&
        d.esIntercambiada === false &&
        d.estado === "planificada" &&
        d.creadoPor === "admin_b26_uid" &&
        d.creadoEn !== undefined &&
        d.fechaCreacion === undefined;
      record("AS1 (crear turno)", "tenant/centro derivados, esIntercambiada=false, estado=planificada, creadoEn (sin fechaCreacion)",
        `tenant=${d.tenantId}, centro=${d.centroId}, esInt=${d.esIntercambiada}, estado=${d.estado}, creadoEn=${d.creadoEn !== undefined}, fechaCreacion=${d.fechaCreacion}`, ok);
    }
  }
  // AS2 — turno sin tipoTurnoId
  {
    const { tipoTurnoId, ...sinTT } = asigBase;
    void tipoTurnoId;
    await invokeCallable(U_CREAR_ASIG, { ...sinTT }, tAdmin)
      .then((r) => expectError("AS2 (turno sin tipoTurnoId)", "INVALID_ARGUMENT", r, (x) => /tipoTurnoId/i.test(x.message)));
  }
  // AS3 — tipo 'libre' rechazado
  await invokeCallable(U_CREAR_ASIG, { ...asigBase, tipoAsignacion: "libre" }, tAdmin)
    .then((r) => expectError("AS3 (libre rechazado)", "INVALID_ARGUMENT", r, (x) => /libre/i.test(x.message)));
  // AS4 — fecha fuera del mes
  await invokeCallable(U_CREAR_ASIG, { ...asigBase, fecha: "2026-10-01" }, tAdmin)
    .then((r) => expectError("AS4 (fecha fuera de mes)", "INVALID_ARGUMENT", r, (x) => /fuera del mes/i.test(x.message)));
  // AS5 — vacaciones sin tipoTurnoId (ok)
  {
    const { tipoTurnoId, ...base } = asigBase;
    void tipoTurnoId;
    const r = await invokeCallable(U_CREAR_ASIG, { ...base, tipoAsignacion: "vacaciones", conductorId: "cond_vac" }, tAdmin);
    record("AS5 (vacaciones sin tipoTurnoId)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }
  // AS6 — actualizar (estado)
  {
    const r = await invokeCallable(U_ACT_ASIG, { asignacionId: asigId, estado: "en_curso" }, tAdmin);
    if (!r.ok) record("AS6 (actualizar estado)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getAsig(asigId)) || {};
      record("AS6 (actualizar estado)", "estado=en_curso, actualizadoPor=admin",
        `estado=${d.estado}, actualizadoPor=${d.actualizadoPor}`, d.estado === "en_curso" && d.actualizadoPor === "admin_b26_uid");
    }
  }
  // AS7 — veto cuadranteId en update
  await invokeCallable(U_ACT_ASIG, { asignacionId: asigId, cuadranteId: "otro" }, tAdmin)
    .then((r) => expectError("AS7 (veto cuadranteId)", "INVALID_ARGUMENT", r, (x) => /cuadranteId no es editable/i.test(x.message)));
  // AS8 — actualizar fecha fuera de mes
  await invokeCallable(U_ACT_ASIG, { asignacionId: asigId, fecha: "2026-11-01" }, tAdmin)
    .then((r) => expectError("AS8 (update fecha fuera de mes)", "INVALID_ARGUMENT", r, (x) => /fuera del mes/i.test(x.message)));
  // AS9 — crear y eliminar
  {
    const c = await invokeCallable(U_CREAR_ASIG, { ...asigBase, conductorId: "cond_del" }, tAdmin);
    const delId = c.ok ? c.body.asignacionId : null;
    const r = await invokeCallable(U_DEL_ASIG, { asignacionId: delId }, tAdmin);
    const gone = (await getAsig(delId)) === null;
    record("AS9 (eliminar)", "ok + doc borrado", `ok=${r.ok}, gone=${gone}`, r.ok && gone);
  }
  // AS10 — lote (3 items)
  {
    const items = [
      { conductorId: "cl1", fecha: "2026-09-01", tipoAsignacion: "turno", tipoTurnoId: "tt", horaInicio: "06:00", horaFin: "14:00" },
      { conductorId: "cl2", fecha: "2026-09-02", tipoAsignacion: "reserva_presencial", horaInicio: "08:00", horaFin: "16:00" },
      { conductorId: "cl3", fecha: "2026-09-03", tipoAsignacion: "baja", horaInicio: "00:00", horaFin: "23:59" },
    ];
    const r = await invokeCallable(U_LOTE, { cuadranteId: ID_BORR, asignaciones: items }, tAdmin);
    if (!r.ok) record("AS10 (lote x3)", "ok creadas=3", `error: ${r.message}`, false);
    else record("AS10 (lote x3)", "creadas=3", `creadas=${r.body.creadas}, ids=${r.body.asignacionIds?.length}`,
      r.body.creadas === 3 && r.body.asignacionIds?.length === 3);
  }
  // AS11 — lote con un item fuera de mes
  {
    const items = [
      { conductorId: "cx", fecha: "2026-09-05", tipoAsignacion: "turno", tipoTurnoId: "tt", horaInicio: "06:00", horaFin: "14:00" },
      { conductorId: "cy", fecha: "2026-10-05", tipoAsignacion: "turno", tipoTurnoId: "tt", horaInicio: "06:00", horaFin: "14:00" },
    ];
    await invokeCallable(U_LOTE, { cuadranteId: ID_BORR, asignaciones: items }, tJefe)
      .then((r) => expectError("AS11 (lote item fuera de mes)", "INVALID_ARGUMENT", r, (x) => /fuera del mes/i.test(x.message)));
  }
  // AS12 — crear asignación en cuadrante inexistente
  await invokeCallable(U_CREAR_ASIG, { ...asigBase, cuadranteId: "cua_inexistente_b26" }, tAdmin)
    .then((r) => expectError("AS12 (cuadrante inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // AS13 — jefe su centro crea asignación (auth ok)
  {
    const r = await invokeCallable(U_CREAR_ASIG, { ...asigBase, conductorId: "cond_jefe" }, tJefe);
    record("AS13 (jefe su centro crea)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }

  // ==========================================================================
  console.log("\n=== Asignaciones: anti-cross + cuadrante no editable ===\n");
  // ==========================================================================
  // Cuadrante en CENTRO_OTRO (borrador) → jefe del CENTRO_ACTIVO no puede tocarlo.
  const ID_OTRO = cuadId(CENTRO_OTRO, 2026, 11);
  await invokeCallable(U_CREAR, { tenantId: TENANT_ID, centroId: CENTRO_OTRO, año: 2026, mes: 11 }, tAdmin);
  // AX1 — jefe crea asignación en cuadrante de otro centro
  await invokeCallable(U_CREAR_ASIG, { cuadranteId: ID_OTRO, conductorId: "c", fecha: "2026-11-01", tipoAsignacion: "turno", tipoTurnoId: "tt", horaInicio: "06:00", horaFin: "14:00" }, tJefe)
    .then((r) => expectError("AX1 (jefe asignación otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro o tenant/i.test(x.message)));

  // Publicamos ID_BORR → asignaciones ya NO editables.
  await invokeCallable(U_PUBLICAR, { cuadranteId: ID_BORR }, tAdmin);
  // AX2 — crear asignación en cuadrante publicado
  await invokeCallable(U_CREAR_ASIG, { ...asigBase, conductorId: "cnew" }, tAdmin)
    .then((r) => expectError("AX2 (crear en publicado)", "FAILED_PRECONDITION", r, (x) => /no es editable/i.test(x.message)));
  // AX3 — actualizar asignación de cuadrante publicado
  await invokeCallable(U_ACT_ASIG, { asignacionId: asigId, estado: "completada" }, tAdmin)
    .then((r) => expectError("AX3 (actualizar en publicado)", "FAILED_PRECONDITION", r, (x) => /no es editable/i.test(x.message)));
  // AX4 — lote en cuadrante publicado
  await invokeCallable(U_LOTE, { cuadranteId: ID_BORR, asignaciones: [{ conductorId: "c", fecha: "2026-09-10", tipoAsignacion: "turno", tipoTurnoId: "tt", horaInicio: "06:00", horaFin: "14:00" }] }, tAdmin)
    .then((r) => expectError("AX4 (lote en publicado)", "FAILED_PRECONDITION", r, (x) => /no es editable/i.test(x.message)));

  // L8 — cerrar un cuadrante en borrador (ID_JEFE sigue borrador) → no permitido
  await invokeCallable(U_CERRAR, { cuadranteId: ID_JEFE }, tAdmin)
    .then((r) => expectError("L8 (cerrar borrador)", "FAILED_PRECONDITION", r, (x) => /publicado/i.test(x.message)));

  // ==========================================================================
  console.log("\n=========================");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`Resultados: ${pass}/${results.length} PASS, ${fail}/${results.length} FAIL`);
  if (fail > 0) {
    console.log("\nFallidos:");
    for (const r of results.filter((r) => !r.pass)) console.log(`  - ${r.name}`);
    process.exit(1);
  }
  console.log("\nTodos los casos PASS.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nError en main:", e);
  process.exit(1);
});
