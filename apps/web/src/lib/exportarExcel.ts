/**
 * Excel del cuadrante (B36.2). Se carga con `import()` desde
 * `ExportarCuadranteMenu`, así que `exceljs` (~950 kB min) vive en su propio
 * chunk y NO entra en el bundle principal ni en el de CalendarioPage.
 *
 * Por qué exceljs y no xlsx (SheetJS): los PANELES FIJOS y los COLORES son
 * justo lo que hace útil un Excel frente al CSV (B36.1); la edición gratuita
 * de SheetJS no colorea y su paquete npm está desactualizado. Aprobación §10
 * en B36.2.
 *
 * Dos hojas:
 *   - "Cuadrante": rejilla conductor × día (de `construirRejilla`, con
 *     ausencias, D6.29), panel fijo en la columna del conductor y en la fila
 *     de cabecera, findes sombreados, turno con TINTE CLARO del color de su
 *     línea y texto negro (se imprime en B/N con frecuencia), ausencia con
 *     estilo propio, `D` en descanso. Leyenda de líneas al pie.
 *   - "Resumen": metadatos del cuadrante y del fichero + KPIs de
 *     `estadisticas` (aquí caben; en el PDF no).
 *
 * Se exporta en CUALQUIER estado (trabajo interno del jefe, no va al tablón).
 */
import ExcelJS from 'exceljs';
import type { Cuadrante, Linea } from '@albius/shared';
import { textoCeldaExport, type CeldaRejilla, type Rejilla } from '@/lib/calendario';
import {
  etiquetaConductorExport,
  formatoFechaHora,
  tinteClaro,
  type MetadatosExport,
} from '@/lib/exportar';

export interface ContextoExcel {
  rejilla: Rejilla;
  meta: MetadatosExport;
  cuadrante: Cuadrante;
  lineas: Linea[];
}

// Paleta (ARGB). Grises de Tailwind slate/gray para que case con la app.
const ARGB = {
  negro: 'FF111111',
  grisTexto: 'FF6B7280',
  grisAusencia: 'FF4B5563',
  grisDescanso: 'FF9CA3AF',
  borde: 'FFD1D5DB',
  cabecera: 'FFF1F5F9',
  cabeceraFinde: 'FFE2E8F0',
  finde: 'FFF8FAFC',
  ausencia: 'FFE5E7EB',
  blanco: 'FFFFFFFF',
} as const;

const ANCHO_CONDUCTOR = 30;
const ANCHO_DIA = 6.5;

const bordeFino: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: ARGB.borde } },
  left: { style: 'thin', color: { argb: ARGB.borde } },
  bottom: { style: 'thin', color: { argb: ARGB.borde } },
  right: { style: 'thin', color: { argb: ARGB.borde } },
};

function relleno(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** "#1F77B4" → "FF1F77B4" (ARGB opaco). */
function argbDe(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`;
}

// ============================================================================
//  Hoja "Cuadrante"
// ============================================================================

function estiloCelda(celda: CeldaRejilla | undefined, esFinde: boolean): {
  fill?: ExcelJS.Fill;
  font: Partial<ExcelJS.Font>;
} {
  if (celda?.turno) {
    const bg = celda.turno.bg;
    return {
      fill: bg ? relleno(argbDe(tinteClaro(bg))) : relleno(ARGB.cabecera),
      font: { bold: true, color: { argb: ARGB.negro } },
    };
  }
  if (celda?.ausencia) {
    return {
      fill: relleno(ARGB.ausencia),
      font: { italic: true, color: { argb: ARGB.grisAusencia } },
    };
  }
  return {
    fill: esFinde ? relleno(ARGB.finde) : undefined,
    font: { color: { argb: ARGB.grisDescanso } },
  };
}

function hojaCuadrante(wb: ExcelJS.Workbook, ctx: ContextoExcel): void {
  const { rejilla, lineas } = ctx;
  const ws = wb.addWorksheet('Cuadrante', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  ws.columns = [
    { width: ANCHO_CONDUCTOR },
    ...rejilla.dias.map(() => ({ width: ANCHO_DIA })),
  ];

  // Cabecera: "Conductor" + "1\nM", "2\nX"… (findes sombreados).
  const cabecera = ws.addRow([
    'Conductor',
    ...rejilla.dias.map((d) => `${d.dia}\n${d.abrev}`),
  ]);
  cabecera.height = 30;
  cabecera.eachCell((cell, col) => {
    const dia = rejilla.dias[col - 2];
    cell.font = { bold: true, color: { argb: ARGB.negro } };
    cell.fill = relleno(dia?.esFinde ? ARGB.cabeceraFinde : ARGB.cabecera);
    cell.alignment = { vertical: 'middle', horizontal: col === 1 ? 'left' : 'center', wrapText: true };
    cell.border = bordeFino;
  });

  for (const fila of rejilla.filas) {
    const row = ws.addRow([
      etiquetaConductorExport(fila),
      ...rejilla.dias.map((d) => textoCeldaExport(fila.celdas.get(d.dia))),
    ]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = bordeFino;
      if (col === 1) {
        cell.font = { bold: true, color: { argb: ARGB.negro } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        return;
      }
      const dia = rejilla.dias[col - 2];
      const estilo = estiloCelda(fila.celdas.get(dia?.dia ?? 0), dia?.esFinde ?? false);
      cell.font = estilo.font;
      if (estilo.fill) cell.fill = estilo.fill;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  }

  // Leyenda al pie: acompaña a lo que explica (los colores de la rejilla).
  ws.addRow([]);
  const titulo = ws.addRow(['Leyenda']);
  titulo.getCell(1).font = { bold: true, color: { argb: ARGB.negro } };
  for (const l of lineas.filter((l) => l.color)) {
    const r = ws.addRow([`Línea ${l.codigo} — ${l.nombre}`]);
    const c = r.getCell(1);
    c.fill = relleno(argbDe(tinteClaro(l.color!)));
    c.font = { color: { argb: ARGB.negro } };
    c.border = bordeFino;
  }
  const rAus = ws.addRow(['V, B, AP… — ausencia (código de la empresa o categoría)']);
  const cAus = rAus.getCell(1);
  cAus.fill = relleno(ARGB.ausencia);
  cAus.font = { italic: true, color: { argb: ARGB.grisAusencia } };
  cAus.border = bordeFino;
  const rD = ws.addRow(['D — descanso']);
  rD.getCell(1).font = { color: { argb: ARGB.grisTexto } };
}

// ============================================================================
//  Hoja "Resumen"
// ============================================================================

const KPI_LABEL: Record<string, { label: string; sufijo?: string }> = {
  coberturaServicios: { label: 'Cobertura de servicios', sufijo: '%' },
  satisfaccionMedia: { label: 'Satisfacción media', sufijo: '%' },
  preferenciasCumplidas: { label: 'Preferencias cumplidas' },
  preferenciasNoCumplidas: { label: 'Preferencias no cumplidas' },
  findesConsecutivosExcedidos: { label: 'Findes consecutivos excedidos' },
  conductoresConFindesExcedidos: { label: 'Conductores con findes excedidos' },
};

const MODO_GENERACION_LABEL: Record<string, string> = {
  optimizador_libre: 'optimizador',
  manual: 'manual',
};

function fechaTs(ts: { toDate(): Date } | undefined): string {
  return ts ? formatoFechaHora(ts.toDate()) : '—';
}

function hojaResumen(wb: ExcelJS.Workbook, ctx: ContextoExcel): void {
  const { meta, cuadrante, rejilla } = ctx;
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 36 }, { width: 44 }];

  const seccion = (titulo: string) => {
    const r = ws.addRow([titulo]);
    r.getCell(1).font = { bold: true, size: 12, color: { argb: ARGB.negro } };
  };
  const par = (clave: string, valor: string | number) => {
    const r = ws.addRow([clave, valor]);
    r.getCell(1).font = { bold: true, color: { argb: ARGB.negro } };
    r.getCell(1).fill = relleno(ARGB.cabecera);
    r.getCell(1).border = bordeFino;
    r.getCell(2).border = bordeFino;
    r.getCell(2).alignment = { horizontal: 'left' };
  };

  seccion('Cuadrante');
  par('Centro', meta.centroNombre);
  par('Mes', `${String(meta.mes).padStart(2, '0')}/${meta.año}`);
  par('Estado', cuadrante.estado);
  par('Versión', cuadrante.versionActual);
  par(
    'Generación del cuadrante',
    `${fechaTs(cuadrante.fechaGeneracion)} (${
      MODO_GENERACION_LABEL[cuadrante.modoGeneracion] ?? cuadrante.modoGeneracion
    })`,
  );
  par('Publicación', fechaTs(cuadrante.fechaPublicacion));
  par('Fichero generado', `${formatoFechaHora(meta.generadoEn)} por Albius`);

  ws.addRow([]);
  seccion('Totales');
  par('Conductores', rejilla.filas.length);
  let turnos = 0;
  let diasAusencia = 0;
  for (const f of rejilla.filas) {
    for (const c of f.celdas.values()) {
      if (c.turno) turnos++;
      else if (c.ausencia) diasAusencia++;
    }
  }
  par('Asignaciones (turnos)', turnos);
  par('Días de ausencia (sin turno)', diasAusencia);

  ws.addRow([]);
  seccion('KPIs del optimizador');
  const est = cuadrante.estadisticas;
  if (!est) {
    ws.addRow(['Sin estadísticas: el cuadrante no se ha generado con el optimizador.']);
    return;
  }
  const vistas = new Set<string>();
  for (const [k, def] of Object.entries(KPI_LABEL)) {
    const v = est[k];
    if (v === undefined) continue;
    vistas.add(k);
    par(def.label, def.sufijo ? `${formatNum(v)}${def.sufijo}` : v);
  }
  // Claves nuevas del motor que aún no tengan etiqueta (index signature).
  for (const [k, v] of Object.entries(est)) {
    if (vistas.has(k) || typeof v !== 'number') continue;
    par(k, v);
  }
  ws.addRow([]);
  ws.addRow([
    'Nota: los KPIs se calculan al generar; una edición manual posterior no los actualiza.',
  ]).getCell(1).font = { italic: true, color: { argb: ARGB.grisTexto } };
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ============================================================================
//  Entrada
// ============================================================================

/** Genera el .xlsx y devuelve sus bytes (para `descargarFichero`). */
export async function generarExcelCuadrante(ctx: ContextoExcel): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Albius';
  wb.created = ctx.meta.generadoEn;
  hojaCuadrante(wb, ctx);
  hojaResumen(wb, ctx);
  // En navegador exceljs devuelve un Buffer polyfill (Uint8Array): vale como
  // BlobPart tal cual.
  return (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer;
}

export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
