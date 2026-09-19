// reset-notificaciones-b38.mjs
//
// Reset entre tests E2E de B38.5 (beforeEach de notificaciones.spec.ts). Deja
// al usuario conductor@albius.local (el del storageState del proyecto setup)
// con 3 notificaciones conocidas:
//   - NO LEÍDA, del MES ACTUAL (datosContexto.cuadranteId = el cuadrante del
//     mes en curso de centro-test) → sale en la campana Y en el banner de Mi
//     horario.
//   - NO LEÍDA, SIN contexto de mes → sale SOLO en la campana (prueba que el
//     banner filtra por mes y no enseña todo lo que hay).
//   - LEÍDA → sale en la campana sin resaltar y NO cuenta en el badge.
// Contador esperado en la campana: 2.
//
// El uid NO se hardcodea: se resuelve por email contra el Auth emulator (lo
// crea seed-test-user.mjs y cambia entre reseteos del emulador).
//
// EMULATOR ONLY. Uso: node apps/functions/scripts/reset-notificaciones-b38.mjs
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
const EMAIL = "conductor@albius.local";

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const auth = getAuth();
const db = getFirestore();

let uid;
try {
  uid = (await auth.getUserByEmail(EMAIL)).uid;
} catch {
  console.error(
    `reset-notificaciones-b38: no existe el usuario ${EMAIL} en el Auth emulator. ` +
      `Ejecuta antes apps/functions/scripts/seed-test-user.mjs.`,
  );
  process.exit(2);
}

const hoy = new Date();
const AÑO = hoy.getUTCFullYear();
const MES = hoy.getUTCMonth() + 1;
const CUADRANTE_MES = `cua_${CENTRO_ID}_${AÑO}_${MES}`;
const mesLabel = `${String(MES).padStart(2, "0")}/${AÑO}`;

// --- limpieza: TODAS las notificaciones del conductor (incluidas las que haya
// creado publicarCuadrante en un test previo, que falsearían el contador) ---
const previas = await db
  .collection("notificaciones")
  .where("destinatarioId", "==", uid)
  .get();
for (const d of previas.docs) await d.ref.delete();

const base = {
  tenantId: TENANT_ID,
  destinatarioId: uid,
  canales: ["app"],
  fechaCreacion: FieldValue.serverTimestamp(),
};

await db.collection("notificaciones").doc("notif_b38_e2e_mes").set({
  id: "notif_b38_e2e_mes",
  ...base,
  tipo: "cuadrante_publicado",
  titulo: "Tu horario ya está publicado",
  mensaje: `El cuadrante de ${mesLabel} se ha publicado. Ya puedes consultar tus turnos en Mi horario.`,
  datosContexto: { cuadranteId: CUADRANTE_MES, año: AÑO, mes: MES },
  estado: "pendiente",
});

await db.collection("notificaciones").doc("notif_b38_e2e_suelta").set({
  id: "notif_b38_e2e_suelta",
  ...base,
  tipo: "otro",
  titulo: "Aviso sin mes",
  mensaje: "Notificación sin contexto de cuadrante (solo campana).",
  estado: "pendiente",
});

await db.collection("notificaciones").doc("notif_b38_e2e_leida").set({
  id: "notif_b38_e2e_leida",
  ...base,
  tipo: "otro",
  titulo: "Aviso ya leído",
  mensaje: "Notificación previamente leída (no cuenta en el badge).",
  estado: "leida",
  fechaLectura: FieldValue.serverTimestamp(),
});

console.log(
  `reset-notificaciones-b38: ${EMAIL} (uid=${uid}) con 2 sin leer (1 del mes ${mesLabel}, cuadrante ${CUADRANTE_MES}) + 1 leída`,
);
