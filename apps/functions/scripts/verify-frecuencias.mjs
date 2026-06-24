// verify-frecuencias.mjs
//
// Verificación empírica de los 4 callables de Frecuencia (B23) contra los
// emulators Auth + Firestore + Functions.
//
// Ejecución (raíz del repo, emulators arriba): node apps/functions/scripts/verify-frecuencias.mjs
//
// Helpers locales clonados de verify-lineas.mjs (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (wire HTTPS Callable v2).
//
// Seed B23: 1 tenant + 2 centros (activo del jefe + otro) + 3 líneas (activa,
// inactiva, otro-centro) + 3 usuarios (admin, jefe, conductor).

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const FIRESTORE_HOST = "127.0.0.1:8080";
const base = (fn) => `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${fn}`;
const URL_CREAR = base("crearFrecuencia");
const URL_ACTUALIZAR = base("actualizarFrecuencia");
const URL_CREAR_EXC = base("crearFrecuenciaExcepcional");
const URL_ACTUALIZAR_EXC = base("actualizarFrecuenciaExcepcional");
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

async function checkEmulatorsUp() {
  for (const host of [AUTH_HOST, FUNCTIONS_HOST, FIRESTORE_HOST]) {
    try {
      await fetch(`http://${host}/`, { method: "GET" });
    } catch (e) {
      console.error(`Emulator ${host} no responde: ${e.message}`);
      console.error("Arranca: npm run emulate");
      process.exit(2);
    }
  }
}

async function getIdTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const resp = await fetch(AUTH_SIGNIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!resp.ok) throw new Error(`signIn fallo: ${resp.status}`);
  return (await resp.json()).idToken;
}

async function invokeCallable(url, data, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  let resp;
  try {
    resp = await fetch(url, {
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
    return { ok: true, body: body.result };
  }
  const err = (body && body.error) || {};
  return {
    ok: false,
    code: err.status || err.code || `http-${resp.status}`,
    message: err.message || text,
  };
}

// ============================================================================
//  Seeds
// ============================================================================

const TENANT_ID = "tenant_seed_b23";
const CENTRO_ID = "centro_seed_b23";
const CENTRO_OTRO = "centro_seed_b23_otro";
const LINEA_ACTIVA = "linea_seed_b23_activa";
const LINEA_INACTIVA = "linea_seed_b23_inactiva";
const LINEA_OTRO = "linea_seed_b23_otrocentro";

const SEED_USERS = [
  { uid: "admin_b23_uid", email: "admin-b23@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b23_uid",
    email: "jefe-b23@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ID },
  },
  {
    uid: "conductor_b23_uid",
    email: "conductor-b23@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ID },
  },
];

function makeLinea(id, centroId, estado) {
  return {
    id,
    tenantId: TENANT_ID,
    centroId,
    codigo: id,
    nombre: id,
    tipo: "urbana",
    esNocturna: false,
    estado,
    paradasIda: [],
    paradasVuelta: [],
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
  };
}

async function seed() {
  for (const u of SEED_USERS) {
    try {
      await auth.deleteUser(u.uid);
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }
    await auth.createUser({ uid: u.uid, email: u.email });
    await auth.setCustomUserClaims(u.uid, u.claims);
  }
  await db.collection("centros").doc(CENTRO_ID).set({
    id: CENTRO_ID, tenantId: TENANT_ID, nombre: "Centro B23", estado: "activo",
    creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  });
  await db.collection("centros").doc(CENTRO_OTRO).set({
    id: CENTRO_OTRO, tenantId: TENANT_ID, nombre: "Centro B23 Otro", estado: "activo",
    creadoPor: "system-seed", creadoEn: FieldValue.serverTimestamp(),
  });
  await db.collection("lineas").doc(LINEA_ACTIVA).set(makeLinea(LINEA_ACTIVA, CENTRO_ID, "activa"));
  await db.collection("lineas").doc(LINEA_INACTIVA).set(makeLinea(LINEA_INACTIVA, CENTRO_ID, "inactiva"));
  await db.collection("lineas").doc(LINEA_OTRO).set(makeLinea(LINEA_OTRO, CENTRO_OTRO, "activa"));
  // Clean slate de frecuencias (auto-id de runs anteriores → no-solape determinista).
  for (const col of ["frecuencias", "frecuencias_excepcionales"]) {
    const all = await db.collection(col).get();
    for (const d of all.docs) await d.ref.delete();
  }
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
function expectError(name, expectedCode, r, re = null) {
  if (r.ok) return record(name, `error ${expectedCode}`, "OK inesperado", false);
  let pass = r.code === expectedCode;
  if (pass && re) pass = re.test(r.message);
  record(name, `error ${expectedCode}`, `code=${r.code} msg="${r.message}"`, pass);
}
async function getFrec(id) {
  const s = await db.collection("frecuencias").doc(id).get();
  return s.exists ? s.data() : null;
}

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando...");
  await seed();
  console.log("   Seeds OK\n");

  const tAdmin = await getIdTokenFor("admin_b23_uid");
  const tJefe = await getIdTokenFor("jefe_b23_uid");
  const tCond = await getIdTokenFor("conductor_b23_uid");

  const baseFrec = {
    tenantId: TENANT_ID, centroId: CENTRO_ID, lineaId: LINEA_ACTIVA,
    tipoDia: "laborable", sentido: "ida", intervaloMinutos: 12,
  };

  console.log("=== crearFrecuencia ===\n");

  // F1: alta mínima (activa default true) — y deja la base 06:00-10:00 para no-solape.
  let baseId;
  {
    const r = await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "06:00", horaFin: "10:00" }, tAdmin);
    if (!r.ok) record("F1 (alta mínima)", "ok", `error: ${r.message}`, false);
    else {
      baseId = r.body.frecuenciaId;
      const d = (await getFrec(baseId)) || {};
      record("F1 (alta mínima)", "activa=true, creadoPor=admin", `activa=${d.activa}, creadoPor=${d.creadoPor}`,
        d.activa === true && d.creadoPor === "admin_b23_uid");
    }
  }

  // F2: horaInicio >= horaFin
  expectError("F2 (horaInicio>=horaFin)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "10:00", horaFin: "06:00" }, tAdmin),
    /anterior a 'horaFin'/);

  // F3: HH:mm inválido
  expectError("F3 (HH:mm inválido)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "25:99", horaFin: "10:00" }, tAdmin),
    /horaInicio/);

  // F4: intervalo <= 0
  expectError("F4 (intervalo<=0)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "06:00", horaFin: "10:00", intervaloMinutos: 0 }, tAdmin),
    /intervaloMinutos/);

  // F5: tipoDia inválido
  expectError("F5 (tipoDia inválido)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, tipoDia: "lunes", horaInicio: "06:00", horaFin: "10:00" }, tAdmin),
    /tipoDia/);

  // F6: sentido inválido ('circular')
  expectError("F6 (sentido circular)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, sentido: "circular", horaInicio: "06:00", horaFin: "10:00" }, tAdmin),
    /sentido/);

  // F7: línea inexistente
  expectError("F7 (línea inexistente)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, lineaId: "no_existe", horaInicio: "14:00", horaFin: "18:00" }, tAdmin),
    /no existe/i);

  // F8: línea inactiva
  expectError("F8 (línea inactiva)", "FAILED_PRECONDITION",
    await invokeCallable(URL_CREAR, { ...baseFrec, lineaId: LINEA_INACTIVA, horaInicio: "14:00", horaFin: "18:00" }, tAdmin),
    /no está activa/i);

  // F9: coherencia centro (payload centro != centro de la línea)
  expectError("F9 (centro incoherente)", "INVALID_ARGUMENT",
    await invokeCallable(URL_CREAR, { ...baseFrec, centroId: CENTRO_OTRO, horaInicio: "14:00", horaFin: "18:00" }, tAdmin),
    /no pertenece/i);

  // F10: solape mismo tramo/línea/tipoDia/sentido (08:00-12:00 solapa 06:00-10:00)
  expectError("F10 (solape)", "FAILED_PRECONDITION",
    await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "08:00", horaFin: "12:00" }, tAdmin),
    /solapa/i);

  // F11: tramo adyacente disjunto (10:00-14:00) → OK
  {
    const r = await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "10:00", horaFin: "14:00" }, tAdmin);
    record("F11 (adyacente disjunto)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }

  // F12: 'ambos' solapa con 'ida' base (07:00-09:00 ambos)
  expectError("F12 (ambos solapa ida)", "FAILED_PRECONDITION",
    await invokeCallable(URL_CREAR, { ...baseFrec, sentido: "ambos", horaInicio: "07:00", horaFin: "09:00" }, tAdmin),
    /solapa/i);

  // F13: jefe alta en su centro (sabado, sin solape) → OK
  {
    const r = await invokeCallable(URL_CREAR, { ...baseFrec, tipoDia: "sabado", horaInicio: "06:00", horaFin: "10:00" }, tJefe);
    record("F13 (jefe su centro)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }

  // F14: jefe alta en otro centro → PERMISSION_DENIED
  expectError("F14 (jefe otro centro)", "PERMISSION_DENIED",
    await invokeCallable(URL_CREAR, { ...baseFrec, centroId: CENTRO_OTRO, lineaId: LINEA_OTRO, horaInicio: "06:00", horaFin: "10:00" }, tJefe),
    /otro centro/i);

  // F15: conductor → PERMISSION_DENIED
  expectError("F15 (conductor)", "PERMISSION_DENIED",
    await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "18:00", horaFin: "20:00" }, tCond));

  // F16: anónimo → UNAUTHENTICATED
  expectError("F16 (anónimo)", "UNAUTHENTICATED",
    await invokeCallable(URL_CREAR, { ...baseFrec, horaInicio: "18:00", horaFin: "20:00" }, null));

  console.log("\n=== actualizarFrecuencia ===\n");

  // F17: editar intervalo + auditoría D4.1
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId, intervaloMinutos: 20 }, tAdmin);
    const d = (await getFrec(baseId)) || {};
    record("F17 (editar intervalo)", "intervalo=20 + actualizadoPor",
      `intervalo=${d.intervaloMinutos}, actualizadoPor=${d.actualizadoPor}`,
      r.ok && d.intervaloMinutos === 20 && d.actualizadoPor === "admin_b23_uid");
  }

  // F18: soft-delete activa=false
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId, activa: false }, tAdmin);
    const d = (await getFrec(baseId)) || {};
    record("F18 (soft-delete activa=false)", "activa=false", `activa=${d.activa}`, r.ok && d.activa === false);
  }

  // F19: veto lineaId
  expectError("F19 (veto lineaId)", "INVALID_ARGUMENT",
    await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId, lineaId: "otra" }, tAdmin),
    /línea no es editable/i);

  // F20: veto tenantId
  expectError("F20 (veto tenantId)", "INVALID_ARGUMENT",
    await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId, tenantId: "otro" }, tAdmin),
    /tenantId no es editable/i);

  // F21: solo frecuenciaId
  expectError("F21 (solo id)", "INVALID_ARGUMENT",
    await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId }, tAdmin),
    /al menos un campo/i);

  // F22: inexistente
  expectError("F22 (inexistente)", "INVALID_ARGUMENT",
    await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: "no_existe", activa: true }, tAdmin),
    /no existe/i);

  // F23: update que genera solape (reactivar base 06-10 y mover la 10-14 a 08-12 chocaría;
  // más simple: la base está inactiva, reactivarla NO solapa con la 10-14). Probamos:
  // editar la 10-14 (sigue activa) a 09:00-13:00 que solaparía con... nada (base inactiva).
  // Para forzar solape: reactivar base (06-10) → no solapa con 10-14 (adyacente) → OK.
  {
    const r = await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId, activa: true }, tAdmin);
    record("F23 (reactivar sin solape)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }

  // F24: ahora mover la base 06-10 a 09:00-11:00 → solaparía con la 10-14? 09-11 vs 10-14: 09<14 && 10<11 → solapa.
  expectError("F24 (update genera solape)", "FAILED_PRECONDITION",
    await invokeCallable(URL_ACTUALIZAR, { frecuenciaId: baseId, horaInicio: "09:00", horaFin: "11:00" }, tAdmin),
    /solapa/i);

  console.log("\n=== frecuencias_excepcionales ===\n");

  const baseExc = {
    tenantId: TENANT_ID, centroId: CENTRO_ID, lineaId: LINEA_ACTIVA,
    sentido: "ida", intervaloMinutos: 6,
  };

  // F25: alta excepcional con fecha
  let excId;
  {
    const r = await invokeCallable(URL_CREAR_EXC, { ...baseExc, fecha: "2026-06-15", horaInicio: "20:00", horaFin: "23:00", motivo: "Concierto" }, tAdmin);
    if (!r.ok) record("F25 (alta excepcional)", "ok", `error: ${r.message}`, false);
    else {
      excId = r.body.frecuenciaExcepcionalId;
      const s = await db.collection("frecuencias_excepcionales").doc(excId).get();
      const d = s.exists ? s.data() : {};
      record("F25 (alta excepcional)", "fecha + activa=true + motivo",
        `fecha=${d.fecha ? "presente" : "ausente"}, activa=${d.activa}, motivo=${d.motivo}`,
        d.fecha !== undefined && d.activa === true && d.motivo === "Concierto");
    }
  }

  // F26: solape excepcional misma fecha/línea/tramo/sentido
  expectError("F26 (solape excepcional)", "FAILED_PRECONDITION",
    await invokeCallable(URL_CREAR_EXC, { ...baseExc, fecha: "2026-06-15", horaInicio: "21:00", horaFin: "22:00" }, tAdmin),
    /solapa/i);

  // F27: misma línea/tramo distinta fecha → OK (no solapa)
  {
    const r = await invokeCallable(URL_CREAR_EXC, { ...baseExc, fecha: "2026-06-16", horaInicio: "20:00", horaFin: "23:00" }, tAdmin);
    record("F27 (excepcional otra fecha)", "ok", r.ok ? "ok" : `error: ${r.message}`, r.ok);
  }

  // F28: editar motivo + auditoría
  {
    const r = await invokeCallable(URL_ACTUALIZAR_EXC, { frecuenciaExcepcionalId: excId, motivo: "Concierto reprogramado" }, tAdmin);
    const s = await db.collection("frecuencias_excepcionales").doc(excId).get();
    const d = s.exists ? s.data() : {};
    record("F28 (editar excepcional)", "motivo cambiado + actualizadoPor",
      `motivo=${d.motivo}, actualizadoPor=${d.actualizadoPor}`,
      r.ok && d.motivo === "Concierto reprogramado" && d.actualizadoPor === "admin_b23_uid");
  }

  // F29: veto lineaId excepcional
  expectError("F29 (veto lineaId exc)", "INVALID_ARGUMENT",
    await invokeCallable(URL_ACTUALIZAR_EXC, { frecuenciaExcepcionalId: excId, lineaId: "otra" }, tAdmin),
    /línea no es editable/i);

  // ==========================================================================
  console.log("\n=========================");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`Resultados: ${pass}/${results.length} PASS, ${fail}/${results.length} FAIL`);
  if (fail > 0) {
    console.log("\nFallidos:");
    for (const r of results.filter((r) => !r.pass)) console.log(`  - ${r.name}`);
    process.exit(1);
  }
  console.log("\nTodos los casos PASS. Verify completado.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nError inesperado:", err);
  process.exit(1);
});
