// reset-cuadrante-b33.mjs
//
// Reset entre tests E2E de B33.2 (beforeEach del spec calendario.spec.ts):
// deja en centro-test un cuadrante CONOCIDO para 2026-09 (id determinista
// cua_centro-test_2026_9) SIN asignaciones, un convenio mínimo del centro
// (descanso 12 h, para el aviso de descanso) y UNA ausencia (cond_b22_2, permiso
// el 2026-09-10, para el aviso de ausencia). Los 3 conductores vienen de
// reset-conductores-b22 (el spec lo llama antes). EMULATOR ONLY.
//
// Uso: node apps/functions/scripts/reset-cuadrante-b33.mjs [--estado borrador|publicado|cerrado]
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
const AÑO = 2026;
const MES = 9;
const CUADRANTE_ID = `cua_${CENTRO_ID}_${AÑO}_${MES}`;

const idx = process.argv.indexOf("--estado");
const ESTADO = idx >= 0 ? process.argv[idx + 1] : "borrador";
if (!["borrador", "publicado", "cerrado"].includes(ESTADO)) {
  console.error(`--estado inválido: ${ESTADO}`);
  process.exit(2);
}

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const db = getFirestore();

// Asignaciones previas del cuadrante → fuera.
const asig = await db
  .collection("asignaciones")
  .where("cuadranteId", "==", CUADRANTE_ID)
  .get();
for (const d of asig.docs) await d.ref.delete();

// Cuadrante (set completo: idempotente).
await db.collection("cuadrantes").doc(CUADRANTE_ID).set({
  id: CUADRANTE_ID,
  tenantId: TENANT_ID,
  centroId: CENTRO_ID,
  año: AÑO,
  mes: MES,
  estado: ESTADO,
  versionActual: 1,
  fechaGeneracion: FieldValue.serverTimestamp(),
  generadoPor: "system-seed",
  modoGeneracion: "manual",
  estadoGeneracion: "idle",
  ...(ESTADO !== "borrador" && {
    fechaPublicacion: FieldValue.serverTimestamp(),
    publicadoPor: "system-seed",
  }),
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
});

// Convenio singleton del centro (D6.9): solo lo que el Calendario lee.
await db.collection("convenio").doc(CENTRO_ID).set({
  id: CENTRO_ID,
  centroId: CENTRO_ID,
  tenantId: TENANT_ID,
  descansoMinimoEntreJornadasHoras: 12,
  maxHorasSemanales: 40,
  maxHorasAnuales: 1800,
  minDomingosLibresAño: 12,
  maxFinesSemanaConsecutivosTrabajados: 2,
  maxDiasConsecutivosTrabajados: 6,
  descansoSemanalMinimoHoras: 36,
  antelacionMinimaPublicacionDias: 15,
  horasFestivoComputanComoExtras: false,
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
});

// Ausencias del tenant → fuera, y una conocida.
const aus = await db
  .collection("ausencias")
  .where("tenantId", "==", TENANT_ID)
  .get();
for (const d of aus.docs) await d.ref.delete();
const ausRef = db.collection("ausencias").doc("aus_b33_permiso");
await ausRef.set({
  id: ausRef.id,
  tenantId: TENANT_ID,
  centroId: CENTRO_ID,
  conductorId: "cond_b22_2",
  categoria: "permiso",
  codigo: "AP",
  fechaInicio: Timestamp.fromDate(new Date(Date.UTC(AÑO, MES - 1, 10))),
  fechaFin: Timestamp.fromDate(new Date(Date.UTC(AÑO, MES - 1, 10))),
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
});

console.log(`reset-cuadrante-b33: ${CUADRANTE_ID} estado=${ESTADO}, 0 asignaciones, convenio + 1 ausencia`);
