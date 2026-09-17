/**
 * Composición del OptimizarRequest desde Firestore (B29 Fase C, dirección C1).
 *
 * El orquestador (worker) LEE el estado del centro y construye el JSON de entrada
 * del motor; el motor NO toca Firestore. Lecturas (Admin SDK, bypassan reglas):
 *   - tipos_turno activos del centro        → tiposTurno[]  (DEMANDA)
 *   - convenio/{centroId} (singleton D6.9)  → convenio       (RESTRICCIONES)
 *   - conductores activos del centro        → conductores[]  (HABILITACIONES)
 *   - festivos del tenant aplicables al mes → dias[] vía resolverTipoDia (CALENDARIO)
 *   - ausencias del centro que solapan el mes → ausencias[] (B32.3: rangos
 *     expandidos a días; los conductores ausentes el MES COMPLETO se excluyen
 *     del pool — ver `excluirAusentesTotales`)
 *
 * Errores legibles si faltan datos (el worker los pondrá en errorGeneracion):
 * sin convenio, sin tipos de turno activos, o sin conductores disponibles → no
 * tiene sentido generar.
 */
import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import {
  expandirAusenciaEnMes,
  resolverTipoDia,
  type FestivoLike,
} from "../calendar";
import type {
  OptimizarRequest,
  TipoTurnoInput,
  ConductorInput,
  ConvenioInput,
  DiaInput,
  AusenciaInput,
} from "./contract";

/** Días naturales del mes (mes 1-based), calculado en UTC. */
function diasEnMes(año: number, mes: number): number {
  return new Date(Date.UTC(año, mes, 0)).getUTCDate();
}

function mapTipoTurno(id: string, d: FirebaseFirestore.DocumentData): TipoTurnoInput {
  return {
    id,
    codigo: d["codigo"],
    horaInicio: d["horaInicio"],
    horaFin: d["horaFin"],
    duracionMinutos: d["duracionMinutos"],
    duracionEfectivaMinutos: d["duracionEfectivaMinutos"],
    esNocturno: d["esNocturno"] === true,
    esPartido: d["esPartido"] === true,
    ...(Array.isArray(d["tramosPartido"]) && {
      tramosPartido: d["tramosPartido"].map((t: { inicio: string; fin: string }) => ({
        inicio: t.inicio,
        fin: t.fin,
      })),
    }),
    tiposDiaAplicables: d["tiposDiaAplicables"] ?? [],
  };
}

function mapConductor(id: string, d: FirebaseFirestore.DocumentData): ConductorInput {
  return {
    id,
    tiposTurnoPermitidos: d["tiposTurnoPermitidos"] ?? [],
    tiposTurnoExcluidos: d["tiposTurnoExcluidos"] ?? [],
    lineasPreferentes: d["lineasPreferentes"] ?? [],
    // maxHorasSemanales: override individual; ausente → el motor usa el del convenio.
    ...(typeof d["maxHorasSemanales"] === "number" && {
      maxHorasSemanales: d["maxHorasSemanales"],
    }),
  };
}

function mapConvenio(d: FirebaseFirestore.DocumentData): ConvenioInput {
  return {
    descansoMinimoEntreJornadasHoras: d["descansoMinimoEntreJornadasHoras"],
    maxHorasSemanales: d["maxHorasSemanales"],
    // computoHoras es opcional en el modelo; el schema Python defaultea 'jornada'.
    computoHoras: d["computoHoras"] === "conduccion" ? "conduccion" : "jornada",
    maxDiasConsecutivosTrabajados: d["maxDiasConsecutivosTrabajados"],
  };
}

/** Timestamp del Admin SDK (o cualquier cosa con .toDate()) → Date, o undefined. */
function toDateOrUndefined(v: unknown): Date | undefined {
  return v && typeof (v as { toDate?: unknown }).toDate === "function"
    ? (v as { toDate: () => Date }).toDate()
    : undefined;
}

/**
 * Lee las ausencias del centro y las expande a `AusenciaInput[]` (un par
 * conductor-día por cada día del rango que cae en el mes). Query por `centroId`
 * (índice single-field automático; el índice compuesto B32 sirve al listado del
 * cliente) + filtro de `tenantId` y de solape con el mes en memoria — el mismo
 * patrón que los festivos. Devuelve también, por conductor, el nº de días
 * ausentes en el mes (lo usa `excluirAusentesTotales`).
 */
async function leerAusenciasDelMes(
  db: Firestore,
  params: { tenantId: string; centroId: string; año: number; mes: number },
): Promise<{ ausencias: AusenciaInput[]; diasAusentePorConductor: Map<string, number> }> {
  const snap = await db
    .collection(COLLECTIONS.AUSENCIAS)
    .where("centroId", "==", params.centroId)
    .get();
  const ausencias: AusenciaInput[] = [];
  // Set por conductor: dos ausencias del mismo conductor no solapan (lo garantiza
  // assertNoSolapeAusencia), pero contamos días únicos por robustez.
  const diasPorConductor = new Map<string, Set<string>>();
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d["tenantId"] !== params.tenantId) continue;
    const conductorId = d["conductorId"];
    const inicio = toDateOrUndefined(d["fechaInicio"]);
    const fin = toDateOrUndefined(d["fechaFin"]);
    if (typeof conductorId !== "string" || !inicio || !fin) continue;
    const dias = expandirAusenciaEnMes(inicio, fin, params.año, params.mes);
    if (dias.length === 0) continue; // no solapa el mes
    let set = diasPorConductor.get(conductorId);
    if (!set) {
      set = new Set();
      diasPorConductor.set(conductorId, set);
    }
    for (const fecha of dias) {
      if (set.has(fecha)) continue;
      set.add(fecha);
      ausencias.push({ conductorId, fecha });
    }
  }
  const diasAusentePorConductor = new Map<string, number>();
  for (const [cid, set] of diasPorConductor) diasAusentePorConductor.set(cid, set.size);
  return { ausencias, diasAusentePorConductor };
}

/**
 * Excluye del pool a los conductores SIN NINGÚN día disponible en el mes
 * (ausentes el mes completo). Decisión B32.3: si entraran con todas sus
 * variables anuladas, su `wload=0` contaminaría la media del término de equidad
 * del motor (`span` vs `mean_load`) y empujaría a bajar la carga de los demás —
 * con el ~17% de ausentes de TUCARSA no es un caso raro. Los ausentes PARCIALES
 * sí entran (con sus días recortados vía `ausencias[]`).
 *
 * TODO[equidad-normalizar-dias-disponibles]: este es el parche barato en el
 * orquestador. La solución correcta a medio plazo es que `optimizer.py`
 * normalice la equidad por días disponibles de cada conductor (carga relativa),
 * y entonces esta exclusión sobra. También conviene entonces que las ausencias
 * de los excluidos no viajen (hoy se filtran del array para no mandar ruido).
 */
function excluirAusentesTotales(
  conductores: ConductorInput[],
  ausencias: AusenciaInput[],
  diasAusentePorConductor: Map<string, number>,
  totalDias: number,
): { conductores: ConductorInput[]; ausencias: AusenciaInput[]; excluidos: string[] } {
  const excluidos = conductores
    .filter((c) => (diasAusentePorConductor.get(c.id) ?? 0) >= totalDias)
    .map((c) => c.id);
  if (excluidos.length === 0) return { conductores, ausencias, excluidos };
  const setExcluidos = new Set(excluidos);
  return {
    conductores: conductores.filter((c) => !setExcluidos.has(c.id)),
    ausencias: ausencias.filter((a) => !setExcluidos.has(a.conductorId)),
    excluidos,
  };
}

/**
 * Lee Firestore y compone el OptimizarRequest del centro para (año, mes).
 * `tenantId` se usa para acotar la query de festivos (que son por tenant, con
 * `centroId` opcional para los de un centro concreto).
 */
export async function construirOptimizarRequest(
  db: Firestore,
  params: { tenantId: string; centroId: string; año: number; mes: number },
): Promise<OptimizarRequest> {
  const { tenantId, centroId, año, mes } = params;

  // --- tiposTurno activos del centro (DEMANDA) ---
  const ttSnap = await db
    .collection(COLLECTIONS.TIPOS_TURNO)
    .where("centroId", "==", centroId)
    .where("estado", "==", "activo")
    .get();
  const tiposTurno = ttSnap.docs.map((doc) => mapTipoTurno(doc.id, doc.data()));
  if (tiposTurno.length === 0) {
    throw new Error(
      `El centro '${centroId}' no tiene tipos de turno activos; no hay demanda que cubrir.`,
    );
  }

  // --- convenio del centro (RESTRICCIONES) ---
  const convSnap = await db.collection(COLLECTIONS.CONVENIO).doc(centroId).get();
  if (!convSnap.exists) {
    throw new Error(
      `El centro '${centroId}' no tiene convenio configurado; el optimizador necesita sus restricciones.`,
    );
  }
  const convenio = mapConvenio(convSnap.data()!);

  // --- conductores activos del centro (HABILITACIONES) ---
  const condSnap = await db
    .collection(COLLECTIONS.CONDUCTORES)
    .where("centroId", "==", centroId)
    .where("estado", "==", "activo")
    .get();
  const conductoresActivos = condSnap.docs.map((doc) => mapConductor(doc.id, doc.data()));
  if (conductoresActivos.length === 0) {
    throw new Error(
      `El centro '${centroId}' no tiene conductores activos; no hay a quién asignar.`,
    );
  }

  // --- dias[] vía resolverTipoDia (CALENDARIO) ---
  // Festivos del tenant aplicables al centro Y al mes. Aplicable = del centro
  // (centroId == X) o tenant-wide (centroId ausente).
  const festSnap = await db
    .collection(COLLECTIONS.FESTIVOS)
    .where("tenantId", "==", tenantId)
    .get();
  const festivosAplicables: FestivoLike[] = festSnap.docs
    .map((doc) => doc.data())
    .filter((f) => {
      const fc = f["centroId"];
      const aplicaAlCentro = fc === undefined || fc === null || fc === centroId;
      const fecha = toDateOrUndefined(f["fecha"]);
      const delMes =
        fecha !== undefined &&
        fecha.getUTCFullYear() === año &&
        fecha.getUTCMonth() + 1 === mes;
      return aplicaAlCentro && delMes;
    })
    .map((f) => ({
      fecha: f["fecha"],
      tipoTraficoAplicable: f["tipoTraficoAplicable"],
    }));

  const totalDias = diasEnMes(año, mes);
  const dias: DiaInput[] = [];
  for (let d = 1; d <= totalDias; d++) {
    const fecha = new Date(Date.UTC(año, mes - 1, d));
    dias.push({
      fecha: fecha.toISOString().slice(0, 10),
      tipoDia: resolverTipoDia(fecha, festivosAplicables),
    });
  }

  // --- ausencias[] del mes (B32.3) + exclusión de ausentes totales ---
  const leidas = await leerAusenciasDelMes(db, { tenantId, centroId, año, mes });
  const { conductores, ausencias, excluidos } = excluirAusentesTotales(
    conductoresActivos,
    leidas.ausencias,
    leidas.diasAusentePorConductor,
    totalDias,
  );
  if (conductores.length === 0) {
    throw new Error(
      `El centro '${centroId}' no tiene conductores disponibles en ${String(mes).padStart(2, "0")}/${año}: ` +
        `los ${conductoresActivos.length} activos están ausentes el mes completo.`,
    );
  }
  // Sanidad de cobertura: cada tipo de turno debe tener al menos un conductor
  // disponible habilitado; si la exclusión deja alguno sin nadie, mejor un error
  // legible ahora que un plan con déficit inexplicable después.
  const sinHabilitados = tiposTurno.filter(
    (t) =>
      !conductores.some(
        (c) => c.tiposTurnoPermitidos.includes(t.id) && !c.tiposTurnoExcluidos.includes(t.id),
      ),
  );
  if (sinHabilitados.length > 0) {
    throw new Error(
      `Sin conductores disponibles para ${sinHabilitados.length} tipo(s) de turno en ` +
        `${String(mes).padStart(2, "0")}/${año} (${sinHabilitados
          .slice(0, 5)
          .map((t) => t.codigo)
          .join(", ")}${sinHabilitados.length > 5 ? ", …" : ""}); ` +
        `${excluidos.length} conductor(es) excluido(s) por ausencia del mes completo.`,
    );
  }

  return {
    centroId,
    año,
    mes,
    dias,
    tiposTurno,
    convenio,
    conductores,
    ausencias,
  };
}
