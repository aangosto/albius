// reset-festivos-b35.mjs
//
// Reset entre tests E2E de B35.1 (beforeEach de festivos.spec.ts): borra TODOS
// los festivos de tenant-test y deja dos conocidos:
//   - fest_b35_nacional: TENANT-WIDE (sin centroId) y OFICIAL (esEditable=false)
//     → el jefe lo ve en solo lectura ("Todos los centros", "oficial").
//   - fest_b35_local: del centro-test, editable → el jefe puede editar/borrar.
// EMULATOR ONLY. Uso: node apps/functions/scripts/reset-festivos-b35.mjs
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const db = getFirestore();

const prev = await db.collection("festivos").where("tenantId", "==", TENANT_ID).get();
for (const d of prev.docs) await d.ref.delete();

const ts = (iso) => Timestamp.fromDate(new Date(`${iso}T00:00:00.000Z`));
const base = { tenantId: TENANT_ID, creadoPor: "reset-festivos-b35", creadoEn: FieldValue.serverTimestamp() };

await db.collection("festivos").doc("fest_b35_nacional").set({
  id: "fest_b35_nacional", ...base,
  fecha: ts("2026-10-12"), nombre: "Fiesta Nacional de España", ambito: "nacional",
  tipoTraficoAplicable: "festivo", esEditable: false,
});
await db.collection("festivos").doc("fest_b35_local").set({
  id: "fest_b35_local", ...base, centroId: CENTRO_ID,
  fecha: ts("2026-09-19"), nombre: "Fiesta local de prueba", ambito: "local",
  tipoTraficoAplicable: "domingo", esEditable: true,
});

console.log("reset-festivos-b35: 2 festivos (1 tenant-wide oficial, 1 del centro editable)");
