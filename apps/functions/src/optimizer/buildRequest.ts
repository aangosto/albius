/**
 * Composición del OptimizarRequest desde Firestore (B29 Fase C, dirección C1).
 *
 * El orquestador (worker) LEE el estado del centro y construye el JSON de entrada
 * del motor; el motor NO toca Firestore. Lecturas (Admin SDK, bypassan reglas):
 *   - tipos_turno activos del centro        → tiposTurno[]  (DEMANDA)
 *   - convenio/{centroId} (singleton D6.9)  → convenio       (RESTRICCIONES)
 *   - conductores activos del centro        → conductores[]  (HABILITACIONES)
 *   - festivos del tenant aplicables al mes → dias[] vía resolverTipoDia (CALENDARIO)
 *   - ausencias                             → [] (sin modelo de ausencias en MVP)
 *
 * Errores legibles si faltan datos (el worker los pondrá en errorGeneracion):
 * sin convenio, sin tipos de turno activos, o sin conductores activos → no tiene
 * sentido generar.
 */
import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { resolverTipoDia, type FestivoLike } from "../calendar";
import type {
  OptimizarRequest,
  TipoTurnoInput,
  ConductorInput,
  ConvenioInput,
  DiaInput,
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
  const conductores = condSnap.docs.map((doc) => mapConductor(doc.id, doc.data()));
  if (conductores.length === 0) {
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
      const fecha: Date | undefined =
        f["fecha"] && typeof f["fecha"].toDate === "function"
          ? f["fecha"].toDate()
          : undefined;
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

  return {
    centroId,
    año,
    mes,
    dias,
    tiposTurno,
    convenio,
    conductores,
    ausencias: [], // MVP: sin modelo de ausencias
  };
}
