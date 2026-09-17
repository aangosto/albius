// reset-convenio-b35.mjs
//
// Reset entre tests E2E de B35.1 (beforeEach de convenio.spec.ts).
//   sin argumento  → BORRA convenio/centro-test (estado "sin convenio").
//   --con          → deja un convenio conocido (valores de abajo) para probar
//                    la precarga y la edición.
//   --cuadrante    → además, cuadrante cua_centro-test_2026_9 en BORRADOR,
//                    estadoGeneracion=completado y fechaGeneracion = hace 1 h
//                    (para el aviso "generado con un convenio anterior" tras
//                    guardar el convenio).
// EMULATOR ONLY. Uso: node apps/functions/scripts/reset-convenio-b35.mjs [--con]
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const db = getFirestore();

const ref = db.collection("convenio").doc(CENTRO_ID);
await ref.delete().catch(() => {});

if (process.argv.includes("--con")) {
  await ref.set({
    id: CENTRO_ID,
    centroId: CENTRO_ID,
    tenantId: TENANT_ID,
    convenioReferencia: "Convenio de prueba B35",
    descansoMinimoEntreJornadasHoras: 12,
    maxHorasSemanales: 40,
    maxHorasAnuales: 1800,
    minDomingosLibresAño: 12,
    maxFinesSemanaConsecutivosTrabajados: 2,
    maxDiasConsecutivosTrabajados: 6,
    descansoSemanalMinimoHoras: 36,
    antelacionMinimaPublicacionDias: 15,
    horasFestivoComputanComoExtras: false,
    computoHoras: "jornada",
    creadoPor: "reset-convenio-b35",
    // Hace 2 h: anterior a la generación del cuadrante de --cuadrante (hace 1 h),
    // para que el aviso "convenio anterior" solo salga tras guardar.
    creadoEn: Timestamp.fromMillis(Date.now() - 7200_000),
  });
  console.log("reset-convenio-b35: convenio de prueba creado");
} else {
  console.log("reset-convenio-b35: sin convenio en centro-test");
}

if (process.argv.includes("--cuadrante")) {
  const CUA = `cua_${CENTRO_ID}_2026_9`;
  await db.collection("cuadrantes").doc(CUA).set({
    id: CUA, tenantId: TENANT_ID, centroId: CENTRO_ID, año: 2026, mes: 9,
    estado: "borrador", versionActual: 1,
    fechaGeneracion: Timestamp.fromMillis(Date.now() - 3600_000),
    generadoPor: "system-seed", modoGeneracion: "optimizador_libre",
    estadoGeneracion: "completado",
    estadisticas: { coberturaServicios: 100, satisfaccionMedia: 0, preferenciasCumplidas: 0, preferenciasNoCumplidas: 0 },
    creadoPor: "reset-convenio-b35", creadoEn: FieldValue.serverTimestamp(),
  });
  console.log(`reset-convenio-b35: ${CUA} borrador completado (generado hace 1 h)`);
}
