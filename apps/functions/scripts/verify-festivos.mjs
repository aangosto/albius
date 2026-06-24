// verify-festivos.mjs
//
// Verificación empírica de B27 (festivos: crear/actualizar/eliminar) contra los
// emulators Auth + Firestore + Functions.
//
// Ejecución (desde la raíz, con el emulator arrancado):
//   node apps/functions/scripts/verify-festivos.mjs
//
// Helpers locales duplicados de verify-convenio/cuadrante (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed: 1 tenant + 3 centros (activo del jefe / inactivo / otro activo) +
// 3 usuarios (super_admin, jefe, conductor). Sin festivos sembrados.

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
const U_CREAR = url("crearFestivo");
const U_ACT = url("actualizarFestivo");
const U_DEL = url("eliminarFestivo");
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

const TENANT_ID = "tenant_seed_b27f";
const CENTRO_ACTIVO = "centro_seed_b27f_activo";
const CENTRO_INACTIVO = "centro_seed_b27f_inactivo";
const CENTRO_OTRO = "centro_seed_b27f_otro";

const SEED_USERS = [
  { uid: "admin_b27f_uid", email: "admin-b27f@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b27f_uid",
    email: "jefe-b27f@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b27f_uid",
    email: "conductor-b27f@albius.test",
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
  makeCentro(CENTRO_ACTIVO, "activo", "Centro B27F Activo (del jefe)"),
  makeCentro(CENTRO_INACTIVO, "inactivo", "Centro B27F Inactivo"),
  makeCentro(CENTRO_OTRO, "activo", "Centro B27F Otro Activo"),
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
    id: TENANT_ID, nombre: "Tenant B27F SL", cif: "A27272720",
    comunidadAutonoma: "Murcia", provincia: "Murcia", plan: "basico", estado: "activo",
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
    creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  });
  for (const c of SEED_CENTROS) await db.collection("centros").doc(c.id).set(c.data);
  await deleteCollection("festivos", "tenantId", TENANT_ID);
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
async function getFest(id) {
  const s = await db.collection("festivos").doc(id).get();
  return s.exists ? s.data() : null;
}

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tAdmin = await getIdTokenFor("admin_b27f_uid");
  const tJefe = await getIdTokenFor("jefe_b27f_uid");
  const tCond = await getIdTokenFor("conductor_b27f_uid");

  const baseCentro = {
    tenantId: TENANT_ID, centroId: CENTRO_ACTIVO,
    fecha: "2026-08-15", nombre: "Festividad local", ambito: "local",
    tipoTraficoAplicable: "festivo",
  };

  console.log("=== crearFestivo ===\n");

  let idJefeCentro = null, idTenantWide = null, idOficial = null;

  // F1 — jefe crea festivo de SU centro
  {
    const r = await invokeCallable(U_CREAR, { ...baseCentro }, tJefe);
    if (!r.ok) record("F1 (jefe su centro)", "ok", `error: ${r.message}`, false);
    else {
      idJefeCentro = r.body.festivoId;
      const d = (await getFest(idJefeCentro)) || {};
      const ok = d.centroId === CENTRO_ACTIVO && d.esEditable === true &&
        d.creadoPor === "jefe_b27f_uid" && d.creadoEn !== undefined &&
        d.fechaCreacion === undefined && d.tipoTraficoAplicable === "festivo";
      record("F1 (jefe su centro)", "centroId, esEditable=true, creadoEn (sin fechaCreacion)",
        `centroId=${d.centroId}, esEditable=${d.esEditable}, creadoEn=${d.creadoEn !== undefined}, fechaCreacion=${d.fechaCreacion}`, ok);
    }
  }
  // F2 — super_admin crea tenant-wide (sin centroId)
  {
    const { centroId, ...sinCentro } = baseCentro; void centroId;
    const r = await invokeCallable(U_CREAR, { ...sinCentro, nombre: "Navidad (todo el tenant)", fecha: "2026-12-25", ambito: "nacional" }, tAdmin);
    if (!r.ok) record("F2 (admin tenant-wide)", "ok", `error: ${r.message}`, false);
    else {
      idTenantWide = r.body.festivoId;
      const d = (await getFest(idTenantWide)) || {};
      record("F2 (admin tenant-wide)", "sin centroId, creadoPor=admin",
        `centroId=${d.centroId}, creadoPor=${d.creadoPor}`, d.centroId === undefined && d.creadoPor === "admin_b27f_uid");
    }
  }
  // F3 — super_admin crea festivo oficial protegido (esEditable=false) en centro
  {
    const r = await invokeCallable(U_CREAR, { ...baseCentro, nombre: "Festivo oficial", fecha: "2026-10-12", ambito: "nacional", esEditable: false }, tAdmin);
    if (!r.ok) record("F3 (oficial esEditable=false)", "ok", `error: ${r.message}`, false);
    else { idOficial = r.body.festivoId; const d = (await getFest(idOficial)) || {};
      record("F3 (oficial esEditable=false)", "esEditable=false", `esEditable=${d.esEditable}`, d.esEditable === false); }
  }
  // F4 — jefe intenta tenant-wide
  {
    const { centroId, ...sinCentro } = baseCentro; void centroId;
    await invokeCallable(U_CREAR, { ...sinCentro }, tJefe)
      .then((r) => expectError("F4 (jefe tenant-wide)", "PERMISSION_DENIED", r, (x) => /todo el tenant/i.test(x.message)));
  }
  // F5 — jefe otro centro
  await invokeCallable(U_CREAR, { ...baseCentro, centroId: CENTRO_OTRO }, tJefe)
    .then((r) => expectError("F5 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  // F6 — jefe otro tenant
  await invokeCallable(U_CREAR, { ...baseCentro, tenantId: "otro_tenant_b27f" }, tJefe)
    .then((r) => expectError("F6 (jefe otro tenant)", "PERMISSION_DENIED", r, (x) => /otro tenant/i.test(x.message)));
  // F7 — conductor
  await invokeCallable(U_CREAR, { ...baseCentro }, tCond)
    .then((r) => expectError("F7 (conductor)", "PERMISSION_DENIED", r));
  // F8 — anónimo
  await invokeCallable(U_CREAR, { ...baseCentro }, null)
    .then((r) => expectError("F8 (anónimo)", "UNAUTHENTICATED", r));
  // F9 — centro inexistente
  await invokeCallable(U_CREAR, { ...baseCentro, centroId: "centro_inexistente_b27f" }, tAdmin)
    .then((r) => expectError("F9 (centro inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // F10 — centro inactivo
  await invokeCallable(U_CREAR, { ...baseCentro, centroId: CENTRO_INACTIVO }, tAdmin)
    .then((r) => expectError("F10 (centro inactivo)", "FAILED_PRECONDITION", r, (x) => /no está activo/i.test(x.message)));
  // F11 — ambito inválido
  await invokeCallable(U_CREAR, { ...baseCentro, ambito: "galactico" }, tJefe)
    .then((r) => expectError("F11 (ambito inválido)", "INVALID_ARGUMENT", r, (x) => /ambito/i.test(x.message)));
  // F12 — tipoTraficoAplicable inválido
  await invokeCallable(U_CREAR, { ...baseCentro, tipoTraficoAplicable: "fiesta" }, tJefe)
    .then((r) => expectError("F12 (tipoTrafico inválido)", "INVALID_ARGUMENT", r, (x) => /tipoTraficoAplicable/i.test(x.message)));
  // F13 — fecha inválida
  await invokeCallable(U_CREAR, { ...baseCentro, fecha: "no-es-fecha" }, tJefe)
    .then((r) => expectError("F13 (fecha inválida)", "INVALID_ARGUMENT", r, (x) => /fecha/i.test(x.message)));

  console.log("\n=== actualizarFestivo ===\n");

  // F14 — jefe actualiza su festivo (nombre)
  {
    const r = await invokeCallable(U_ACT, { festivoId: idJefeCentro, nombre: "Festividad local (corregido)" }, tJefe);
    if (!r.ok) record("F14 (jefe actualiza su centro)", "ok", `error: ${r.message}`, false);
    else { const d = (await getFest(idJefeCentro)) || {};
      record("F14 (jefe actualiza su centro)", "nombre cambiado, actualizadoPor=jefe",
        `nombre=${d.nombre}, actualizadoPor=${d.actualizadoPor}`,
        d.nombre === "Festividad local (corregido)" && d.actualizadoPor === "jefe_b27f_uid"); }
  }
  // F15 — actualizar oficial protegido
  await invokeCallable(U_ACT, { festivoId: idOficial, nombre: "x" }, tAdmin)
    .then((r) => expectError("F15 (oficial no editable)", "FAILED_PRECONDITION", r, (x) => /oficial/i.test(x.message)));
  // F16 — veto centroId
  await invokeCallable(U_ACT, { festivoId: idJefeCentro, centroId: CENTRO_OTRO }, tJefe)
    .then((r) => expectError("F16 (veto centroId)", "INVALID_ARGUMENT", r, (x) => /centroId no es editable/i.test(x.message)));
  // F17 — jefe actualiza tenant-wide
  await invokeCallable(U_ACT, { festivoId: idTenantWide, nombre: "x" }, tJefe)
    .then((r) => expectError("F17 (jefe sobre tenant-wide)", "PERMISSION_DENIED", r, (x) => /todo el tenant/i.test(x.message)));
  // F18 — actualizar inexistente
  await invokeCallable(U_ACT, { festivoId: "festivo_inexistente_b27f", nombre: "x" }, tAdmin)
    .then((r) => expectError("F18 (inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));

  console.log("\n=== eliminarFestivo (hard-delete) ===\n");

  // F19 — jefe elimina su festivo
  {
    const r = await invokeCallable(U_DEL, { festivoId: idJefeCentro }, tJefe);
    const gone = (await getFest(idJefeCentro)) === null;
    record("F19 (jefe elimina su centro)", "ok + doc borrado", `ok=${r.ok}, gone=${gone}`, r.ok && gone);
  }
  // F20 — eliminar oficial protegido
  await invokeCallable(U_DEL, { festivoId: idOficial }, tAdmin)
    .then((r) => expectError("F20 (oficial no borrable)", "FAILED_PRECONDITION", r, (x) => /oficial/i.test(x.message)));
  // F21 — jefe elimina tenant-wide
  await invokeCallable(U_DEL, { festivoId: idTenantWide }, tJefe)
    .then((r) => expectError("F21 (jefe borra tenant-wide)", "PERMISSION_DENIED", r, (x) => /todo el tenant/i.test(x.message)));
  // F22 — super_admin elimina tenant-wide
  {
    const r = await invokeCallable(U_DEL, { festivoId: idTenantWide }, tAdmin);
    const gone = (await getFest(idTenantWide)) === null;
    record("F22 (admin elimina tenant-wide)", "ok + doc borrado", `ok=${r.ok}, gone=${gone}`, r.ok && gone);
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
