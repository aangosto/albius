// seed-tipos-turno-b19.mjs
//
// Seed para verificación manual en navegador del frontend de Tipos de turno
// (B19). Self-contained desde emulador frío: crea jefe + tenant + centro + un
// abanico de tipos de turno que ejercitan las columnas y casos de la UI.
//
// Reusa los MISMOS IDs/credenciales que seed-lineas-b17.mjs (tenant-test,
// centro-test, jefe@albius.local / albius123, flag=false → login directo), así
// que ambos seeds conviven: tras correr los dos, el jefe ve sus Líneas Y sus
// Tipos de turno en el mismo centro.
//
// Crea (además de jefe/admin/conductor + tenant + centro):
//   - M-LARGO     Mañana largo     06:00–14:00  simple      activo
//   - T-NOCHE     Noche            22:00–06:00  nocturno (cruza medianoche)  activo
//   - P-COMERCIAL Partido comercial 07:00–20:00 partido (2 tramos)  activo
//   - REFUERZO    Refuerzo verano  10:00–13:00  simple      obsoleto (para Reactivar)
//
// Auditoría canónica D6.4: creadoEn/creadoPor, SIN fechaCreacion.
// TramoPartido = { inicio, fin } en "HH:mm" (forma canónica de @albius/shared).
//
// EMULATOR ONLY: env vars hardcodeadas para impedir uso contra Firebase real.
//
// Uso:
//   node apps/functions/scripts/seed-tipos-turno-b19.mjs

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

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

console.log(
  "\n[SEED-TIPOS-TURNO-B19] Emulator only. Password (todos): albius123\n",
);

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
  creadoPor: "seed-tipos-turno-b19",
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
  creadoPor: "seed-tipos-turno-b19",
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
    creadoPor: "seed-tipos-turno-b19",
    creadoEn: FieldValue.serverTimestamp(),
  };
  if (spec.tenantId) doc.tenantId = spec.tenantId;
  if (spec.centroId) doc.centroId = spec.centroId;
  await db.collection("usuarios").doc(u.uid).set(doc);
}

// Tipos de turno. Auditoría D6.4 (creadoEn, SIN fechaCreacion).
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
    estado: "obsoleto", // para probar Reactivar
  },
];

// Limpieza idempotente: borrar tipos previos del centro de test.
const prevTipos = await db
  .collection("tipos_turno")
  .where("centroId", "==", CENTRO_ID)
  .get();
for (const d of prevTipos.docs) await d.ref.delete();

for (const t of TIPOS) {
  await db.collection("tipos_turno").doc(t.id).set({
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    creadoPor: "seed-tipos-turno-b19",
    creadoEn: FieldValue.serverTimestamp(),
    ...t,
  });
}

console.log("Seed OK:");
console.log("  jefe@albius.local / albius123  (jefe_trafico, flag=false)");
console.log("  conductor@albius.local / albius123  (gate NoAutorizadoView)");
console.log("  admin@albius.local / albius123  (sin /tipos-turno en sidebar)");
console.log(
  `  4 tipos de turno en ${CENTRO_ID}: M-LARGO (simple), T-NOCHE (nocturno, cruza medianoche), P-COMERCIAL (partido 2 tramos), REFUERZO (obsoleto)\n`,
);

process.exit(0);
