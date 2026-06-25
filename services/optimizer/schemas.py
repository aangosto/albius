"""
Contratos de datos del motor optimizador (B29 Fase A).

Modelos pydantic de ENTRADA y SALIDA. Son la frontera entre el orquestador Node
(que lee Firestore y compone el JSON de entrada — Fase C) y el motor: el motor NO
toca Firestore, recibe estos datos como input y devuelve el plan como output
(función pura a gran escala, dirección C1).

Los nombres de campo replican el modelo de Albius (packages/shared/src/types.ts).
Único campo con alias: `año` (no-ASCII) → atributo Python `anio`.
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

TipoDia = Literal["laborable", "sabado", "domingo", "festivo"]
ComputoHoras = Literal["jornada", "conduccion"]


# ============================================================================
#  ENTRADA
# ============================================================================


class DiaInput(BaseModel):
    fecha: str  # ISO "YYYY-MM-DD"
    tipoDia: TipoDia  # ya resuelto por el orquestador (resolverTipoDia, B27)


class TramoInput(BaseModel):
    inicio: str  # "HH:mm"
    fin: str  # "HH:mm"


class TipoTurnoInput(BaseModel):
    id: str  # doc id Firestore → se emite como tipoTurnoId en la salida
    codigo: str
    horaInicio: str  # "HH:mm"
    horaFin: str  # "HH:mm"; si fin <= inicio cruza medianoche
    duracionMinutos: int
    duracionEfectivaMinutos: int
    esNocturno: bool
    esPartido: bool
    tramosPartido: Optional[list[TramoInput]] = None
    tiposDiaAplicables: list[TipoDia]


class ConvenioInput(BaseModel):
    descansoMinimoEntreJornadasHoras: float
    maxHorasSemanales: float
    computoHoras: ComputoHoras = "jornada"
    maxDiasConsecutivosTrabajados: int


class ConductorInput(BaseModel):
    id: str  # = conductorId en la salida
    tiposTurnoPermitidos: list[str]
    tiposTurnoExcluidos: list[str] = []
    lineasPreferentes: list[str] = []  # reservado (preferencias diferidas en MVP)
    maxHorasSemanales: Optional[float] = None  # None → usar el del convenio


class AusenciaInput(BaseModel):
    conductorId: str
    fecha: str  # ISO "YYYY-MM-DD"


class OptimizarRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    centroId: str
    anio: int = Field(alias="año")
    mes: int
    dias: list[DiaInput]
    tiposTurno: list[TipoTurnoInput]
    convenio: ConvenioInput
    conductores: list[ConductorInput]
    ausencias: list[AusenciaInput] = []
    # Override opcional del límite de tiempo del solver (segundos).
    timeLimitSeconds: Optional[float] = None


# ============================================================================
#  SALIDA
# ============================================================================


class AsignacionOutput(BaseModel):
    conductorId: str
    fecha: str  # ISO "YYYY-MM-DD"
    tipoTurnoId: str
    tipoAsignacion: Literal["turno"] = "turno"
    horaInicio: str
    horaFin: str
    estado: Literal["planificada"] = "planificada"


class EstadisticasOutput(BaseModel):
    coberturaServicios: float  # % plazas cubiertas
    # Placeholders mientras las preferencias estén desactivadas (MVP):
    satisfaccionMedia: float
    preferenciasCumplidas: int
    preferenciasNoCumplidas: int


class DiagnosticoOutput(BaseModel):
    status: str  # optimal | feasible_gap_ok | feasible_timeout | feasible | infeasible
    plazasTotales: int
    plazasCubiertas: int
    plazasDeficit: int
    tiempoSegundos: float
    gapFinal: Optional[float] = None  # gap relativo MIP final (None si el solver no da cota)
    numVariablesX: Optional[int] = None  # nº de variables de asignación (diagnóstico de escala)
    numClausulasR2: Optional[int] = None  # nº de restricciones de descanso R2 (diagnóstico de escala)


class OptimizarResponse(BaseModel):
    asignaciones: list[AsignacionOutput]
    estadisticas: EstadisticasOutput
    diagnostico: DiagnosticoOutput
