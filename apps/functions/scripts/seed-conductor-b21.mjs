// seed-conductor-b21.mjs
//
// Seed adicional para los E2E de B21 (alta de conductor con pickers). Se ejecuta
// en globalSetup DESPUÉS de seed-tipos-turno-b19.mjs (que crea usuarios + tenant
// + centro + 4 tipos de turno). Aquí añadimos, SIN tocar usuarios:
//   - 3 líneas activas en centro-test (para los pickers de líneas).
//   - un segundo centro activo "centro-vacio-b21" SIN líneas ni tipos (para el
//     caso "centro sin líneas" + "cambio de centro resetea").
//
// Idempotente (set por id fijo). EMULATOR ONLY.
//
// Uso: node apps/functions/scripts/seed-conductor-b21.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
const CENTRO_VACIO = "centro-vacio-b21";

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const db = getFirestore();

// Asegura tenant + centro (idempotente; mismos datos que seed-tipos-turno-b19).
await db.collection("tenants").doc(TENANT_ID).set(
  {
    id: TENANT_ID,
    nombre: "Tenant Test",
    estado: "activo",
    creadoPor: "seed-conductor-b21",
    creadoEn: FieldValue.serverTimestamp(),
  },
  { merge: true },
);
await db.collection("centros").doc(CENTRO_ID).set(
  {
    id: CENTRO_ID,
    tenantId: TENANT_ID,
    nombre: "Centro Test",
    estado: "activo",
    creadoPor: "seed-conductor-b21",
    creadoEn: FieldValue.serverTimestamp(),
  },
  { merge: true },
);
// Segundo centro, activo, vacío (sin líneas ni tipos).
await db.collection("centros").doc(CENTRO_VACIO).set({
  id: CENTRO_VACIO,
  tenantId: TENANT_ID,
  nombre: "Centro Vacío B21",
  ciudad: "Murcia",
  provincia: "Murcia",
  estado: "activo",
  creadoPor: "seed-conductor-b21",
  creadoEn: FieldValue.serverTimestamp(),
});

// 3 líneas activas en centro-test.
const LINEAS = [
  { id: "linea_b21_a", codigo: "L-A", nombre: "Línea A" },
  { id: "linea_b21_b", codigo: "L-B", nombre: "Línea B" },
  { id: "linea_b21_c", codigo: "L-C", nombre: "Línea C" },
];
// Limpieza idempotente de líneas B21 previas en el centro.
const prev = await db
  .collection("lineas")
  .where("centroId", "==", CENTRO_ID)
  .get();
for (const d of prev.docs) {
  if (d.id.startsWith("linea_b21_")) await d.ref.delete();
}
for (const l of LINEAS) {
  await db.collection("lineas").doc(l.id).set({
    id: l.id,
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    codigo: l.codigo,
    nombre: l.nombre,
    tipo: "urbana",
    esNocturna: false,
    estado: "activa",
    paradasIda: [],
    paradasVuelta: [],
    creadoPor: "seed-conductor-b21",
    creadoEn: FieldValue.serverTimestamp(),
  });
}

console.log(
  `[SEED-CONDUCTOR-B21] OK: 3 líneas en ${CENTRO_ID} + ${CENTRO_VACIO} (vacío)`,
);
process.exit(0);
