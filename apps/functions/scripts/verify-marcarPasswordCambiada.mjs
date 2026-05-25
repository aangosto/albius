// verify-marcarPasswordCambiada.mjs
//
// Verificación empírica del callable `marcarPasswordCambiada` contra los
// emulators Auth + Firestore + Functions. Bloque 7.
//
// Cobertura:
//   C1 — user con flag=true: 200 ok=true; doc tras pasa a flag=false +
//        passwordCambiadaEn presente.
//   C2 — user con flag=false: 200 ok=true idempotente; doc NO cambia.
//   C3 — user con flag=true, invocar 2x: la segunda es idempotente y NO
//        sobreescribe passwordCambiadaEn de la primera.
//   N1 — sin auth: UNAUTHENTICATED.
//   N2 — auth con uid sin doc /usuarios: FAILED_PRECONDITION.
//
// Requisitos previos: emulator arriba (npm run emulate desde raíz).
//
// Ejecución:
//   node apps/functions/scripts/verify-marcarPasswordCambiada.mjs

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
const CALLABLE_URL = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/marcarPasswordCambiada`;
const AUTH_SIGNIN_URL = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const auth = getAuth();
const db = getFirestore();

// ============================================================================
//  Pre-flight
// ============================================================================

async function checkEmulatorsUp() {
  const probes = [
    { name: "Auth", host: AUTH_HOST },
    { name: "Functions", host: FUNCTIONS_HOST },
    { name: "Firestore", host: "127.0.0.1:8080" },
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
    process.exit(2);
  }
}

// ============================================================================
//  Helpers (paralelo a verify-crearJefeTrafico.mjs; TODO[refactor-verify-helpers])
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
//  Seed
// ============================================================================

const UID_FLAG_TRUE = "marcar_user_flag_true";
const UID_FLAG_FALSE = "marcar_user_flag_false";
const UID_SIN_DOC = "marcar_user_sin_doc";

async function deleteUserIfExistsByUid(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
}

async function seed() {
  // Borrar previos
  for (const uid of [UID_FLAG_TRUE, UID_FLAG_FALSE, UID_SIN_DOC]) {
    await deleteUserIfExistsByUid(uid);
    await db.collection("usuarios").doc(uid).delete().catch(() => {});
  }

  // Crear Auth users
  await auth.createUser({
    uid: UID_FLAG_TRUE,
    email: "marcar.true@test.local",
  });
  await auth.createUser({
    uid: UID_FLAG_FALSE,
    email: "marcar.false@test.local",
  });
  await auth.createUser({ uid: UID_SIN_DOC, email: "marcar.sindoc@test.local" });

  // Docs /usuarios: flag_true y flag_false; sin_doc NO tiene doc.
  await db.collection("usuarios").doc(UID_FLAG_TRUE).set({
    id: UID_FLAG_TRUE,
    email: "marcar.true@test.local",
    nombreCompleto: "Marcar True Test",
    rol: "jefe_trafico",
    estado: "activo",
    passwordChangeRequired: true,
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: "verify-marcarPasswordCambiada",
    creadoEn: FieldValue.serverTimestamp(),
  });
  await db.collection("usuarios").doc(UID_FLAG_FALSE).set({
    id: UID_FLAG_FALSE,
    email: "marcar.false@test.local",
    nombreCompleto: "Marcar False Test",
    rol: "jefe_trafico",
    estado: "activo",
    passwordChangeRequired: false,
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: "verify-marcarPasswordCambiada",
    creadoEn: FieldValue.serverTimestamp(),
  });
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

function expectError(name, expectedCode, result) {
  if (result.ok) {
    record(name, `error code=${expectedCode}`, `OK inesperado`, false);
    return;
  }
  const pass = result.code === expectedCode;
  record(
    name,
    `error code=${expectedCode}`,
    `code=${result.code} msg="${result.message}"`,
    pass,
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

  const tokenTrue = await getIdTokenFor(UID_FLAG_TRUE);
  const tokenFalse = await getIdTokenFor(UID_FLAG_FALSE);
  const tokenSinDoc = await getIdTokenFor(UID_SIN_DOC);

  // ---------- C1: flag=true -> flag pasa a false + passwordCambiadaEn ----------
  {
    const r = await invokeCallable({}, tokenTrue);
    if (!r.ok) {
      record("C1 (flag=true)", "200 ok=true; doc actualizado", `error ${r.code}: ${r.message}`, false);
    } else {
      const snap = await db.collection("usuarios").doc(UID_FLAG_TRUE).get();
      const doc = snap.data() || {};
      const docOK =
        doc.passwordChangeRequired === false &&
        doc.passwordCambiadaEn !== undefined;
      record(
        "C1 (flag=true)",
        "ok=true; doc.passwordChangeRequired=false; passwordCambiadaEn presente",
        `ok=${r.ok} flag=${doc.passwordChangeRequired} ts=${doc.passwordCambiadaEn ? "presente" : "ausente"}`,
        r.ok && docOK,
      );
    }
  }

  // ---------- C2: flag=false -> idempotente, doc no cambia ----------
  {
    const snapAntes = await db.collection("usuarios").doc(UID_FLAG_FALSE).get();
    const docAntes = snapAntes.data() || {};
    const r = await invokeCallable({}, tokenFalse);
    if (!r.ok) {
      record("C2 (flag=false idempotente)", "200 ok=true sin escribir", `error ${r.code}: ${r.message}`, false);
    } else {
      const snapDespues = await db.collection("usuarios").doc(UID_FLAG_FALSE).get();
      const docDespues = snapDespues.data() || {};
      // No debería existir passwordCambiadaEn antes ni después (flag ya false al alta).
      const sinEscribir =
        docDespues.passwordChangeRequired === false &&
        docDespues.passwordCambiadaEn === undefined &&
        docAntes.passwordCambiadaEn === undefined;
      record(
        "C2 (flag=false idempotente)",
        "ok=true; passwordCambiadaEn sigue ausente (no se escribió)",
        `ok=${r.ok} ts=${docDespues.passwordCambiadaEn ? "presente" : "ausente"}`,
        r.ok && sinEscribir,
      );
    }
  }

  // ---------- C3: flag=true, 2 invocaciones; la 2a no sobreescribe el ts ----------
  {
    // C1 ya dejó UID_FLAG_TRUE con flag=false + ts. Segunda llamada es la idempotente.
    const snapAntes = await db.collection("usuarios").doc(UID_FLAG_TRUE).get();
    const tsAntes = snapAntes.data()?.passwordCambiadaEn;
    const r = await invokeCallable({}, tokenTrue);
    const snapDespues = await db.collection("usuarios").doc(UID_FLAG_TRUE).get();
    const tsDespues = snapDespues.data()?.passwordCambiadaEn;
    const mismoTs =
      tsAntes !== undefined &&
      tsDespues !== undefined &&
      tsAntes.isEqual?.(tsDespues);
    record(
      "C3 (2a invocación idempotente, ts no se sobreescribe)",
      "ok=true; passwordCambiadaEn igual antes y después",
      `ok=${r.ok} mismoTs=${mismoTs}`,
      r.ok && mismoTs,
    );
  }

  // ---------- N1: sin auth ----------
  expectError("N1 (sin auth)", "UNAUTHENTICATED", await invokeCallable({}, null));

  // ---------- N2: auth pero sin doc /usuarios ----------
  expectError(
    "N2 (sin doc /usuarios)",
    "FAILED_PRECONDITION",
    await invokeCallable({}, tokenSinDoc),
  );

  // ---------- Resumen ----------
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
