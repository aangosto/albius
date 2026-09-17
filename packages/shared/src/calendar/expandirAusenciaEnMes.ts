/**
 * Expande el rango CERRADO [fechaInicio, fechaFin] de una ausencia (B32) a los
 * días ISO "YYYY-MM-DD" que caen DENTRO del mes natural (año, mes 1-12),
 * recortando por ambos extremos. Función pura, todo en UTC (`Date.UTC` /
 * `getUTC*`): las fechas de ausencia se persisten a medianoche UTC (igual que
 * las asignaciones y los festivos) y el orquestador genera `dias[]` también en
 * UTC — usar hora local aquí produciría el off-by-one clásico de Europe/Madrid.
 *
 * Contrato con el motor: cada día devuelto se emite como
 * `AusenciaInput {conductorId, fecha}` y el motor NO crea la variable de
 * asignación para ese par. Un rango totalmente fuera del mes devuelve `[]`.
 *
 * NOTA: `apps/functions/src/calendar.ts` mantiene un ESPEJO runtime 1:1 de
 * esta función (TODO[refactor-shared-build]). Mantener sincronizados.
 */
export function expandirAusenciaEnMes(
  fechaInicio: Date,
  fechaFin: Date,
  año: number,
  mes: number,
): string[] {
  // Normaliza a "día UTC" (descarta la hora) en milisegundos.
  const diaUTC = (d: Date): number =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const primerDiaMes = Date.UTC(año, mes - 1, 1);
  const ultimoDiaMes = Date.UTC(año, mes, 0); // día 0 del mes siguiente

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
