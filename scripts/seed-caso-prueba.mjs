// seed-caso-prueba.mjs
//
// Siembra el CASO DE PRUEBA del optimizador (B29 Fase C.4.3) en Firestore:
// tenant + centro + 1 jefe + 5 líneas (con colores, B30) + 38 tipos de turno
// (cada uno con lineaId → su línea) + 60 conductores + ausencias (B32.3: ~17%
// ausentes el mes completo + permisos de un día, perfil real TUCARSA) + convenio
// + cuadrante borrador (septiembre 2026). Escritura DIRECTA con Admin SDK (NO
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
import { randomBytes } from "node:crypto";

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

// B34.1 — 3 conductores CON cuenta Auth (Mi horario). Perfil útil para la
// demo: 05 turnos variados sin ausencias; 11 con una semana de vacaciones
// (ausencia PARCIAL nueva, sigue en el pool); 53 con dos permisos sueltos.
// Contraseñas: NO en el repo — se generan por ejecución (o SEED_CONDUCTOR_PASSWORD
// fija una para las 3) y se imprimen en el resumen. TODO[credenciales-seed-en-git]
// sigue pendiente para el jefe.
const CONDUCTORES_CON_CUENTA = [
  { numeroEmpleado: "05", perfil: "turnos variados, sin ausencias" },
  { numeroEmpleado: "11", perfil: "vacaciones 14-20/09 (ausencia parcial)" },
  { numeroEmpleado: "53", perfil: "dos permisos sueltos (04/09 AP, 25/09 PS)" },
];
const conductorEmail = (n) => `conductor${n}.prueba@albius.local`;
function generarPassword() {
  const fija = process.env.SEED_CONDUCTOR_PASSWORD;
  if (fija && fija.length >= 10) return fija;
  // 12 chars base64url + sufijo para cumplir la política mínima (10+).
  return `${randomBytes(9).toString("base64url")}Ab1!`;
}

const ACTOR = "seed-caso-prueba"; // creadoPor (paralelo a 'bootstrap-cli')

// B36.4 — Nombres y apellidos castellanos PLAUSIBLES E INVENTADOS para los 60
// conductores (índice = nº de empleado - 1). Antes eran "Conductor NN, Prueba
// NN": redundante y sin longitud real, con lo que la columna del nombre de las
// exportaciones nunca se tensaba. NUNCA usar los nombres reales de los PDFs de
// TUCARSA. Hay compuestos largos a propósito (03, 17, 29, 41, 52) para probar
// el truncado de la columna Conductor en el PDF mensual.
const NOMBRES_CONDUCTORES = [
  ["Antonio", "García López"],
  ["Manuel", "Martínez Ruiz"],
  ["María del Carmen", "Rodríguez de la Fuente"],
  ["José", "Sánchez Pérez"],
  ["Francisco", "Gómez Martín"],
  ["Juan Carlos", "Jiménez Hernández"],
  ["Ana", "Díaz Moreno"],
  ["Pedro", "Álvarez Muñoz"],
  ["Carmen", "Romero Alonso"],
  ["Luis", "Gutiérrez Navarro"],
  ["Javier", "Torres Domínguez"],
  ["Isabel", "Vázquez Ramos"],
  ["Miguel Ángel", "Gil Serrano"],
  ["Rafael", "Blanco Molina"],
  ["Dolores", "Castro Ortega"],
  ["Ángel", "Delgado Rubio"],
  ["Francisco Javier", "Fernández-Ballesteros Iglesias"],
  ["Rosa", "Marín Sanz"],
  ["Alberto", "Núñez Medina"],
  ["Pilar", "Garrido Cortés"],
  ["Sergio", "Iglesias Castillo"],
  ["Cristina", "Lozano Guerrero"],
  ["Fernando", "Cano Prieto"],
  ["Lucía", "Méndez Calvo"],
  ["Andrés", "Vega Herrera"],
  ["Beatriz", "Peña León"],
  ["Jorge", "Flores Cabrera"],
  ["Marta", "Campos Vidal"],
  ["Osvaldo Manuel", "Rodríguez Sánchez de Toledo"],
  ["Raúl", "Reyes Fuentes"],
  ["Elena", "Carrasco Pascual"],
  ["Daniel", "Aguilar Santos"],
  ["Silvia", "Cruz Montero"],
  ["Óscar", "Ortiz Lorenzo"],
  ["Nuria", "Rubio Soler"],
  ["Ignacio", "Ferrer Bravo"],
  ["Sonia", "Esteban Crespo"],
  ["Roberto", "Vicente Mora"],
  ["Inmaculada", "Pastor Sáez"],
  ["Emilio", "Benítez Arias"],
  ["María de los Ángeles", "Villanueva Carmona"],
  ["Alejandro", "Nieto Lara"],
  ["Teresa", "Caballero Rey"],
  ["Víctor", "Ibáñez Otero"],
  ["Mercedes", "Vargas Galán"],
  ["Rubén", "Redondo Pardo"],
  ["Yolanda", "Marcos Bermúdez"],
  ["Tomás", "Soto Roldán"],
  ["Esther", "Parra Escudero"],
  ["Enrique", "Sáenz Camacho"],
  ["Verónica", "Lara Segura"],
  ["Juan Francisco", "Hernández de la Cruz Quintana"],
  ["Gloria", "Robles Ponce"],
  ["Adrián", "Salas Barrios"],
  ["Eva", "Trujillo Casado"],
  ["Ramón", "Ríos Gallardo"],
  ["Lorena", "Mateo Peláez"],
  ["Julián", "Naranjo Valero"],
  ["Patricia", "Ruiz Lorente"],
  ["Gonzalo", "Herrero Zamora"],
];

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

/** Índices (0-based) de los 10 conductores ausentes el MES COMPLETO. Constante
 *  COMPARTIDA: `buildAusencias` los materializa como ausencias y
 *  `generarHabilitacion` los excluye al medir la cobertura por turno (B32.3:
 *  buildRequest los saca del pool). Si divergen, el seed sembraría un caso que
 *  parece cubrible y no lo es. */
const AUSENTES_TOTALES_IDX = [0, 6, 12, 18, 24, 31, 37, 43, 49, 55];

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
function dniFor(n) {
  const num = 10000000 + n;
  return `${num}${DNI_LETTERS[num % 23]}`;
}

/**
 * Habilitación REALISTA (B37.1a). Antes cada conductor recibía TODOS los turnos
 * de su línea base + una franja de la adyacente: ~2/3 de sus plazas candidatas
 * eran ya de su línea POR DISEÑO. Eso daba una expectativa de indiferencia del
 * 65,8% (si el motor asignara al azar entre lo que el conductor puede hacer, ya
 * saldría un 65,8% "en su línea"), cuando en los datos reales de TUCARSA es del
 * 24,9% (Sample20: 20 conductores reales, 19,1 códigos de media) o del 39,5%
 * (Sample178, calibrado a la versatilidad real). El banco de pruebas mentía en
 * toda medición que dependiera de la habilitación — costó una puerta de decisión
 * en B37.1, donde la línea base de preferencia salió 61,6% y no significaba nada.
 *
 * Forma nueva (referencia: SPEC §1.3 del spike + Sample20.json como FORMA, no
 * como valores): versatilidad triangular(1, 24, moda 8) → media ~11 tipos, con
 * cola larga por los dos lados; sesgo suave del 35% hacia una "línea de casa"
 * (rotada, para que las 5 líneas estén representadas) y el resto repartido por
 * todo el catálogo. Resultado medido: versatilidad 4..22 (media 11,5), cobertura
 * por turno 12..21 (media 14,8), expectativa de indiferencia 19,7%.
 *
 * DETERMINISTA: PRNG propio con semilla fija (el seed tiene que ser reproducible
 * — un seed aleatorio haría inestables verifies, E2E y mediciones).
 */
const HABIL_SEMILLA = 20260901;
const HABIL_VERS_MIN = 1;
const HABIL_VERS_MAX = 24;
const HABIL_VERS_MODA = 8;
/** Fracción de la habilitación que sale de la "línea de casa" del conductor. */
const HABIL_SESGO_LINEA = 0.35;
/** Piso de conductores DISPONIBLES habilitados por turno (invariante de
 *  resolubilidad: con 12 el caso sigue cerrando al 100% de cobertura). */
const HABIL_COBERTURA_MIN = 12;

/** PRNG determinista (mulberry32): mismo seed → mismos datos, siempre. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distribución triangular (SPEC §1.3: versatilidad 1-24, moda 8). */
function triangular(rnd, min, max, moda) {
  const u = rnd();
  const c = (moda - min) / (max - min);
  return u < c
    ? min + Math.sqrt(u * (max - min) * (moda - min))
    : max - Math.sqrt((1 - u) * (max - min) * (max - moda));
}

/**
 * Genera la habilitación y la línea preferente de los 60 conductores.
 * Devuelve [{ permitidos, lineaPreferente }] indexado por idx (0..59).
 *
 * La LÍNEA PREFERENTE se siembra a propósito DISTINTA de la línea modal de la
 * habilitación: si el conductor prefiriera siempre la línea en la que más puede
 * trabajar, cualquier medición de "preferencias cumplidas" volvería a estar
 * sesgada al alza por construcción, que es justo el defecto que este cambio
 * corrige. Es un sesgo CONSERVADOR (la línea base medida queda por debajo de la
 * expectativa real), preferible a uno optimista en un banco de pruebas.
 */
function generarHabilitacion(catalogo, nConductores, idsAusentesTotalesIdx) {
  const rnd = mulberry32(HABIL_SEMILLA);
  const lineas = [...new Set(catalogo.map((t) => t.linea))].sort((a, b) => a - b);
  const todos = catalogo.map((t) => t.codigo);
  const lineaDe = Object.fromEntries(catalogo.map((t) => [t.codigo, t.linea]));
  const porLinea = (l) => catalogo.filter((t) => t.linea === l).map((t) => t.codigo);
  // Fisher-Yates, NO `sort(() => rnd() - 0.5)`: un comparador aleatorio no es
  // transitivo y no da una permutación uniforme (el sesgo depende del motor de
  // JS). En un generador cuyo propósito es quitar un sesgo, importa.
  const barajar = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const gen = [];
  for (let idx = 0; idx < nConductores; idx++) {
    const lineaCasa = lineas[idx % lineas.length];
    const k = Math.max(
      HABIL_VERS_MIN,
      Math.min(HABIL_VERS_MAX, Math.round(triangular(rnd, HABIL_VERS_MIN, HABIL_VERS_MAX, HABIL_VERS_MODA))),
    );
    const sel = new Set();
    const deCasa = barajar(porLinea(lineaCasa));
    const nCasa = Math.min(Math.round(k * HABIL_SESGO_LINEA), deCasa.length);
    for (let i = 0; i < nCasa; i++) sel.add(deCasa[i]);
    for (const codigo of barajar(todos)) {
      if (sel.size >= k) break;
      sel.add(codigo);
    }
    gen.push({ idx, lineaCasa, permitidos: [...sel] });
  }

  // Reparación hasta el piso de cobertura, contando SOLO el pool disponible
  // (buildRequest excluye a los ausentes el mes completo, B32.3). Se añade el
  // turno flojo al conductor con menos tipos → sube el piso sin inflar a nadie.
  const ausentes = new Set(idsAusentesTotalesIdx);
  const disponibles = gen.filter((g) => !ausentes.has(g.idx));
  const cobertura = () => {
    const m = new Map(todos.map((t) => [t, 0]));
    for (const g of disponibles) for (const t of g.permitidos) m.set(t, m.get(t) + 1);
    return m;
  };
  for (let guard = 0; guard < 5000; guard++) {
    const flojos = [...cobertura().entries()]
      .filter(([, v]) => v < HABIL_COBERTURA_MIN)
      .sort((a, b) => a[1] - b[1]);
    if (flojos.length === 0) break;
    const turno = flojos[0][0];
    const candidatos = disponibles
      .filter((g) => !g.permitidos.includes(turno))
      .sort((a, b) => a.permitidos.length - b.permitidos.length);
    if (candidatos.length === 0) {
      throw new Error(`No se puede alcanzar la cobertura mínima en el turno ${turno}.`);
    }
    candidatos[0].permitidos.push(turno);
  }

  // Línea preferente: presente en la habilitación pero NO la modal (ver arriba).
  for (const g of gen) {
    const cuenta = new Map();
    for (const t of g.permitidos) cuenta.set(lineaDe[t], (cuenta.get(lineaDe[t]) ?? 0) + 1);
    const orden = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const noModales = orden.slice(1).map(([l]) => l);
    g.lineaPreferente =
      noModales.length > 0 ? noModales[Math.floor(rnd() * noModales.length)] : orden[0][0];
    g.permitidos.sort();
  }
  return gen;
}

function buildConductores(catalogo, FieldValue, Timestamp) {
  const habil = generarHabilitacion(catalogo, 60, AUSENTES_TOTALES_IDX);

  const conductores = [];
  for (let i = 1; i <= 60; i++) {
    const idx = i - 1;
    const { permitidos, lineaPreferente } = habil[idx];
    const numeroEmpleado = String(i).padStart(2, "0");
    const id = `${TENANT_ID}_${numeroEmpleado}`;
    const [nombre, apellidos] = NOMBRES_CONDUCTORES[idx];
    if (!nombre || !apellidos) throw new Error(`Falta nombre para el conductor ${numeroEmpleado}.`);
    conductores.push({
      id,
      doc: {
        id,
        tenantId: TENANT_ID,
        centroId: CENTRO_ID,
        numeroEmpleado,
        nombre,
        apellidos,
        dni: dniFor(i),
        categoria: "conductor",
        fechaAntiguedad: Timestamp.fromDate(new Date(Date.UTC(2018, 0, 1))),
        fechaIncorporacion: Timestamp.fromDate(new Date(Date.UTC(2018, 1, 1))),
        estado: "activo",
        // B37.1a: hasta aquí iba [] en los 60 — el motor recibía el array vacío
        // y no había NADA que medir. `lineasSecundarias` sigue a [] a propósito:
        // no la lee ni el motor (buildRequest no la mapea) ni ninguna medición.
        lineasPreferentes: [lineaDocId(lineaPreferente)],
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

/**
 * Ausencias (B32.3), perfil real de TUCARSA: ~17% de los 60 conductores ausentes
 * el MES COMPLETO (vacaciones "V" / baja "B" — algunas cruzan los límites del mes
 * para ejercitar el recorte de buildRequest) + permisos de UN día ("AP", "PS")
 * repartidos por el mes. Un conductor no puede tener dos ausencias solapadas
 * (invariante de assertNoSolapeAusencia, respetado a mano: los de permiso no
 * están entre los ausentes totales). Reparto por línea base (idx%5) para que
 * ningún turno se quede sin cobertura: 2 ausentes totales por línea → cada línea
 * conserva 10 de sus 12 conductores base + los de la línea adyacente.
 */
function buildAusencias(conductores, FieldValue, Timestamp) {
  const ts = (y, m, d) => Timestamp.fromDate(new Date(Date.UTC(y, m - 1, d)));
  const ultimoDia = new Date(Date.UTC(ANIO, MES, 0)).getUTCDate();
  const byIdx = (idx) => conductores[idx];
  const ausencias = [];
  let n = 0;
  const push = (cond, categoria, codigo, ini, fin, observaciones) => {
    n += 1;
    const id = `aus_${CENTRO_ID}_${String(n).padStart(3, "0")}`;
    ausencias.push({
      id,
      conductorId: cond.id,
      doc: {
        id,
        tenantId: TENANT_ID,
        centroId: CENTRO_ID,
        conductorId: cond.id,
        categoria,
        codigo,
        fechaInicio: ini,
        fechaFin: fin,
        ...(observaciones !== undefined && { observaciones }),
        creadoPor: ACTOR,
        creadoEn: FieldValue.serverTimestamp(),
      },
    });
  };

  // Ausentes el mes completo: 10 de 60 (16.7%), los de AUSENTES_TOTALES_IDX.
  // Los índices se eligen equiespaciados (uno por cada bloque de 6) para no
  // concentrar bajas en una misma franja de la plantilla. Desde B37.1a la
  // habilitación ya no se deriva de idx%5, así que el reparto "2 por línea" que
  // describía este comentario dejó de tener sentido; lo que SÍ importa es que
  // `generarHabilitacion` repara la cobertura contando solo el pool disponible,
  // es decir, excluyendo exactamente a estos índices.
  const totales = [
    { idx: AUSENTES_TOTALES_IDX[0], cat: "vacaciones", cod: "V", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES, ultimoDia) },
    { idx: AUSENTES_TOTALES_IDX[1], cat: "vacaciones", cod: "V", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES, ultimoDia) },
    { idx: AUSENTES_TOTALES_IDX[2], cat: "vacaciones", cod: "V", ini: ts(ANIO, MES - 1, 24), fin: ts(ANIO, MES, ultimoDia) }, // empieza en agosto
    { idx: AUSENTES_TOTALES_IDX[3], cat: "vacaciones", cod: "V", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES + 1, 4) }, // acaba en octubre
    { idx: AUSENTES_TOTALES_IDX[4], cat: "vacaciones", cod: "V", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES, ultimoDia) },
    { idx: AUSENTES_TOTALES_IDX[5], cat: "baja", cod: "B", ini: ts(ANIO, MES - 2, 15), fin: ts(ANIO, MES + 2, 30), obs: "Baja larga (IT)" }, // envuelve el mes
    { idx: AUSENTES_TOTALES_IDX[6], cat: "baja", cod: "B", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES, ultimoDia) },
    { idx: AUSENTES_TOTALES_IDX[7], cat: "baja", cod: "B", ini: ts(ANIO, MES - 1, 10), fin: ts(ANIO, MES + 1, 20) }, // envuelve el mes
    { idx: AUSENTES_TOTALES_IDX[8], cat: "vacaciones", cod: "V", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES, ultimoDia) },
    { idx: AUSENTES_TOTALES_IDX[9], cat: "baja", cod: "B", ini: ts(ANIO, MES, 1), fin: ts(ANIO, MES, ultimoDia) },
  ];
  for (const t of totales) push(byIdx(t.idx), t.cat, t.cod, t.ini, t.fin, t.obs);

  // Permisos de un día (inicio == fin), en conductores que NO son ausentes totales.
  const sueltos = [
    { idx: 2, cod: "AP", dia: 3 },
    { idx: 9, cod: "PS", dia: 8 },
    { idx: 15, cod: "AP", dia: 11 },
    { idx: 21, cod: "AP", dia: 15 },
    { idx: 28, cod: "PS", dia: 17 },
    { idx: 34, cod: "AP", dia: 22 },
    { idx: 40, cod: "PS", dia: 24 },
    { idx: 47, cod: "AP", dia: 29 },
  ];
  for (const s of sueltos) {
    const d = ts(ANIO, MES, s.dia);
    push(byIdx(s.idx), "permiso", s.cod, d, d);
  }

  // Un mismo conductor con DOS permisos sueltos no solapados (caso realista).
  push(byIdx(52), "permiso", "AP", ts(ANIO, MES, 4), ts(ANIO, MES, 4));
  push(byIdx(52), "permiso", "PS", ts(ANIO, MES, 25), ts(ANIO, MES, 25));

  // B34.1: ausencia PARCIAL (una semana) para el conductor 11 (idx 10), que
  // tiene cuenta Auth: en Mi horario se ven turnos Y vacaciones el mismo mes.
  // Sigue en el pool (no es ausente total).
  push(byIdx(10), "vacaciones", "V", ts(ANIO, MES, 14), ts(ANIO, MES, 20));

  const idsTotales = new Set(totales.map((t) => byIdx(t.idx).id));
  return { ausencias, idsTotales };
}

/** ASSERT de invariantes de las ausencias sembradas (espejo de los callables B32.1). */
function checkAusencias(ausencias, conductores) {
  const idsCond = new Set(conductores.map((c) => c.id));
  const porConductor = new Map();
  for (const a of ausencias) {
    if (!idsCond.has(a.conductorId)) {
      throw new Error(`AUSENCIA ROTA: ${a.id} referencia conductor '${a.conductorId}' inexistente.`);
    }
    const ini = a.doc.fechaInicio.toDate().getTime();
    const fin = a.doc.fechaFin.toDate().getTime();
    if (ini > fin) throw new Error(`AUSENCIA ROTA: ${a.id} tiene fechaInicio > fechaFin.`);
    const prev = porConductor.get(a.conductorId) ?? [];
    for (const [pIni, pFin, pId] of prev) {
      if (ini <= pFin && pIni <= fin) {
        throw new Error(`AUSENCIAS SOLAPADAS: ${a.id} y ${pId} (conductor ${a.conductorId}).`);
      }
    }
    prev.push([ini, fin, a.id]);
    porConductor.set(a.conductorId, prev);
  }
}

/** ASSERT de coherencia de IDs + estadísticas de cobertura/versatilidad. */
function checkCoherencia(tipos, conductores, lineas, idsAusentesTotales = new Set()) {
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
      // B32.3: la cobertura se mide sobre conductores DISPONIBLES (buildRequest
      // excluye del pool a los ausentes el mes completo).
      if (!idsAusentesTotales.has(c.id)) cobertura.set(code, cobertura.get(code) + 1);
    }
    minVers = Math.min(minVers, perm.length);
    maxVers = Math.max(maxVers, perm.length);
    sumVers += perm.length;
  }
  const cobs = [...cobertura.values()];
  const minCob = Math.min(...cobs);
  // B37.1a: el piso pasa de 4 (holgura mínima histórica) al que garantiza
  // `generarHabilitacion`. Con la habilitación realista la cobertura ya no es
  // un subproducto del diseño "todos los turnos de tu línea", así que este
  // assert es la red que detecta una regresión del generador ANTES de escribir.
  const sinCobertura = [...cobertura.entries()].filter(([, n]) => n < HABIL_COBERTURA_MIN);
  if (sinCobertura.length > 0) {
    throw new Error(
      `COBERTURA INSUFICIENTE (<${HABIL_COBERTURA_MIN} conductores) en: ` +
        sinCobertura.map(([id, n]) => `${id}(${n})`).join(", "),
    );
  }
  // B37.1a — cuota de la línea preferente DENTRO de la habilitación: es la
  // "expectativa de indiferencia", el % de asignaciones que caerían en la línea
  // preferente aunque el motor la ignorase por completo. Es el número que hacía
  // inútil el banco antiguo (65,8%) y el que hay que vigilar en cada cambio del
  // generador: si vuelve a dispararse, cualquier medición de preferencias miente.
  const lineaDeTipo = new Map(tipos.map((t) => [t.id, t.doc.lineaId]));
  let conPreferente = 0;
  let sumCuota = 0;
  for (const c of conductores) {
    const pref = new Set(c.doc.lineasPreferentes ?? []);
    if (pref.size > 0) conPreferente += 1;
    const perm = c.doc.tiposTurnoPermitidos;
    if (perm.length > 0) {
      sumCuota += perm.filter((code) => pref.has(lineaDeTipo.get(code))).length / perm.length;
    }
  }
  return {
    minCobertura: minCob,
    maxCobertura: Math.max(...cobs),
    avgCobertura: (cobs.reduce((a, b) => a + b, 0) / cobs.length).toFixed(1),
    minVersatilidad: minVers,
    maxVersatilidad: maxVers,
    avgVersatilidad: (sumVers / conductores.length).toFixed(1),
    nConductores: conductores.length,
    conPreferente,
    cuotaPreferente: ((sumCuota / conductores.length) * 100).toFixed(1),
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
  // Auth: jefe de prueba + conductores con cuenta (si existen).
  const emails = [JEFE_EMAIL, ...CONDUCTORES_CON_CUENTA.map((c) => conductorEmail(c.numeroEmpleado))];
  for (const email of emails) {
    try {
      const u = await auth.getUserByEmail(email);
      await auth.deleteUser(u.uid);
      await db.collection("usuarios").doc(u.uid).delete().catch(() => {});
    } catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
    }
  }
  // Firestore: docs por colección dentro del centro/tenant de prueba.
  const dels = [];
  for (const col of ["tipos_turno", "conductores", "lineas", "ausencias"]) {
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
  const { ausencias, idsTotales } = buildAusencias(conductores, FieldValue, Timestamp);
  checkAusencias(ausencias, conductores);
  const stats = checkCoherencia(tipos, conductores, lineas, idsTotales);

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
  // B34.1 — Conductores con cuenta (Auth + claims CON conductorId + /usuarios
  // con conductorId + usuarioId en su doc /conductores). passwordChangeRequired
  // =false → login directo (el flujo de primera contraseña ya está probado, B7).
  const cuentasConductor = [];
  const usuariosConductorOps = [];
  for (const spec of CONDUCTORES_CON_CUENTA) {
    const cond = conductores.find((c) => c.doc.numeroEmpleado === spec.numeroEmpleado);
    if (!cond) throw new Error(`Conductor ${spec.numeroEmpleado} no existe en el seed.`);
    const email = conductorEmail(spec.numeroEmpleado);
    const password = generarPassword();
    const nombreCompleto = `${cond.doc.nombre} ${cond.doc.apellidos}`;
    const u = await auth.createUser({ email, password, displayName: nombreCompleto });
    await auth.setCustomUserClaims(u.uid, {
      rol: "conductor",
      tenantId: TENANT_ID,
      centroId: CENTRO_ID,
      conductorId: cond.id, // B34.1: reglas self-only
    });
    cond.doc.usuarioId = u.uid; // enlace inverso conductor→usuario (como crearConductor)
    usuariosConductorOps.push((b) =>
      b.set(db.collection("usuarios").doc(u.uid), {
        id: u.uid,
        email,
        nombreCompleto,
        rol: "conductor",
        tenantId: TENANT_ID,
        centroId: CENTRO_ID,
        conductorId: cond.id, // D1: enlace usuario→conductor
        estado: "activo",
        passwordChangeRequired: false,
        fechaCreacion: FieldValue.serverTimestamp(),
        creadoPor: ACTOR,
        creadoEn: FieldValue.serverTimestamp(),
      }),
    );
    cuentasConductor.push({ ...spec, email, password, uid: u.uid, conductorId: cond.id });
  }
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
    ...usuariosConductorOps,
    (b) => b.set(db.collection("convenio").doc(CENTRO_ID), convenioDoc),
    (b) => b.set(db.collection("cuadrantes").doc(CUADRANTE_ID), cuadranteDoc),
    ...lineas.map((l) => (b) => b.set(db.collection("lineas").doc(l.id), l.doc)),
    ...tipos.map((t) => (b) => b.set(db.collection("tipos_turno").doc(t.id), t.doc)),
    ...conductores.map(
      (c) => (b) => b.set(db.collection("conductores").doc(c.id), c.doc),
    ),
    ...ausencias.map((a) => (b) => b.set(db.collection("ausencias").doc(a.id), a.doc)),
  ];
  await commitInChunks(db, ops);

  return {
    jefeUid: jefe.uid,
    cuentasConductor,
    nLineas: lineas.length,
    nTipos: tipos.length,
    nConductores: conductores.length,
    nAusencias: ausencias.length,
    nAusentesTotales: idsTotales.size,
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
  console.log(
    `  ausencias:     ${r.nAusencias} (${r.nAusentesTotales} conductores ausentes el mes completo → fuera del pool; resto permisos de 1 día + 1 semana de vacaciones del conductor 11)`,
  );
  console.log(`  convenio:      sí (singleton id=${CENTRO_ID})`);
  console.log(`  cuadrante:     ${CUADRANTE_ID}  (borrador, estadoGeneracion=idle)`);
  console.log(`  festivos:      ninguno (septiembre 2026 no tiene festivo nacional)`);
  console.log("\n  --- Credenciales del JEFE (login para pulsar Generar) ---");
  console.log(`  email:         ${JEFE_EMAIL}`);
  console.log(`  password:      ${JEFE_PASSWORD}`);
  console.log(`  uid:           ${r.jefeUid}`);
  console.log("\n  --- Credenciales de CONDUCTORES con cuenta (B34.1, Mi horario) ---");
  console.log("  (contraseñas generadas en esta ejecución; no están en el repo)");
  for (const c of r.cuentasConductor) {
    console.log(`  ${c.email}  /  ${c.password}   → ${c.conductorId}  (${c.perfil})`);
  }
  console.log("\n  --- Coherencia / cobertura (assert OK) ---");
  console.log(
    `  cobertura por turno (solo disponibles): min=${r.stats.minCobertura} max=${r.stats.maxCobertura} avg=${r.stats.avgCobertura} (mínimo exigido ≥${HABIL_COBERTURA_MIN})`,
  );
  console.log(
    `  versatilidad/conductor: min=${r.stats.minVersatilidad} max=${r.stats.maxVersatilidad} avg=${r.stats.avgVersatilidad} (triangular 1-24, B37.1a)`,
  );
  console.log(
    `  línea preferente: ${r.stats.conPreferente}/${r.stats.nConductores} sembrada; cuota media en la habilitación ${r.stats.cuotaPreferente}% (expectativa de indiferencia)`,
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
