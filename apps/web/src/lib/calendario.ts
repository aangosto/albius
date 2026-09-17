/**
 * Helpers PUROS de la vista Calendario (B30.3) — fechas en UTC y contraste de
 * color. Sin I/O, sin deps de React.
 *
 * ⚠️ UTC INNEGOCIABLE: el seed y el optimizador escriben las fechas de las
 * asignaciones a medianoche UTC, y se leen en UTC. TODO el manejo de fechas de
 * esta vista usa getUTCDate()/getUTCDay()/Date.UTC() — nunca getDate() ni
 * new Date(y,m,d) locales, que en Europe/Madrid (UTC+1/+2) meterían los turnos
 * en el día equivocado.
 */
import type { Timestamp } from 'firebase/firestore';
import type {
  Asignacion,
  CategoriaAusencia,
  Conductor,
  TipoTurno,
} from '@albius/shared';

// Índice = getUTCDay() (0=domingo … 6=sábado).
const ABREV_DIA_SEMANA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

export interface DiaColumna {
  /** Día del mes 1..N. */
  dia: number;
  /** Date a medianoche UTC del día. */
  fecha: Date;
  /** getUTCDay(): 0=domingo … 6=sábado. */
  diaSemana: number;
  /** Inicial del día de la semana (L/M/X/J/V/S/D). */
  abrev: string;
  /** Sábado o domingo. */
  esFinde: boolean;
}

/**
 * Columnas-día de un mes completo (mes 1-12). Último día vía
 * `Date.UTC(año, mes, 0)` (día 0 del mes siguiente = último del actual), todo en
 * UTC.
 */
export function diasDelMes(año: number, mes: number): DiaColumna[] {
  const ultimoDia = new Date(Date.UTC(año, mes, 0)).getUTCDate();
  const dias: DiaColumna[] = [];
  for (let d = 1; d <= ultimoDia; d++) {
    const fecha = new Date(Date.UTC(año, mes - 1, d));
    const diaSemana = fecha.getUTCDay();
    dias.push({
      dia: d,
      fecha,
      diaSemana,
      abrev: ABREV_DIA_SEMANA[diaSemana] ?? '?',
      esFinde: diaSemana === 0 || diaSemana === 6,
    });
  }
  return dias;
}

/** Día del mes (1..31) de un Timestamp, en UTC. */
export function diaDelMesUTC(ts: Timestamp): number {
  return ts.toDate().getUTCDate();
}

/**
 * Texto legible (#1a1a1a o #ffffff) sobre un fondo HEX según su luminancia
 * relativa (sRGB aproximada). Para los 5 colores de línea (azul/naranja/verde/
 * morado/rojo) devuelve blanco; para fondos muy claros, texto oscuro.
 * Devuelve 'inherit' si no hay color (la celda usa el color de texto del tema).
 */
export function textoSobreColor(hex?: string): string {
  if (!hex) return 'inherit';
  const h = hex.replace('#', '');
  if (h.length !== 6) return 'inherit';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return 'inherit';
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1a1a1a' : '#ffffff';
}

// ============================================================================
//  EDICIÓN MANUAL (B33.2) — helpers puros de avisos NO bloqueantes
// ============================================================================
//
// Decisión híbrida B33.2: el backend RECHAZA lo estructural (R1, referencias);
// lo de convenio (habilitación, ausencia, descanso entre jornadas) la UI lo
// AVISA y permite — un jefe puede necesitar saltárselo en una urgencia real.


/** "YYYY-MM-DD" de un día del mes (UTC). */
export function fechaISODia(año: number, mes: number, dia: number): string {
  return new Date(Date.UTC(año, mes - 1, dia)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" de un Timestamp, en UTC. */
export function fechaISOUTC(ts: Timestamp): string {
  return ts.toDate().toISOString().slice(0, 10);
}

/** Duración en minutos de una jornada HH:mm→HH:mm (cruce de medianoche: fin<=inicio → +24h). */
export function duracionMinutos(horaInicio: string, horaFin: string): number {
  const ini = horaAMinutos(horaInicio);
  let fin = horaAMinutos(horaFin);
  if (fin <= ini) fin += 24 * 60;
  return fin - ini;
}

/** "YYYY-MM-DD" de hoy en UTC (D6.22). */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Suma `dias` a una fecha ISO (UTC). */
export function sumarDiasISO(iso: string, dias: number): string {
  const t = Date.parse(`${iso}T00:00:00.000Z`) + dias * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

function horaAMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Tramo absoluto (minutos desde epoch/60000) de una jornada. */
function tramoAbsoluto(j: JornadaLite): { inicio: number; fin: number } {
  const dia = Date.parse(`${j.fechaISO}T00:00:00.000Z`) / 60000;
  const ini = horaAMinutos(j.horaInicio);
  let fin = horaAMinutos(j.horaFin);
  // Cruce de medianoche (convención TipoTurno: horaFin <= horaInicio → +1 día).
  if (fin <= ini) fin += 24 * 60;
  return { inicio: dia + ini, fin: dia + fin };
}

export interface JornadaLite {
  fechaISO: string;
  horaInicio: string;
  horaFin: string;
}

/**
 * Horas de descanso entre el FIN de `a` y el INICIO de `b` (a antes que b).
 * Negativo si solapan. Contempla cruce de medianoche en ambas.
 */
export function horasDescansoEntre(a: JornadaLite, b: JornadaLite): number {
  const ta = tramoAbsoluto(a);
  const tb = tramoAbsoluto(b);
  return (tb.inicio - ta.fin) / 60;
}

/** ¿Está el conductor habilitado para el tipo? Misma semántica que el motor
 *  (`buildRequest`): debe estar en `tiposTurnoPermitidos` y no en `Excluidos`. */
export function conductorHabilitadoPara(
  conductor: Pick<Conductor, 'tiposTurnoPermitidos' | 'tiposTurnoExcluidos'>,
  tipoTurnoId: string,
): boolean {
  return (
    conductor.tiposTurnoPermitidos.includes(tipoTurnoId) &&
    !(conductor.tiposTurnoExcluidos ?? []).includes(tipoTurnoId)
  );
}

export interface AvisoAsignacion {
  clave: 'habilitacion' | 'ausencia' | 'descanso-anterior' | 'descanso-siguiente';
  texto: string;
}

export interface VecinoJornada extends JornadaLite {
  /** Etiqueta legible del turno vecino (código del tipo o tipoAsignacion). */
  etiqueta: string;
}

/**
 * Avisos NO bloqueantes de una asignación manual `conductor × fechaISO × tipo`.
 * Solo mira el día anterior y el siguiente del mismo conductor (lo que importa
 * para el descanso entre jornadas). Sin convenio → sin aviso de descanso.
 */
export function calcularAvisosAsignacion(params: {
  conductor: Pick<Conductor, 'tiposTurnoPermitidos' | 'tiposTurnoExcluidos'>;
  tipo: TipoTurno;
  fechaISO: string;
  ausencia?: { categoria: CategoriaAusencia; codigo?: string };
  anterior?: VecinoJornada;
  siguiente?: VecinoJornada;
  descansoMinimoHoras?: number;
}): AvisoAsignacion[] {
  const avisos: AvisoAsignacion[] = [];
  if (!conductorHabilitadoPara(params.conductor, params.tipo.id)) {
    avisos.push({
      clave: 'habilitacion',
      texto: `Este conductor no está habilitado para el turno ${params.tipo.codigo}.`,
    });
  }
  if (params.ausencia) {
    const cod = params.ausencia.codigo ? ` (${params.ausencia.codigo})` : '';
    avisos.push({
      clave: 'ausencia',
      texto: `Está ausente ese día: ${params.ausencia.categoria}${cod}.`,
    });
  }
  const min = params.descansoMinimoHoras;
  if (min !== undefined && min > 0) {
    const nueva: JornadaLite = {
      fechaISO: params.fechaISO,
      horaInicio: params.tipo.horaInicio,
      horaFin: params.tipo.horaFin,
    };
    if (params.anterior) {
      const h = horasDescansoEntre(params.anterior, nueva);
      if (h < min) {
        avisos.push({
          clave: 'descanso-anterior',
          texto: `El descanso con el turno anterior (${params.anterior.etiqueta}, ${params.anterior.fechaISO}) es de ${formatHoras(h)} (mínimo ${min} h).`,
        });
      }
    }
    if (params.siguiente) {
      const h = horasDescansoEntre(nueva, params.siguiente);
      if (h < min) {
        avisos.push({
          clave: 'descanso-siguiente',
          texto: `El descanso con el turno siguiente (${params.siguiente.etiqueta}, ${params.siguiente.fechaISO}) es de ${formatHoras(h)} (mínimo ${min} h).`,
        });
      }
    }
  }
  return avisos;
}

function formatHoras(h: number): string {
  if (h < 0) return 'solape';
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Jornada "lite" de una asignación existente (para el cálculo de descanso). */
export function jornadaDeAsignacion(
  a: Asignacion,
  etiqueta: string,
): VecinoJornada {
  return {
    fechaISO: fechaISOUTC(a.fecha),
    horaInicio: a.horaInicio,
    horaFin: a.horaFin,
    etiqueta,
  };
}
