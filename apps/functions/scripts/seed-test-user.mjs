// seed-test-user.mjs
//
// Crea 4 usuarios de testing en el Auth emulator para verificar el Bloque 6:
//   1. admin@albius.local      → rol=super_admin           (sin tenantId/centroId)
//   2. jefe@albius.local       → rol=jefe_trafico          (tenant-test, centro-test)
//   3. conductor@albius.local  → rol=conductor             (tenant-test, centro-test)
//   4. sinclaims@albius.local  → SIN custom claims         (simula alta incompleta)
//
// Cada user con rol obtiene además su documento /usuarios/{uid} con
// creadoPor='seed-test-user'. El user sinclaims se crea SOLO en Auth (sin
// /usuarios doc), modelando el escenario que LoginPage cubre con
// ClaimsIncompletosView.
//
// Docs de referencia para que el modelo sea consistente (D9 Bloque 6):
//   - /tenants/tenant-test
//   - /centros/centro-test
//   - /conductores/conductor-test  (asociado al user conductor@albius.local)
//
// EMULATOR ONLY: env vars hardcodeadas al inicio para impedir uso contra
// Firebase real. Producción usa siempre el bootstrap CLI con
// generatePasswordResetLink (D3 del Bloque 3).
//
// TODO[verify-full-password-reset-flow]: para verificar el flujo COMPLETO de
// password reset link (Bloque 5 Opción 1) usar el bootstrap CLI y seguir el
// link en el navegador. Este seed usa password directo: atajo de testing.
//
// Uso:
//   node apps/functions/scripts/seed-test-user.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

// ============================================================================
//  Constantes del seed
// ============================================================================

const SEED_PASSWORD = "albius123";
const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
const CONDUCTOR_ID = "conductor-test";

const USERS = [
  {
    email: "admin@albius.local",
    nombre: "Super Admin Test",
    rol: "super_admin",
    claims: { rol: "super_admin" },
    tenantId: null,
    centroId: null,
    conductorId: null,
  },
  {
    email: "jefe@albius.local",
    nombre: "Jefe Trafico Test",
    rol: "jefe_trafico",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ID },
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    conductorId: null,
  },
  {
    email: "conductor@albius.local",
    nombre: "Conductor Test",
    rol: "conductor",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ID },
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    conductorId: CONDUCTOR_ID,
  },
  {
    email: "sinclaims@albius.local",
    nombre: "Usuario Sin Claims",
    rol: null,
    claims: null,
    tenantId: null,
    centroId: null,
    conductorId: null,
  },
];

console.log("");
console.log("================================================================");
console.log("  [SEED-TEST-USER] Emulator only. NO usar contra Firebase real.");
console.log(`  password (todos): ${SEED_PASSWORD}`);
console.log("================================================================");
console.log("");

// ============================================================================
//  Init Admin SDK
// ============================================================================

if (getApps().length === 0) {
  initializeApp({ projectId: "albius-cbdb1" });
}
const auth = getAuth();
const db = getFirestore();

// ============================================================================
//  Idempotencia: borrar Auth users previos + sus /usuarios docs
// ============================================================================

for (const spec of USERS) {
  try {
    const prev = await auth.getUserByEmail(spec.email);
    console.log(`Eliminando user previo: ${spec.email} (uid=${prev.uid})`);
    await auth.deleteUser(prev.uid);
    await db.collection("usuarios").doc(prev.uid).delete().catch(() => {});
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

// ============================================================================
//  Docs de referencia: /tenants/tenant-test, /centros/centro-test
//  .set() sobrescribe el doc entero, garantizando estado idempotente.
// ============================================================================

console.log("Creando /tenants/tenant-test...");
await db.collection("tenants").doc(TENANT_ID).set({
  id: TENANT_ID,
  nombre: "Tenant Test",
  cif: "B00000000",
  comunidadAutonoma: "Murcia",
  provincia: "Murcia",
  plan: "basico",
  estado: "activo",
  fechaAlta: FieldValue.serverTimestamp(),
  configuracion: {
    zonaHoraria: "Europe/Madrid",
    idioma: "es",
  },
  creadoPor: "seed-test-user",
  creadoEn: FieldValue.serverTimestamp(),
});

console.log("Creando /centros/centro-test...");
await db.collection("centros").doc(CENTRO_ID).set({
  id: CENTRO_ID,
  tenantId: TENANT_ID,
  nombre: "Centro Test",
  ciudad: "Murcia",
  provincia: "Murcia",
  estado: "activo",
  fechaCreacion: FieldValue.serverTimestamp(),
  creadoPor: "seed-test-user",
  creadoEn: FieldValue.serverTimestamp(),
});

// ============================================================================
//  Auth users + custom claims + /usuarios docs (excepto sin-claims)
// ============================================================================

const results = [];

for (const spec of USERS) {
  const userRecord = await auth.createUser({
    email: spec.email,
    password: SEED_PASSWORD,
    displayName: spec.nombre,
  });
  if (spec.claims) {
    await auth.setCustomUserClaims(userRecord.uid, spec.claims);
  }
  if (spec.rol) {
    const usuarioDoc = {
      id: userRecord.uid,
      email: spec.email,
      nombreCompleto: spec.nombre,
      rol: spec.rol,
      estado: "activo",
      // Atajo de testing: el password se setea directamente, no requiere
      // reset previo. En producción (bootstrap CLI / callables) el flujo es
      // distinto y passwordChangeRequired=true al alta.
      passwordChangeRequired: false,
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "seed-test-user",
      creadoEn: FieldValue.serverTimestamp(),
    };
    if (spec.tenantId) usuarioDoc.tenantId = spec.tenantId;
    if (spec.centroId) usuarioDoc.centroId = spec.centroId;
    if (spec.conductorId) usuarioDoc.conductorId = spec.conductorId;
    await db.collection("usuarios").doc(userRecord.uid).set(usuarioDoc);
  }
  // sin-claims: NO /usuarios doc (simula alta incompleta, escenario
  // ClaimsIncompletosView del LoginPage).
  results.push({ ...spec, uid: userRecord.uid });
}

// ============================================================================
//  /conductores/conductor-test (asociado al user conductor)
// ============================================================================

const conductorUser = results.find((r) => r.email === "conductor@albius.local");
if (!conductorUser) {
  throw new Error("Conductor user no encontrado en results (bug en seed)");
}

console.log("Creando /conductores/conductor-test...");
await db.collection("conductores").doc(CONDUCTOR_ID).set({
  id: CONDUCTOR_ID,
  tenantId: TENANT_ID,
  centroId: CENTRO_ID,
  usuarioId: conductorUser.uid,
  numeroEmpleado: CONDUCTOR_ID,
  nombre: "Conductor",
  apellidos: "Test",
  dni: "00000000T",
  categoria: "conductor",
  fechaAntiguedad: FieldValue.serverTimestamp(),
  fechaIncorporacion: FieldValue.serverTimestamp(),
  estado: "activo",
  lineasPreferentes: [],
  lineasSecundarias: [],
  tiposTurnoPermitidos: [],
  puedeSerReserva: false,
  creadoPor: "seed-test-user",
  creadoEn: FieldValue.serverTimestamp(),
});

// ============================================================================
//  Resumen
// ============================================================================

console.log("");
console.log("================================================================");
console.log("  Seed OK. Users creados:");
console.log("================================================================");
for (const r of results) {
  const rolLabel = r.rol || "(sin claims)";
  console.log(`  ${r.email.padEnd(28)} ${rolLabel.padEnd(14)} uid=${r.uid}`);
}
console.log("");
console.log(`Password de todos: ${SEED_PASSWORD}`);
console.log("Login desde apps/web con VITE_USE_EMULATORS=true.");
console.log("");

process.exit(0);
