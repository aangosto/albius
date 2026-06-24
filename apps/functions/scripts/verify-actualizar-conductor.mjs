// verify-actualizar-conductor.mjs
//
// Verificación empírica del callable `actualizarConductor` contra los emulators
// Auth + Firestore + Functions (B21).
//
// Ejecución (desde la raíz del repo, con emulators arriba):
//   node apps/functions/scripts/verify-actualizar-conductor.mjs
//
// Helpers locales duplicados de verify-lineas.mjs (TODO[refactor-verify-helpers]).
// expectedCode en UPPER_SNAKE_CASE (wire HTTPS Callable v2).
//
// Seed B21:
//   - 2 tenants activos (tenant_seed_b21, tenant_otro_b21).
//   - 2 centros del tenant principal: CENTRO_ACTIVO (del jefe) + CENTRO_OTRO.
//   - 3 conductores: del centro del jefe (editable), de otro centro (anti-cross
//     centro), de otro tenant (anti-cross tenant).
//   - 3 usuarios: super_admin, jefe (tenant+centro activo), conductor.

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
const CALLABLE_URL = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/actualizarConductor`;
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const auth = getAuth();
const db = getFirestore();

// ============================================================================
//  Pre-flight + helpers (clon de verify-lineas.mjs)
// ============================================================================

async function checkEmulatorsUp() {
  const probes = [
    { name: "Auth emulator", host: AUTH_HOST },
    { name: "Functions emulator", host: FUNCTIONS_HOST },
    { name: "Firestore emulator", host: FIRESTORE_HOST },
  ];
  const errors = [];
  for (const p of probes) {
    try {
      await fetch(`http://${p.host}/`, { method: "GET" });
    } catch (e) {
      errors.push(`  - ${p.name} (${p.host}): ${e.message}`);
    }
  }
  if (errors.length > 0) {
    console.error("\nEmulators no responden:");
    console.error(errors.join("\n"));
    console.error("\nArranca el emulator: npm run emulate\n");
    process.exit(2);
  }
}

async function signInWithCustomToken(customToken) {
  const resp = await fetch(AUTH_SIGNIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  if (!resp.ok) {
    throw new Error(
      `signInWithCustomToken fallo: ${resp.status} ${await resp.text()}`,
    );
  }
  const json = await resp.json();
  return json.idToken;
}

async function getIdTokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  return signInWithCustomToken(customToken);
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
    return { ok: false, status: 0, body: null, code: "network-error", message: e.message };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (resp.ok && body && body.result !== undefined) {
    return { ok: true, status: resp.status, body: body.result, code: null, message: null };
  }
  const err = (body && body.error) || {};
  return {
    ok: false,
    status: resp.status,
    body,
    code: err.status || err.code || `http-${resp.status}`,
    message: err.message || text,
  };
}

// ============================================================================
//  Seeds (idempotentes)
// ============================================================================

const TENANT_ID = "tenant_seed_b21";
const TENANT_OTRO = "tenant_otro_b21";
const CENTRO_ACTIVO = "centro_seed_b21_activo";
const CENTRO_OTRO = "centro_seed_b21_otro";
const CENTRO_OTROTENANT = "centro_seed_b21_otrotenant";

const COND_JEFE = "cond_seed_b21_jefe"; // tenant principal, centro del jefe
const COND_OTROCENTRO = "cond_seed_b21_otrocentro"; // tenant principal, otro centro
const COND_OTROTENANT = "cond_seed_b21_otrotenant"; // otro tenant

const SEED_USERS = [
  { uid: "admin_b21_uid", email: "admin-b21@albius.test", claims: { rol: "super_admin" } },
  {
    uid: "jefe_b21_uid",
    email: "jefe-b21@albius.test",
    claims: { rol: "jefe_trafico", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
  {
    uid: "conductor_b21_uid",
    email: "conductor-b21@albius.test",
    claims: { rol: "conductor", tenantId: TENANT_ID, centroId: CENTRO_ACTIVO },
  },
];

function makeConductor(id, tenantId, centroId, numeroEmpleado) {
  return {
    id,
    tenantId,
    centroId,
    usuarioId: `${id}_usuario`,
    numeroEmpleado,
    nombre: "Nombre",
    apellidos: "Apellidos",
    dni: "12345678Z",
    categoria: "conductor",
    fechaAntiguedad: FieldValue.serverTimestamp(),
    fechaIncorporacion: FieldValue.serverTimestamp(),
    estado: "activo",
    lineasPreferentes: [],
    lineasSecundarias: [],
    tiposTurnoPermitidos: [],
    puedeSerReserva: false,
    creadoPor: "system-seed",
    creadoEn: FieldValue.serverTimestamp(),
  };
}

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  for (const u of SEED_USERS) {
    await deleteUserIfExistsByUid(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  }
  await db.collection("conductores").doc(COND_JEFE).set(
    makeConductor(COND_JEFE, TENANT_ID, CENTRO_ACTIVO, "E001"),
  );
  await db.collection("conductores").doc(COND_OTROCENTRO).set(
    makeConductor(COND_OTROCENTRO, TENANT_ID, CENTRO_OTRO, "E002"),
  );
  await db.collection("conductores").doc(COND_OTROTENANT).set(
    makeConductor(COND_OTROTENANT, TENANT_OTRO, CENTRO_OTROTENANT, "E003"),
  );
  // Limpieza idempotente: borrar conductores NO seed-b21 de runs anteriores.
  const all = await db.collection("conductores").get();
  for (const c of all.docs) {
    if (!c.id.startsWith("cond_seed_b21_")) await c.ref.delete();
  }
}

// ============================================================================
//  Runner
// ============================================================================

const results = [];

function record(name, expected, actual, pass, extra = "") {
  const tag = pass ? "[OK]  " : "[FAIL]";
  console.log(`${tag} ${name}`);
  console.log(`       esperado: ${expected}`);
  console.log(`       recibido: ${actual}${extra ? "  -> " + extra : ""}`);
  results.push({ name, expected, actual, pass });
}

function expectError(name, expectedCode, result, extraCheck = null) {
  if (result.ok) {
    record(name, `error code=${expectedCode}`, `OK inesperado (sin error)`, false);
    return;
  }
  let pass = result.code === expectedCode;
  let extra = "";
  if (pass && extraCheck) {
    const r = extraCheck(result);
    if (r !== true) {
      pass = false;
      extra = r;
    }
  }
  record(name, `error code=${expectedCode}`, `code=${result.code} msg="${result.message}"`, pass, extra);
}

async function getCond(id) {
  const snap = await db.collection("conductores").doc(id).get();
  return snap.exists ? snap.data() : null;
}

// ============================================================================
//  Main
// ============================================================================

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_b21_uid");
  const tokenJefe = await getIdTokenFor("jefe_b21_uid");
  const tokenConductor = await getIdTokenFor("conductor_b21_uid");

  console.log("=== actualizarConductor ===\n");

  // ----- C1: editar líneas (pref + sec) + auditoría D4.1 -----
  {
    const payload = {
      conductorId: COND_JEFE,
      lineasPreferentes: ["linea_a", "linea_b"],
      lineasSecundarias: ["linea_c"],
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("C1 (editar líneas)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getCond(COND_JEFE)) || {};
      const ok =
        JSON.stringify(doc.lineasPreferentes) === JSON.stringify(["linea_a", "linea_b"]) &&
        JSON.stringify(doc.lineasSecundarias) === JSON.stringify(["linea_c"]) &&
        doc.actualizadoPor === "admin_b21_uid" &&
        doc.actualizadoEn !== undefined;
      record(
        "C1 (editar líneas)",
        "pref=[a,b], sec=[c], actualizadoPor=admin, actualizadoEn presente",
        `pref=${JSON.stringify(doc.lineasPreferentes)}, sec=${JSON.stringify(doc.lineasSecundarias)}, actualizadoPor=${doc.actualizadoPor}`,
        ok,
      );
    }
  }

  // ----- C2: editar tipos de turno (perm + excl) -----
  {
    const payload = {
      conductorId: COND_JEFE,
      tiposTurnoPermitidos: ["tt_m", "tt_t"],
      tiposTurnoExcluidos: ["tt_n"],
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("C2 (editar tipos)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getCond(COND_JEFE)) || {};
      const ok =
        JSON.stringify(doc.tiposTurnoPermitidos) === JSON.stringify(["tt_m", "tt_t"]) &&
        JSON.stringify(doc.tiposTurnoExcluidos) === JSON.stringify(["tt_n"]);
      record(
        "C2 (editar tipos)",
        "perm=[m,t], excl=[n]",
        `perm=${JSON.stringify(doc.tiposTurnoPermitidos)}, excl=${JSON.stringify(doc.tiposTurnoExcluidos)}`,
        ok,
      );
    }
  }

  // ----- C3: editar maxHoras + observaciones + puedeSerReserva -----
  {
    const payload = {
      conductorId: COND_JEFE,
      maxHorasSemanales: 35,
      observaciones: "Prefiere turnos de mañana",
      puedeSerReserva: true,
    };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("C3 (maxHoras+obs+reserva)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getCond(COND_JEFE)) || {};
      const ok =
        doc.maxHorasSemanales === 35 &&
        doc.observaciones === "Prefiere turnos de mañana" &&
        doc.puedeSerReserva === true;
      record(
        "C3 (maxHoras+obs+reserva)",
        "maxHoras=35, obs set, puedeSerReserva=true",
        `maxHoras=${doc.maxHorasSemanales}, obs=${doc.observaciones}, reserva=${doc.puedeSerReserva}`,
        ok,
      );
    }
  }

  // ----- C4: editar estado (activo→vacaciones) -----
  {
    const payload = { conductorId: COND_JEFE, estado: "vacaciones" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    if (!r.ok) {
      record("C4 (estado vacaciones)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getCond(COND_JEFE)) || {};
      record("C4 (estado vacaciones)", "doc.estado=vacaciones", `estado=${doc.estado}`, doc.estado === "vacaciones");
    }
  }

  // ----- C5: estado inválido -----
  {
    const payload = { conductorId: COND_JEFE, estado: "muerto" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("C5 (estado inválido)", "INVALID_ARGUMENT", r, (res) =>
      /'estado'/.test(res.message) ? true : "no menciona 'estado'",
    );
  }

  // ----- C6-C12: vetos de inmutables / dual-homed -----
  const vetos = [
    ["C6 (veto centroId)", { centroId: "x" }, /centroId no es editable/i],
    ["C7 (veto tenantId)", { tenantId: "x" }, /tenantId no es editable/i],
    ["C8 (veto dni)", { dni: "x" }, /DNI no es editable/i],
    ["C9 (veto numeroEmpleado)", { numeroEmpleado: "x" }, /número de empleado no es editable/i],
    ["C10 (veto categoria)", { categoria: "interventor" }, /categoría no es editable/i],
    ["C11 (veto email dual-homed)", { email: "x@y.z" }, /actualizarUsuario/i],
    ["C12 (veto creadoPor)", { creadoPor: "x" }, /'creadoPor' no es editable/i],
  ];
  for (const [name, extra, re] of vetos) {
    const payload = { conductorId: COND_JEFE, ...extra };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError(name, "INVALID_ARGUMENT", r, (res) =>
      re.test(res.message) ? true : `mensaje no matchea ${re}`,
    );
  }

  // ----- C13: solo conductorId → 'al menos un campo' -----
  {
    const payload = { conductorId: COND_JEFE };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("C13 (solo conductorId)", "INVALID_ARGUMENT", r, (res) =>
      /al menos un campo/i.test(res.message) ? true : "no menciona 'al menos un campo'",
    );
  }

  // ----- C14: conductor inexistente -----
  {
    const payload = { conductorId: "cond_inexistente_b21", estado: "activo" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("C14 (conductor inexistente)", "INVALID_ARGUMENT", r, (res) =>
      /no existe/i.test(res.message) ? true : "no menciona 'no existe'",
    );
  }

  // ----- C15: jefe edita conductor de SU centro → OK, actualizadoPor=jefe -----
  {
    const payload = { conductorId: COND_JEFE, observaciones: "Tocado por el jefe" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenJefe);
    if (!r.ok) {
      record("C15 (jefe su centro)", "200 ok=true", `error: ${r.message}`, false);
    } else {
      const doc = (await getCond(COND_JEFE)) || {};
      record(
        "C15 (jefe su centro)",
        "obs cambiada + actualizadoPor=jefe_b21_uid",
        `obs=${doc.observaciones}, actualizadoPor=${doc.actualizadoPor}`,
        doc.observaciones === "Tocado por el jefe" && doc.actualizadoPor === "jefe_b21_uid",
      );
    }
  }

  // ----- C16: jefe edita conductor de OTRO centro (mismo tenant) → PERMISSION_DENIED -----
  {
    const payload = { conductorId: COND_OTROCENTRO, estado: "vacaciones" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenJefe);
    expectError("C16 (jefe otro centro)", "PERMISSION_DENIED", r, (res) =>
      /otro centro/i.test(res.message) ? true : "no menciona 'otro centro'",
    );
  }

  // ----- C17: jefe edita conductor de OTRO tenant → PERMISSION_DENIED -----
  {
    const payload = { conductorId: COND_OTROTENANT, estado: "vacaciones" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenJefe);
    expectError("C17 (jefe otro tenant)", "PERMISSION_DENIED", r, (res) =>
      /otro tenant/i.test(res.message) ? true : "no menciona 'otro tenant'",
    );
  }

  // ----- C18: conductor (rol) → PERMISSION_DENIED -----
  {
    const payload = { conductorId: COND_JEFE, estado: "activo" };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenConductor);
    expectError("C18 (rol conductor)", "PERMISSION_DENIED", r);
  }

  // ----- C19: anónimo → UNAUTHENTICATED -----
  {
    const payload = { conductorId: COND_JEFE, estado: "activo" };
    const r = await invokeCallable(CALLABLE_URL, payload, null);
    expectError("C19 (anónimo)", "UNAUTHENTICATED", r);
  }

  // ----- C20: array con elemento inválido (string vacío) → INVALID_ARGUMENT -----
  {
    const payload = { conductorId: COND_JEFE, lineasPreferentes: ["ok", ""] };
    const r = await invokeCallable(CALLABLE_URL, payload, tokenAdmin);
    expectError("C20 (array elemento vacío)", "INVALID_ARGUMENT", r, (res) =>
      /lineasPreferentes/.test(res.message) ? true : "no menciona 'lineasPreferentes'",
    );
  }

  // ==========================================================================
  //  Resumen
  // ==========================================================================
  console.log("\n=========================");
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`Resultados: ${pass}/${results.length} PASS, ${fail}/${results.length} FAIL`);
  if (fail > 0) {
    console.log("\nCasos fallidos:");
    for (const r of results.filter((r) => !r.pass)) console.log(`  - ${r.name}`);
    process.exit(1);
  }
  console.log("\nTodos los casos PASS. Verify completado.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nError inesperado en main:", err);
  process.exit(1);
});
