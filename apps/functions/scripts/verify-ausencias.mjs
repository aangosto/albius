// verify-ausencias.mjs
//
// Verificación empírica de B32.1 (ausencias por rango: crear/actualizar/eliminar)
// contra los emulators Auth + Firestore + Functions.
//
// Ejecución (desde la raíz, con el emulator arrancado):
//   node apps/functions/scripts/verify-ausencias.mjs
//
// Helpers locales duplicados de verify-festivos (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed: 1 tenant + 3 centros (activo del jefe / inactivo / otro activo) +
// 3 usuarios (super_admin, jefe, conductor) + 3 conductores (2 del centro del
// jefe — uno de ellos en estado 'baja_definitiva' — y 1 del otro centro).
// Sin ausencias sembradas.

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const FIRESTORE_HOST = "127.0.0.1:8080";
const url = (fn) => `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${fn}`;
const U_CREAR = url("crearAusencia");
const U_ACT = url("actualizarAusencia");
const U_DEL = url("eliminarAusencia");
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

const TENANT_ID = "tenant_seed_b32a";
const CENTRO_ACTIVO = "centro_seed_b32a_activo";
const CENTRO_INACTIVO = "centro_seed_b32a_inactivo";
const CENTRO_OTRO = "centro_seed_b32a_otro";
const COND_A = "cond_b32a_a"; // del centro del jefe, activo
const COND_BAJA = "cond_b32a_baja"; // del centro del jefe, baja_definitiva
const COND_OTRO = "cond_b32a_otro"; // del otro centro

const SEED_USERS = [
  { uid: "admin_b32a_uid", email: "admin-b32a@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b32a_uid",
    email: "jefe-b32a@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b32a_uid",
    email: "conductor-b32a@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
];

function makeCentro(id, estado, nombre) {
  return {
    id,
    data: {
      id, tenantId: TENANT_ID, nombre, ciudad: "Cartagena", provincia: "Murcia",
      estado, fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
    },
  };
}
const SEED_CENTROS = [
  makeCentro(CENTRO_ACTIVO, "activo", "Centro B32A Activo (del jefe)"),
  makeCentro(CENTRO_INACTIVO, "inactivo", "Centro B32A Inactivo"),
  makeCentro(CENTRO_OTRO, "activo", "Centro B32A Otro Activo"),
];

function makeConductor(id, centroId, estado, nombre) {
  return {
    id, tenantId: TENANT_ID, centroId, nombre, apellidos: "Seed B32A",
    dni: `0000000${id.length}A`, categoria: "conductor",
    fechaAntiguedad: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    fechaIncorporacion: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    estado, lineasPreferentes: [], lineasSecundarias: [], tiposTurnoPermitidos: [],
    puedeSerReserva: false, creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  };
}
const SEED_CONDUCTORES = [
  makeConductor(COND_A, CENTRO_ACTIVO, "activo", "Ana"),
  makeConductor(COND_BAJA, CENTRO_ACTIVO, "baja_definitiva", "Benito"),
  makeConductor(COND_OTRO, CENTRO_OTRO, "activo", "Carla"),
];

async function delUser(uid) {
  try { await auth.deleteUser(uid); }
  catch (e) { if (e.code !== "auth/user-not-found") throw e; }
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
    id: TENANT_ID, nombre: "Tenant B32A SL", cif: "A32323235",
    comunidadAutonoma: "Murcia", provincia: "Murcia", plan: "basico", estado: "activo",
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
    creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  });
  for (const c of SEED_CENTROS) await db.collection("centros").doc(c.id).set(c.data);
  for (const c of SEED_CONDUCTORES) await db.collection("conductores").doc(c.id).set(c);
  await deleteCollection("ausencias", "tenantId", TENANT_ID);
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
  if (result.ok) { record(name, `error code=${expectedCode}`, "OK inesperado", false); return; }
  let pass = result.code === expectedCode;
  if (pass && extraCheck && extraCheck(result) !== true) pass = false;
  record(name, `error code=${expectedCode}`, `code=${result.code} msg="${result.message}"`, pass);
}
async function getAus(id) {
  const s = await db.collection("ausencias").doc(id).get();
  return s.exists ? s.data() : null;
}
const dia = (ts) => ts.toDate().toISOString().slice(0, 10);

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tAdmin = await getIdTokenFor("admin_b32a_uid");
  const tJefe = await getIdTokenFor("jefe_b32a_uid");
  const tCond = await getIdTokenFor("conductor_b32a_uid");

  // Vacaciones de Ana: 2026-10-05 .. 2026-10-18 (dos semanas).
  const base = {
    tenantId: TENANT_ID, centroId: CENTRO_ACTIVO, conductorId: COND_A,
    categoria: "vacaciones", codigo: "V",
    fechaInicio: "2026-10-05", fechaFin: "2026-10-18",
  };

  console.log("=== crearAusencia ===\n");

  let idVac = null, idDia = null, idBaja = null;

  // A1 — jefe crea vacaciones (rango) de un conductor de su centro
  {
    const r = await invokeCallable(U_CREAR, { ...base, observaciones: "Vacaciones de verano tardío" }, tJefe);
    if (!r.ok) record("A1 (jefe crea rango)", "ok", `error: ${r.message}`, false);
    else {
      idVac = r.body.ausenciaId;
      const d = (await getAus(idVac)) || {};
      const ok = d.centroId === CENTRO_ACTIVO && d.conductorId === COND_A && d.categoria === "vacaciones" &&
        d.codigo === "V" && dia(d.fechaInicio) === "2026-10-05" && dia(d.fechaFin) === "2026-10-18" &&
        d.creadoPor === "jefe_b32a_uid" && d.creadoEn !== undefined && d.fechaCreacion === undefined;
      record("A1 (jefe crea rango)", "doc completo, creadoPor=jefe, sin fechaCreacion",
        `cat=${d.categoria} cod=${d.codigo} ${d.fechaInicio && dia(d.fechaInicio)}..${d.fechaFin && dia(d.fechaFin)} creadoPor=${d.creadoPor}`, ok);
    }
  }
  // A2 — día suelto (inicio == fin) aceptado, sin codigo ni observaciones
  {
    const { codigo, ...sinCodigo } = base; void codigo;
    const r = await invokeCallable(U_CREAR, { ...sinCodigo, categoria: "permiso", fechaInicio: "2026-10-01", fechaFin: "2026-10-01" }, tJefe);
    if (!r.ok) record("A2 (día suelto inicio==fin)", "ok", `error: ${r.message}`, false);
    else { idDia = r.body.ausenciaId; const d = (await getAus(idDia)) || {};
      record("A2 (día suelto inicio==fin)", "categoria=permiso, sin codigo", `categoria=${d.categoria} codigo=${d.codigo}`,
        d.categoria === "permiso" && d.codigo === undefined && dia(d.fechaInicio) === dia(d.fechaFin)); }
  }
  // A3 — super_admin registra baja de un conductor en baja_definitiva (laxo: no exige activo)
  {
    const r = await invokeCallable(U_CREAR, { ...base, conductorId: COND_BAJA, categoria: "baja", codigo: "B", fechaInicio: "2026-10-01", fechaFin: "2026-10-31" }, tAdmin);
    if (!r.ok) record("A3 (admin, conductor no activo)", "ok", `error: ${r.message}`, false);
    else { idBaja = r.body.ausenciaId; const d = (await getAus(idBaja)) || {};
      record("A3 (admin, conductor no activo)", "creadoPor=admin", `creadoPor=${d.creadoPor}`, d.creadoPor === "admin_b32a_uid"); }
  }
  // A4 — rango invertido
  await invokeCallable(U_CREAR, { ...base, fechaInicio: "2026-11-10", fechaFin: "2026-11-05" }, tJefe)
    .then((r) => expectError("A4 (rango invertido)", "INVALID_ARGUMENT", r, (x) => /fechaInicio/i.test(x.message)));
  // A5 — solape total (dentro del rango de A1)
  await invokeCallable(U_CREAR, { ...base, categoria: "permiso", fechaInicio: "2026-10-10", fechaFin: "2026-10-12" }, tJefe)
    .then((r) => expectError("A5 (solape interior)", "FAILED_PRECONDITION", r, (x) => /solapa/i.test(x.message)));
  // A6 — solape en el borde exacto: empieza el mismo día en que acaba A1 (cerrado)
  await invokeCallable(U_CREAR, { ...base, categoria: "permiso", fechaInicio: "2026-10-18", fechaFin: "2026-10-20" }, tJefe)
    .then((r) => expectError("A6 (solape borde fin exacto)", "FAILED_PRECONDITION", r, (x) => /solapa/i.test(x.message)));
  // A7 — solape en el borde inicial exacto: acaba el día en que empieza A1
  await invokeCallable(U_CREAR, { ...base, categoria: "permiso", fechaInicio: "2026-10-01", fechaFin: "2026-10-05" }, tJefe)
    .then((r) => expectError("A7 (solape borde inicio exacto)", "FAILED_PRECONDITION", r, (x) => /solapa/i.test(x.message)));
  // A8 — día suelto que choca con otro día suelto (A2 = 2026-10-01)
  await invokeCallable(U_CREAR, { ...base, categoria: "baja", fechaInicio: "2026-10-01", fechaFin: "2026-10-01" }, tJefe)
    .then((r) => expectError("A8 (día suelto sobre día suelto)", "FAILED_PRECONDITION", r, (x) => /solapa/i.test(x.message)));
  // A9 — adyacente SIN solapar (día siguiente al fin de A1) → ok
  {
    const r = await invokeCallable(U_CREAR, { ...base, categoria: "permiso", codigo: "AP", fechaInicio: "2026-10-19", fechaFin: "2026-10-19" }, tJefe);
    record("A9 (adyacente día siguiente, sin solape)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
    if (r.ok) await invokeCallable(U_DEL, { ausenciaId: r.body.ausenciaId }, tAdmin);
  }
  // A10 — conductor de otro centro
  await invokeCallable(U_CREAR, { ...base, conductorId: COND_OTRO }, tJefe)
    .then((r) => expectError("A10 (conductor de otro centro)", "INVALID_ARGUMENT", r, (x) => /no pertenece a este centro/i.test(x.message)));
  // A11 — conductor inexistente
  await invokeCallable(U_CREAR, { ...base, conductorId: "cond_inexistente_b32a" }, tJefe)
    .then((r) => expectError("A11 (conductor inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // A12 — jefe otro centro (anti-cross payload)
  await invokeCallable(U_CREAR, { ...base, centroId: CENTRO_OTRO, conductorId: COND_OTRO }, tJefe)
    .then((r) => expectError("A12 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  // A13 — jefe otro tenant
  await invokeCallable(U_CREAR, { ...base, tenantId: "otro_tenant_b32a" }, tJefe)
    .then((r) => expectError("A13 (jefe otro tenant)", "PERMISSION_DENIED", r, (x) => /otro tenant/i.test(x.message)));
  // A14 — conductor (rol)
  await invokeCallable(U_CREAR, { ...base }, tCond)
    .then((r) => expectError("A14 (rol conductor)", "PERMISSION_DENIED", r));
  // A15 — anónimo
  await invokeCallable(U_CREAR, { ...base }, null)
    .then((r) => expectError("A15 (anónimo)", "UNAUTHENTICATED", r));
  // A16 — centro inactivo (D5.1)
  await invokeCallable(U_CREAR, { ...base, centroId: CENTRO_INACTIVO }, tAdmin)
    .then((r) => expectError("A16 (centro inactivo)", "FAILED_PRECONDITION", r, (x) => /no está activo/i.test(x.message)));
  // A17 — categoria inválida
  await invokeCallable(U_CREAR, { ...base, categoria: "reten" }, tJefe)
    .then((r) => expectError("A17 (categoria inválida)", "INVALID_ARGUMENT", r, (x) => /categoria/i.test(x.message)));
  // A18 — fecha inválida
  await invokeCallable(U_CREAR, { ...base, fechaFin: "no-es-fecha" }, tJefe)
    .then((r) => expectError("A18 (fecha inválida)", "INVALID_ARGUMENT", r, (x) => /fechaFin/i.test(x.message)));

  console.log("\n=== actualizarAusencia ===\n");

  // A19 — jefe actualiza codigo + observaciones
  {
    const r = await invokeCallable(U_ACT, { ausenciaId: idVac, codigo: "VAC", observaciones: "corregido" }, tJefe);
    if (!r.ok) record("A19 (jefe actualiza codigo)", "ok", `error: ${r.message}`, false);
    else { const d = (await getAus(idVac)) || {};
      record("A19 (jefe actualiza codigo)", "codigo=VAC, actualizadoPor=jefe, fechas intactas",
        `codigo=${d.codigo} actualizadoPor=${d.actualizadoPor} ${dia(d.fechaInicio)}..${dia(d.fechaFin)}`,
        d.codigo === "VAC" && d.actualizadoPor === "jefe_b32a_uid" && d.actualizadoEn !== undefined &&
        dia(d.fechaInicio) === "2026-10-05" && dia(d.fechaFin) === "2026-10-18"); }
  }
  // A20 — solo fechaFin, ANTES del inicio persistido → rechazado contra persistido
  await invokeCallable(U_ACT, { ausenciaId: idVac, fechaFin: "2026-10-03" }, tJefe)
    .then((r) => expectError("A20 (solo fechaFin < inicio persistido)", "INVALID_ARGUMENT", r, (x) => /fechaInicio/i.test(x.message)));
  // A21 — solo fechaInicio, DESPUÉS del fin persistido → rechazado contra persistido
  await invokeCallable(U_ACT, { ausenciaId: idVac, fechaInicio: "2026-10-20" }, tJefe)
    .then((r) => expectError("A21 (solo fechaInicio > fin persistido)", "INVALID_ARGUMENT", r, (x) => /fechaInicio/i.test(x.message)));
  // A22 — solo fechaFin válida (recorta a 2026-10-15) → ok, no choca consigo misma (excludeId)
  {
    const r = await invokeCallable(U_ACT, { ausenciaId: idVac, fechaFin: "2026-10-15" }, tJefe);
    const d = (await getAus(idVac)) || {};
    record("A22 (solo fechaFin válida, excludeId)", "ok, fin=2026-10-15", r.ok ? `fin=${dia(d.fechaFin)}` : `error: ${r.message}`,
      r.ok && dia(d.fechaFin) === "2026-10-15");
  }
  // A23 — mover el inicio para pisar el día suelto A2 (2026-10-01) → solape
  await invokeCallable(U_ACT, { ausenciaId: idVac, fechaInicio: "2026-10-01" }, tJefe)
    .then((r) => expectError("A23 (update que solapa con otra)", "FAILED_PRECONDITION", r, (x) => /solapa/i.test(x.message)));
  // A24 — veto conductorId
  await invokeCallable(U_ACT, { ausenciaId: idVac, conductorId: COND_BAJA }, tJefe)
    .then((r) => expectError("A24 (veto conductorId)", "INVALID_ARGUMENT", r, (x) => /conductorId no es editable/i.test(x.message)));
  // A25 — veto centroId
  await invokeCallable(U_ACT, { ausenciaId: idVac, centroId: CENTRO_OTRO }, tJefe)
    .then((r) => expectError("A25 (veto centroId)", "INVALID_ARGUMENT", r, (x) => /centroId no es editable/i.test(x.message)));
  // A26 — sin campos editables
  await invokeCallable(U_ACT, { ausenciaId: idVac }, tJefe)
    .then((r) => expectError("A26 (sin campos)", "INVALID_ARGUMENT", r));
  // A27 — inexistente
  await invokeCallable(U_ACT, { ausenciaId: "aus_inexistente_b32a", codigo: "x" }, tAdmin)
    .then((r) => expectError("A27 (inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // A28 — jefe sobre ausencia de otro centro (gate contra el doc): admin crea una en CENTRO_OTRO
  let idOtro = null;
  {
    const r = await invokeCallable(U_CREAR, { ...base, centroId: CENTRO_OTRO, conductorId: COND_OTRO, fechaInicio: "2026-10-01", fechaFin: "2026-10-02" }, tAdmin);
    idOtro = r.ok ? r.body.ausenciaId : null;
    await invokeCallable(U_ACT, { ausenciaId: idOtro, codigo: "x" }, tJefe)
      .then((rr) => expectError("A28 (jefe sobre doc de otro centro)", "PERMISSION_DENIED", rr, (x) => /otro centro/i.test(x.message)));
  }

  console.log("\n=== eliminarAusencia (hard-delete) ===\n");

  // A29 — jefe elimina la de su centro
  {
    const r = await invokeCallable(U_DEL, { ausenciaId: idDia }, tJefe);
    const gone = (await getAus(idDia)) === null;
    record("A29 (jefe elimina su centro)", "ok + doc borrado", `ok=${r.ok}, gone=${gone}`, r.ok && gone);
  }
  // A30 — jefe elimina la de otro centro
  await invokeCallable(U_DEL, { ausenciaId: idOtro }, tJefe)
    .then((r) => expectError("A30 (jefe borra otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  // A31 — rol conductor elimina
  await invokeCallable(U_DEL, { ausenciaId: idVac }, tCond)
    .then((r) => expectError("A31 (rol conductor borra)", "PERMISSION_DENIED", r));
  // A32 — admin elimina la de otro centro
  {
    const r = await invokeCallable(U_DEL, { ausenciaId: idOtro }, tAdmin);
    const gone = (await getAus(idOtro)) === null;
    record("A32 (admin elimina otro centro)", "ok + doc borrado", `ok=${r.ok}, gone=${gone}`, r.ok && gone);
  }
  // A33 — tras borrar, el hueco se puede reocupar (A2 borrada en A29 → día 2026-10-01 libre)
  {
    const r = await invokeCallable(U_CREAR, { ...base, categoria: "permiso", codigo: "PS", fechaInicio: "2026-10-01", fechaFin: "2026-10-01" }, tJefe);
    record("A33 (hueco reocupable tras delete)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }

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

main().catch((e) => { console.error("\nError en main:", e); process.exit(1); });
