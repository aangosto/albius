// reset-mi-horario-b34.mjs
//
// Reset entre tests E2E de B34.2 (beforeEach de mi-horario.spec.ts). Deja en
// centro-test, para el MES ACTUAL (UTC — la página abre por defecto el mes
// actual y los "próximos turnos" se calculan respecto a hoy):
//   - /conductores/cond_e2e_conductor (el claim/doc conductorId de
//     conductor@albius.local apunta aquí desde seed-tipos-turno-b19) y
//     /conductores/cond_b34_otro (otro conductor, para probar que NO se ven
//     sus turnos). OJO: SIN `usuarioId` a propósito — los resets de B21/B22
//     (reset-conductor-b21 / reset-conductores-b22) borran los conductores del
//     tenant Y su Auth user enlazado, y se llevarían la cuenta fija del seed
//     (conductor@albius.local) con la que loguea el proyecto setup. Mi horario
//     no lee la ficha (usa claim + /usuarios), así que el enlace inverso no
//     hace falta aquí.
//   - cuadrante del mes actual PUBLICADO; el del mes siguiente NO existe; el de
//     dentro de dos meses en BORRADOR (ambos → "aún no está publicado").
//   - asignaciones del conductor: hoy M-LARGO (06–14), hoy+2 T-NOCHE (22–06),
//     hoy-3 M-LARGO — solo las que caen dentro del mes. Del otro conductor:
//     hoy y hoy+3 P-COMERCIAL (07–20), que el conductor NO debe ver.
//   - ausencia del conductor: permiso AP el día hoy+1 (si sigue en el mes; si
//     no, hoy-1). El spec replica la misma regla.
// EMULATOR ONLY. Uso: node apps/functions/scripts/reset-mi-horario-b34.mjs
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

const TENANT_ID = "tenant-test";
const CENTRO_ID = "centro-test";
const COND = "cond_e2e_conductor";
const OTRO = "cond_b34_otro";

if (getApps().length === 0) initializeApp({ projectId: "albius-cbdb1" });
const db = getFirestore();

// --- fechas (UTC) ---
const hoy = new Date();
const AÑO = hoy.getUTCFullYear();
const MES = hoy.getUTCMonth() + 1;
const hoyISO = hoy.toISOString().slice(0, 10);
const sumar = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);
const enMes = (iso) => iso.startsWith(`${AÑO}-${String(MES).padStart(2, "0")}-`);
const ts = (iso) => Timestamp.fromDate(new Date(`${iso}T00:00:00.000Z`));
const cuaId = (a, m) => `cua_${CENTRO_ID}_${a}_${m}`;
const siguiente = (a, m, k) => {
  const d = new Date(Date.UTC(a, m - 1 + k, 1));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1];
};

const base = { creadoPor: "reset-mi-horario-b34", creadoEn: FieldValue.serverTimestamp() };

// --- limpieza ---
for (const cid of [COND, OTRO]) {
  for (const col of ["asignaciones", "ausencias"]) {
    const snap = await db.collection(col).where("tenantId", "==", TENANT_ID).where("conductorId", "==", cid).get();
    for (const d of snap.docs) await d.ref.delete();
  }
}
const [a1, m1] = siguiente(AÑO, MES, 1);
const [a2, m2] = siguiente(AÑO, MES, 2);
await db.collection("cuadrantes").doc(cuaId(a1, m1)).delete().catch(() => {});

// --- conductores ---
const cond = (id, n, usuarioId) => ({
  id, tenantId: TENANT_ID, centroId: CENTRO_ID, ...(usuarioId && { usuarioId }),
  numeroEmpleado: n, nombre: id === COND ? "Conductor" : "Otro", apellidos: id === COND ? "Test" : "Conductor",
  dni: "00000000T", categoria: "conductor", fechaAntiguedad: ts("2020-01-01"), fechaIncorporacion: ts("2020-01-01"),
  estado: "activo", lineasPreferentes: [], lineasSecundarias: [], tiposTurnoPermitidos: ["tt_b19_manana", "tt_b19_noche"],
  puedeSerReserva: false, ...base,
});
await db.collection("conductores").doc(COND).set(cond(COND, "E900"));
await db.collection("conductores").doc(OTRO).set(cond(OTRO, "E901"));

// --- cuadrantes ---
const cua = (a, m, estado) => ({
  id: cuaId(a, m), tenantId: TENANT_ID, centroId: CENTRO_ID, año: a, mes: m, estado, versionActual: 1,
  fechaGeneracion: FieldValue.serverTimestamp(), generadoPor: "system-seed", modoGeneracion: "manual",
  estadoGeneracion: "completado",
  ...(estado !== "borrador" && { fechaPublicacion: FieldValue.serverTimestamp(), publicadoPor: "system-seed" }),
  ...base,
});
const CUA = cuaId(AÑO, MES);
await db.collection("cuadrantes").doc(CUA).set(cua(AÑO, MES, "publicado"));
await db.collection("cuadrantes").doc(cuaId(a2, m2)).set(cua(a2, m2, "borrador"));

// --- asignaciones ---
const TIPOS = {
  tt_b19_manana: ["06:00", "14:00"],
  tt_b19_noche: ["22:00", "06:00"],
  tt_b19_partido: ["07:00", "20:00"],
};
let n = 0;
async function asig(conductorId, iso, tipoTurnoId) {
  if (!enMes(iso)) return false;
  n += 1;
  const id = `asig_b34_${n}`;
  const [hi, hf] = TIPOS[tipoTurnoId];
  await db.collection("asignaciones").doc(id).set({
    id, tenantId: TENANT_ID, centroId: CENTRO_ID, cuadranteId: CUA, conductorId, fecha: ts(iso),
    tipoTurnoId, horaInicio: hi, horaFin: hf, tipoAsignacion: "turno", esIntercambiada: false, estado: "planificada", ...base,
  });
  return true;
}
const creadas = [];
if (await asig(COND, hoyISO, "tt_b19_manana")) creadas.push(hoyISO);
if (await asig(COND, sumar(hoyISO, 2), "tt_b19_noche")) creadas.push(sumar(hoyISO, 2));
if (await asig(COND, sumar(hoyISO, -3), "tt_b19_manana")) creadas.push(sumar(hoyISO, -3));
await asig(OTRO, hoyISO, "tt_b19_partido");
await asig(OTRO, sumar(hoyISO, 3), "tt_b19_partido");

// --- ausencia del conductor ---
const diaAus = enMes(sumar(hoyISO, 1)) ? sumar(hoyISO, 1) : sumar(hoyISO, -1);
await db.collection("ausencias").doc("aus_b34_cond").set({
  id: "aus_b34_cond", tenantId: TENANT_ID, centroId: CENTRO_ID, conductorId: COND, categoria: "permiso", codigo: "AP",
  fechaInicio: ts(diaAus), fechaFin: ts(diaAus), ...base,
});

console.log(`reset-mi-horario-b34: ${CUA} publicado; asignaciones del conductor en ${creadas.join(", ")}; ausencia ${diaAus}; ${cuaId(a1, m1)} ausente; ${cuaId(a2, m2)} borrador`);
