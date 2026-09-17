/**
 * ESPEJO RUNTIME de `resolverTipoDia` (B27, B29 Fase C).
 *
 * Reimplementación 1:1 de `packages/shared/src/calendar/resolverTipoDia.ts`.
 * Existe por la misma razón que `collections.ts`: `@albius/shared` se distribuye
 * como TypeScript crudo (sin paso de build) y Node CJS (donde corren las
 * functions tras compilar a `lib/`) no resuelve los `.ts` en runtime — un
 * `import { resolverTipoDia } from "@albius/shared"` rompería al hacer `require()`.
 *
 * TODO[refactor-shared-build]: cuando `@albius/shared` se compile a JS, eliminar
 * este archivo y volver a importar `resolverTipoDia` desde `@albius/shared`.
 * Mantener sincronizado con el original (la lógica del calendario es el contrato
 * compartido con el optimizador Python, que la reimplementa por su lado).
 *
 * El orquestador del optimizador (B29 Fase C) lo usa para construir el mapa
 * fecha→tipoDia del mes a partir de los festivos del centro leídos de Firestore.
 *
 * `TipoDia` se importa SOLO como tipo (los type-imports de `@albius/shared` sí
 * funcionan en functions; solo el runtime `require` de sus `.ts` rompe). El
 * Festivo se acepta como forma estructural mínima (`FestivoLike`) para no acoplar
 * al `Timestamp` de shared: el Admin SDK Timestamp también expone `.toDate()`.
 */
import type { TipoDia } from "@albius/shared";

/**
 * Forma mínima que `resolverTipoDia` necesita de un Festivo. El Festivo real
 * (Admin SDK) trae `fecha: Timestamp` (con `.toDate()`) y `tipoTraficoAplicable`
 * ('festivo'|'domingo'|'laborable', subconjunto de TipoDia).
 */
export interface FestivoLike {
  fecha: { toDate(): Date };
  tipoTraficoAplicable: TipoDia;
}

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
 *     `tipoTraficoAplicable`. El primero que coincida gana (el caller no debería
 *     pasar dos festivos contradictorios para el mismo día/centro).
 *   - Si no hay festivo → por día de semana: sábado→'sabado', domingo→'domingo',
 *     resto→'laborable'.
 *
 * El caller PRE-FILTRA los festivos aplicables al centro (un Festivo puede ser de
 * un centro o de todo el tenant). Comparación en UTC (coherente con
 * assertFechaEnMes de B26).
 */
export function resolverTipoDia(
  fecha: Date,
  festivosAplicables: FestivoLike[],
): TipoDia {
  for (const f of festivosAplicables) {
    if (mismoDiaUTC(fecha, f.fecha.toDate())) {
      return f.tipoTraficoAplicable;
    }
  }
  const diaSemana = fecha.getUTCDay(); // 0=domingo … 6=sábado
  if (diaSemana === 6) return "sabado";
  if (diaSemana === 0) return "domingo";
  return "laborable";
}

/**
 * ESPEJO RUNTIME 1:1 de `packages/shared/src/calendar/expandirAusenciaEnMes.ts`
 * (B32.3; misma razón que `resolverTipoDia` arriba — TODO[refactor-shared-build]).
 * Expande el rango CERRADO [fechaInicio, fechaFin] de una ausencia a los días ISO
 * "YYYY-MM-DD" que caen dentro del mes natural, recortando por ambos extremos.
 * Todo en UTC. Rango fuera del mes (o invertido) → []. Los tests unitarios viven
 * en shared (vitest); mantener sincronizados.
 */
export function expandirAusenciaEnMes(
  fechaInicio: Date,
  fechaFin: Date,
  año: number,
  mes: number,
): string[] {
  const diaUTC = (d: Date): number =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const primerDiaMes = Date.UTC(año, mes - 1, 1);
  const ultimoDiaMes = Date.UTC(año, mes, 0);

  const desde = Math.max(diaUTC(fechaInicio), primerDiaMes);
  const hasta = Math.min(diaUTC(fechaFin), ultimoDiaMes);
  if (desde > hasta) return [];

  const MS_DIA = 24 * 60 * 60 * 1000;
  const dias: string[] = [];
  for (let t = desde; t <= hasta; t += MS_DIA) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}
