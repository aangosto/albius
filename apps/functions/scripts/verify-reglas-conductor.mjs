// verify-reglas-conductor.mjs
//
// SONDA DE REGLAS Firestore con el SDK DE CLIENTE (B34.1): comprueba, contra
// el emulador y las reglas reales de firestore.rules, qué puede LEER cada rol.
// Distinto de los verify-* de callables (Admin SDK bypassa reglas): aquí lo que
// se prueba es la regla, no el callable.
//
//   - Conductor: SOLO sus asignaciones y ausencias (claim conductorId), SOLO su
//     ficha (usuarioId==uid), SOLO cuadrantes publicados/cerrados (no borrador),
//     y el catálogo (tipos_turno/lineas) del tenant.
//   - Conductor SIN claim conductorId (creado antes de B34.1): NO lee ni las
//     suyas → documenta TODO[claims-conductorid-migracion].
//   - Jefe y super_admin: no pierden nada (listados del jefe D6.5 intactos).
//   - D6.5 en el conductor: un list sin where('conductorId') o sin
//     where('estado' in publicado/cerrado) → permission-denied aunque los
//     docs sean suyos.
//
// Ejecución (desde la raíz, con el emulator arrancado, reglas cargadas desde
// firebase.json):  node apps/functions/scripts/verify-reglas-conductor.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp: initAdmin, getApps } = await import("firebase-admin/app");
const { getAuth: getAdminAuth } = await import("firebase-admin/auth");
const { getFirestore: getAdminDb, FieldValue, Timestamp } = await import(
  "firebase-admin/firestore"
);
const { initializeApp: initClient } = await import("firebase/app");
const { getAuth: getClientAuth, connectAuthEmulator, signInWithCustomToken } =
  await import("firebase/auth");
const {
  getFirestore: getClientDb,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} = await import("firebase/firestore");

const PROJECT_ID = "albius-cbdb1";
if (getApps().length === 0) initAdmin({ projectId: PROJECT_ID });
const adminAuth = getAdminAuth();
const adb = getAdminDb();

// ============================================================================
//  Seed (Admin SDK)
// ============================================================================
const T = "tenant_b34";
const C = "centro_b34";
const COND_A = `${T}_A1`;
const COND_B = `${T}_B1`;
const CUA_PUB = `cua_${C}_2026_9`;
const CUA_BORR = `cua_${C}_2026_10`;
const USERS = {
  condA: { uid: "b34_cond_a", claims: { rol: "conductor", tenantId: T, centroId: C, conductorId: COND_A } },
  condB: { uid: "b34_cond_b", claims: { rol: "conductor", tenantId: T, centroId: C, conductorId: COND_B } },
  condLegacy: { uid: "b34_cond_legacy", claims: { rol: "conductor", tenantId: T, centroId: C } }, // sin claim (pre-B34.1)
  jefe: { uid: "b34_jefe", claims: { rol: "jefe_trafico", tenantId: T, centroId: C } },
  admin: { uid: "b34_admin", claims: { rol: "super_admin" } },
};

async function delCol(col, field, value) {
  const snap = await adb.collection(col).where(field, "==", value).get();
  for (const d of snap.docs) await d.ref.delete();
}
const ts = (d) => Timestamp.fromDate(new Date(`2026-09-${String(d).padStart(2, "0")}T00:00:00.000Z`));

async function seed() {
  for (const u of Object.values(USERS)) {
    await adminAuth.deleteUser(u.uid).catch((e) => { if (e.code !== "auth/user-not-found") throw e; });
    await adminAuth.createUser({ uid: u.uid, email: `${u.uid}@b34.test` });
    await adminAuth.setCustomUserClaims(u.uid, u.claims);
  }
  for (const [col, field] of [["conductores", "tenantId"], ["asignaciones", "tenantId"], ["ausencias", "tenantId"], ["cuadrantes", "tenantId"], ["tipos_turno", "tenantId"], ["lineas", "tenantId"]]) {
    await delCol(col, field, T);
  }
  const base = { creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp() };
  await adb.collection("tenants").doc(T).set({ id: T, nombre: "Tenant B34", cif: "A34343434", estado: "activo", plan: "basico", comunidadAutonoma: "Murcia", provincia: "Murcia", fechaAlta: FieldValue.serverTimestamp(), configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" }, ...base });
  await adb.collection("centros").doc(C).set({ id: C, tenantId: T, nombre: "Centro B34", ciudad: "Cartagena", provincia: "Murcia", estado: "activo", fechaCreacion: FieldValue.serverTimestamp(), ...base });
  const cond = (id, usuarioId, n) => ({ id, tenantId: T, centroId: C, usuarioId, numeroEmpleado: n, nombre: "Cond", apellidos: n, dni: "00000000T", categoria: "conductor", fechaAntiguedad: ts(1), fechaIncorporacion: ts(1), estado: "activo", lineasPreferentes: [], lineasSecundarias: [], tiposTurnoPermitidos: [], puedeSerReserva: false, ...base });
  await adb.collection("conductores").doc(COND_A).set(cond(COND_A, USERS.condA.uid, "A1"));
  await adb.collection("conductores").doc(COND_B).set(cond(COND_B, USERS.condB.uid, "B1"));
  const cua = (id, mes, estado) => ({ id, tenantId: T, centroId: C, año: 2026, mes, estado, versionActual: 1, fechaGeneracion: FieldValue.serverTimestamp(), generadoPor: "system-seed", modoGeneracion: "manual", estadoGeneracion: "completado", ...base });
  await adb.collection("cuadrantes").doc(CUA_PUB).set(cua(CUA_PUB, 9, "publicado"));
  await adb.collection("cuadrantes").doc(CUA_BORR).set(cua(CUA_BORR, 10, "borrador"));
  const asig = (id, conductorId, dia) => ({ id, tenantId: T, centroId: C, cuadranteId: CUA_PUB, conductorId, fecha: ts(dia), tipoAsignacion: "turno", tipoTurnoId: "tt_b34", horaInicio: "06:00", horaFin: "14:00", esIntercambiada: false, estado: "planificada", ...base });
  await adb.collection("asignaciones").doc("asig_b34_a").set(asig("asig_b34_a", COND_A, 5));
  await adb.collection("asignaciones").doc("asig_b34_b").set(asig("asig_b34_b", COND_B, 5));
  const aus = (id, conductorId) => ({ id, tenantId: T, centroId: C, conductorId, categoria: "permiso", codigo: "AP", fechaInicio: ts(10), fechaFin: ts(10), ...base });
  await adb.collection("ausencias").doc("aus_b34_a").set(aus("aus_b34_a", COND_A));
  await adb.collection("ausencias").doc("aus_b34_b").set(aus("aus_b34_b", COND_B));
  await adb.collection("tipos_turno").doc("tt_b34").set({ id: "tt_b34", tenantId: T, centroId: C, codigo: "TT34", nombre: "Tipo", horaInicio: "06:00", horaFin: "14:00", duracionMinutos: 480, duracionEfectivaMinutos: 450, esPartido: false, esNocturno: false, estado: "activo", tiposDiaAplicables: ["laborable"], ...base });
  await adb.collection("lineas").doc("lin_b34").set({ id: "lin_b34", tenantId: T, centroId: C, codigo: "34", nombre: "Línea 34", tipo: "urbana", esNocturna: false, estado: "activa", paradasIda: [], paradasVuelta: [], ...base });
}

// ============================================================================
//  Cliente (una app por usuario, con las REGLAS aplicadas)
// ============================================================================
async function clienteDe(key) {
  const u = USERS[key];
  const app = initClient({ projectId: PROJECT_ID, apiKey: "fake-api-key" }, `app_${key}`);
  const auth = getClientAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getClientDb(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const token = await adminAuth.createCustomToken(u.uid, u.claims);
  await signInWithCustomToken(auth, token);
  // El custom token ya lleva los claims; el ID token resultante también.
  return db;
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
/** Ejecuta una lectura; `expectOk` true → debe resolver (con `minDocs` si es list); false → permission-denied. */
async function probar(name, fn, expectOk, minDocs = 1) {
  try {
    const r = await fn();
    const n = r && typeof r.size === "number" ? r.size : r && r.exists?.() ? 1 : 0;
    if (expectOk) record(name, `ok (≥${minDocs} docs)`, `ok (${n} docs)`, n >= minDocs);
    else record(name, "permission-denied", `ok (${n} docs) — LEAK`, false);
  } catch (e) {
    const code = e?.code ?? String(e);
    if (expectOk) record(name, "ok", `error ${code}`, false);
    else record(name, "permission-denied", code, code === "permission-denied");
  }
}

async function main() {
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const dbA = await clienteDe("condA");
  const dbLegacy = await clienteDe("condLegacy");
  const dbJefe = await clienteDe("jefe");
  const dbAdmin = await clienteDe("admin");

  const q = (db, col, ...w) => getDocs(query(collection(db, col), ...w));

  console.log("=== CONDUCTOR A (claim conductorId) ===\n");
  await probar("C1 list asignaciones propias (tenantId+conductorId)", () => q(dbA, "asignaciones", where("tenantId", "==", T), where("conductorId", "==", COND_A)), true);
  await probar("C2 list asignaciones de B", () => q(dbA, "asignaciones", where("tenantId", "==", T), where("conductorId", "==", COND_B)), false);
  await probar("C3 list asignaciones sin conductorId (D6.5)", () => q(dbA, "asignaciones", where("tenantId", "==", T)), false);
  await probar("C4 list asignaciones por cuadrante (query del jefe)", () => q(dbA, "asignaciones", where("tenantId", "==", T), where("cuadranteId", "==", CUA_PUB)), false);
  await probar("C5 get asignación propia", () => getDoc(doc(dbA, "asignaciones", "asig_b34_a")), true);
  await probar("C6 get asignación de B", () => getDoc(doc(dbA, "asignaciones", "asig_b34_b")), false);
  await probar("C7 list ausencias propias", () => q(dbA, "ausencias", where("tenantId", "==", T), where("conductorId", "==", COND_A)), true);
  await probar("C8 list ausencias del centro (query del jefe)", () => q(dbA, "ausencias", where("tenantId", "==", T), where("centroId", "==", C)), false);
  await probar("C9 get ausencia de B", () => getDoc(doc(dbA, "ausencias", "aus_b34_b")), false);
  await probar("C10 get SU ficha /conductores", () => getDoc(doc(dbA, "conductores", COND_A)), true);
  await probar("C11 get ficha de B", () => getDoc(doc(dbA, "conductores", COND_B)), false);
  await probar("C12 list conductores del centro (query del jefe)", () => q(dbA, "conductores", where("tenantId", "==", T), where("centroId", "==", C)), false);
  await probar("C13 get cuadrante PUBLICADO", () => getDoc(doc(dbA, "cuadrantes", CUA_PUB)), true);
  await probar("C14 get cuadrante BORRADOR", () => getDoc(doc(dbA, "cuadrantes", CUA_BORR)), false);
  await probar("C15 list cuadrantes estado in [publicado,cerrado]", () => q(dbA, "cuadrantes", where("tenantId", "==", T), where("centroId", "==", C), where("estado", "in", ["publicado", "cerrado"])), true);
  await probar("C16 list cuadrantes sin filtro de estado (D6.5)", () => q(dbA, "cuadrantes", where("tenantId", "==", T), where("centroId", "==", C)), false);
  await probar("C17 list tipos_turno (catálogo)", () => q(dbA, "tipos_turno", where("tenantId", "==", T), where("centroId", "==", C)), true);
  await probar("C18 list lineas (catálogo)", () => q(dbA, "lineas", where("tenantId", "==", T), where("centroId", "==", C)), true);

  console.log("\n=== CONDUCTOR LEGACY (sin claim conductorId, pre-B34.1) ===\n");
  await probar("L1 list asignaciones 'propias' sin claim → denegado", () => q(dbLegacy, "asignaciones", where("tenantId", "==", T), where("conductorId", "==", COND_A)), false);
  await probar("L2 get cuadrante publicado (no depende del claim)", () => getDoc(doc(dbLegacy, "cuadrantes", CUA_PUB)), true);

  console.log("\n=== JEFE (sin regresión) ===\n");
  await probar("J1 list asignaciones por cuadrante", () => q(dbJefe, "asignaciones", where("tenantId", "==", T), where("cuadranteId", "==", CUA_PUB)), true, 2);
  await probar("J2 list conductores del centro", () => q(dbJefe, "conductores", where("tenantId", "==", T), where("centroId", "==", C)), true, 2);
  await probar("J3 list ausencias del centro", () => q(dbJefe, "ausencias", where("tenantId", "==", T), where("centroId", "==", C)), true, 2);
  await probar("J4 get cuadrante BORRADOR", () => getDoc(doc(dbJefe, "cuadrantes", CUA_BORR)), true);
  await probar("J5 list cuadrantes del centro (sin estado)", () => q(dbJefe, "cuadrantes", where("tenantId", "==", T), where("centroId", "==", C)), true, 2);

  console.log("\n=== SUPER_ADMIN (sin regresión) ===\n");
  await probar("A1 list asignaciones sin tenantId", () => q(dbAdmin, "asignaciones", where("cuadranteId", "==", CUA_PUB)), true, 2);
  await probar("A2 get ficha de B", () => getDoc(doc(dbAdmin, "conductores", COND_B)), true);
  await probar("A3 get cuadrante BORRADOR", () => getDoc(doc(dbAdmin, "cuadrantes", CUA_BORR)), true);

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
