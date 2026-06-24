// reset-conductores-b22.mjs
//
// Reset entre tests E2E de B22 (beforeEach): deja en centro-test un conjunto
// CONOCIDO de 3 conductores con config variada para listar/editar. Borra TODOS
// los /conductores de tenant-test primero (limpia leftovers de los tests de B21,
// cuyo reset borra conductores) y recrea los 3. Sin Auth users reales (son docs
// /conductores para que el jefe los liste/edite; el jefe no inicia sesión como
// ellos).
//
// Referencia ids de seed-conductor-b21 (líneas linea_b21_a/b/c) y
// seed-tipos-turno-b19 (tipos tt_b19_manana/noche/partido/obsoleto), creados en
// globalSetup. EMULATOR ONLY.
//
// Uso: node apps/functions/scripts/reset-conductores-b22.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const auth = getAuth();
const db = getFirestore();

// Borra todos los conductores del tenant (incluye los de tests de B21 + recrea).
const prev = await db
  .collection("conductores")
  .where("tenantId", "==", TENANT_ID)
  .get();
for (const d of prev.docs) {
  const uid = d.data().usuarioId;
  if (uid) {
    await auth.deleteUser(uid).catch((e) => {
      if (e.code !== "auth/user-not-found") throw e;
    });
    await db.collection("usuarios").doc(uid).delete().catch(() => {});
  }
  await d.ref.delete();
}

function makeCond(spec) {
  return {
    id: spec.id,
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    usuarioId: `${spec.id}_u`,
    numeroEmpleado: spec.numeroEmpleado,
    nombre: spec.nombre,
    apellidos: spec.apellidos,
    dni: "12345678Z",
    categoria: "conductor",
    fechaAntiguedad: FieldValue.serverTimestamp(),
    fechaIncorporacion: FieldValue.serverTimestamp(),
    estado: spec.estado,
    lineasPreferentes: spec.lineasPreferentes ?? [],
    lineasSecundarias: spec.lineasSecundarias ?? [],
    tiposTurnoPermitidos: spec.tiposTurnoPermitidos ?? [],
    ...(spec.tiposTurnoExcluidos && {
      tiposTurnoExcluidos: spec.tiposTurnoExcluidos,
    }),
    puedeSerReserva: spec.puedeSerReserva ?? false,
    creadoPor: "reset-conductores-b22",
    creadoEn: FieldValue.serverTimestamp(),
  };
}

const CONDUCTORES = [
  {
    id: "cond_b22_1",
    numeroEmpleado: "E100",
    nombre: "Ana",
    apellidos: "García",
    estado: "activo",
    puedeSerReserva: true,
    lineasPreferentes: ["linea_b21_a"],
    lineasSecundarias: ["linea_b21_b"],
    tiposTurnoPermitidos: ["tt_b19_manana"],
    tiposTurnoExcluidos: ["tt_b19_obsoleto"],
  },
  {
    id: "cond_b22_2",
    numeroEmpleado: "E101",
    nombre: "Luis",
    apellidos: "Pérez",
    estado: "vacaciones",
    puedeSerReserva: false,
    lineasPreferentes: ["linea_b21_c"],
  },
  {
    id: "cond_b22_3",
    numeroEmpleado: "E102",
    nombre: "Marta",
    apellidos: "Ruiz",
    estado: "activo",
    puedeSerReserva: false,
  },
];

for (const spec of CONDUCTORES) {
  await db.collection("conductores").doc(spec.id).set(makeCond(spec));
}

process.exit(0);
