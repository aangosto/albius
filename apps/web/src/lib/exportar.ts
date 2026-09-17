/**
 * Exportación del cuadrante (B36) — helpers PUROS de formato + la descarga en
 * navegador. Sin React. Sin dependencias: B36.1 entrega CSV; Excel (B36.2) y
 * PDF (B36.3) se añadirán aquí (o en módulos hermanos cargados con `import()`
 * al pulsar, para no tocar el primer paint).
 *
 * La rejilla viene de `construirRejilla` (lib/calendario, con las ausencias ya
 * cruzadas, D6.29). Regla de celda (B36.1): código del turno > etiqueta de
 * ausencia > `D` (descanso; nunca en blanco, como los cuadrantes reales).
 */
import type { Cuadrante } from '@albius/shared';
import { textoCeldaExport, type Rejilla } from '@/lib/calendario';

export interface MetadatosExport {
  /** Nombre del centro (o su id si no se pudo leer). */
  centroNombre: string;
  año: number;
  mes: number;
  estado: Cuadrante['estado'];
  /** Instante de generación del fichero. */
  generadoEn: Date;
}

// ============================================================================
//  Nombre de fichero
// ============================================================================

/** "Centro Test · Cartagena" → "centro-test-cartagena". */
export function slugFichero(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "cuadrante_<centro>_2026-09.<ext>" (el mes con dos dígitos, ordena bien). */
export function nombreFicheroCuadrante(
  meta: Pick<MetadatosExport, 'centroNombre' | 'año' | 'mes'>,
  ext: string,
): string {
  const centro = slugFichero(meta.centroNombre) || 'centro';
  return `cuadrante_${centro}_${meta.año}-${String(meta.mes).padStart(2, '0')}.${ext}`;
}

// ============================================================================
//  CSV
// ============================================================================

/**
 * `;` porque el Excel con configuración regional española usa la coma como
 * separador decimal y espera punto y coma entre campos; con `,` metería toda
 * la fila en una celda.
 */
export const CSV_SEPARADOR = ';';
/** BOM UTF-8: sin él, Excel (Windows) abre el fichero como ANSI y rompe ñ/acentos. */
export const CSV_BOM = '﻿';
/** Fin de línea de Windows (RFC 4180; Excel lo prefiere). */
export const CSV_EOL = '\r\n';

/** Escapa un campo CSV: comillas si contiene separador, comillas o saltos. */
export function campoCSV(valor: string): string {
  if (/[";\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

export function filaCSV(campos: string[]): string {
  return campos.map(campoCSV).join(CSV_SEPARADOR);
}

/** "17/09/2026 18:05" en hora LOCAL: es la hora a la que el jefe pulsó Exportar
 *  (no una fecha del dominio; D6.22 no aplica). */
export function formatoFechaHora(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** Etiqueta de la fila del conductor: "Apellidos, Nombre (nº empleado)". */
export function etiquetaConductorExport(fila: Rejilla['filas'][number]): string {
  return fila.numeroEmpleado ? `${fila.label} (${fila.numeroEmpleado})` : fila.label;
}

/**
 * CSV del cuadrante completo: cabecera con centro / mes / estado / generación,
 * una línea en blanco, y la tabla conductor × día (una columna por día del mes,
 * cabecera "1 M", "2 X"…).
 */
export function generarCSVCuadrante(rejilla: Rejilla, meta: MetadatosExport): string {
  const mesLabel = `${String(meta.mes).padStart(2, '0')}/${meta.año}`;
  const lineas: string[] = [
    filaCSV(['Cuadrante', meta.centroNombre]),
    filaCSV(['Mes', mesLabel]),
    filaCSV(['Estado', meta.estado]),
    filaCSV(['Generado', `${formatoFechaHora(meta.generadoEn)} por Albius`]),
    '',
    filaCSV(['Conductor', ...rejilla.dias.map((d) => `${d.dia} ${d.abrev}`)]),
  ];
  for (const fila of rejilla.filas) {
    lineas.push(
      filaCSV([
        etiquetaConductorExport(fila),
        ...rejilla.dias.map((d) => textoCeldaExport(fila.celdas.get(d.dia))),
      ]),
    );
  }
  return CSV_BOM + lineas.join(CSV_EOL) + CSV_EOL;
}

// ============================================================================
//  Descarga en navegador
// ============================================================================

/**
 * Descarga `contenido` como fichero. Blob + <a download>: sin servidor, sin
 * permisos. El object URL se libera tras el clic.
 */
export function descargarFichero(
  nombre: string,
  contenido: BlobPart,
  mime: string,
): void {
  const blob = new Blob([contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Diferido: algunos navegadores cancelan la descarga si se revoca en el acto.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
