// seed-test-user.mjs
//
// Crea un super_admin de testing con password directo en el Auth emulator.
// Atajo de testing para Bloque 5 (login funcional): evita seguir el flujo
// real de generatePasswordResetLink del bootstrap CLI cuando solo queremos
// un usuario operable para probar signInWithEmailAndPassword desde el frontend.
//
// EMULATOR ONLY: las env vars de emulator se hardcodean al inicio del script
// para impedir uso accidental contra Firebase real. Producción usa siempre
// el bootstrap CLI con linkPasswordReset (D3).
//
// TODO[verify-full-password-reset-flow]: si en una sesión futura queremos
// verificar el flujo COMPLETO del password reset link (Bloque 5 Opción 1),
// se hace con el bootstrap CLI + seguir el link en el navegador.
//
// Uso:
//   node apps/functions/scripts/seed-test-user.mjs [--email <email>] [--password <pwd>] [--nombre <"nombre">]

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "albius-cbdb1";

const { initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");

// ============================================================================
//  CLI args (sin deps)
// ============================================================================

function parseArgs() {
  const args = { email: undefined, password: undefined, nombre: undefined };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(
        `seed-test-user.mjs — Crea un super_admin de testing en el Auth emulator.\n\n` +
          `EMULATOR ONLY. No usar contra Firebase real.\n\n` +
          `Uso:\n  node apps/functions/scripts/seed-test-user.mjs [--email <email>] [--password <pwd>] [--nombre <"nombre">]\n\n` +
          `Defaults:\n  --email     admin@albius.local\n  --password  admin123\n  --nombre    Super Admin Test\n`,
      );
      process.exit(0);
    } else if (a === "--email") {
      args.email = argv[++i];
    } else if (a === "--password") {
      args.password = argv[++i];
    } else if (a === "--nombre") {
      args.nombre = argv[++i];
    } else {
      console.error(`Argumento desconocido: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const args = parseArgs();
const email = args.email || "admin@albius.local";
const password = args.password || "admin123";
const nombre = args.nombre || "Super Admin Test";

console.log("");
console.log("================================================================");
console.log("  [SEED-TEST-USER] Emulator only. NO usar contra Firebase real.");
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`  nombre:   ${nombre}`);
console.log(`  rol:      super_admin`);
console.log("================================================================");
console.log("");

// ============================================================================
//  Init Admin SDK
// ============================================================================

if (getApps().length === 0) {
  initializeApp({ projectId: "albius-cbdb1" });
}
const auth = getAuth();
const db = getFirestore();

// ============================================================================
//  Idempotencia: borrar previo si existe
// ============================================================================

try {
  const prev = await auth.getUserByEmail(email);
  console.log(`Eliminando usuario previo (uid=${prev.uid})...`);
  await auth.deleteUser(prev.uid);
  await db.collection("usuarios").doc(prev.uid).delete().catch(() => {});
} catch (e) {
  if (e.code !== "auth/user-not-found") throw e;
}

// ============================================================================
//  Crear Auth user con password directo + claims + doc /usuarios
// ============================================================================

const userRecord = await auth.createUser({
  email,
  password,
  displayName: nombre,
});
await auth.setCustomUserClaims(userRecord.uid, { rol: "super_admin" });

await db.collection("usuarios").doc(userRecord.uid).set({
  id: userRecord.uid,
  email,
  nombreCompleto: nombre,
  rol: "super_admin",
  estado: "activo",
  // Atajo de testing: el password se setea directamente, no requiere reset previo.
  // En producción (bootstrap CLI), passwordChangeRequired=true porque el usuario
  // recibe un link de reset y debe configurar su password.
  passwordChangeRequired: false,
  fechaCreacion: FieldValue.serverTimestamp(),
  creadoPor: "seed-test-user", // distingue de "bootstrap-cli" (CLI) y uid real (callables)
  creadoEn: FieldValue.serverTimestamp(),
});

console.log("Seed OK:");
console.log(`  uid:      ${userRecord.uid}`);
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log(`  rol:      super_admin`);
console.log("");
console.log("Para iniciar sesión desde apps/web con VITE_USE_EMULATORS=true:");
console.log(`  email:    ${email}`);
console.log(`  password: ${password}`);
console.log("");

process.exit(0);
