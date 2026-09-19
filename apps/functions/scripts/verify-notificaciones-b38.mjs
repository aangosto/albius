// verify-notificaciones-b38.mjs
//
// Verificación empírica de B38.5 (notificaciones in-app) contra los emulators
// Auth + Firestore + Functions:
//   - callable marcarNotificacionesLeidas (auth, ownership, lote, idempotencia)
//   - productor de 'cuadrante_publicado' dentro de publicarCuadrante
//     (best-effort, salto conductorId → usuarioId, republicación)
//
// Ejecución (desde la raíz, con el emulator arrancado):
//   node apps/functions/scripts/verify-notificaciones-b38.mjs
//
// Helpers locales duplicados de verify-ausencias (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (convención B9: wire HTTPS Callable v2).
//
// Seed: 1 tenant + 1 centro activo + jefe + 2 conductores-usuario (ANA con
// cuenta enlazada, BRUNO con cuenta enlazada) + 1 conductor SIN usuarioId
// (CARLA, ficha administrativa) + 2 cuadrantes en borrador (uno con
// asignaciones de ANA y CARLA, otro vacío).

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const FIRESTORE_HOST = "127.0.0.1:8080";
const url = (fn) => `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${fn}`;
const U_MARCAR = url("marcarNotificacionesLeidas");
const U_PUBLICAR = url("publicarCuadrante");
const U_REABRIR = url("reabrirCuadrante");
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

async function checkEmulatorsUp() {
  const probes = [AUTH_HOST, FUNCTIONS_HOST, FIRESTORE_HOST];
  const errors = [];
  for (const h of probes) {
    try {
      await fetch(`http://${h}/`, { method: "GET" });
    } catch (e) {
      errors.push(`  - ${h}: ${e.message}`);
    }
  }
  if (errors.length > 0) {
    console.error("\nEmulators no responden:\n" + errors.join("\n"));
    process.exit(2);
  }
}

async function signInWithCustomToken(customToken) {
  const resp = await fetch(AUTH_SIGNIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!resp.ok)
    throw new Error(`signIn fallo: ${resp.status} ${await resp.text()}`);
  return (await resp.json()).idToken;
}
async function getIdTokenFor(uid) {
  return signInWithCustomToken(await auth.createCustomToken(uid));
}

async function invokeCallable(u, data, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  let resp;
  try {
    resp = await fetch(u, {
      method: "POST",
      headers,
      body: JSON.stringify({ data }),
    });
  } catch (e) {
    return { ok: false, code: "network-error", message: e.message };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (resp.ok && body && body.result !== undefined) {
    return { ok: true, body: body.result, code: null, message: null };
  }
  const err = (body && body.error) || {};
  return {
    ok: false,
    body,
    code: err.status || err.code || `http-${resp.status}`,
    message: err.message || text,
  };
}

// ============================================================================
//  Seed
// ============================================================================

const TENANT_ID = "tenant_seed_b38";
const CENTRO_ID = "centro_seed_b38";
const UID_JEFE = "jefe_b38_uid";
const UID_ANA = "ana_b38_uid";
const UID_BRUNO = "bruno_b38_uid";
const COND_ANA = "cond_b38_ana";
const COND_BRUNO = "cond_b38_bruno";
const COND_CARLA = "cond_b38_carla"; // SIN usuarioId (ficha sin cuenta)
const AÑO = 2027;
const MES = 3;
const CUA_CON_ASIG = `cua_${CENTRO_ID}_${AÑO}_${MES}`;
const CUA_VACIO = `cua_${CENTRO_ID}_${AÑO}_4`;

const SEED_USERS = [
  {
    uid: UID_JEFE,
    email: "jefe-b38@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ID },
  },
  {
    uid: UID_ANA,
    email: "ana-b38@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ID },
  },
  {
    uid: UID_BRUNO,
    email: "bruno-b38@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ID },
  },
];

const ts = (iso) => Timestamp.fromDate(new Date(`${iso}T00:00:00.000Z`));
const base = () => ({
  creadoPor: "system-seed",
  creadoEn: FieldValue.serverTimestamp(),
});

function makeConductor(id, usuarioId, nombre) {
  return {
    id,
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    ...(usuarioId && { usuarioId }),
    nombre,
    apellidos: "Seed B38",
    dni: "00000000T",
    categoria: "conductor",
    fechaAntiguedad: ts("2020-01-01"),
    fechaIncorporacion: ts("2020-01-01"),
    estado: "activo",
    lineasPreferentes: [],
    lineasSecundarias: [],
    tiposTurnoPermitidos: [],
    puedeSerReserva: false,
    ...base(),
  };
}

function makeCuadrante(id, año, mes) {
  return {
    id,
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    año,
    mes,
    estado: "borrador",
    versionActual: 1,
    fechaGeneracion: FieldValue.serverTimestamp(),
    generadoPor: "system-seed",
    modoGeneracion: "manual",
    estadoGeneracion: "completado",
    ...base(),
  };
}

function makeNotificacion(id, destinatarioId, estado, titulo) {
  return {
    id,
    tenantId: TENANT_ID,
    destinatarioId,
    tipo: "otro",
    titulo,
    mensaje: `Mensaje de ${titulo}`,
    canales: ["app"],
    estado,
    fechaCreacion: FieldValue.serverTimestamp(),
    ...(estado === "leida" && { fechaLectura: FieldValue.serverTimestamp() }),
  };
}

async function delUser(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}
async function deleteWhere(name, field, value) {
  const snap = await db.collection(name).where(field, "==", value).get();
  for (const d of snap.docs) await d.ref.delete();
}

async function seed() {
  for (const u of SEED_USERS) {
    await delUser(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    await auth.setCustomUserClaims(u.uid, u.claims);
  }
  await db.collection("tenants").doc(TENANT_ID).set({
    id: TENANT_ID,
    nombre: "Tenant B38 SL",
    cif: "A32323235",
    comunidadAutonoma: "Murcia",
    provincia: "Murcia",
    plan: "basico",
    estado: "activo",
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
    ...base(),
  });
  await db.collection("centros").doc(CENTRO_ID).set({
    id: CENTRO_ID,
    tenantId: TENANT_ID,
    nombre: "Centro B38",
    ciudad: "Cartagena",
    provincia: "Murcia",
    estado: "activo",
    fechaCreacion: FieldValue.serverTimestamp(),
    ...base(),
  });

  await deleteWhere("conductores", "tenantId", TENANT_ID);
  await db.collection("conductores").doc(COND_ANA).set(makeConductor(COND_ANA, UID_ANA, "Ana"));
  await db.collection("conductores").doc(COND_BRUNO).set(makeConductor(COND_BRUNO, UID_BRUNO, "Bruno"));
  await db.collection("conductores").doc(COND_CARLA).set(makeConductor(COND_CARLA, null, "Carla"));

  await deleteWhere("cuadrantes", "tenantId", TENANT_ID);
  await db.collection("cuadrantes").doc(CUA_CON_ASIG).set(makeCuadrante(CUA_CON_ASIG, AÑO, MES));
  await db.collection("cuadrantes").doc(CUA_VACIO).set(makeCuadrante(CUA_VACIO, AÑO, 4));

  // Asignaciones del cuadrante "con asignaciones": ANA (2 días, un solo
  // destinatario esperado) y CARLA (sin usuarioId → sinUsuario=1). BRUNO NO
  // tiene asignaciones: no debe recibir nada aunque sea del centro.
  await deleteWhere("asignaciones", "tenantId", TENANT_ID);
  let k = 0;
  for (const [cond, dia] of [
    [COND_ANA, "2027-03-02"],
    [COND_ANA, "2027-03-03"],
    [COND_CARLA, "2027-03-02"],
  ]) {
    k += 1;
    const id = `asig_b38_${k}`;
    await db.collection("asignaciones").doc(id).set({
      id,
      tenantId: TENANT_ID,
      centroId: CENTRO_ID,
      cuadranteId: CUA_CON_ASIG,
      conductorId: cond,
      fecha: ts(dia),
      horaInicio: "06:00",
      horaFin: "14:00",
      tipoAsignacion: "turno",
      esIntercambiada: false,
      estado: "planificada",
      ...base(),
    });
  }

  // Notificaciones previas: 2 sin leer + 1 leída de ANA; 1 sin leer de BRUNO.
  await deleteWhere("notificaciones", "tenantId", TENANT_ID);
  await db.collection("notificaciones").doc("notif_b38_a1").set(makeNotificacion("notif_b38_a1", UID_ANA, "pendiente", "A1"));
  await db.collection("notificaciones").doc("notif_b38_a2").set(makeNotificacion("notif_b38_a2", UID_ANA, "pendiente", "A2"));
  await db.collection("notificaciones").doc("notif_b38_a3").set(makeNotificacion("notif_b38_a3", UID_ANA, "leida", "A3"));
  await db.collection("notificaciones").doc("notif_b38_b1").set(makeNotificacion("notif_b38_b1", UID_BRUNO, "pendiente", "B1"));
}

// ============================================================================
//  Runner
// ============================================================================

const results = [];
function record(name, expected, actual, pass) {
  console.log(`${pass ? "[OK]  " : "[FAIL]"} ${name}`);
  console.log(`       esperado: ${expected}`);
  console.log(`       recibido: ${actual}`);
  results.push({ name, pass });
}
function expectError(name, expectedCode, result, extraCheck = null) {
  if (result.ok) {
    record(name, `error code=${expectedCode}`, "OK inesperado", false);
    return;
  }
  let pass = result.code === expectedCode;
  if (pass && extraCheck && extraCheck(result) !== true) pass = false;
  record(name, `error code=${expectedCode}`, `code=${result.code} msg="${result.message}"`, pass);
}
async function getNotif(id) {
  const s = await db.collection("notificaciones").doc(id).get();
  return s.exists ? s.data() : null;
}
async function notifsDe(uid, tipo) {
  const snap = await db
    .collection("notificaciones")
    .where("tenantId", "==", TENANT_ID)
    .where("destinatarioId", "==", uid)
    .get();
  return snap.docs.map((d) => d.data()).filter((d) => !tipo || d.tipo === tipo);
}

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tJefe = await getIdTokenFor(UID_JEFE);
  const tAna = await getIdTokenFor(UID_ANA);
  const tBruno = await getIdTokenFor(UID_BRUNO);

  console.log("=== marcarNotificacionesLeidas ===\n");

  // N1 — sin auth
  expectError(
    "N1 (sin auth)",
    "UNAUTHENTICATED",
    await invokeCallable(U_MARCAR, { notificacionIds: ["notif_b38_a1"] }, null),
  );

  // N2 — notificacionIds no es array
  expectError(
    "N2 (notificacionIds no array)",
    "INVALID_ARGUMENT",
    await invokeCallable(U_MARCAR, { notificacionIds: "notif_b38_a1" }, tAna),
  );

  // N3 — array vacío
  expectError(
    "N3 (array vacío)",
    "INVALID_ARGUMENT",
    await invokeCallable(U_MARCAR, { notificacionIds: [] }, tAna),
  );

  // N4 — más de 50 ids
  expectError(
    "N4 (>50 ids)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      U_MARCAR,
      { notificacionIds: Array.from({ length: 51 }, (_, i) => `x${i}`) },
      tAna,
    ),
  );

  // N5 — ids duplicados
  expectError(
    "N5 (ids duplicados)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      U_MARCAR,
      { notificacionIds: ["notif_b38_a1", "notif_b38_a1"] },
      tAna,
    ),
  );

  // N6 — id inexistente
  expectError(
    "N6 (id inexistente)",
    "INVALID_ARGUMENT",
    await invokeCallable(U_MARCAR, { notificacionIds: ["no_existe_b38"] }, tAna),
  );

  // N7 — notificación de OTRO destinatario: aborta el lote ENTERO
  {
    const r = await invokeCallable(
      U_MARCAR,
      { notificacionIds: ["notif_b38_a1", "notif_b38_b1"] },
      tAna,
    );
    expectError("N7 (notificación ajena en el lote)", "PERMISSION_DENIED", r);
    const a1 = (await getNotif("notif_b38_a1")) || {};
    record(
      "N7b (el lote no se aplica a medias)",
      "notif_b38_a1 sigue pendiente",
      `estado=${a1.estado}`,
      a1.estado === "pendiente",
    );
  }

  // N8 — marca dos propias
  {
    const r = await invokeCallable(
      U_MARCAR,
      { notificacionIds: ["notif_b38_a1", "notif_b38_a2"] },
      tAna,
    );
    if (!r.ok) record("N8 (marca 2 propias)", "ok", `error: ${r.message}`, false);
    else {
      const a1 = (await getNotif("notif_b38_a1")) || {};
      const a2 = (await getNotif("notif_b38_a2")) || {};
      const ok =
        r.body.marcadas === 2 &&
        r.body.yaLeidas === 0 &&
        a1.estado === "leida" &&
        a2.estado === "leida" &&
        a1.fechaLectura !== undefined &&
        a2.fechaLectura !== undefined;
      record(
        "N8 (marca 2 propias)",
        "marcadas=2 yaLeidas=0, ambas leida con fechaLectura",
        `marcadas=${r.body.marcadas} yaLeidas=${r.body.yaLeidas} a1=${a1.estado} a2=${a2.estado} fl=${a1.fechaLectura !== undefined}`,
        ok,
      );
    }
  }

  // N9 — idempotente: re-marcar no re-escribe ni mueve fechaLectura
  {
    const antes = (await getNotif("notif_b38_a1")) || {};
    const r = await invokeCallable(
      U_MARCAR,
      { notificacionIds: ["notif_b38_a1", "notif_b38_a2"] },
      tAna,
    );
    if (!r.ok) record("N9 (idempotente)", "ok", `error: ${r.message}`, false);
    else {
      const despues = (await getNotif("notif_b38_a1")) || {};
      const mismaFecha =
        antes.fechaLectura &&
        despues.fechaLectura &&
        antes.fechaLectura.toMillis() === despues.fechaLectura.toMillis();
      const ok = r.body.marcadas === 0 && r.body.yaLeidas === 2 && mismaFecha;
      record(
        "N9 (idempotente)",
        "marcadas=0 yaLeidas=2, fechaLectura intacta",
        `marcadas=${r.body.marcadas} yaLeidas=${r.body.yaLeidas} mismaFecha=${!!mismaFecha}`,
        ok,
      );
    }
  }

  // N10 — mezcla de no leída + ya leída (BRUNO marca la suya y una leída suya)
  {
    await db.collection("notificaciones").doc("notif_b38_b2").set(makeNotificacion("notif_b38_b2", UID_BRUNO, "leida", "B2"));
    const r = await invokeCallable(
      U_MARCAR,
      { notificacionIds: ["notif_b38_b1", "notif_b38_b2"] },
      tBruno,
    );
    if (!r.ok) record("N10 (mezcla leída/no leída)", "ok", `error: ${r.message}`, false);
    else
      record(
        "N10 (mezcla leída/no leída)",
        "marcadas=1 yaLeidas=1",
        `marcadas=${r.body.marcadas} yaLeidas=${r.body.yaLeidas}`,
        r.body.marcadas === 1 && r.body.yaLeidas === 1,
      );
  }

  console.log("\n=== publicarCuadrante → notificaciones (B38.5) ===\n");

  // P1 — publicar notifica SOLO a los conductores con asignaciones Y cuenta
  {
    const r = await invokeCallable(U_PUBLICAR, { cuadranteId: CUA_CON_ASIG }, tJefe);
    if (!r.ok) record("P1 (publicar notifica)", "ok", `error: ${r.message}`, false);
    else {
      const deAna = await notifsDe(UID_ANA, "cuadrante_publicado");
      const deBruno = await notifsDe(UID_BRUNO, "cuadrante_publicado");
      const n = deAna[0] || {};
      const ok =
        r.body.notificados === 1 &&
        deAna.length === 1 && // ANA tiene 2 asignaciones → 1 sola notificación
        deBruno.length === 0 && // sin asignaciones → nada
        n.estado === "pendiente" &&
        Array.isArray(n.canales) &&
        n.canales[0] === "app" &&
        n.titulo === "Tu horario ya está publicado" &&
        n.mensaje.includes(`03/${AÑO}`) &&
        n.datosContexto &&
        n.datosContexto.cuadranteId === CUA_CON_ASIG &&
        n.datosContexto.año === AÑO &&
        n.datosContexto.mes === MES;
      record(
        "P1 (publicar notifica)",
        "notificados=1, 1 doc a ANA (dedup), 0 a BRUNO, shape correcto",
        `notificados=${r.body.notificados} ana=${deAna.length} bruno=${deBruno.length} titulo="${n.titulo}" ctx=${JSON.stringify(n.datosContexto)}`,
        ok,
      );
    }
  }

  // P2 — CARLA (sin usuarioId) no genera notificación y no rompe nada
  {
    const todas = await db
      .collection("notificaciones")
      .where("tenantId", "==", TENANT_ID)
      .where("tipo", "==", "cuadrante_publicado")
      .get();
    record(
      "P2 (conductor sin usuarioId se omite)",
      "1 notificación de publicación en total (CARLA no cuenta)",
      `total=${todas.size}`,
      todas.size === 1,
    );
  }

  // P3 — cuadrante SIN asignaciones: publica igual, 0 notificados
  {
    const r = await invokeCallable(U_PUBLICAR, { cuadranteId: CUA_VACIO }, tJefe);
    if (!r.ok) record("P3 (cuadrante vacío)", "ok", `error: ${r.message}`, false);
    else {
      const cua = (await db.collection("cuadrantes").doc(CUA_VACIO).get()).data() || {};
      record(
        "P3 (cuadrante vacío)",
        "publicado con notificados=0",
        `estado=${cua.estado} notificados=${r.body.notificados}`,
        cua.estado === "publicado" && r.body.notificados === 0,
      );
    }
  }

  // P4 — republicar (reabrir + publicar) vuelve a notificar
  {
    const rr = await invokeCallable(U_REABRIR, { cuadranteId: CUA_CON_ASIG }, tJefe);
    if (!rr.ok) record("P4 (republicar)", "reabrir ok", `error: ${rr.message}`, false);
    else {
      const r = await invokeCallable(U_PUBLICAR, { cuadranteId: CUA_CON_ASIG }, tJefe);
      const deAna = await notifsDe(UID_ANA, "cuadrante_publicado");
      record(
        "P4 (republicar)",
        "notificados=1 y ANA acumula 2 avisos de publicación",
        `ok=${r.ok} notificados=${r.ok ? r.body.notificados : "-"} ana=${deAna.length}`,
        r.ok === true && r.body.notificados === 1 && deAna.length === 2,
      );
    }
  }

  // ------------------------------------------------------------------ resumen
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n================ ${pass}/${results.length} PASS ================`);
  for (const r of results.filter((x) => !x.pass)) console.log(`  FAIL: ${r.name}`);
  process.exit(pass === results.length ? 0 : 1);
}

await main();
