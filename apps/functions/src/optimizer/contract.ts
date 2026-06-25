/**
 * Contrato TS del motor optimizador (B29 Fase C) — ESPEJO de
 * `services/optimizer/schemas.py` (pydantic). Es la frontera de datos entre el
 * orquestador Node (lee Firestore → compone el request) y el motor Python en
 * Cloud Run (NO toca Firestore: función pura request→response).
 *
 * Debe encajar 1:1 con el schema Python. Único campo no-ASCII: `año` (en Python
 * es `anio` con `alias="año"` + `populate_by_name=True`, así que el motor acepta
 * tanto "año" como "anio"; aquí emitimos "año").
 *
 * TODO[refactor-shared-build]: si algún día este contrato se comparte con otra
 * superficie, considerar moverlo a @albius/shared. Hoy vive en functions porque
 * solo el orquestador lo usa.
 */
import type { TipoDia, TipoAsignacion, EstadoAsignacion } from "@albius/shared";

// ============================================================================
//  ENTRADA  (OptimizarRequest)
// ============================================================================

export interface DiaInput {
  fecha: string; // ISO "YYYY-MM-DD"
  tipoDia: TipoDia; // ya resuelto por el orquestador (resolverTipoDia, B27)
}

export interface TramoInput {
  inicio: string; // "HH:mm"
  fin: string; // "HH:mm"
}

export interface TipoTurnoInput {
  id: string; // doc id Firestore → se emite como tipoTurnoId en la salida
  codigo: string;
  horaInicio: string; // "HH:mm"
  horaFin: string; // "HH:mm"; si fin <= inicio cruza medianoche
  duracionMinutos: number;
  duracionEfectivaMinutos: number;
  esNocturno: boolean;
  esPartido: boolean;
  tramosPartido?: TramoInput[];
  tiposDiaAplicables: TipoDia[];
}

export interface ConvenioInput {
  descansoMinimoEntreJornadasHoras: number;
  maxHorasSemanales: number;
  computoHoras: "jornada" | "conduccion";
  maxDiasConsecutivosTrabajados: number;
}

export interface ConductorInput {
  id: string; // = conductorId en la salida
  tiposTurnoPermitidos: string[];
  tiposTurnoExcluidos: string[];
  lineasPreferentes: string[]; // reservado (preferencias diferidas en MVP)
  maxHorasSemanales?: number; // ausente → usar el del convenio
}

export interface AusenciaInput {
  conductorId: string;
  fecha: string; // ISO "YYYY-MM-DD"
}

export interface OptimizarRequest {
  centroId: string;
  año: number; // alias del `anio` de Python
  mes: number;
  dias: DiaInput[];
  tiposTurno: TipoTurnoInput[];
  convenio: ConvenioInput;
  conductores: ConductorInput[];
  ausencias: AusenciaInput[];
  timeLimitSeconds?: number; // override opcional del límite del solver
}

// ============================================================================
//  SALIDA  (OptimizarResponse)
// ============================================================================

export interface AsignacionOutput {
  conductorId: string;
  fecha: string; // ISO "YYYY-MM-DD"
  tipoTurnoId: string;
  tipoAsignacion: TipoAsignacion; // el motor solo emite 'turno'
  horaInicio: string;
  horaFin: string;
  estado: EstadoAsignacion; // el motor solo emite 'planificada'
}

export interface EstadisticasOutput {
  coberturaServicios: number; // % plazas cubiertas
  satisfaccionMedia: number; // placeholder mientras W_PREF está desactivado
  preferenciasCumplidas: number;
  preferenciasNoCumplidas: number;
}

export interface DiagnosticoOutput {
  status: string; // optimal | feasible_* | infeasible
  plazasTotales: number;
  plazasCubiertas: number;
  plazasDeficit: number;
  tiempoSegundos: number;
  gapFinal?: number | null;
  numVariablesX?: number | null;
  numClausulasR2?: number | null;
}

export interface OptimizarResponse {
  asignaciones: AsignacionOutput[];
  estadisticas: EstadisticasOutput;
  diagnostico: DiagnosticoOutput;
}
