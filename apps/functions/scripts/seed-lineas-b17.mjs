// seed-lineas-b17.mjs
//
// Seed para verificación manual en navegador del frontend de Líneas (B17).
// A diferencia de seed-test-user.mjs (que pone el jefe con
// passwordChangeRequired=true para verificar el flujo de B7), aquí el jefe
// nace con flag=false para entrar directo a /lineas sin pasar por
// /cambiar-password.
//
// Crea:
//   - 3 usuarios (password albius123, flag=false → login directo):
//       admin@albius.local      super_admin   (no tiene /lineas en sidebar)
//       jefe@albius.local       jefe_trafico  (tenant-test, centro-test)  ← sujeto
//       conductor@albius.local  conductor     (gate: NoAutorizadoView en /lineas)
//   - /tenants/tenant-test (activo) + /centros/centro-test (activo)
//   - 3 líneas en centro-test que ejercitan las columnas de la tabla:
//       "1"   Urbana      activa      color, sin vigencia
//       "N1"  Urbana      activa      nocturna (icono Moon)
//       "44"  Interurbana suspendida  vigencia estacional + observaciones
//
// Auditoría canónica D6.4: las líneas nacen con creadoEn/creadoPor, SIN
// fechaCreacion (Línea es la primera entidad sin lastre).
//
// EMULATOR ONLY: env vars hardcodeadas para impedir uso contra Firebase real.
//
// Uso:
//   node apps/functions/scripts/seed-lineas-b17.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = await import(
  "firebase-admin/firestore"
);

const SEED_PASSWORD = "albius123";
const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";

const USERS = [
  {
    email: "admin@albius.local",
    nombre: "Super Admin Test",
    rol: "super_admin",
    claims: { rol: "super_admin" },
  },
  {
    email: "jefe@albius.local",
    nombre: "Jefe Trafico Test",
    rol: "jefe_trafico",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ID },
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
  },
  {
    email: "conductor@albius.local",
    nombre: "Conductor Test",
    rol: "conductor",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ID },
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
  },
];

if (getApps().length === 0) {
  initializeApp({ projectId: "albius-cbdb1" });
}
const auth = getAuth();
const db = getFirestore();

console.log("\n[SEED-LINEAS-B17] Emulator only. Password (todos): albius123\n");

// Idempotencia: borrar Auth users previos + sus /usuarios docs.
for (const spec of USERS) {
  try {
    const prev = await auth.getUserByEmail(spec.email);
    await auth.deleteUser(prev.uid);
    await db.collection("usuarios").doc(prev.uid).delete().catch(() => {});
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

// Tenant + centro activos.
await db.collection("tenants").doc(TENANT_ID).set({
  id: TENANT_ID,
  nombre: "Tenant Test",
  cif: "B00000000",
  comunidadAutonoma: "Murcia",
  provincia: "Murcia",
  plan: "basico",
  estado: "activo",
  fechaAlta: FieldValue.serverTimestamp(),
  configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
  creadoPor: "seed-lineas-b17",
  creadoEn: FieldValue.serverTimestamp(),
});
await db.collection("centros").doc(CENTRO_ID).set({
  id: CENTRO_ID,
  tenantId: TENANT_ID,
  nombre: "Centro Test",
  ciudad: "Cartagena",
  provincia: "Murcia",
  estado: "activo",
  fechaCreacion: FieldValue.serverTimestamp(),
  creadoPor: "seed-lineas-b17",
  creadoEn: FieldValue.serverTimestamp(),
});

// Users + claims + /usuarios docs (flag=false → login directo).
for (const spec of USERS) {
  const u = await auth.createUser({
    email: spec.email,
    password: SEED_PASSWORD,
    displayName: spec.nombre,
  });
  await auth.setCustomUserClaims(u.uid, spec.claims);
  const doc = {
    id: u.uid,
    email: spec.email,
    nombreCompleto: spec.nombre,
    rol: spec.rol,
    estado: "activo",
    passwordChangeRequired: false,
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: "seed-lineas-b17",
    creadoEn: FieldValue.serverTimestamp(),
  };
  if (spec.tenantId) doc.tenantId = spec.tenantId;
  if (spec.centroId) doc.centroId = spec.centroId;
  await db.collection("usuarios").doc(u.uid).set(doc);
}

// 3 líneas en centro-test. Auditoría D6.4 (creadoEn, SIN fechaCreacion).
const LINEAS = [
  {
    id: "linea_b17_1",
    codigo: "1",
    nombre: "Centro - Universidad",
    tipo: "urbana",
    esNocturna: false,
    estado: "activa",
    color: "#1F77B4",
    paradasIda: [],
    paradasVuelta: [],
  },
  {
    id: "linea_b17_n1",
    codigo: "N1",
    nombre: "Búho nocturno",
    tipo: "urbana",
    esNocturna: true,
    estado: "activa",
    color: "#222222",
    paradasIda: [],
    paradasVuelta: [],
  },
  {
    id: "linea_b17_44",
    codigo: "44",
    nombre: "Cartagena - La Manga (verano)",
    tipo: "interurbana",
    esNocturna: false,
    estado: "suspendida",
    paradasIda: [],
    paradasVuelta: [],
    vigenciaDesde: Timestamp.fromDate(new Date("2026-06-01T00:00:00Z")),
    vigenciaHasta: Timestamp.fromDate(new Date("2026-09-30T00:00:00Z")),
    observaciones: "Refuerzo estival a las playas.",
  },
];

// Limpieza idempotente: borrar líneas previas del centro de test.
const prevLineas = await db
  .collection("lineas")
  .where("centroId", "==", CENTRO_ID)
  .get();
for (const d of prevLineas.docs) await d.ref.delete();

for (const l of LINEAS) {
  await db.collection("lineas").doc(l.id).set({
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    creadoPor: "seed-lineas-b17",
    creadoEn: FieldValue.serverTimestamp(),
    ...l,
  });
}

console.log("Seed OK:");
console.log("  jefe@albius.local / albius123  (jefe_trafico, flag=false)");
console.log("  conductor@albius.local / albius123  (gate NoAutorizadoView)");
console.log("  admin@albius.local / albius123  (sin /lineas en sidebar)");
console.log(`  3 líneas en ${CENTRO_ID}: "1" (urbana), "N1" (nocturna), "44" (interurbana suspendida, estacional)\n`);

process.exit(0);
