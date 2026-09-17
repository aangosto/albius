// inspect-produccion.mjs
//
// Inspección READ-ONLY del estado de producción (B31.1 saneamiento). Responde:
//   b) ¿Hay asignaciones huérfanas? Cuenta asignaciones del cuadrante de prueba y
//      muestra estado / estadoGeneracion / estadisticas del doc del cuadrante.
//   c) ¿Cuántos docs hay en cada colección del centro de prueba?
//
// NO ESCRIBE NADA: solo `get()` y agregaciones `count()`. No toca Auth. Reutiliza
// las guardas de target de seed-caso-prueba.mjs (project_id === albius-cbdb1,
// detección ADC multiplataforma) pero SIN confirmación interactiva porque no hay
// nada que confirmar (lectura).
//
// Uso:
//   node scripts/inspect-produccion.mjs --target <emulator|production>
//
// Requiere ADC (`gcloud auth application-default login`) o
// GOOGLE_APPLICATION_CREDENTIALS. Exit codes: 0 ok · 1 input/credenciales · 2 Firebase.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const EXPECTED_PROJECT_ID = "albius-cbdb1";
const DEFAULT_EMULATOR_FIRESTORE_HOST = "127.0.0.1:8080";

// Mismas constantes que seed-caso-prueba.mjs (ámbito de prueba).
const TENANT_ID = "tenant-prueba-tucarsa";
const CENTRO_ID = "centro-prueba-tucarsa";
const ANIO = 2026;
const MES = 9;
const CUADRANTE_ID = `cua_${CENTRO_ID}_${ANIO}_${MES}`;

// Colecciones con centroId (se cuentan por centro) y con tenantId (por tenant).
const COLS_POR_CENTRO = [
  "lineas",
  "tipos_turno",
  "conductores",
  "frecuencias",
  "frecuencias_excepcionales",
  "cuadrantes",
  "asignaciones",
];
const COLS_POR_TENANT = ["usuarios", "festivos", "notificaciones"];

// ============================================================================
//  CLI + guardas (clon reducido de seed-caso-prueba.mjs)
// ============================================================================

function parseCliArgs() {
  const args = { target: undefined };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--target") {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        throw new Error("--target requiere un valor (emulator|production).");
      }
      args.target = val;
      i++;
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (args.target !== "emulator" && args.target !== "production") {
    throw new Error("Uso: node scripts/inspect-produccion.mjs --target <emulator|production>");
  }
  return args;
}

function adcDefaultPath() {
  if (process.env.CLOUDSDK_CONFIG) {
    return join(process.env.CLOUDSDK_CONFIG, "application_default_credentials.json");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "gcloud", "application_default_credentials.json");
  }
  return join(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function detectProductionCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!existsSync(saPath)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS apunta a ${saPath} pero no existe.`);
    }
    const sa = JSON.parse(readFileSync(saPath, "utf8"));
    if (!sa.project_id) throw new Error(`Service Account ${saPath} no contiene project_id.`);
    return { source: "service-account", projectId: sa.project_id };
  }
  if (!existsSync(adcDefaultPath())) return null;
  const result = spawnSync("gcloud", ["config", "get-value", "project"], {
    encoding: "utf8",
    timeout: 5000,
    shell: true,
  });
  if (result.error || result.status !== 0) return null;
  const projectId = result.stdout.trim();
  if (!projectId || projectId === "(unset)") return null;
  return { source: "gcloud-adc", projectId };
}

function setupTarget(args) {
  if (args.target === "emulator") {
    process.env.FIRESTORE_EMULATOR_HOST ??= DEFAULT_EMULATOR_FIRESTORE_HOST;
    process.env.GCLOUD_PROJECT ??= EXPECTED_PROJECT_ID;
    console.log(`[EMULATOR] Firestore=${process.env.FIRESTORE_EMULATOR_HOST}`);
    return;
  }
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Detectadas env vars de emulator con --target=production. Unset o usa --target=emulator.",
    );
  }
  const creds = detectProductionCredentials();
  if (!creds) {
    throw new Error(
      "No se detectaron credenciales. Configura GOOGLE_APPLICATION_CREDENTIALS o ejecuta " +
        "'gcloud auth application-default login'.",
    );
  }
  if (creds.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Las credenciales (${creds.source}) apuntan a '${creds.projectId}', no a '${EXPECTED_PROJECT_ID}'.`,
    );
  }
  console.log(`[PRODUCTION · READ-ONLY] project=${creds.projectId} (source: ${creds.source})`);
}

// ============================================================================
//  Inspección
// ============================================================================

async function countWhere(db, col, field, value) {
  const agg = await db.collection(col).where(field, "==", value).count().get();
  return agg.data().count;
}

function fmtTs(v) {
  return v && typeof v.toDate === "function" ? v.toDate().toISOString() : String(v ?? "—");
}

async function inspeccionar(db) {
  console.log("\n=== (c) Docs por colección del ámbito de prueba ===");
  console.log(`tenant=${TENANT_ID}  centro=${CENTRO_ID}`);
  const tenantDoc = await db.collection("tenants").doc(TENANT_ID).get();
  const centroDoc = await db.collection("centros").doc(CENTRO_ID).get();
  const convenioDoc = await db.collection("convenio").doc(CENTRO_ID).get();
  console.log(`  tenants/${TENANT_ID}: ${tenantDoc.exists ? "existe" : "NO EXISTE"}`);
  console.log(`  centros/${CENTRO_ID}: ${centroDoc.exists ? "existe" : "NO EXISTE"}`);
  console.log(`  convenio/${CENTRO_ID}: ${convenioDoc.exists ? "existe" : "NO EXISTE"}`);
  for (const col of COLS_POR_CENTRO) {
    const n = await countWhere(db, col, "centroId", CENTRO_ID);
    console.log(`  ${col.padEnd(26)} (centroId): ${n}`);
  }
  for (const col of COLS_POR_TENANT) {
    const n = await countWhere(db, col, "tenantId", TENANT_ID);
    console.log(`  ${col.padEnd(26)} (tenantId): ${n}`);
  }

  console.log("\n=== Cuadrantes del centro ===");
  const cuas = await db.collection("cuadrantes").where("centroId", "==", CENTRO_ID).get();
  if (cuas.empty) console.log("  (ninguno)");
  for (const d of cuas.docs) {
    const x = d.data();
    const nAsig = await countWhere(db, "asignaciones", "cuadranteId", d.id);
    console.log(
      `  ${d.id}: estado=${x.estado} estadoGeneracion=${x.estadoGeneracion ?? "(ausente≡idle)"} ` +
        `modo=${x.modoGeneracion} generadoPor=${x.generadoPor} ` +
        `fechaGeneracion=${fmtTs(x.fechaGeneracion)} asignaciones=${nAsig}` +
        (x.estadisticas ? ` cobertura=${x.estadisticas.coberturaServicios}%` : "") +
        (x.errorGeneracion ? ` ERROR="${x.errorGeneracion}"` : ""),
    );
  }

  console.log(`\n=== (b) Diagnóstico de huérfanas: ${CUADRANTE_ID} ===`);
  const cua = await db.collection("cuadrantes").doc(CUADRANTE_ID).get();
  const nAsig = await countWhere(db, "asignaciones", "cuadranteId", CUADRANTE_ID);
  if (!cua.exists) {
    console.log(`  El doc del cuadrante NO existe; asignaciones con ese cuadranteId: ${nAsig}`);
    if (nAsig > 0) console.log("  → HUÉRFANAS (cuadrante inexistente).");
    return;
  }
  const gen = cua.data().estadoGeneracion ?? "idle";
  console.log(`  estado=${cua.data().estado}  estadoGeneracion=${gen}  asignaciones=${nAsig}`);
  if (nAsig > 0 && gen !== "completado") {
    console.log(
      "  → HUÉRFANAS: hay asignaciones bajo un cuadrante que no está 'completado' " +
        "(el seed de B30.2 recreó el doc en idle sin borrar la colección).",
    );
  } else if (nAsig === 0 && gen === "completado") {
    console.log("  → INCOHERENTE: cuadrante 'completado' sin asignaciones.");
  } else if (nAsig > 0) {
    // Muestra de coherencia: ¿las asignaciones apuntan a conductores/turnos existentes?
    const muestra = await db
      .collection("asignaciones")
      .where("cuadranteId", "==", CUADRANTE_ID)
      .limit(5)
      .get();
    let rotas = 0;
    for (const a of muestra.docs) {
      const { conductorId, tipoTurnoId, creadoPor, creadoEn } = a.data();
      const c = await db.collection("conductores").doc(conductorId).get();
      const t = tipoTurnoId ? await db.collection("tipos_turno").doc(tipoTurnoId).get() : null;
      const ok = c.exists && (!t || t.exists);
      if (!ok) rotas++;
      console.log(
        `    muestra ${a.id}: conductor=${conductorId}(${c.exists ? "ok" : "FALTA"}) ` +
          `turno=${tipoTurnoId}(${t ? (t.exists ? "ok" : "FALTA") : "—"}) ` +
          `creadoPor=${creadoPor} creadoEn=${fmtTs(creadoEn)}`,
      );
    }
    console.log(
      rotas === 0
        ? "  → COHERENTE: cuadrante completado y las referencias de la muestra resuelven."
        : `  → ${rotas}/${muestra.size} referencias rotas en la muestra.`,
    );
  } else {
    console.log("  → LIMPIO: cuadrante sin generar y sin asignaciones.");
  }
}

// ============================================================================
//  main
// ============================================================================

async function main() {
  let args;
  try {
    args = parseCliArgs();
    setupTarget(args);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  try {
    const { initializeApp, getApps } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    if (getApps().length === 0) initializeApp({ projectId: EXPECTED_PROJECT_ID });
    await inspeccionar(getFirestore());
  } catch (e) {
    console.error(`Error Firebase: ${e.message}`);
    process.exit(2);
  }
}

main();
