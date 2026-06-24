// read-conductor-b21.mjs <conductorId>
//
// Lee /conductores/{conductorId} del emulator y imprime en stdout un JSON con
// los campos operativos (para aserciones desde los E2E de B21). Si no existe,
// imprime {"exists": false}.
//
// EMULATOR ONLY. Uso: node apps/functions/scripts/read-conductor-b21.mjs <id>

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

const conductorId = process.argv[2];
if (!conductorId) {
  console.error("Falta el argumento conductorId");
  process.exit(2);
}

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const db = getFirestore();

const snap = await db.collection("conductores").doc(conductorId).get();
if (!snap.exists) {
  console.log(JSON.stringify({ exists: false }));
  process.exit(0);
}
const d = snap.data();
console.log(
  JSON.stringify({
    exists: true,
    lineasPreferentes: d.lineasPreferentes ?? [],
    lineasSecundarias: d.lineasSecundarias ?? [],
    tiposTurnoPermitidos: d.tiposTurnoPermitidos ?? [],
    tiposTurnoExcluidos: d.tiposTurnoExcluidos ?? [],
    maxHorasSemanales: d.maxHorasSemanales ?? null,
    observaciones: d.observaciones ?? null,
    estado: d.estado ?? null,
  }),
);
process.exit(0);
