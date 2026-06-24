// verify-convenio.mjs
//
// Verificación empírica de guardarConvenio (B25 — UPSERT singleton por centro)
// contra los emulators Auth + Firestore + Functions.
//
// Ejecución (desde la raíz, con el emulator arrancado):
//   node apps/functions/scripts/verify-convenio.mjs
//
// Helpers locales duplicados de verify-tipos-turno.mjs (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed: 1 tenant + 3 centros (activo del jefe / inactivo / otro activo) +
// 3 usuarios (super_admin, jefe, conductor). SIN convenios sembrados: el primer
// guardado de cada centro es el CREATE.

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
const URL_GUARDAR = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/guardarConvenio`;
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

const TENANT_ID = "tenant_seed_b25";
const CENTRO_ACTIVO = "centro_seed_b25_activo";
const CENTRO_INACTIVO = "centro_seed_b25_inactivo";
const CENTRO_OTRO = "centro_seed_b25_otro";

const SEED_USERS = [
  { uid: "admin_b25_uid", email: "admin-b25@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b25_uid",
    email: "jefe-b25@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b25_uid",
    email: "conductor-b25@albius.test",
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
  makeCentro(CENTRO_ACTIVO, "activo", "Centro B25 Activo (del jefe)"),
  makeCentro(CENTRO_INACTIVO, "inactivo", "Centro B25 Inactivo"),
  makeCentro(CENTRO_OTRO, "activo", "Centro B25 Otro Activo"),
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
    nombre: "Tenant B25 SL",
    cif: "A25252520",
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
  // Limpieza idempotente de convenios previos del seed (los 3 centros).
  for (const cid of [CENTRO_ACTIVO, CENTRO_INACTIVO, CENTRO_OTRO]) {
    await db.collection("convenio").doc(cid).delete().catch(() => {});
  }
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
async function getConv(id) {
  const s = await db.collection("convenio").doc(id).get();
  return s.exists ? s.data() : null;
}

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tAdmin = await getIdTokenFor("admin_b25_uid");
  const tJefe = await getIdTokenFor("jefe_b25_uid");
  const tCond = await getIdTokenFor("conductor_b25_uid");

  // Payload base válido (calibrado al convenio TUCARSA: 37.5h, descanso 12h, etc.)
  const base = {
    tenantId: TENANT_ID,
    centroId: CENTRO_ACTIVO,
    descansoMinimoEntreJornadasHoras: 12,
    maxHorasSemanales: 37.5,
    maxHorasAnuales: 1800,
    minDomingosLibresAño: 10,
    maxFinesSemanaConsecutivosTrabajados: 2,
    maxDiasConsecutivosTrabajados: 6,
    descansoSemanalMinimoHoras: 36,
    antelacionMinimaPublicacionDias: 15,
    horasFestivoComputanComoExtras: true,
  };

  console.log("=== guardarConvenio: UPSERT ===\n");

  // C1 — primer guardado = CREATE (creadoEn, id===centroId, sin actualizado*)
  let creadoEnC1 = null;
  {
    const r = await invokeCallable(URL_GUARDAR, { ...base }, tAdmin);
    if (!r.ok) record("C1 (create)", "ok creado=true", `error: ${r.message}`, false);
    else {
      const d = (await getConv(CENTRO_ACTIVO)) || {};
      creadoEnC1 = d.creadoEn;
      const ok =
        r.body.creado === true &&
        d.id === CENTRO_ACTIVO &&
        d.centroId === CENTRO_ACTIVO &&
        d.tenantId === TENANT_ID &&
        d.creadoPor === "admin_b25_uid" &&
        d.creadoEn !== undefined &&
        d.actualizadoPor === undefined &&
        d.actualizadoEn === undefined &&
        d.maxHorasSemanales === 37.5;
      record("C1 (create)", "creado=true, id===centroId, creadoPor=admin, sin actualizado*",
        `creado=${r.body.creado}, id=${d.id}, creadoPor=${d.creadoPor}, actualizadoPor=${d.actualizadoPor}`, ok);
    }
  }

  // C2 — segundo guardado mismo centro = UPDATE (preserva creadoEn, set actualizadoEn)
  {
    const r = await invokeCallable(URL_GUARDAR,
      { ...base, maxHorasSemanales: 40, computoHoras: "conduccion" }, tAdmin);
    if (!r.ok) record("C2 (update preserva creadoEn)", "ok creado=false", `error: ${r.message}`, false);
    else {
      const d = (await getConv(CENTRO_ACTIVO)) || {};
      const creadoPreservado =
        creadoEnC1 && d.creadoEn && d.creadoEn.toMillis() === creadoEnC1.toMillis();
      const ok =
        r.body.creado === false &&
        d.maxHorasSemanales === 40 &&
        d.computoHoras === "conduccion" &&
        d.creadoPor === "admin_b25_uid" &&
        creadoPreservado &&
        d.actualizadoPor === "admin_b25_uid" &&
        d.actualizadoEn !== undefined;
      record("C2 (update preserva creadoEn)",
        "creado=false, maxHoras=40, creadoEn preservado, actualizadoPor=admin",
        `creado=${r.body.creado}, maxHoras=${d.maxHorasSemanales}, creadoEnIgual=${creadoPreservado}, actualizadoPor=${d.actualizadoPor}`,
        ok);
    }
  }

  // C3 — create en otro centro con opcionales (convenioReferencia + computoHoras)
  {
    const r = await invokeCallable(URL_GUARDAR,
      { ...base, centroId: CENTRO_OTRO, convenioReferencia: "Convenio TUCARSA 2026", computoHoras: "jornada" }, tAdmin);
    if (!r.ok) record("C3 (create con opcionales)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getConv(CENTRO_OTRO)) || {};
      const ok =
        d.id === CENTRO_OTRO &&
        d.convenioReferencia === "Convenio TUCARSA 2026" &&
        d.computoHoras === "jornada";
      record("C3 (create con opcionales)", "id===CENTRO_OTRO, convenioReferencia + computoHoras=jornada",
        `id=${d.id}, ref=${d.convenioReferencia}, computo=${d.computoHoras}`, ok);
    }
  }

  console.log("\n=== Validación de payload ===\n");

  // C4 — falta campo requerido (maxHorasSemanales)
  {
    const { maxHorasSemanales, ...sinMax } = base;
    void maxHorasSemanales;
    await invokeCallable(URL_GUARDAR, sinMax, tAdmin)
      .then((r) => expectError("C4 (falta maxHorasSemanales)", "INVALID_ARGUMENT", r, (x) => /maxHorasSemanales/.test(x.message)));
  }
  // C5 — maxHorasSemanales negativo
  await invokeCallable(URL_GUARDAR, { ...base, maxHorasSemanales: -5 }, tAdmin)
    .then((r) => expectError("C5 (maxHoras negativo)", "INVALID_ARGUMENT", r, (x) => /maxHorasSemanales/.test(x.message)));
  // C6 — descanso = 0 (exclusiveMin)
  await invokeCallable(URL_GUARDAR, { ...base, descansoMinimoEntreJornadasHoras: 0 }, tAdmin)
    .then((r) => expectError("C6 (descanso=0)", "INVALID_ARGUMENT", r, (x) => /descansoMinimoEntreJornadasHoras/.test(x.message)));
  // C7 — minDomingosLibresAño = 0 PERMITIDO (update sobre CENTRO_ACTIVO)
  {
    const r = await invokeCallable(URL_GUARDAR, { ...base, minDomingosLibresAño: 0 }, tAdmin);
    record("C7 (minDomingos=0 permitido)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }
  // C8 — maxHorasSemanales fuera de rango (>168)
  await invokeCallable(URL_GUARDAR, { ...base, maxHorasSemanales: 200 }, tAdmin)
    .then((r) => expectError("C8 (maxHoras>168)", "INVALID_ARGUMENT", r, (x) => /maxHorasSemanales/.test(x.message)));
  // C9 — minDomingosLibresAño no entero
  await invokeCallable(URL_GUARDAR, { ...base, minDomingosLibresAño: 5.5 }, tAdmin)
    .then((r) => expectError("C9 (minDomingos no entero)", "INVALID_ARGUMENT", r, (x) => /entero/.test(x.message)));
  // C10 — computoHoras inválido
  await invokeCallable(URL_GUARDAR, { ...base, computoHoras: "mixto" }, tAdmin)
    .then((r) => expectError("C10 (computoHoras inválido)", "INVALID_ARGUMENT", r, (x) => /computoHoras/.test(x.message)));
  // C11 — convenioReferencia vacío
  await invokeCallable(URL_GUARDAR, { ...base, convenioReferencia: "" }, tAdmin)
    .then((r) => expectError("C11 (convenioReferencia vacío)", "INVALID_ARGUMENT", r, (x) => /convenioReferencia/.test(x.message)));

  console.log("\n=== D5.1 (centro padre) ===\n");

  // C12 — centro inexistente
  await invokeCallable(URL_GUARDAR, { ...base, centroId: "centro_inexistente_b25" }, tAdmin)
    .then((r) => expectError("C12 (centro inexistente)", "INVALID_ARGUMENT", r, (x) => /no existe/i.test(x.message)));
  // C13 — centro inactivo
  await invokeCallable(URL_GUARDAR, { ...base, centroId: CENTRO_INACTIVO }, tAdmin)
    .then((r) => expectError("C13 (centro inactivo)", "FAILED_PRECONDITION", r, (x) => /no está activo/i.test(x.message)));

  console.log("\n=== Auth (3 niveles + anti-cross) ===\n");

  // C14 — jefe guarda convenio de SU centro (update)
  {
    const r = await invokeCallable(URL_GUARDAR, { ...base, maxHorasSemanales: 38 }, tJefe);
    if (!r.ok) record("C14 (jefe su centro)", "ok", `error: ${r.message}`, false);
    else {
      const d = (await getConv(CENTRO_ACTIVO)) || {};
      record("C14 (jefe su centro)", "actualizadoPor=jefe", `actualizadoPor=${d.actualizadoPor}`,
        d.actualizadoPor === "jefe_b25_uid");
    }
  }
  // C15 — jefe otro centro
  await invokeCallable(URL_GUARDAR, { ...base, centroId: CENTRO_OTRO }, tJefe)
    .then((r) => expectError("C15 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  // C16 — jefe otro tenant
  await invokeCallable(URL_GUARDAR, { ...base, tenantId: "otro_tenant_b25" }, tJefe)
    .then((r) => expectError("C16 (jefe otro tenant)", "PERMISSION_DENIED", r, (x) => /otro tenant/i.test(x.message)));
  // C17 — conductor
  await invokeCallable(URL_GUARDAR, { ...base }, tCond)
    .then((r) => expectError("C17 (conductor)", "PERMISSION_DENIED", r));
  // C18 — anónimo
  await invokeCallable(URL_GUARDAR, { ...base }, null)
    .then((r) => expectError("C18 (anónimo)", "UNAUTHENTICATED", r));

  console.log("\n=== Veto de inmutables server-managed ===\n");

  // C19-C23
  await invokeCallable(URL_GUARDAR, { ...base, id: "x" }, tAdmin)
    .then((r) => expectError("C19 (veto id)", "INVALID_ARGUMENT", r, (x) => /'id' no es editable/i.test(x.message)));
  await invokeCallable(URL_GUARDAR, { ...base, creadoPor: "x" }, tAdmin)
    .then((r) => expectError("C20 (veto creadoPor)", "INVALID_ARGUMENT", r, (x) => /'creadoPor' no es editable/i.test(x.message)));
  await invokeCallable(URL_GUARDAR, { ...base, creadoEn: "x" }, tAdmin)
    .then((r) => expectError("C21 (veto creadoEn)", "INVALID_ARGUMENT", r, (x) => /'creadoEn' no es editable/i.test(x.message)));
  await invokeCallable(URL_GUARDAR, { ...base, actualizadoPor: "x" }, tAdmin)
    .then((r) => expectError("C22 (veto actualizadoPor)", "INVALID_ARGUMENT", r, (x) => /'actualizadoPor' no es editable/i.test(x.message)));
  await invokeCallable(URL_GUARDAR, { ...base, actualizadoEn: "x" }, tAdmin)
    .then((r) => expectError("C23 (veto actualizadoEn)", "INVALID_ARGUMENT", r, (x) => /'actualizadoEn' no es editable/i.test(x.message)));

  // C24 — UPDATE con tenantId distinto al doc (inmutable) → admin, doc ya existe
  await invokeCallable(URL_GUARDAR, { ...base, tenantId: "otro_tenant_b25" }, tAdmin)
    .then((r) => expectError("C24 (tenantId inmutable en update)", "INVALID_ARGUMENT", r, (x) => /tenantId del convenio no es editable/i.test(x.message)));

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
