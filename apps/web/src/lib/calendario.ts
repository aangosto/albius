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
