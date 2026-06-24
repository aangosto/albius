// verify-cuadrante-b28.mjs
//
// Verificación empírica de B28 (maquinaria de escritura reutilizable +
// actualizarCuadrante) contra los emulators Auth + Firestore + Functions.
//
//   node apps/functions/scripts/verify-cuadrante-b28.mjs
//
// Cubre: refactor de crearAsignacionesLote (no-regresión), eliminarAsignacionesCuadrante
// (limpiar borrador), regenerarAsignacionesCuadrante (limpiar+volcar = M no N+M),
// actualizarCuadrante (estadisticas, bloque regeneracion, veto inmutables, exige
// borrador, auth 3 niveles + anti-cross), y actorId persistido.
//
// Helpers locales duplicados (TODO[refactor-verify-helpers]). expectedCode UPPER_SNAKE_CASE.

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
const U_CREAR_CUAD = url("crearCuadrante");
const U_PUBLICAR = url("publicarCuadrante");
const U_LOTE = url("crearAsignacionesLote");
const U_LIMPIAR = url("eliminarAsignacionesCuadrante");
const U_REGENERAR = url("regenerarAsignacionesCuadrante");
const U_ACT_CUAD = url("actualizarCuadrante");
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

async function checkEmulatorsUp() {
  for (const h of [AUTH_HOST, FUNCTIONS_HOST, FIRESTORE_HOST]) {
    try {
      await fetch(`http://${h}/`, { method: "GET" });
    } catch (e) {
      console.error(`\nEmulator ${h} no responde: ${e.message}`);
      process.exit(2);
    }
  }
}
async function signIn(customToken) {
  const resp = await fetch(AUTH_SIGNIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!resp.ok) throw new Error(`signIn fallo: ${resp.status}`);
  return (await resp.json()).idToken;
}
async function tokenFor(uid) {
  return signIn(await auth.createCustomToken(uid));
}
async function invoke(u, data, idToken) {
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
    return { ok: true, body: body.result };
  }
  const err = (body && body.error) || {};
  return {
    ok: false,
    code: err.status || err.code || `http-${resp.status}`,
    message: err.message || text,
  };
}

const TENANT_ID = "tenant_b28";
const CENTRO = "centro_b28_activo";
const CENTRO_OTRO = "centro_b28_otro";

const SEED_USERS = [
  { uid: "admin_b28", email: "admin-b28@albius.test", claims: { rol: "super_admin" } },
  { uid: "jefe_b28", email: "jefe-b28@albius.test", claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO } },
  { uid: "cond_b28", email: "cond-b28@albius.test", claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO } },
];

function makeCentro(id, nombre) {
  return {
    id, tenantId: TENANT_ID, nombre, ciudad: "Cartagena", provincia: "Murcia",
    estado: "activo", fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  };
}
async function delUser(uid) {
  try { await auth.deleteUser(uid); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
}
async function delColl(name, field, value) {
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
    id: TENANT_ID, nombre: "Tenant B28", cif: "A28282820",
    comunidadAutonoma: "Murcia", provincia: "Murcia", plan: "basico", estado: "activo",
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
    creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  });
  await db.collection("centros").doc(CENTRO).set(makeCentro(CENTRO, "Centro B28 (jefe)"));
  await db.collection("centros").doc(CENTRO_OTRO).set(makeCentro(CENTRO_OTRO, "Centro B28 Otro"));
  await delColl("cuadrantes", "tenantId", TENANT_ID);
  await delColl("asignaciones", "tenantId", TENANT_ID);
}

const results = [];
function record(name, expected, actual, pass) {
  console.log(`${pass ? "[OK]  " : "[FAIL]"} ${name}`);
  console.log(`       esperado: ${expected}`);
  console.log(`       recibido: ${actual}`);
  results.push({ name, pass });
}
function expectError(name, code, r, extra = null) {
  if (r.ok) { record(name, `error ${code}`, "OK inesperado", false); return; }
  let pass = r.code === code;
  if (pass && extra && extra(r) !== true) pass = false;
  record(name, `error ${code}`, `code=${r.code} msg="${r.message}"`, pass);
}
const cuadId = (centro, año, mes) => `cua_${centro}_${año}_${mes}`;
async function countAsig(cuadranteId) {
  const s = await db.collection("asignaciones").where("cuadranteId", "==", cuadranteId).get();
  return s.size;
}
async function getCuad(id) {
  const s = await db.collection("cuadrantes").doc(id).get();
  return s.exists ? s.data() : null;
}
function asig(conductorId, fecha) {
  return { conductorId, fecha, tipoAsignacion: "turno", tipoTurnoId: "tt_x", horaInicio: "06:00", horaFin: "14:00" };
}

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   OK\n");

  const tAdmin = await tokenFor("admin_b28");
  const tJefe = await tokenFor("jefe_b28");
  const tCond = await tokenFor("cond_b28");

  // Cuadrante borrador para asignaciones (2026/9).
  const ID = cuadId(CENTRO, 2026, 9);
  await invoke(U_CREAR_CUAD, { tenantId: TENANT_ID, centroId: CENTRO, año: 2026, mes: 9 }, tAdmin);

  console.log("=== Refactor crearAsignacionesLote (no-regresión) ===\n");
  // T1 — lote de 3 sigue funcionando
  {
    const items = [asig("c1", "2026-09-01"), asig("c2", "2026-09-02"), asig("c3", "2026-09-03")];
    const r = await invoke(U_LOTE, { cuadranteId: ID, asignaciones: items }, tJefe);
    const n = await countAsig(ID);
    record("T1 (lote x3 tras refactor)", "creadas=3, total=3", `creadas=${r.body?.creadas}, total=${n}`, r.ok && r.body.creadas === 3 && n === 3);
  }
  // T2 — fecha fuera de mes sigue rechazándose (validación intacta)
  await invoke(U_LOTE, { cuadranteId: ID, asignaciones: [asig("cx", "2026-10-01")] }, tJefe)
    .then((r) => expectError("T2 (fecha fuera de mes)", "INVALID_ARGUMENT", r, (x) => /fuera del mes/i.test(x.message)));

  console.log("\n=== eliminarAsignacionesCuadrante ===\n");
  // T3 — limpiar el borrador (había 3) → 0
  {
    const r = await invoke(U_LIMPIAR, { cuadranteId: ID }, tJefe);
    const n = await countAsig(ID);
    record("T3 (limpiar borrador)", "eliminadas=3, total=0", `eliminadas=${r.body?.eliminadas}, total=${n}`, r.ok && r.body.eliminadas === 3 && n === 0);
  }
  // T4 — limpiar vacío → eliminadas=0 (idempotente)
  {
    const r = await invoke(U_LIMPIAR, { cuadranteId: ID }, tJefe);
    record("T4 (limpiar vacío)", "eliminadas=0", `eliminadas=${r.body?.eliminadas}`, r.ok && r.body.eliminadas === 0);
  }
  // T5 — limpiar otro tenant/centro (anti-cross): jefe sobre cuadrante de CENTRO_OTRO
  {
    const idOtro = cuadId(CENTRO_OTRO, 2026, 9);
    await invoke(U_CREAR_CUAD, { tenantId: TENANT_ID, centroId: CENTRO_OTRO, año: 2026, mes: 9 }, tAdmin);
    await invoke(U_LIMPIAR, { cuadranteId: idOtro }, tJefe)
      .then((r) => expectError("T5 (limpiar otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  }

  console.log("\n=== regenerarAsignacionesCuadrante (limpiar+volcar) ===\n");
  // T6 — sembrar 3, regenerar con 2 → quedan 2 (no 5)
  {
    await invoke(U_LOTE, { cuadranteId: ID, asignaciones: [asig("a", "2026-09-04"), asig("b", "2026-09-05"), asig("c", "2026-09-06")] }, tJefe);
    const antes = await countAsig(ID);
    const r = await invoke(U_REGENERAR, { cuadranteId: ID, asignaciones: [asig("x", "2026-09-10"), asig("y", "2026-09-11")] }, tJefe);
    const despues = await countAsig(ID);
    record("T6 (regenerar 3→2)", "antes=3, eliminadas=3, creadas=2, despues=2 (no 5)",
      `antes=${antes}, eliminadas=${r.body?.eliminadas}, creadas=${r.body?.creadas}, despues=${despues}`,
      r.ok && antes === 3 && r.body.eliminadas === 3 && r.body.creadas === 2 && despues === 2);
  }

  console.log("\n=== actualizarCuadrante ===\n");
  // T7 — escribir estadisticas (persisten)
  {
    const stats = { coberturaServicios: 98.5, satisfaccionMedia: 89, preferenciasCumplidas: 120, preferenciasNoCumplidas: 15 };
    const r = await invoke(U_ACT_CUAD, { cuadranteId: ID, estadisticas: stats }, tJefe);
    const d = (await getCuad(ID)) || {};
    const ok = r.ok && d.estadisticas?.coberturaServicios === 98.5 && d.estadisticas?.preferenciasCumplidas === 120 && d.actualizadoPor === "jefe_b28";
    record("T7 (estadisticas persisten)", "cobertura=98.5, prefCumplidas=120, actualizadoPor=jefe",
      `cobertura=${d.estadisticas?.coberturaServicios}, prefCumplidas=${d.estadisticas?.preferenciasCumplidas}, actualizadoPor=${d.actualizadoPor}`, ok);
  }
  // T8 — bloque regeneracion (generadoPor/fechaGeneracion/modoGeneracion)
  {
    const r = await invoke(U_ACT_CUAD, { cuadranteId: ID, regeneracion: { generadoPor: "jefe_b28", modoGeneracion: "optimizador_libre" } }, tAdmin);
    const d = (await getCuad(ID)) || {};
    const ok = r.ok && d.generadoPor === "jefe_b28" && d.modoGeneracion === "optimizador_libre" && d.fechaGeneracion !== undefined && d.actualizadoPor === "admin_b28";
    record("T8 (bloque regeneracion)", "generadoPor=jefe_b28, modo=optimizador_libre, fechaGeneracion set, actualizadoPor=admin",
      `generadoPor=${d.generadoPor}, modo=${d.modoGeneracion}, fechaGen=${d.fechaGeneracion !== undefined}, actualizadoPor=${d.actualizadoPor}`, ok);
  }
  // T9 — sin campos (ni estadisticas ni regeneracion) → invalid-argument
  await invoke(U_ACT_CUAD, { cuadranteId: ID }, tAdmin)
    .then((r) => expectError("T9 (sin campos)", "INVALID_ARGUMENT", r, (x) => /al menos un campo/i.test(x.message)));
  // T10 — veto estado
  await invoke(U_ACT_CUAD, { cuadranteId: ID, estado: "publicado" }, tAdmin)
    .then((r) => expectError("T10 (veto estado)", "INVALID_ARGUMENT", r, (x) => /estado/i.test(x.message)));
  // T11 — veto centroId
  await invoke(U_ACT_CUAD, { cuadranteId: ID, centroId: "x", estadisticas: { a: 1 } }, tAdmin)
    .then((r) => expectError("T11 (veto centroId)", "INVALID_ARGUMENT", r, (x) => /centroId/i.test(x.message)));
  // T12 — estadisticas con valor no numérico
  await invoke(U_ACT_CUAD, { cuadranteId: ID, estadisticas: { cobertura: "alta" } }, tAdmin)
    .then((r) => expectError("T12 (estadistica no numérica)", "INVALID_ARGUMENT", r, (x) => /número finito/i.test(x.message)));
  // T13 — modoGeneracion inválido en regeneracion
  await invoke(U_ACT_CUAD, { cuadranteId: ID, regeneracion: { generadoPor: "j", modoGeneracion: "magia" } }, tAdmin)
    .then((r) => expectError("T13 (modoGeneracion inválido)", "INVALID_ARGUMENT", r, (x) => /modoGeneracion/i.test(x.message)));

  console.log("\n=== actualizarCuadrante: exige borrador + auth ===\n");
  // Cuadrante publicado para probar el gate de estado.
  const ID_PUB = cuadId(CENTRO, 2026, 8);
  await invoke(U_CREAR_CUAD, { tenantId: TENANT_ID, centroId: CENTRO, año: 2026, mes: 8 }, tAdmin);
  await invoke(U_PUBLICAR, { cuadranteId: ID_PUB }, tAdmin);
  // T14 — actualizar cuadrante publicado → failed-precondition
  await invoke(U_ACT_CUAD, { cuadranteId: ID_PUB, estadisticas: { a: 1 } }, tAdmin)
    .then((r) => expectError("T14 (publicado no editable)", "FAILED_PRECONDITION", r, (x) => /no es editable/i.test(x.message)));
  // T15 — jefe otro centro (anti-cross)
  {
    const idOtro = cuadId(CENTRO_OTRO, 2026, 9);
    await invoke(U_ACT_CUAD, { cuadranteId: idOtro, estadisticas: { a: 1 } }, tJefe)
      .then((r) => expectError("T15 (jefe otro centro)", "PERMISSION_DENIED", r, (x) => /otro centro/i.test(x.message)));
  }
  // T16 — conductor
  await invoke(U_ACT_CUAD, { cuadranteId: ID, estadisticas: { a: 1 } }, tCond)
    .then((r) => expectError("T16 (conductor)", "PERMISSION_DENIED", r));
  // T17 — anónimo
  await invoke(U_ACT_CUAD, { cuadranteId: ID, estadisticas: { a: 1 } }, null)
    .then((r) => expectError("T17 (anónimo)", "UNAUTHENTICATED", r));

  console.log("\n=== actorId='optimizador' (escritura por servicio) ===\n");
  // T18 — lote con actorId del servicio: lo simulamos vía el callable como admin,
  // pero verificamos la convención escribiendo directamente con la función no es
  // posible por HTTP; en su lugar confirmamos que creadoPor refleja el invocador.
  // (La convención actorId='optimizador' la ejercerá el orquestador B29 llamando
  // la función interna; aquí validamos que creadoPor = uid del invocador del lote.)
  {
    await invoke(U_LIMPIAR, { cuadranteId: ID }, tAdmin);
    await invoke(U_LOTE, { cuadranteId: ID, asignaciones: [asig("svc", "2026-09-20")] }, tAdmin);
    const s = await db.collection("asignaciones").where("cuadranteId", "==", ID).get();
    const d = s.docs[0]?.data() || {};
    record("T18 (creadoPor = actor del lote)", "creadoPor=admin_b28", `creadoPor=${d.creadoPor}`, d.creadoPor === "admin_b28");
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
