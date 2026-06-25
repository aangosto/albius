// bootstrap-super-admin.mjs
//
// Crea un super_admin en el sistema Albius desde CLI. Necesario en bootstrap
// inicial (no hay super_admin previo que autorice un callable) y en altas
// posteriores de super_admins adicionales.
//
// Diseño aprobado en Bloque 4 (sesión 2026-05-22). 6 capas de fail-safe contra
// accidentes en producción. Sin Zod (D4); sin deps nuevas; ESM nativo Node 20+.
//
// Uso:
//   node scripts/bootstrap-super-admin.mjs --email <email> --nombre "<nombre>" --target <emulator|production> [--yes]
//
// Más detalles con: node scripts/bootstrap-super-admin.mjs --help

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

// ============================================================================
//  Constantes
// ============================================================================

const EXPECTED_PROJECT_ID = "albius-cbdb1";
const DEFAULT_EMULATOR_AUTH_HOST = "127.0.0.1:9099";
const DEFAULT_EMULATOR_FIRESTORE_HOST = "127.0.0.1:8080";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
//  Errores tipados
// ============================================================================

class OperatorAbortError extends Error {
  constructor() {
    super("Operación abortada por el operador.");
    this.name = "OperatorAbortError";
  }
}

// ============================================================================
//  CLI parsing (manual, sin deps)
// ============================================================================

function consumeValue(argv, i, flagName) {
  const val = argv[i + 1];
  if (val === undefined || val.startsWith("--")) {
    throw new Error(`${flagName} requiere un valor.`);
  }
  return val;
}

function parseCliArgs() {
  const args = {
    email: undefined,
    nombre: undefined,
    target: undefined,
    yes: false,
    help: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--yes" || arg === "-y") {
      args.yes = true;
    } else if (arg === "--email") {
      args.email = consumeValue(argv, i, "--email");
      i++;
    } else if (arg === "--nombre") {
      args.nombre = consumeValue(argv, i, "--nombre");
      i++;
    } else if (arg === "--target") {
      args.target = consumeValue(argv, i, "--target");
      i++;
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`bootstrap-super-admin.mjs — Crea un super_admin en el sistema Albius.

Uso:
  node scripts/bootstrap-super-admin.mjs --email <email> --nombre "<nombre>" --target <emulator|production> [--yes]

Args:
  --email     Email del super_admin (requerido).
  --nombre    Nombre completo a usar como displayName (requerido).
  --target    'emulator' (local) o 'production' (Firebase real). REQUERIDO sin default.
  --yes, -y   Salta confirmación interactiva en --target production (uso bajo automation).
  --help, -h  Muestra esta ayuda.

Target = emulator: setea env vars de los emulators de Auth (${DEFAULT_EMULATOR_AUTH_HOST})
                   y Firestore (${DEFAULT_EMULATOR_FIRESTORE_HOST}) con default si no están
                   ya seteadas. Project = ${EXPECTED_PROJECT_ID} (override por GCLOUD_PROJECT).

Target = production: requiere GOOGLE_APPLICATION_CREDENTIALS (path a SA JSON) o
                     'gcloud auth application-default login' previa. Verifica que las
                     credenciales apunten al proyecto ${EXPECTED_PROJECT_ID}. Pide
                     confirmación interactiva escribiendo 'CONFIRMAR' (salvo con --yes).

Exit codes:
  0  éxito (incluido no-op idempotente).
  1  error de input, credenciales, idempotencia conflictiva o target ambiguo.
  2  error de Firebase durante creación.
  3  verificación post-creación falló.
  130  aborted por operador (Ctrl+C o no 'CONFIRMAR').
`);
}

// ============================================================================
//  Validación de inputs
// ============================================================================

function validateInputs(args) {
  if (args.target === undefined) {
    throw new Error(
      "Especifica --target emulator|production explícitamente. Sin default por seguridad.",
    );
  }
  if (args.target !== "emulator" && args.target !== "production") {
    throw new Error(
      `Valor inválido para --target: ${args.target}. Debe ser 'emulator' o 'production'.`,
    );
  }
  if (args.email === undefined) {
    throw new Error("--email es requerido. Usa --help para ver opciones.");
  }
  if (args.nombre === undefined) {
    throw new Error("--nombre es requerido. Usa --help para ver opciones.");
  }
  const email = args.email.trim();
  if (!EMAIL_REGEX.test(email)) {
    throw new Error(
      `El email no tiene formato válido: ${args.email}`,
    );
  }
  const nombre = args.nombre.trim();
  if (nombre.length === 0) {
    throw new Error("El --nombre no puede estar vacío.");
  }
  return { email, nombre, target: args.target, yes: args.yes };
}

// ============================================================================
//  Detección de credenciales para production (capas 3 y 6)
// ============================================================================

/**
 * Ruta del fichero ADC (Application Default Credentials) de gcloud, según
 * plataforma. FIX B29 C.4.4 (ruta ADC multiplataforma): antes estaba hardcodeada
 * a la ruta POSIX (~/.config/gcloud/...) y fallaba en Windows, donde el ADC vive
 * en %APPDATA%\gcloud\. Eso impedía que la capa 3b (gcloud ADC) detectara
 * credenciales en Windows pese a estar bien configuradas. Esto deja la CAPA DE
 * CREDENCIALES (3b) funcional en Windows; el resto de TODO[bootstrap-verify-
 * production-layers] (banner/confirmación/project_id contra Firebase real) sigue
 * pendiente de verificación empírica. Prioridad:
 *   1. CLOUDSDK_CONFIG (si el operador movió el config de gcloud).
 *   2. Windows → %APPDATA%\gcloud\application_default_credentials.json.
 *   3. POSIX (Linux/Mac) → ~/.config/gcloud/application_default_credentials.json.
 */
function adcDefaultPath() {
  if (process.env.CLOUDSDK_CONFIG) {
    return join(
      process.env.CLOUDSDK_CONFIG,
      "application_default_credentials.json",
    );
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(
      process.env.APPDATA,
      "gcloud",
      "application_default_credentials.json",
    );
  }
  return join(
    homedir(),
    ".config",
    "gcloud",
    "application_default_credentials.json",
  );
}

function detectProductionCredentials() {
  // Layer 3a: GOOGLE_APPLICATION_CREDENTIALS apunta a SA JSON
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!existsSync(saPath)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS apunta a ${saPath} pero el archivo no existe.`,
      );
    }
    let sa;
    try {
      sa = JSON.parse(readFileSync(saPath, "utf8"));
    } catch (e) {
      throw new Error(
        `Error leyendo Service Account file ${saPath}: ${e.message}`,
      );
    }
    if (!sa.project_id) {
      throw new Error(
        `Service Account file ${saPath} no contiene project_id.`,
      );
    }
    return { source: "service-account", projectId: sa.project_id };
  }

  // Layer 3b: gcloud Application Default Credentials (ruta multiplataforma, B29 C.4.4)
  const adcPath = adcDefaultPath();
  if (!existsSync(adcPath)) {
    return null;
  }

  // ADC file existe. Project ID viene de gcloud config (no del ADC file).
  let result;
  try {
    result = spawnSync("gcloud", ["config", "get-value", "project"], {
      encoding: "utf8",
      timeout: 5000,
      shell: true,
    });
  } catch {
    return null; // gcloud no disponible o falla
  }
  if (result.error || result.status !== 0) {
    return null;
  }
  const projectId = result.stdout.trim();
  if (!projectId || projectId === "(unset)") {
    return null;
  }
  return { source: "gcloud-adc", projectId };
}

async function confirmProductionInteractive() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise((resolve) => {
    rl.question(
      "Escribe 'CONFIRMAR' para continuar (cualquier otra cosa aborta): ",
      (input) => {
        rl.close();
        resolve(input);
      },
    );
  });
  if (answer !== "CONFIRMAR") {
    throw new OperatorAbortError();
  }
}

async function setupTarget(args) {
  if (args.target === "emulator") {
    // Setear env vars con default si no están seteadas (respeta override).
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = DEFAULT_EMULATOR_AUTH_HOST;
    }
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_EMULATOR_HOST = DEFAULT_EMULATOR_FIRESTORE_HOST;
    }
    if (!process.env.GCLOUD_PROJECT) {
      process.env.GCLOUD_PROJECT = EXPECTED_PROJECT_ID;
    }
    // Banner informativo (sin pausa) con valores EFECTIVOS, no defaults.
    console.log(
      `[EMULATOR] Auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST} ` +
        `Firestore=${process.env.FIRESTORE_EMULATOR_HOST} ` +
        `Project=${process.env.GCLOUD_PROJECT}`,
    );
    return { projectId: process.env.GCLOUD_PROJECT };
  }

  // target === "production"
  // Layer 2: NO env vars de emulator
  const emulatorVars = [
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIRESTORE_EMULATOR_HOST",
  ];
  const setEmulatorVars = emulatorVars.filter((v) => process.env[v]);
  if (setEmulatorVars.length > 0) {
    throw new Error(
      `Detectadas env vars de emulator con --target=production: ${setEmulatorVars.join(", ")}. ` +
        `Unset las env vars o usa --target=emulator.`,
    );
  }

  // Layer 3: detectar credenciales
  const creds = detectProductionCredentials();
  if (!creds) {
    throw new Error(
      "No se detectaron credenciales para Firebase real. " +
        "Configura GOOGLE_APPLICATION_CREDENTIALS=<path-a-sa.json> o " +
        "ejecuta 'gcloud auth application-default login'.",
    );
  }

  // Layer 6: verificar project ID coincide con el esperado
  if (creds.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Las credenciales (${creds.source}) apuntan al proyecto '${creds.projectId}', ` +
        `no a '${EXPECTED_PROJECT_ID}'. Aborta para evitar crear super_admin en proyecto equivocado.`,
    );
  }

  // Layer 4: banner llamativo (project ID EFECTIVO, no default)
  console.log("================================================================");
  console.log("  ⚠  TARGET = PRODUCTION");
  console.log(`  ⚠  Project: ${creds.projectId} (source: ${creds.source})`);
  console.log("  ⚠  Esto creará un super_admin REAL en Firebase de producción.");
  console.log("================================================================");

  // Layer 5: confirmación interactiva (salvo --yes)
  if (args.yes) {
    console.log("--yes especificado: saltando confirmación interactiva.");
  } else {
    await confirmProductionInteractive();
  }

  return { projectId: creds.projectId };
}

// ============================================================================
//  Lógica de Firebase (tras init Admin SDK)
// ============================================================================

async function ensureUserDoesNotExist(auth, email) {
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      return { exists: false };
    }
    throw e;
  }
  // Existe: chequear claims
  const claims = userRecord.customClaims || {};
  if (claims.rol === "super_admin") {
    return { exists: true, isAlreadySuperAdmin: true, userRecord };
  }
  if (!claims.rol) {
    throw new Error(
      `Existe usuario con email ${email} pero sin claims (uid: ${userRecord.uid}). ` +
        `Intervención manual requerida para evitar sobrescribir estado inconsistente.`,
    );
  }
  throw new Error(
    `Existe usuario con email ${email} pero rol=${claims.rol} (uid: ${userRecord.uid}). ` +
      `Aborta para evitar sobrescribir.`,
  );
}

async function createSuperAdmin(auth, db, FieldValue, email, nombre) {
  const flags = {
    authUserCreated: false,
    firestoreDocCreated: false,
    uid: undefined,
  };
  try {
    const userRecord = await auth.createUser({ email, displayName: nombre });
    flags.uid = userRecord.uid;
    flags.authUserCreated = true;

    await auth.setCustomUserClaims(flags.uid, { rol: "super_admin" });

    const usuarioDoc = {
      id: flags.uid,
      email,
      nombreCompleto: nombre,
      rol: "super_admin",
      estado: "activo",
      passwordChangeRequired: true,
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: "bootstrap-cli", // DUDA-13: valor convencional, no hay request.auth.uid
      creadoEn: FieldValue.serverTimestamp(),
    };
    await db.collection("usuarios").doc(flags.uid).set(usuarioDoc);
    flags.firestoreDocCreated = true;

    const link = await auth.generatePasswordResetLink(email);
    return { uid: flags.uid, link, flags };
  } catch (err) {
    await rollback(auth, db, flags);
    throw err;
  }
}

async function rollback(auth, db, flags) {
  if (flags.firestoreDocCreated && flags.uid) {
    await db
      .collection("usuarios")
      .doc(flags.uid)
      .delete()
      .catch((e) => {
        console.error(
          `Rollback Firestore falló (uid ${flags.uid}): ${e.message}`,
        );
      });
  }
  if (flags.authUserCreated && flags.uid) {
    await auth.deleteUser(flags.uid).catch((e) => {
      console.error(`Rollback Auth user falló (uid ${flags.uid}): ${e.message}`);
    });
  }
}

async function verifyPostCreation(auth, db, uid, email, nombre) {
  const errors = [];

  // 1. Doc /usuarios/{uid}
  const snap = await db.collection("usuarios").doc(uid).get();
  if (!snap.exists) {
    errors.push("Doc /usuarios/{uid} no existe tras la creación.");
  } else {
    const d = snap.data();
    if (d.rol !== "super_admin") errors.push(`rol esperado super_admin, leído ${d.rol}`);
    if (d.email !== email) errors.push(`email mismatch`);
    if (d.nombreCompleto !== nombre) errors.push(`nombreCompleto mismatch`);
    if (d.estado !== "activo") errors.push(`estado esperado activo`);
    if (d.passwordChangeRequired !== true) errors.push(`passwordChangeRequired esperado true`);
    if (d.creadoPor !== "bootstrap-cli") errors.push(`creadoPor esperado bootstrap-cli`);
    if (!d.creadoEn) errors.push(`creadoEn ausente`);
    if ("tenantId" in d) errors.push(`tenantId no debería existir en super_admin`);
    if ("centroId" in d) errors.push(`centroId no debería existir en super_admin`);
    if ("conductorId" in d) errors.push(`conductorId no debería existir en super_admin`);
  }

  // 2. Custom claims
  const user = await auth.getUser(uid);
  const claims = user.customClaims || {};
  if (claims.rol !== "super_admin") {
    errors.push(`claim rol esperado super_admin, leído ${claims.rol}`);
  }
  if ("tenantId" in claims) {
    errors.push(`claim tenantId no debería existir en super_admin`);
  }
  if ("centroId" in claims) {
    errors.push(`claim centroId no debería existir en super_admin`);
  }

  if (errors.length > 0) {
    throw new Error(
      "Verificación post-creación fallida:\n  - " + errors.join("\n  - "),
    );
  }
}

function printResult({ uid, email, target, link }) {
  console.log("");
  console.log("super_admin creado correctamente:");
  console.log("");
  console.log(`  uid:    ${uid}`);
  console.log(`  email:  ${email}`);
  console.log(`  target: ${target.toUpperCase()}`);
  console.log("");
  console.log("Link de password reset (compartir con el usuario por canal seguro):");
  console.log(`  ${link}`);
  console.log("");
  console.log(
    "El link caduca en ~1 hora. Si se pierde, generar uno nuevo desde Firebase Console.",
  );
}

// ============================================================================
//  Main
// ============================================================================

async function main() {
  // Parse + help
  let args;
  try {
    args = parseCliArgs();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    printHelp();
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate inputs
  let validated;
  try {
    validated = validateInputs(args);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  // Setup target (capas 1-6 según target)
  let targetSetup;
  try {
    targetSetup = await setupTarget(validated);
  } catch (e) {
    if (e instanceof OperatorAbortError) {
      console.error(`\n${e.message}`);
      process.exit(130);
    }
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  // Dynamic import de firebase-admin (tras setear env vars del emulator)
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

  if (getApps().length === 0) {
    initializeApp({ projectId: targetSetup.projectId });
  }
  const auth = getAuth();
  const db = getFirestore();

  // Idempotencia
  let preCheck;
  try {
    preCheck = await ensureUserDoesNotExist(auth, validated.email);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  if (preCheck.exists && preCheck.isAlreadySuperAdmin) {
    console.log("");
    console.log(
      `Ya existe super_admin con email ${validated.email} (uid: ${preCheck.userRecord.uid}). No-op.`,
    );
    process.exit(0);
  }

  // Creación + verificación post-creación
  let result;
  try {
    result = await createSuperAdmin(
      auth,
      db,
      FieldValue,
      validated.email,
      validated.nombre,
    );
  } catch (e) {
    console.error(`Error durante creación: ${e.message}`);
    process.exit(2);
  }

  try {
    await verifyPostCreation(
      auth,
      db,
      result.uid,
      validated.email,
      validated.nombre,
    );
  } catch (e) {
    console.error(e.message);
    console.error("Ejecutando rollback completo...");
    await rollback(auth, db, result.flags);
    process.exit(3);
  }

  printResult({
    uid: result.uid,
    email: validated.email,
    target: validated.target,
    link: result.link,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error("Error inesperado:", e);
  process.exit(1);
});
