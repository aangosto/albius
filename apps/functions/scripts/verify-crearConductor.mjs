// verify-crearConductor.mjs
//
// Verificacion empirica del callable `crearConductor` contra los emulators
// Auth + Firestore + Functions. Diseño aprobado en sesion 3.2.d PASO 5.
//
// Requisitos previos: emulator arrancado (`npm run emulate` desde la raiz).
//
// Ejecucion (desde la raiz del repo):
//   node apps/functions/scripts/verify-crearConductor.mjs
//
// Sin dependencias nuevas: firebase-admin (ya en node_modules) + fetch nativo Node 20+.
// Las env vars de los emulators se setean ANTES de importar firebase-admin (dynamic import).
//
// Helpers duplicados de verify-crearJefeTrafico.mjs intencionalmente.
// TODO[refactor-verify-helpers]: extraer a `_lib.mts` cuando 3.2.e consolide los scripts.

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT ??= "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");

const PROJECT_ID = "albius-cbdb1";
const REGION = "us-central1";
const AUTH_HOST = "127.0.0.1:9099";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const CALLABLE_URL = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/crearConductor`;
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const auth = getAuth();
const db = getFirestore();

// ============================================================================
//  Pre-flight: ¿estan los emulators arriba?
// ============================================================================

async function checkEmulatorsUp() {
  const probes = [
    { name: "Auth emulator", host: AUTH_HOST },
    { name: "Functions emulator", host: FUNCTIONS_HOST },
    { name: "Firestore emulator", host: "127.0.0.1:8080" },
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
    console.error(
      "\nArranca el emulator (en otra terminal):\n  npm run emulate\n",
    );
    process.exit(2);
  }
}

// ============================================================================
//  Helpers: signIn + invokeCallable
// ============================================================================

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

async function invokeCallable(data, idToken) {
  const headers = { "Content-Type": "application/json" };
  if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  let resp;
  try {
    resp = await fetch(CALLABLE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ data }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      code: "network-error",
      message: e.message,
    };
  }
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (resp.ok && body && body.result !== undefined) {
    return {
      ok: true,
      status: resp.status,
      body: body.result,
      code: null,
      message: null,
    };
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

const SEED_USERS = [
  { uid: "admin_001", email: "admin@test.local", claims: { rol: "super_admin" } },
  {
    uid: "jefe_001",
    email: "jefe@test.local",
    claims: { rol: "jefe_trafico", tenantId: "tenant_001", centroId: "centro_001" },
  },
  { uid: "cond_001", email: "cond@test.local", claims: { rol: "conductor" } },
  { uid: "sin_rol_001", email: "sinrol@test.local", claims: null },
];

const SEED_TENANTS = [
  { id: "tenant_001", data: { nombre: "Tenant Test 1" } },
  { id: "tenant_002", data: { nombre: "Tenant Test 2" } },
];

const SEED_CENTROS = [
  { id: "centro_001", data: { tenantId: "tenant_001", nombre: "Centro A" } },
  { id: "centro_002", data: { tenantId: "tenant_002", nombre: "Centro B" } },
  // NUEVO en 3.2.d: centro alternativo del MISMO tenant que centro_001.
  // Permite distinguir cross-centro (N5) de cross-tenant (N4).
  {
    id: "centro_alt_001",
    data: { tenantId: "tenant_001", nombre: "Centro C (mismo tenant que centro_001)" },
  },
];

// Conductor pre-creado para N23 (numeroEmpleado duplicado).
// Doc minimo: assertConductorIdDisponible solo mira existencia del doc, no su contenido.
const SEED_CONDUCTOR_PRE = {
  id: "tenant_001_PRE-001",
  data: {
    id: "tenant_001_PRE-001",
    tenantId: "tenant_001",
    centroId: "centro_001",
    numeroEmpleado: "PRE-001",
    nombre: "Pre",
    apellidos: "Existente",
    dni: "00000000A",
    categoria: "conductor",
    estado: "activo",
    lineasPreferentes: [],
    lineasSecundarias: [],
    tiposTurnoPermitidos: [],
    puedeSerReserva: false,
    fechaAntiguedad: Timestamp.fromDate(new Date("2020-01-01")),
    fechaIncorporacion: Timestamp.fromDate(new Date("2020-01-01")),
  },
};

// Emails que el callable va a crear durante los casos felices.
const TEST_COND_EMAILS = [
  "nuevo-cond-c1@test.local",
  "nuevo-cond-c2@test.local",
];

// ConductorIds que los felices van a crear (limpieza /conductores previa).
// /usuarios huerfanos no se limpian — TODO[verify-cleanup-usuarios-huerfanos].
const TEST_CONDUCTOR_IDS = ["tenant_001_C1-001", "tenant_001_C2-002"];

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function deleteUserIfExistsByEmail(email) {
  try {
    const u = await auth.getUserByEmail(email);
    await auth.deleteUser(u.uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  // 1. Usuarios fijos
  for (const u of SEED_USERS) {
    await deleteUserIfExistsByUid(u.uid);
    await auth.createUser({ uid: u.uid, email: u.email });
    if (u.claims) await auth.setCustomUserClaims(u.uid, u.claims);
  }
  // 2. Emails que el callable creara: limpiar previas si existen
  for (const email of TEST_COND_EMAILS) {
    await deleteUserIfExistsByEmail(email);
  }
  // 3. ConductorIds previos de tests anteriores: limpiar docs /conductores
  for (const cid of TEST_CONDUCTOR_IDS) {
    await db
      .collection("conductores")
      .doc(cid)
      .delete()
      .catch(() => {});
  }
  // 4. Tenants
  for (const t of SEED_TENANTS) {
    await db.collection("tenants").doc(t.id).set(t.data);
  }
  // 5. Centros (incluye centro_alt_001 nuevo)
  for (const c of SEED_CENTROS) {
    await db.collection("centros").doc(c.id).set(c.data);
  }
  // 6. Conductor pre-creado para N23
  await db
    .collection("conductores")
    .doc(SEED_CONDUCTOR_PRE.id)
    .set(SEED_CONDUCTOR_PRE.data);
}

// ============================================================================
//  Payload helpers
// ============================================================================

/**
 * Devuelve un payload base valido para crearConductor. Cada caso modifica
 * solo lo que cambia via override. Para OMITIR un campo, usar basePayloadWithout.
 */
function basePayload(overrides = {}) {
  return {
    numeroEmpleado: "X-000",
    nombre: "Juan",
    apellidos: "Pérez García",
    dni: "12345678A",
    email: "x@test.local",
    tenantId: "tenant_001",
    centroId: "centro_001",
    categoria: "conductor",
    fechaAntiguedad: "2020-03-15",
    fechaIncorporacion: "2020-04-01",
    puedeSerReserva: false,
    ...overrides,
  };
}

function basePayloadWithout(field, overrides = {}) {
  const p = basePayload(overrides);
  delete p[field];
  return p;
}

// ============================================================================
//  Runner de casos
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
    record(
      name,
      `error code=${expectedCode}`,
      `OK inesperado (sin error)`,
      false,
    );
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
  record(
    name,
    `error code=${expectedCode}`,
    `code=${result.code} msg="${result.message}"`,
    pass,
    extra,
  );
}

// ============================================================================
//  Main
// ============================================================================

async function main() {
  await checkEmulatorsUp();
  console.log(">> Sembrando emulators...");
  await seed();
  console.log("   Seeds OK\n");

  const tokenAdmin = await getIdTokenFor("admin_001");
  const tokenJefe = await getIdTokenFor("jefe_001");
  const tokenCond = await getIdTokenFor("cond_001");
  const tokenSinRol = await getIdTokenFor("sin_rol_001");

  // ==========================================================================
  //  FELICES
  // ==========================================================================

  // ---- C1: super_admin + payload completo con todos los opcionales ----
  {
    const payload = {
      numeroEmpleado: "C1-001",
      nombre: "Juan",
      apellidos: "Pérez García",
      dni: "12345678A",
      email: "nuevo-cond-c1@test.local",
      telefono: "+34600111222",
      tenantId: "tenant_001",
      centroId: "centro_001",
      categoria: "conductor",
      fechaAntiguedad: "2020-03-15",
      fechaIncorporacion: "2020-04-01",
      puedeSerReserva: false,
      lineasPreferentes: ["L1", "L5"],
      lineasSecundarias: ["L3"],
      tiposTurnoPermitidos: ["maniana", "tarde"],
      tiposTurnoExcluidos: ["nocturno"],
      maxHorasSemanales: 40,
      observaciones: "Conductor con experiencia previa",
    };
    const r = await invokeCallable(payload, tokenAdmin);
    if (!r.ok) {
      record(
        "C1 (super_admin + payload completo)",
        "200 ok=true; docs completos; claims aplicados",
        `error ${r.code}: ${r.message}`,
        false,
      );
    } else {
      const { usuarioId, conductorId, linkPasswordReset } = r.body;
      const linkOk =
        typeof linkPasswordReset === "string" && linkPasswordReset.length > 0;
      const conductorIdOk = conductorId === "tenant_001_C1-001";

      // /usuarios/{uid}
      const usuarioSnap = await db.collection("usuarios").doc(usuarioId).get();
      const usuario = usuarioSnap.data() || {};
      const usuarioOk =
        usuarioSnap.exists &&
        usuario.rol === "conductor" &&
        usuario.tenantId === "tenant_001" &&
        usuario.centroId === "centro_001" &&
        usuario.email === payload.email &&
        usuario.nombreCompleto === `${payload.nombre} ${payload.apellidos}` &&
        usuario.telefono === payload.telefono &&
        usuario.conductorId === conductorId &&
        usuario.estado === "activo" &&
        usuario.passwordChangeRequired === true &&
        usuario.fechaCreacion &&
        usuario.creadoPor === "admin_001" &&
        usuario.creadoEn;

      // /conductores/{conductorId}
      const condSnap = await db
        .collection("conductores")
        .doc(conductorId)
        .get();
      const cond = condSnap.data() || {};
      const fechaAntOk =
        cond.fechaAntiguedad &&
        cond.fechaAntiguedad.toDate &&
        cond.fechaAntiguedad.toDate().toISOString().startsWith("2020-03-15");
      const fechaIncOk =
        cond.fechaIncorporacion &&
        cond.fechaIncorporacion.toDate &&
        cond.fechaIncorporacion.toDate().toISOString().startsWith("2020-04-01");
      const condOk =
        condSnap.exists &&
        cond.usuarioId === usuarioId &&
        cond.tenantId === "tenant_001" &&
        cond.centroId === "centro_001" &&
        cond.numeroEmpleado === payload.numeroEmpleado &&
        cond.nombre === payload.nombre &&
        cond.apellidos === payload.apellidos &&
        cond.dni === payload.dni &&
        cond.email === payload.email &&
        cond.telefono === payload.telefono &&
        cond.categoria === payload.categoria &&
        fechaAntOk &&
        fechaIncOk &&
        cond.estado === "activo" &&
        Array.isArray(cond.lineasPreferentes) &&
        cond.lineasPreferentes.length === 2 &&
        cond.lineasPreferentes[0] === "L1" &&
        Array.isArray(cond.lineasSecundarias) &&
        cond.lineasSecundarias.length === 1 &&
        Array.isArray(cond.tiposTurnoPermitidos) &&
        cond.tiposTurnoPermitidos.length === 2 &&
        Array.isArray(cond.tiposTurnoExcluidos) &&
        cond.tiposTurnoExcluidos.length === 1 &&
        cond.maxHorasSemanales === payload.maxHorasSemanales &&
        cond.puedeSerReserva === payload.puedeSerReserva &&
        cond.observaciones === payload.observaciones &&
        cond.creadoPor === "admin_001" &&
        cond.creadoEn;

      // Custom claims
      const user = await auth.getUser(usuarioId);
      const c = user.customClaims || {};
      const claimsOk =
        c.rol === "conductor" &&
        c.tenantId === "tenant_001" &&
        c.centroId === "centro_001";

      const pass =
        r.ok && linkOk && conductorIdOk && usuarioOk && condOk && claimsOk;
      record(
        "C1 (super_admin + payload completo)",
        "200 ok=true; docs completos; claims aplicados; arrays con valores",
        `usuarioId=${usuarioId} conductorId=${conductorId}`,
        pass,
        `link=${linkOk ? "OK" : "FAIL"} cid=${conductorIdOk ? "OK" : "FAIL"} usuario=${usuarioOk ? "OK" : "FAIL"} conductor=${condOk ? "OK" : "FAIL"} claims=${claimsOk ? "OK" : "FAIL"}`,
      );
    }
  }

  // ---- C2: jefe_trafico en SU tenant+centro, payload minimo ----
  {
    const payload = {
      numeroEmpleado: "C2-002",
      nombre: "Ana",
      apellidos: "Martínez",
      dni: "87654321B",
      email: "nuevo-cond-c2@test.local",
      tenantId: "tenant_001",
      centroId: "centro_001",
      categoria: "conductor",
      fechaAntiguedad: "2021-01-10",
      fechaIncorporacion: "2021-02-01",
      puedeSerReserva: false,
      // Sin telefono, lineasPreferentes, lineasSecundarias,
      // tiposTurnoPermitidos, tiposTurnoExcluidos, maxHorasSemanales, observaciones.
    };
    const r = await invokeCallable(payload, tokenJefe);
    if (!r.ok) {
      record(
        "C2 (jefe en su centro, payload minimo)",
        "200 ok=true; arrays []; opcionales ausentes; creadoPor=jefe_001",
        `error ${r.code}: ${r.message}`,
        false,
      );
    } else {
      const { usuarioId, conductorId } = r.body;
      const conductorIdOk = conductorId === "tenant_001_C2-002";

      const usuarioSnap = await db.collection("usuarios").doc(usuarioId).get();
      const usuario = usuarioSnap.data() || {};
      const telefonoAusenteUsuario = !("telefono" in usuario);
      const creadoPorJefe = usuario.creadoPor === "jefe_001";

      const condSnap = await db
        .collection("conductores")
        .doc(conductorId)
        .get();
      const cond = condSnap.data() || {};
      const arrayDuda8Ok =
        Array.isArray(cond.lineasPreferentes) &&
        cond.lineasPreferentes.length === 0 &&
        Array.isArray(cond.lineasSecundarias) &&
        cond.lineasSecundarias.length === 0 &&
        Array.isArray(cond.tiposTurnoPermitidos) &&
        cond.tiposTurnoPermitidos.length === 0;
      const opcionalesAusentes =
        !("tiposTurnoExcluidos" in cond) &&
        !("maxHorasSemanales" in cond) &&
        !("observaciones" in cond) &&
        !("telefono" in cond);
      const creadoPorJefeCond = cond.creadoPor === "jefe_001";

      const pass =
        conductorIdOk &&
        telefonoAusenteUsuario &&
        creadoPorJefe &&
        arrayDuda8Ok &&
        opcionalesAusentes &&
        creadoPorJefeCond;
      record(
        "C2 (jefe en su centro, payload minimo)",
        "arrays [] por DUDA-8; opcionales ausentes por DUDA-9; creadoPor=jefe_001",
        `usuarioId=${usuarioId} conductorId=${conductorId}`,
        pass,
        `cid=${conductorIdOk ? "OK" : "FAIL"} telUsr=${telefonoAusenteUsuario ? "OK" : "FAIL"} creadoUsr=${creadoPorJefe ? "OK" : "FAIL"} arr8=${arrayDuda8Ok ? "OK" : "FAIL"} opc9=${opcionalesAusentes ? "OK" : "FAIL"} creadoCond=${creadoPorJefeCond ? "OK" : "FAIL"}`,
      );
    }
  }

  // ==========================================================================
  //  NEGATIVOS — AUTH-GUARDS
  // ==========================================================================

  // N1: sin auth
  expectError(
    "N1 (sin auth)",
    "UNAUTHENTICATED",
    await invokeCallable(basePayload(), null),
  );

  // N2: usuario sin claim rol
  expectError(
    "N2 (sin claim rol)",
    "PERMISSION_DENIED",
    await invokeCallable(basePayload(), tokenSinRol),
  );

  // N3: rol conductor
  expectError(
    "N3 (rol conductor)",
    "PERMISSION_DENIED",
    await invokeCallable(basePayload(), tokenCond),
  );

  // ==========================================================================
  //  NEGATIVOS — CROSS-TENANT / CROSS-CENTRO (D6 ampliado en 3.2.d)
  // ==========================================================================

  // N4: jefe del tenant_001 intenta crear en tenant_002
  expectError(
    "N4 (jefe cross-tenant)",
    "PERMISSION_DENIED",
    await invokeCallable(
      basePayload({ tenantId: "tenant_002", centroId: "centro_002" }),
      tokenJefe,
    ),
    (rr) =>
      /jefe.*otro tenant/i.test(rr.message)
        ? true
        : `mensaje no menciona tenant: "${rr.message}"`,
  );

  // N5: jefe del centro_001 intenta crear en centro_alt_001 (mismo tenant)
  expectError(
    "N5 (jefe cross-centro)",
    "PERMISSION_DENIED",
    await invokeCallable(
      basePayload({ centroId: "centro_alt_001" }),
      tokenJefe,
    ),
    (rr) =>
      /jefe.*otro centro/i.test(rr.message)
        ? true
        : `mensaje no menciona centro: "${rr.message}"`,
  );

  // ==========================================================================
  //  NEGATIVOS — VALIDATION
  // ==========================================================================

  // N6: data = null
  expectError(
    "N6 (data=null)",
    "INVALID_ARGUMENT",
    await invokeCallable(null, tokenAdmin),
  );

  // N7: data = []
  expectError(
    "N7 (data=[])",
    "INVALID_ARGUMENT",
    await invokeCallable([], tokenAdmin),
  );

  // N8: numeroEmpleado omitido
  expectError(
    "N8 (numeroEmpleado omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayloadWithout("numeroEmpleado"), tokenAdmin),
  );

  // N9: nombre omitido
  expectError(
    "N9 (nombre omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayloadWithout("nombre"), tokenAdmin),
  );

  // N10: apellidos omitido
  expectError(
    "N10 (apellidos omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayloadWithout("apellidos"), tokenAdmin),
  );

  // N11: dni omitido
  expectError(
    "N11 (dni omitido)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayloadWithout("dni"), tokenAdmin),
  );

  // N12: email mal formado
  expectError(
    "N12 (email mal formado)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayload({ email: "no-es-email" }), tokenAdmin),
  );

  // N13: categoria fuera de enum
  expectError(
    "N13 (categoria fuera de enum)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayload({ categoria: "supervisor" }), tokenAdmin),
  );

  // N14: fechaAntiguedad no ISO
  expectError(
    "N14 (fechaAntiguedad no ISO)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      basePayload({ fechaAntiguedad: "no-es-fecha" }),
      tokenAdmin,
    ),
  );

  // N15: fechaIncorporacion omitida
  expectError(
    "N15 (fechaIncorporacion omitida)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayloadWithout("fechaIncorporacion"), tokenAdmin),
  );

  // N16: puedeSerReserva string en lugar de boolean
  expectError(
    "N16 (puedeSerReserva no boolean)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayload({ puedeSerReserva: "true" }), tokenAdmin),
  );

  // N17: maxHorasSemanales negativo
  expectError(
    "N17 (maxHorasSemanales negativo)",
    "INVALID_ARGUMENT",
    await invokeCallable(basePayload({ maxHorasSemanales: -5 }), tokenAdmin),
  );

  // N18: lineasPreferentes con item vacio
  expectError(
    "N18 (lineasPreferentes item vacio)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      basePayload({ lineasPreferentes: ["L1", ""] }),
      tokenAdmin,
    ),
  );

  // ==========================================================================
  //  NEGATIVOS — REFS
  // ==========================================================================

  // N19: tenant no existe
  expectError(
    "N19 (tenant no existe)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      basePayload({ tenantId: "no-existe", numeroEmpleado: "N19-001" }),
      tokenAdmin,
    ),
    (rr) =>
      /tenant.*no existe/i.test(rr.message)
        ? true
        : `mensaje no menciona tenant: "${rr.message}"`,
  );

  // N20: centro no existe
  expectError(
    "N20 (centro no existe)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      basePayload({ centroId: "no-existe", numeroEmpleado: "N20-001" }),
      tokenAdmin,
    ),
    (rr) =>
      /centro.*no existe/i.test(rr.message)
        ? true
        : `mensaje no menciona centro: "${rr.message}"`,
  );

  // N21: cross-tenant entre payload (centro_002 pertenece a tenant_002)
  expectError(
    "N21 (cross-tenant entre payload)",
    "INVALID_ARGUMENT",
    await invokeCallable(
      basePayload({
        tenantId: "tenant_001",
        centroId: "centro_002",
        numeroEmpleado: "N21-001",
      }),
      tokenAdmin,
    ),
    (rr) =>
      /no pertenece/i.test(rr.message)
        ? true
        : `mensaje no menciona pertenencia: "${rr.message}"`,
  );

  // ==========================================================================
  //  NEGATIVOS — COLISIONES (N23 antes que N22; N22 depende de C1 exitoso)
  // ==========================================================================

  // N23: numeroEmpleado duplicado en mismo tenant (conductor pre-creado)
  expectError(
    "N23 (numeroEmpleado duplicado)",
    "ALREADY_EXISTS",
    await invokeCallable(
      basePayload({
        numeroEmpleado: "PRE-001",
        email: "n23@test.local",
      }),
      tokenAdmin,
    ),
    (rr) =>
      /conductor.*tenant_001_PRE-001/i.test(rr.message)
        ? true
        : `mensaje no menciona conductorId: "${rr.message}"`,
  );

  // N22: email duplicado (mismo de C1, otro numeroEmpleado)
  expectError(
    "N22 (email duplicado)",
    "ALREADY_EXISTS",
    await invokeCallable(
      basePayload({
        email: "nuevo-cond-c1@test.local",
        numeroEmpleado: "N22-001",
      }),
      tokenAdmin,
    ),
    (rr) =>
      /usuario.*email/i.test(rr.message)
        ? true
        : `mensaje no menciona usuario/email: "${rr.message}"`,
  );

  // ==========================================================================
  //  RESUMEN
  // ==========================================================================

  console.log("\n==========================================");
  const ok = results.filter((r) => r.pass).length;
  const fail = results.length - ok;
  console.log(`Total: ${results.length} | OK: ${ok} | FAIL: ${fail}`);
  if (fail > 0) {
    console.log("\nFallos:");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  - ${r.name}`);
      console.log(`      esperado: ${r.expected}`);
      console.log(`      recibido: ${r.actual}`);
    }
  }
  console.log("==========================================\n");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\nError inesperado en el runner:", e);
  process.exit(3);
});
