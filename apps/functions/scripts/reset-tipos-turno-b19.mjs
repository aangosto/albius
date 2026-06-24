// reset-tipos-turno-b19.mjs
//
// Reset FOCALIZADO de la colección tipos_turno del centro-test, para usar entre
// tests E2E (B20 Fase 2). A diferencia de seed-tipos-turno-b19.mjs, este script
// NO toca usuarios/tenant/centro: solo borra y recrea los 4 tipos de turno
// canónicos. Esto es DELIBERADO — recrear los usuarios cambiaría sus UIDs de
// Auth e invalidaría el storageState del jefe (la sesión persistida apunta a un
// UID concreto). Los usuarios se siembran una vez en globalSetup; los tipos se
// resetean por test para que cada uno parta de un estado conocido y la suite
// sea re-ejecutable sin estado residual (altas/ediciones de tests previos).
//
// EMULATOR ONLY. Uso: node apps/functions/scripts/reset-tipos-turno-b19.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";

if (getApps().length === 0) {
  initializeApp({ projectId: "albius-cbdb1" });
}
const db = getFirestore();

// Mismos 4 tipos que seed-tipos-turno-b19.mjs (duplicación consciente: este
// script es independiente para mantener el reset rápido y sin dependencias).
const TIPOS = [
  {
    id: "tt_b19_manana",
    codigo: "M-LARGO",
    nombre: "Mañana largo",
    horaInicio: "06:00",
    horaFin: "14:00",
    duracionMinutos: 480,
    duracionEfectivaMinutos: 450,
    esPartido: false,
    esNocturno: false,
    color: "#FFD700",
    estado: "activo",
  },
  {
    id: "tt_b19_noche",
    codigo: "T-NOCHE",
    nombre: "Noche",
    horaInicio: "22:00",
    horaFin: "06:00", // cruza medianoche
    duracionMinutos: 480,
    duracionEfectivaMinutos: 450,
    esPartido: false,
    esNocturno: true,
    estado: "activo",
  },
  {
    id: "tt_b19_partido",
    codigo: "P-COMERCIAL",
    nombre: "Partido comercial",
    horaInicio: "07:00",
    horaFin: "20:00",
    duracionMinutos: 480,
    duracionEfectivaMinutos: 450,
    esPartido: true,
    tramosPartido: [
      { inicio: "07:00", fin: "11:00" },
      { inicio: "16:00", fin: "20:00" },
    ],
    esNocturno: false,
    color: "#1F77B4",
    estado: "activo",
  },
  {
    id: "tt_b19_obsoleto",
    codigo: "REFUERZO",
    nombre: "Refuerzo verano",
    horaInicio: "10:00",
    horaFin: "13:00",
    duracionMinutos: 180,
    duracionEfectivaMinutos: 180,
    esPartido: false,
    esNocturno: false,
    estado: "obsoleto",
  },
];

// Borra TODOS los tipos del centro (incluye los creados por tests previos).
const prev = await db
  .collection("tipos_turno")
  .where("centroId", "==", CENTRO_ID)
  .get();
for (const d of prev.docs) await d.ref.delete();

for (const t of TIPOS) {
  await db.collection("tipos_turno").doc(t.id).set({
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    creadoPor: "reset-tipos-turno-b19",
    creadoEn: FieldValue.serverTimestamp(),
    ...t,
  });
}

process.exit(0);
