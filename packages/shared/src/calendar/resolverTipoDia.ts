/**
 * Calendario: resolución del tipo de día de una fecha (B27).
 *
 * Función PURA (sin deps, sin I/O) — patrón de validators/cif.ts. Alimenta la
 * DEMANDA del optimizador: para cada día del mes, qué `TipoDia` aplica, y de ahí
 * qué tipos de turno (con ese día en `tiposDiaAplicables`) deben cubrirse.
 *
 * El caller PRE-FILTRA los festivos aplicables al centro antes de llamar (un
 * Festivo puede ser de un centro o de todo el tenant, `centroId?`); esta función
 * no conoce centros. El caller convierte Timestamp→Date donde haga falta.
 *
 * Comparación de día en UTC (coherente con assertFechaEnMes de B26 y con las
 * fechas ISO "YYYY-MM-DD" que se parsean a medianoche UTC). El caller debe pasar
 * `fecha` como Date que represente el día deseado en UTC.
 *
 * El optimizador Python (bloque futuro) reimplementará esta misma lógica; el
 * contrato compartido es la colección `festivos`, no esta función.
 */
import type { Festivo } from '../types';
import type { TipoDia } from '../types';

function mismoDiaUTC(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Devuelve el `TipoDia` de `fecha`:
 *   - Si algún festivo de `festivosAplicables` cae el mismo día (UTC) → su
 *     `tipoTraficoAplicable` ('festivo'|'domingo'|'laborable', ya son TipoDia
 *     válidos). El primero que coincida gana (el caller no debería pasar dos
 *     festivos contradictorios para el mismo día/centro).
 *   - Si no hay festivo → por día de semana: sábado→'sabado', domingo→'domingo',
 *     resto→'laborable'.
 */
export function resolverTipoDia(
  fecha: Date,
  festivosAplicables: Festivo[],
): TipoDia {
  for (const f of festivosAplicables) {
    if (mismoDiaUTC(fecha, f.fecha.toDate())) {
      return f.tipoTraficoAplicable;
    }
  }
  const diaSemana = fecha.getUTCDay(); // 0=domingo … 6=sábado
  if (diaSemana === 6) return 'sabado';
  if (diaSemana === 0) return 'domingo';
  return 'laborable';
}
