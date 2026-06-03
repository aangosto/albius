// verify-tipos-turno.mjs
//
// Verificación empírica de crearTipoTurno + actualizarTipoTurno contra los
// emulators Auth + Firestore + Functions (B18 Sesión 8).
//
// Ejecución (desde la raíz, con el emulator arrancado):
//   node apps/functions/scripts/verify-tipos-turno.mjs
//
// Helpers locales duplicados de verify-lineas.mjs (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed: 1 tenant + 3 centros (activo del jefe / inactivo / otro activo) +
// 3 usuarios (super_admin, jefe, conductor) + 4 tipos seed (M-L y T-L en el
// centro activo, M-L en el otro centro para unicidad-por-centro, OBS para
// transiciones). Auditoría D6.4 (creadoEn, sin fechaCreacion).

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
const URL_CREAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/crearTipoTurno`;
const URL_ACTUALIZAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/actualizarTipoTurno`;
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

const TENANT_ID = "tenant_seed_b18";
const CENTRO_ACTIVO = "centro_seed_b18_activo";
const CENTRO_INACTIVO = "centro_seed_b18_inactivo";
const CENTRO_OTRO = "centro_seed_b18_otro";

const SEED_USERS = [
  { uid: "admin_b18_uid", email: "admin-b18@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b18_uid",
    email: "jefe-b18@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b18_uid",
    email: "conductor-b18@albius.test",
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
  makeCentro(CENTRO_ACTIVO, "activo", "Centro B18 Activo (del jefe)"),
  makeCentro(CENTRO_INACTIVO, "inactivo", "Centro B18 Inactivo"),
  makeCentro(CENTRO_OTRO, "activo", "Centro B18 Otro Activo"),
];

function makeTT(id, centroId, codigo, estado = "activo") {
  return {
    id,
    tenantId: TENANT_ID,
    centroId,
    codigo,
    nombre: `Tipo ${codigo}`,
    horaInicio: "06:00",
    horaFin: "14:00",
    duracionMinutos: 480,
    duracionEfectivaMinutos: 420,
    esPartido: false,
    esNocturno: false,
    estado,
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
  };
}
const SEED_TT = [
  makeTT("tt_seed_b18_ml", CENTRO_ACTIVO, "M-L"), // colisión + update target
  makeTT("tt_seed_b18_ml_otro", CENTRO_OTRO, "M-L"), // unicidad por centro
  makeTT("tt_seed_b18_tl", CENTRO_ACTIVO, "T-L"), // editable
  makeTT("tt_seed_b18_obs", CENTRO_ACTIVO, "OBS"), // transiciones de estado
];

async function delUser(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}
async function seed() {
  for (const u of SEED_USERS) {
    await delUser(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    await auth.setCustomUserClaims(u.uid, u.claims);
  }
  await db.collection("tenants").doc(TENANT_ID).set({
    id: TENANT_ID,
    nombre: "Tenant B18 SL",
    cif: "A18181810",
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
  // Limpieza idempotente de tipos_turno previos del seed.
  const prev = await db.collection("tipos_turno").get();
  for (const d of prev.docs) {
    if (!d.id.startsWith("tt_seed_b18_") && !d.id.startsWith("tt_")) continue;
    await d.ref.delete();
  }
  for (const t of SEED_TT) await db.collection("tipos_turno").doc(t.id).set(t);
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
async function getTT(id) {
  const s = await db.collection("tipos_turno").doc(id).get();
  return s.exists ? s.data() : null;
}

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tAdmin = await getIdTokenFor("admin_b18_uid");
  const tJefe = await getIdTokenFor("jefe_b18_uid");
  const tCond = await getIdTokenFor("conductor_b18_uid");

  const base = {
    tenantId: TENANT_ID,
    centroId: CENTRO_ACTIVO,
    horaInicio: "06:00",
    horaFin: "14:00",
    duracionMinutos: 480,
    duracionEfectivaMinutos: 420,
    esPartido: false,
    esNocturno: false,
    estado: "activo",
  };

  console.log("=== crearTipoTurno ===\n");

  // T1 alta mínima
  {
    const r = await invokeCallable(URL_CREAR, { ...base, codigo: "T1", nombre: "Mañana T1" }, tAdmin);
    if (!r.ok) record("T1 (alta mínima)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getTT(r.body.tipoTurnoId)) || {};
      const ok =
        d.codigo === "T1" && d.esPartido === false && d.estado === "activo" &&
        d.creadoPor === "admin_b18_uid" && d.actualizadoPor === undefined &&
        d.color === undefined && d.tramosPartido === undefined && d.fechaCreacion === undefined;
      record("T1 (alta mínima)", "doc sin color/tramos/actualizado*/fechaCreacion, creadoPor=admin",
        `codigo=${d.codigo}, creadoPor=${d.creadoPor}, fechaCreacion=${d.fechaCreacion}`, ok);
    }
  }
  // T2 alta completa (color + nocturno)
  {
    const r = await invokeCallable(URL_CREAR, { ...base, codigo: "T2", nombre: "Noche T2", esNocturno: true, color: "#FFD700" }, tAdmin);
    if (!r.ok) record("T2 (color+nocturno)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getTT(r.body.tipoTurnoId)) || {};
      record("T2 (color+nocturno)", "color=#FFD700, esNocturno=true",
        `color=${d.color}, esNocturno=${d.esNocturno}`, d.color === "#FFD700" && d.esNocturno === true);
    }
  }
  // T3 alta partido válido
  {
    const payload = { ...base, codigo: "T3", nombre: "Partido T3", horaInicio: "06:00", horaFin: "21:00",
      esPartido: true, tramosPartido: [{ inicio: "06:00", fin: "10:00" }, { inicio: "17:00", fin: "21:00" }] };
    const r = await invokeCallable(URL_CREAR, payload, tAdmin);
    if (!r.ok) record("T3 (partido válido)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getTT(r.body.tipoTurnoId)) || {};
      record("T3 (partido válido)", "esPartido=true + 2 tramos",
        `esPartido=${d.esPartido}, tramos=${d.tramosPartido?.length}`, d.esPartido === true && d.tramosPartido?.length === 2);
    }
  }
  // T4 codigo vacío
  await invokeCallable(URL_CREAR, { ...base, codigo: "", nombre: "X" }, tAdmin)
    .then((r) => expectError("T4 (codigo vacío)", "INVALID_ARGUMENT", r, (x) => /'codigo'/.test(x.message)));
  // T5 nombre vacío
  await invokeCallable(URL_CREAR, { ...base, codigo: "T5", nombre: "" }, tAdmin)
    .then((r) => expectError("T5 (nombre vacío)", "INVALID_ARGUMENT", r, (x) => /'nombre'/.test(x.message)));
  // T6 horaInicio malformada
  await invokeCallable(URL_CREAR, { ...base, codigo: "T6", nombre: "X", horaInicio: "25:00" }, tAdmin)
    .then((r) => expectError("T6 (horaInicio 25:00)", "INVALID_ARGUMENT", r, (x) => /'horaInicio'.*HH:mm/.test(x.message)));
  // T7 horaFin malformada
  await invokeCallable(URL_CREAR, { ...base, codigo: "T7", nombre: "X", horaFin: "12:99" }, tAdmin)
    .then((r) => expectError("T7 (horaFin 12:99)", "INVALID_ARGUMENT", r, (x) => /'horaFin'/.test(x.message)));
  // T8 efectiva > total
  await invokeCallable(URL_CREAR, { ...base, codigo: "T8", nombre: "X", duracionMinutos: 100, duracionEfectivaMinutos: 200 }, tAdmin)
    .then((r) => expectError("T8 (efectiva>total)", "INVALID_ARGUMENT", r, (x) => /no puede superar/.test(x.message)));
  // T9 esPartido sin tramos
  await invokeCallable(URL_CREAR, { ...base, codigo: "T9", nombre: "X", esPartido: true }, tAdmin)
    .then((r) => expectError("T9 (partido sin tramos)", "INVALID_ARGUMENT", r, (x) => /tramosPartido/.test(x.message)));
  // T10 esPartido false con tramos
  await invokeCallable(URL_CREAR, { ...base, codigo: "T10", nombre: "X", esPartido: false, tramosPartido: [{ inicio: "06:00", fin: "10:00" }] }, tAdmin)
    .then((r) => expectError("T10 (no-partido con tramos)", "INVALID_ARGUMENT", r, (x) => /solo se permite/.test(x.message)));
  // T11 tramo fuera de rango
  await invokeCallable(URL_CREAR, { ...base, codigo: "T11", nombre: "X", horaInicio: "06:00", horaFin: "14:00", esPartido: true, tramosPartido: [{ inicio: "06:00", fin: "18:00" }] }, tAdmin)
    .then((r) => expectError("T11 (tramo fuera de rango)", "INVALID_ARGUMENT", r, (x) => /dentro del rango/.test(x.message)));
  // T12 estado inválido
  await invokeCallable(URL_CREAR, { ...base, codigo: "T12", nombre: "X", estado: "activa" }, tAdmin)
    .then((r) => expectError("T12 (estado inválido)", "INVALID_ARGUMENT", r, (x) => /'estado'/.test(x.message)));
  // T13 color HEX malformado
  await invokeCallable(URL_CREAR, { ...base, codigo: "T13", nombre: "X", color: "oro" }, tAdmin)
    .then((r) => expectError("T13 (color malformado)", "INVALID_ARGUMENT", r, (x) => /'color'/.test(x.message)));
  // T14 centro inexistente
  await invokeCallable(URL_CREAR, { ...base, centroId: "centro_inexistente_b18", codigo: "T14", nombre: "X" }, tAdmin)
    .then((r) => expectError("T14 (centro inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // T15 centro inactivo
  await invokeCallable(URL_CREAR, { ...base, centroId: CENTRO_INACTIVO, codigo: "T15", nombre: "X" }, tAdmin)
    .then((r) => expectError("T15 (centro inactivo)", "FAILED_PRECONDITION", r, (x) => /no está activo/i.test(x.message)));
  // T16 codigo duplicado en centro
  await invokeCallable(URL_CREAR, { ...base, codigo: "M-L", nombre: "Colisión" }, tAdmin)
    .then((r) => expectError("T16 (codigo duplicado)", "ALREADY_EXISTS", r, (x) => /código 'M-L'/.test(x.message)));
  // T17 mismo codigo distinto centro
  {
    const r = await invokeCallable(URL_CREAR, { ...base, centroId: CENTRO_OTRO, codigo: "T-L", nombre: "T-L en otro" }, tAdmin);
    record("T17 (mismo codigo distinto centro)", "ok (unicidad por centro)",
      r.ok ? `creado en ${CENTRO_OTRO}` : `error: ${r.message}`, r.ok);
  }
  // T18 jefe en su centro
  {
    const r = await invokeCallable(URL_CREAR, { ...base, codigo: "J1", nombre: "Del jefe" }, tJefe);
    if (!r.ok) record("T18 (jefe su centro)", "ok", `error: ${r.message}`, false);
    else { const d = (await getTT(r.body.tipoTurnoId)) || {}; record("T18 (jefe su centro)", "creadoPor=jefe", `creadoPor=${d.creadoPor}`, d.creadoPor === "jefe_b18_uid"); }
  }
  // T19 jefe otro centro
  await invokeCallable(URL_CREAR, { ...base, centroId: CENTRO_OTRO, codigo: "J2", nombre: "X" }, tJefe)
    .then((r) => expectError("T19 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  // T20 jefe otro tenant
  await invokeCallable(URL_CREAR, { ...base, tenantId: "otro_tenant_b18", codigo: "J3", nombre: "X" }, tJefe)
    .then((r) => expectError("T20 (jefe otro tenant)", "PERMISSION_DENIED", r, (x) => /otro tenant/i.test(x.message)));
  // T21 conductor
  await invokeCallable(URL_CREAR, { ...base, codigo: "T21", nombre: "X" }, tCond)
    .then((r) => expectError("T21 (conductor)", "PERMISSION_DENIED", r));
  // T22 anónimo
  await invokeCallable(URL_CREAR, { ...base, codigo: "T22", nombre: "X" }, null)
    .then((r) => expectError("T22 (anónimo)", "UNAUTHENTICATED", r));

  console.log("\n=== actualizarTipoTurno ===\n");

  // T23 editar nombre + auditoría
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", nombre: "T-L renombrado" }, tAdmin);
    if (!r.ok) record("T23 (editar nombre)", "ok", `error: ${r.message}`, false);
    else { const d = (await getTT("tt_seed_b18_tl")) || {}; record("T23 (editar nombre)", "nombre + actualizadoPor=admin",
      `nombre=${d.nombre}, actualizadoPor=${d.actualizadoPor}, actualizadoEn=${d.actualizadoEn !== undefined ? "sí" : "no"}`,
      d.nombre === "T-L renombrado" && d.actualizadoPor === "admin_b18_uid" && d.actualizadoEn !== undefined); }
  }
  // T24-T28 vetos inmutables
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", centroId: CENTRO_OTRO }, tAdmin)
    .then((r) => expectError("T24 (veto centroId)", "INVALID_ARGUMENT", r, (x) => /centroId no es editable/i.test(x.message)));
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", tenantId: "otro" }, tAdmin)
    .then((r) => expectError("T25 (veto tenantId)", "INVALID_ARGUMENT", r, (x) => /tenantId no es editable/i.test(x.message)));
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", id: "x" }, tAdmin)
    .then((r) => expectError("T26 (veto id)", "INVALID_ARGUMENT", r, (x) => /'id'.*no es editable/i.test(x.message)));
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", creadoPor: "x" }, tAdmin)
    .then((r) => expectError("T27 (veto creadoPor)", "INVALID_ARGUMENT", r, (x) => /'creadoPor' no es editable/i.test(x.message)));
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", creadoEn: "x" }, tAdmin)
    .then((r) => expectError("T28 (veto creadoEn)", "INVALID_ARGUMENT", r, (x) => /'creadoEn' no es editable/i.test(x.message)));
  // T29 solo id
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl" }, tAdmin)
    .then((r) => expectError("T29 (solo tipoTurnoId)", "INVALID_ARGUMENT", r, (x) => /al menos un campo/i.test(x.message)));
  // T30 cambio codigo libre
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", codigo: "T-L2" }, tAdmin);
    if (!r.ok) record("T30 (codigo libre)", "ok", `error: ${r.message}`, false);
    else { const d = (await getTT("tt_seed_b18_tl")) || {}; record("T30 (codigo libre)", "codigo=T-L2", `codigo=${d.codigo}`, d.codigo === "T-L2"); }
  }
  // T31 cambio codigo colisión (M-L ya existe en centro activo)
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_tl", codigo: "M-L" }, tAdmin)
    .then((r) => expectError("T31 (codigo colisión)", "ALREADY_EXISTS", r, (x) => /código 'M-L'/.test(x.message)));
  // T32 soft-delete activo→obsoleto
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_obs", estado: "obsoleto" }, tAdmin);
    if (!r.ok) record("T32 (activo→obsoleto)", "ok", `error: ${r.message}`, false);
    else { const d = (await getTT("tt_seed_b18_obs")) || {}; record("T32 (activo→obsoleto)", "estado=obsoleto", `estado=${d.estado}`, d.estado === "obsoleto"); }
  }
  // T33 reactivar obsoleto→activo
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_obs", estado: "activo" }, tAdmin);
    if (!r.ok) record("T33 (obsoleto→activo)", "ok", `error: ${r.message}`, false);
    else { const d = (await getTT("tt_seed_b18_obs")) || {}; record("T33 (obsoleto→activo)", "estado=activo", `estado=${d.estado}`, d.estado === "activo"); }
  }
  // T34 estado inválido update
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_obs", estado: "muerto" }, tAdmin)
    .then((r) => expectError("T34 (estado inválido)", "INVALID_ARGUMENT", r, (x) => /'estado'/.test(x.message)));
  // T35 inexistente
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_inexistente_b18", nombre: "X" }, tAdmin)
    .then((r) => expectError("T35 (inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // T36 jefe edita su centro
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_ml", nombre: "M-L por jefe" }, tJefe);
    if (!r.ok) record("T36 (jefe su centro)", "ok", `error: ${r.message}`, false);
    else { const d = (await getTT("tt_seed_b18_ml")) || {}; record("T36 (jefe su centro)", "actualizadoPor=jefe", `actualizadoPor=${d.actualizadoPor}`, d.actualizadoPor === "jefe_b18_uid"); }
  }
  // T37 jefe edita otro centro
  await invokeCallable(URL_ACTUALIZAR, { tipoTurnoId: "tt_seed_b18_ml_otro", nombre: "X" }, tJefe)
    .then((r) => expectError("T37 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));

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
