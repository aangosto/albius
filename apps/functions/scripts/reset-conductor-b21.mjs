// reset-conductor-b21.mjs
//
// Reset entre tests E2E de B21 (beforeEach): borra los conductores creados por
// los tests en tenant-test, incluyendo su Auth user + doc /usuarios (crearConductor
// crea los 3: Auth + /usuarios + /conductores). Sin esto, un segundo run chocaría
// con "email ya existe" en Auth. NO toca los usuarios seed (jefe/admin/conductor),
// que NO tienen doc /conductores.
//
// EMULATOR ONLY. Uso: node apps/functions/scripts/reset-conductor-b21.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const auth = getAuth();
const db = getFirestore();

const snap = await db
  .collection("conductores")
  .where("tenantId", "==", TENANT_ID)
  .get();

for (const d of snap.docs) {
  const data = d.data();
  const uid = data.usuarioId;
  if (uid) {
    await auth.deleteUser(uid).catch((e) => {
      if (e.code !== "auth/user-not-found") throw e;
    });
    await db.collection("usuarios").doc(uid).delete().catch(() => {});
  }
  await d.ref.delete();
}

process.exit(0);
