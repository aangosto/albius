// seed-caso-prueba.mjs
//
// Siembra el CASO DE PRUEBA del optimizador (B29 Fase C.4.3) en Firestore:
// tenant + centro + 1 jefe + 5 líneas (con colores, B30) + 38 tipos de turno
// (cada uno con lineaId → su línea) + 60 conductores + convenio + cuadrante
// borrador (septiembre 2026). Escritura DIRECTA con Admin SDK (NO
// callables: el optimizador solo lee tipos_turno/conductores/convenio; crear 60
// Auth users de conductor sería innecesario). Por eso el script respeta A MANO
// todos los invariantes del modelo que los callables normalmente validan.
//
// Hermano de bootstrap-super-admin.mjs (el otro script que puede tocar
// producción): MISMAS guardas de seguridad (target explícito, project_id,
// detección de credenciales, banner + confirmación).
//
// Uso:
//   node scripts/seed-caso-prueba.mjs --target <emulator|production> [--yes]
//
// Más detalles: node scripts/seed-caso-prueba.mjs --help

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

// ============================================================================
//  Constantes del caso de prueba
// ============================================================================

const EXPECTED_PROJECT_ID = "albius-cbdb1";
const DEFAULT_EMULATOR_AUTH_HOST = "127.0.0.1:9099";
const DEFAULT_EMULATOR_FIRESTORE_HOST = "127.0.0.1:8080";

const TENANT_ID = "tenant-prueba-tucarsa";
const CENTRO_ID = "centro-prueba-tucarsa";
const ANIO = 2026;
const MES = 9; // septiembre 2026
const CUADRANTE_ID = `cua_${CENTRO_ID}_${ANIO}_${MES}`;

const JEFE_EMAIL = "jefe.prueba@albius.local";
const JEFE_PASSWORD = "AlbiusPrueba2026!";
const JEFE_NOMBRE = "Jefe Prueba TUCARSA";

const ACTOR = "seed-caso-prueba"; // creadoPor (paralelo a 'bootstrap-cli')

// Convenio (valores validados con el motor por el arquitecto).
const CONVENIO = {
  descansoMinimoEntreJornadasHoras: 12,
  maxHorasSemanales: 37.5,
  computoHoras: "jornada",
  maxDiasConsecutivosTrabajados: 6,
  // Resto de campos requeridos del modelo Convenio (no los usa el optimizador
  // MVP, pero el modelo los exige — valores típicos de convenio del sector).
  maxHorasAnuales: 1800,
  minDomingosLibresAño: 12,
  maxFinesSemanaConsecutivosTrabajados: 2,
  descansoSemanalMinimoHoras: 36,
  antelacionMinimaPublicacionDias: 15,
  horasFestivoComputanComoExtras: true,
};

// Catálogo de turnos por línea/franja (38 en total).
const COUNTS = {
  1: { M: 4, T: 4 },
  2: { M: 4, T: 4 },
  3: { M: 2, T: 2 },
  4: { M: 3, T: 3 },
  5: { M: 6, T: 6 },
};

// Colores de las 5 líneas (HEX, paleta categórica). El cuadrante (B30) agrupa y
// colorea por línea; el lineaId de cada turno apunta a estas líneas.
const LINEA_COLORS = {
  1: "#1F77B4", // azul
  2: "#FF7F0E", // naranja
  3: "#2CA02C", // verde
  4: "#9467BD", // morado
  5: "#D62728", // rojo teja
};

/** doc-id determinista y legible de una línea (B30). Lo referencia el lineaId
 *  de cada tipo de turno → coherencia trivial (mismo patrón que doc-id=codigo). */
function lineaDocId(linea) {
  return `lin_${linea}`;
}

const DUR_MINUTOS = 450; // jornada 7h30
const DUR_EFECTIVA = 420;
const M_BASE = "05:45"; // inicio mañana escalonado
const T_BASE = "13:45"; // inicio tarde escalonado

// ============================================================================
//  CLI parsing (manual, sin deps)
// ============================================================================

function parseCliArgs() {
  const args = { target: undefined, yes: false, help: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--yes" || arg === "-y") args.yes = true;
    else if (arg === "--target") {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        throw new Error("--target requiere un valor (emulator|production).");
      }
      args.target = val;
      i++;
    } else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`seed-caso-prueba.mjs — Siembra el caso de prueba del optimizador.

Uso:
  node scripts/seed-caso-prueba.mjs --target <emulator|production> [--yes]

Args:
  --target    'emulator' (local) o 'production' (Firebase real). REQUERIDO.
  --yes, -y   Salta la confirmación interactiva en --target production.
  --help, -h  Esta ayuda.

Idempotente: limpia su propio ámbito (tenant/centro de prueba y sus datos) antes
de sembrar, así que re-ejecutar no duplica.

Target = production: requiere GOOGLE_APPLICATION_CREDENTIALS (SA JSON) o
'gcloud auth application-default login'. Verifica project_id=${EXPECTED_PROJECT_ID}
y pide confirmación interactiva ('CONFIRMAR') salvo con --yes.

Exit codes: 0 éxito · 1 input/credenciales · 2 error Firebase · 130 abortado.`);
}

class OperatorAbortError extends Error {
  constructor() {
    super("Operación abortada por el operador.");
    this.name = "OperatorAbortError";
  }
}

// ============================================================================
//  Guardas de target (clon de bootstrap-super-admin.mjs)
// ============================================================================

/**
 * Ruta del fichero ADC (Application Default Credentials) de gcloud, según
 * plataforma (B29 C.4.4 — antes estaba hardcodeada a la ruta POSIX y fallaba en
 * Windows, donde el ADC vive en %APPDATA%\gcloud\). Prioridad:
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
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!existsSync(saPath)) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS apunta a ${saPath} pero no existe.`,
      );
    }
    let sa;
    try {
      sa = JSON.parse(readFileSync(saPath, "utf8"));
    } catch (e) {
      throw new Error(`Error leyendo Service Account ${saPath}: ${e.message}`);
    }
    if (!sa.project_id) {
      throw new Error(`Service Account ${saPath} no contiene project_id.`);
    }
    return { source: "service-account", projectId: sa.project_id };
  }
  const adcPath = adcDefaultPath();
  if (!existsSync(adcPath)) return null;
  let result;
  try {
    result = spawnSync("gcloud", ["config", "get-value", "project"], {
      encoding: "utf8",
      timeout: 5000,
      shell: true,
    });
  } catch {
    return null;
  }
  if (result.error || result.status !== 0) return null;
  const projectId = result.stdout.trim();
  if (!projectId || projectId === "(unset)") return null;
  return { source: "gcloud-adc", projectId };
}

async function confirmProductionInteractive() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(
      "Escribe 'CONFIRMAR' para sembrar en PRODUCCIÓN (otra cosa aborta): ",
      (input) => {
        rl.close();
        resolve(input);
      },
    );
  });
  if (answer !== "CONFIRMAR") throw new OperatorAbortError();
}

async function setupTarget(args) {
  if (args.target === "emulator") {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = DEFAULT_EMULATOR_AUTH_HOST;
    }
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_EMULATOR_HOST = DEFAULT_EMULATOR_FIRESTORE_HOST;
    }
    if (!process.env.GCLOUD_PROJECT) {
      process.env.GCLOUD_PROJECT = EXPECTED_PROJECT_ID;
    }
    console.log(
      `[EMULATOR] Auth=${process.env.FIREBASE_AUTH_EMULATOR_HOST} ` +
        `Firestore=${process.env.FIRESTORE_EMULATOR_HOST} ` +
        `Project=${process.env.GCLOUD_PROJECT}`,
    );
    return { projectId: process.env.GCLOUD_PROJECT };
  }

  // production
  const emulatorVars = ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"];
  const set = emulatorVars.filter((v) => process.env[v]);
  if (set.length > 0) {
    throw new Error(
      `Detectadas env vars de emulator con --target=production: ${set.join(", ")}. ` +
        `Unset las variables o usa --target=emulator.`,
    );
  }
  const creds = detectProductionCredentials();
  if (!creds) {
    throw new Error(
      "No se detectaron credenciales para Firebase real. Configura " +
        "GOOGLE_APPLICATION_CREDENTIALS=<sa.json> o ejecuta " +
        "'gcloud auth application-default login'.",
    );
  }
  if (creds.projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      `Las credenciales (${creds.source}) apuntan a '${creds.projectId}', ` +
        `no a '${EXPECTED_PROJECT_ID}'. Aborta para no sembrar en el proyecto equivocado.`,
    );
  }
  console.log("================================================================");
  console.log("  ⚠  TARGET = PRODUCTION");
  console.log(`  ⚠  Project: ${creds.projectId} (source: ${creds.source})`);
  console.log(`  ⚠  Sembrará el caso de prueba (tenant '${TENANT_ID}', centro`);
  console.log(`  ⚠  '${CENTRO_ID}', 38 turnos + 60 conductores) en Firebase REAL.`);
  console.log(`  ⚠  Primero LIMPIA ese ámbito (idempotente).`);
  console.log("================================================================");
  if (args.yes) console.log("--yes: saltando confirmación interactiva.");
  else await confirmProductionInteractive();
  return { projectId: creds.projectId };
}

// ============================================================================
//  Construcción de datos (modelo respetado a mano)
// ============================================================================

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Las 5 líneas de TUCARSA (anonimizado). doc-id = lin_{codigo} (B30). */
function buildLineas(FieldValue) {
  return [1, 2, 3, 4, 5].map((linea) => {
    const id = lineaDocId(linea);
    return {
      id,
      doc: {
        id,
        tenantId: TENANT_ID,
        centroId: CENTRO_ID,
        codigo: String(linea),
        nombre: `Línea ${linea}`,
        tipo: "urbana",
        color: LINEA_COLORS[linea],
        esNocturna: false,
        paradasIda: [], // vacío permitido (el modelo/callable defaultea a [])
        paradasVuelta: [],
        estado: "activa",
        creadoPor: ACTOR,
        creadoEn: FieldValue.serverTimestamp(),
      },
    };
  });
}

/** Catálogo de turnos: {codigo, linea, franja, k}. doc-id = codigo (coherencia). */
function buildCatalogo() {
  const turnos = [];
  for (const linea of [1, 2, 3, 4, 5]) {
    for (const franja of ["M", "T"]) {
      const n = COUNTS[linea][franja];
      for (let k = 1; k <= n; k++) {
        turnos.push({ codigo: `${linea}${franja}${k}`, linea, franja, k });
      }
    }
  }
  return turnos;
}

/** Doc TipoTurno (id = codigo). Primer turno de cada línea/franja cubre fin de semana. */
function buildTipos(catalogo, FieldValue) {
  return catalogo.map((t) => {
    const base = t.franja === "M" ? M_BASE : T_BASE;
    const horaInicio = addMinutes(base, ((t.k - 1) % 4) * 15);
    const horaFin = addMinutes(horaInicio, DUR_MINUTOS);
    const esPrimero = t.k === 1; // 1M1,1T1,2M1,... cubren laborable+sabado+domingo
    return {
      id: t.codigo,
      doc: {
        id: t.codigo,
        tenantId: TENANT_ID,
        centroId: CENTRO_ID,
        codigo: t.codigo,
        nombre: `Línea ${t.linea} ${t.franja === "M" ? "Mañana" : "Tarde"} ${t.k}`,
        lineaId: lineaDocId(t.linea), // B30: enlace estructurado turno→línea
        horaInicio,
        horaFin,
        duracionMinutos: DUR_MINUTOS,
        duracionEfectivaMinutos: DUR_EFECTIVA,
        esPartido: false,
        esNocturno: false,
        estado: "activo",
        tiposDiaAplicables: esPrimero
          ? ["laborable", "sabado", "domingo"]
          : ["laborable"],
        creadoPor: ACTOR,
        creadoEn: FieldValue.serverTimestamp(),
      },
    };
  });
}

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
function dniFor(n) {
  const num = 10000000 + n;
  return `${num}${DNI_LETTERS[num % 23]}`;
}

/**
 * 60 conductores. Habilitación: cada conductor recibe TODOS los turnos de su
 * línea base (i%5) + los de su franja preferida (par→M, impar→T) de la línea
 * adyacente. Versatilidad media ~11 turnos/conductor; cada turno queda habilitado
 * por ~18 conductores (los 12 de su línea base + ~6 de la adyacente). Holgura muy
 * por encima del mínimo ≥4 exigido.
 */
function buildConductores(catalogo, FieldValue, Timestamp) {
  const porLineaFranja = (linea, franja) =>
    catalogo.filter((t) => t.linea === linea && t.franja === franja).map((t) => t.codigo);
  const porLinea = (linea) =>
    catalogo.filter((t) => t.linea === linea).map((t) => t.codigo);

  const conductores = [];
  for (let i = 1; i <= 60; i++) {
    const idx = i - 1;
    const baseLinea = (idx % 5) + 1;
    const franjaPref = idx % 2 === 0 ? "M" : "T";
    const adjLinea = (baseLinea % 5) + 1;
    const permitidos = [
      ...porLinea(baseLinea),
      ...porLineaFranja(adjLinea, franjaPref),
    ];
    const numeroEmpleado = String(i).padStart(2, "0");
    const id = `${TENANT_ID}_${numeroEmpleado}`;
    conductores.push({
      id,
      doc: {
        id,
        tenantId: TENANT_ID,
        centroId: CENTRO_ID,
        numeroEmpleado,
        nombre: `Conductor ${numeroEmpleado}`,
        apellidos: `Prueba ${numeroEmpleado}`,
        dni: dniFor(i),
        categoria: "conductor",
        fechaAntiguedad: Timestamp.fromDate(new Date(Date.UTC(2018, 0, 1))),
        fechaIncorporacion: Timestamp.fromDate(new Date(Date.UTC(2018, 1, 1))),
        estado: "activo",
        lineasPreferentes: [],
        lineasSecundarias: [],
        tiposTurnoPermitidos: permitidos,
        tiposTurnoExcluidos: [],
        puedeSerReserva: i % 5 === 0,
        creadoPor: ACTOR,
        creadoEn: FieldValue.serverTimestamp(),
      },
    });
  }
  return conductores;
}

/** ASSERT de coherencia de IDs + estadísticas de cobertura/versatilidad. */
function checkCoherencia(tipos, conductores, lineas) {
  // B30: cada lineaId de cada tipo de turno DEBE resolver a una línea sembrada
  // (paralelo al assert conductores↔turnos de abajo). Si algún turno apunta a
  // una línea inexistente, abortamos antes de escribir nada.
  const idsLineas = new Set(lineas.map((l) => l.id));
  for (const t of tipos) {
    const lid = t.doc.lineaId;
    if (lid !== undefined && !idsLineas.has(lid)) {
      throw new Error(
        `COHERENCIA ROTA: tipo de turno ${t.id} referencia línea '${lid}' que no existe en las líneas sembradas.`,
      );
    }
  }

  const idsTipos = new Set(tipos.map((t) => t.id));
  const cobertura = new Map([...idsTipos].map((id) => [id, 0]));
  let minVers = Infinity;
  let maxVers = 0;
  let sumVers = 0;
  for (const c of conductores) {
    const perm = c.doc.tiposTurnoPermitidos;
    for (const code of perm) {
      if (!idsTipos.has(code)) {
        throw new Error(
          `COHERENCIA ROTA: conductor ${c.id} referencia tipo '${code}' que no existe en los tipos sembrados.`,
        );
      }
      cobertura.set(code, cobertura.get(code) + 1);
    }
    minVers = Math.min(minVers, perm.length);
    maxVers = Math.max(maxVers, perm.length);
    sumVers += perm.length;
  }
  const cobs = [...cobertura.values()];
  const minCob = Math.min(...cobs);
  const sinCobertura = [...cobertura.entries()].filter(([, n]) => n < 4);
  if (sinCobertura.length > 0) {
    throw new Error(
      `COBERTURA INSUFICIENTE (<4 conductores) en: ${sinCobertura.map(([id]) => id).join(", ")}`,
    );
  }
  return {
    minCobertura: minCob,
    maxCobertura: Math.max(...cobs),
    avgCobertura: (cobs.reduce((a, b) => a + b, 0) / cobs.length).toFixed(1),
    minVersatilidad: minVers,
    maxVersatilidad: maxVers,
    avgVersatilidad: (sumVers / conductores.length).toFixed(1),
  };
}

// ============================================================================
//  Limpieza idempotente del ámbito del seed
// ============================================================================

async function commitInChunks(db, ops) {
  for (let i = 0; i < ops.length; i += 500) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 500)) op(batch);
    await batch.commit();
  }
}

async function limpiarAmbito(db, auth) {
  // Auth: jefe de prueba (si existe).
  try {
    const u = await auth.getUserByEmail(JEFE_EMAIL);
    await auth.deleteUser(u.uid);
    await db.collection("usuarios").doc(u.uid).delete().catch(() => {});
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
  // Firestore: docs por colección dentro del centro/tenant de prueba.
  const dels = [];
  for (const col of ["tipos_turno", "conductores", "lineas"]) {
    const snap = await db.collection(col).where("centroId", "==", CENTRO_ID).get();
    for (const d of snap.docs) dels.push((b) => b.delete(d.ref));
  }
  dels.push((b) => b.delete(db.collection("convenio").doc(CENTRO_ID)));
  dels.push((b) => b.delete(db.collection("cuadrantes").doc(CUADRANTE_ID)));
  dels.push((b) => b.delete(db.collection("centros").doc(CENTRO_ID)));
  dels.push((b) => b.delete(db.collection("tenants").doc(TENANT_ID)));
  await commitInChunks(db, dels);
}

// ============================================================================
//  Siembra
// ============================================================================

async function sembrar(db, auth, FieldValue, Timestamp) {
  const lineas = buildLineas(FieldValue);
  const catalogo = buildCatalogo();
  const tipos = buildTipos(catalogo, FieldValue);
  const conductores = buildConductores(catalogo, FieldValue, Timestamp);
  const stats = checkCoherencia(tipos, conductores, lineas);

  // Tenant.
  const tenantDoc = {
    id: TENANT_ID,
    nombre: "PRUEBA TUCARSA (líneas 1-5)",
    cif: "B00000000",
    comunidadAutonoma: "Murcia",
    provincia: "Murcia",
    plan: "basico",
    estado: "activo",
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion: { zonaHoraria: "Europe/Madrid", idioma: "es" },
    creadoPor: ACTOR,
    creadoEn: FieldValue.serverTimestamp(),
  };
  // Centro.
  const centroDoc = {
    id: CENTRO_ID,
    tenantId: TENANT_ID,
    nombre: "Centro Prueba Cartagena",
    ciudad: "Cartagena",
    provincia: "Murcia",
    estado: "activo",
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: ACTOR,
    creadoEn: FieldValue.serverTimestamp(),
  };
  // Jefe (Auth + claims + /usuarios). passwordChangeRequired=false → login directo.
  const jefe = await auth.createUser({
    email: JEFE_EMAIL,
    password: JEFE_PASSWORD,
    displayName: JEFE_NOMBRE,
  });
  await auth.setCustomUserClaims(jefe.uid, {
    rol: "jefe_trafico",
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
  });
  const usuarioDoc = {
    id: jefe.uid,
    email: JEFE_EMAIL,
    nombreCompleto: JEFE_NOMBRE,
    rol: "jefe_trafico",
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    estado: "activo",
    passwordChangeRequired: false,
    fechaCreacion: FieldValue.serverTimestamp(),
    creadoPor: ACTOR,
    creadoEn: FieldValue.serverTimestamp(),
  };
  // Convenio (id = centroId, singleton D6.9).
  const convenioDoc = {
    id: CENTRO_ID,
    centroId: CENTRO_ID,
    tenantId: TENANT_ID,
    ...CONVENIO,
    creadoPor: ACTOR,
    creadoEn: FieldValue.serverTimestamp(),
  };
  // Cuadrante borrador (la "mesa" donde el optimizador volcará).
  const cuadranteDoc = {
    id: CUADRANTE_ID,
    tenantId: TENANT_ID,
    centroId: CENTRO_ID,
    año: ANIO,
    mes: MES,
    estado: "borrador",
    versionActual: 1,
    fechaGeneracion: FieldValue.serverTimestamp(),
    generadoPor: ACTOR,
    modoGeneracion: "manual",
    estadoGeneracion: "idle",
    creadoPor: ACTOR,
    creadoEn: FieldValue.serverTimestamp(),
  };

  const ops = [
    (b) => b.set(db.collection("tenants").doc(TENANT_ID), tenantDoc),
    (b) => b.set(db.collection("centros").doc(CENTRO_ID), centroDoc),
    (b) => b.set(db.collection("usuarios").doc(jefe.uid), usuarioDoc),
    (b) => b.set(db.collection("convenio").doc(CENTRO_ID), convenioDoc),
    (b) => b.set(db.collection("cuadrantes").doc(CUADRANTE_ID), cuadranteDoc),
    ...lineas.map((l) => (b) => b.set(db.collection("lineas").doc(l.id), l.doc)),
    ...tipos.map((t) => (b) => b.set(db.collection("tipos_turno").doc(t.id), t.doc)),
    ...conductores.map(
      (c) => (b) => b.set(db.collection("conductores").doc(c.id), c.doc),
    ),
  ];
  await commitInChunks(db, ops);

  return {
    jefeUid: jefe.uid,
    nLineas: lineas.length,
    nTipos: tipos.length,
    nConductores: conductores.length,
    stats,
  };
}

function printResumen(target, r) {
  console.log("\n================ SEED COMPLETADO ================\n");
  console.log(`  target:        ${target.toUpperCase()}`);
  console.log(`  tenant:        ${TENANT_ID}  ("PRUEBA TUCARSA (líneas 1-5)")`);
  console.log(`  centro:        ${CENTRO_ID}  ("Centro Prueba Cartagena")`);
  console.log(`  líneas:        ${r.nLineas} (con colores: lin_1..lin_5)`);
  console.log(`  tipos turno:   ${r.nTipos}  (todos con lineaId → su línea)`);
  console.log(`  conductores:   ${r.nConductores}`);
  console.log(`  convenio:      sí (singleton id=${CENTRO_ID})`);
  console.log(`  cuadrante:     ${CUADRANTE_ID}  (borrador, estadoGeneracion=idle)`);
  console.log(`  festivos:      ninguno (septiembre 2026 no tiene festivo nacional)`);
  console.log("\n  --- Credenciales del JEFE (login para pulsar Generar) ---");
  console.log(`  email:         ${JEFE_EMAIL}`);
  console.log(`  password:      ${JEFE_PASSWORD}`);
  console.log(`  uid:           ${r.jefeUid}`);
  console.log("\n  --- Coherencia / cobertura (assert OK) ---");
  console.log(
    `  cobertura por turno: min=${r.stats.minCobertura} max=${r.stats.maxCobertura} avg=${r.stats.avgCobertura} (mínimo exigido ≥4)`,
  );
  console.log(
    `  versatilidad/conductor: min=${r.stats.minVersatilidad} max=${r.stats.maxVersatilidad} avg=${r.stats.avgVersatilidad}`,
  );
  console.log("\n  Login en la web → Cuadrante → mes 09/2026 → 'Generar con optimizador'.");
  console.log("================================================\n");
}

// ============================================================================
//  Main
// ============================================================================

async function main() {
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
  if (args.target !== "emulator" && args.target !== "production") {
    console.error(
      "Error: --target emulator|production es REQUERIDO (sin default por seguridad).",
    );
    process.exit(1);
  }

  try {
    await setupTarget(args);
  } catch (e) {
    if (e instanceof OperatorAbortError) {
      console.error(`\n${e.message}`);
      process.exit(130);
    }
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore, FieldValue, Timestamp } = await import(
    "firebase-admin/firestore"
  );
  if (getApps().length === 0) initializeApp({ projectId: EXPECTED_PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  let result;
  try {
    console.log("\nLimpiando ámbito del seed (idempotente)…");
    await limpiarAmbito(db, auth);
    console.log("Sembrando…");
    result = await sembrar(db, auth, FieldValue, Timestamp);
  } catch (e) {
    console.error(`\nError durante la siembra: ${e.message}`);
    process.exit(2);
  }

  printResumen(args.target, result);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error inesperado:", e);
  process.exit(1);
});
