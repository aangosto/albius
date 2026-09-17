/**
 * PDF del cuadrante (B36.3) — el que va al TABLÓN. Se carga con `import()`
 * desde `ExportarCuadranteMenu`, así que `jspdf` + `jspdf-autotable` (~430 kB
 * min) viven en su propio chunk y NO entran en el bundle principal.
 *
 * Por qué jspdf + autotable (aprobación §10 en B36.3): pdfmake pesa ~2 MB por
 * las fuentes embebidas y pdf-lib no tiene layout de tablas; autotable da
 * tabla con salto de página automático, cabecera repetida y estilo por celda.
 *
 * Decisiones (recon B36.0, confirmadas):
 *   - A4 APAISADO por defecto, mes completo en columnas, FILAS PARTIDAS en
 *     bloques de ~30 conductores por página con CABECERA REPETIDA. Nada de
 *     60 filas a 6 pt: ilegible en un tablón. A3 apaisado como opción del
 *     MISMO layout (más filas por página y letra mayor).
 *   - TINTE CLARO del color de línea con texto negro (`tinteClaro`): los
 *     tablones se imprimen en B/N con frecuencia.
 *   - Descanso como `D`; ausencia con su código; gana el turno (B36.1).
 *   - Se exporta en CUALQUIER estado; si NO está publicado/cerrado lleva
 *     MARCA DE AGUA "BORRADOR" en cada página (el jefe lo imprime para
 *     revisarlo en papel; la marca evita que acabe en el tablón por error).
 *   - Cabecera: centro, mes, estado, fecha de generación del fichero y la
 *     LEYENDA de líneas en una línea compacta (muestras de color) en CADA
 *     página: no roba filas (la altura de la cabecera se calcula midiendo la
 *     leyenda y las filas se reparten en el resto) y evita una última página
 *     solo para la leyenda, que es lo que pasaba con 60 conductores a 30 por
 *     página. Sin KPIs (roban espacio; están en el Excel). Pie: "Generado por
 *     Albius el …" + "Página n de N".
 *   - Tamaño de letra de las celdas ADAPTATIVO: se mide el código más ancho
 *     (p.ej. `SP8AT`, 5 caracteres en TUCARSA) y se baja la letra (8 → 5,5
 *     pt) hasta que quepa en la columna del día sin cortarse. Si ni así
 *     cabe (códigos de 7+ caracteres en A4), autotable parte el texto en dos
 *     líneas en vez de truncarlo: se sigue leyendo.
 *
 * Fuentes estándar de jsPDF (Helvetica, WinAnsi): ñ, acentos, «·» y «—»
 * salen bien sin embeber nada.
 */
import { jsPDF } from 'jspdf';
import { autoTable, type CellHookData, type HookData } from 'jspdf-autotable';
import type { Cuadrante, Linea } from '@albius/shared';
import { textoCeldaExport, type CeldaRejilla, type Rejilla } from '@/lib/calendario';
import {
  etiquetaConductorExport,
  formatoFechaHora,
  tinteClaro,
  type MetadatosExport,
} from '@/lib/exportar';

export type FormatoPagina = 'a4' | 'a3';

export interface ContextoPdf {
  rejilla: Rejilla;
  meta: MetadatosExport;
  cuadrante: Cuadrante;
  lineas: Linea[];
  formato: FormatoPagina;
}

export const MIME_PDF = 'application/pdf';

type RGB = [number, number, number];

const COLOR = {
  texto: [17, 17, 17] as RGB,
  textoSuave: [110, 110, 110] as RGB,
  descanso: [150, 150, 150] as RGB,
  ausenciaTexto: [75, 85, 99] as RGB,
  ausenciaFondo: [229, 231, 235] as RGB,
  cabecera: [241, 245, 249] as RGB,
  cabeceraFinde: [226, 232, 240] as RGB,
  finde: [248, 250, 252] as RGB,
  sinLinea: [241, 245, 249] as RGB,
  borde: [190, 190, 190] as RGB,
  marcaAgua: [140, 140, 140] as RGB,
};

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Geometría por formato (mm). */
const GEO: Record<FormatoPagina, {
  margen: number;
  altoCabecera: number;
  altoPie: number;
  anchoNombre: number;
  filasObjetivo: number;
  fontMax: number;
  fontMin: number;
}> = {
  a4: { margen: 10, altoCabecera: 12, altoPie: 8, anchoNombre: 36, filasObjetivo: 30, fontMax: 8, fontMin: 5.5 },
  a3: { margen: 12, altoCabecera: 13, altoPie: 8, anchoNombre: 48, filasObjetivo: 38, fontMax: 9.5, fontMin: 6 },
};

const PLACEHOLDER_TOTAL = '{total_pages}';

function rgbDe(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mesLabel(año: number, mes: number): string {
  return `${MESES[mes - 1] ?? mes} ${año}`;
}

// ============================================================================
//  Tamaño de letra adaptativo (PASO 4)
// ============================================================================

/**
 * Mayor tamaño de letra en [fontMin, fontMax] con el que el texto más ancho de
 * las celdas cabe en `anchoCol` (descontando el padding). Mide con la fuente
 * en NEGRITA (la de los turnos, la más ancha). Devuelve también si cabe.
 */
export function ajustarFontCeldas(
  doc: jsPDF,
  textos: string[],
  anchoCol: number,
  paddingH: number,
  fontMax: number,
  fontMin: number,
): { fontSize: number; cabe: boolean } {
  doc.setFont('helvetica', 'bold');
  const disponible = anchoCol - 2 * paddingH;
  const anchoDe = (t: string, size: number) => {
    doc.setFontSize(size);
    return doc.getTextWidth(t);
  };
  // El más ancho a un tamaño de referencia es el más ancho a cualquiera.
  const masAncho = textos.reduce(
    (a, b) => (anchoDe(b, fontMax) > anchoDe(a, fontMax) ? b : a),
    'D',
  );
  for (let size = fontMax; size >= fontMin - 1e-9; size -= 0.5) {
    if (anchoDe(masAncho, size) <= disponible) return { fontSize: size, cabe: true };
  }
  return { fontSize: fontMin, cabe: false };
}

// ============================================================================
//  Cabecera, pie, marca de agua (por página)
// ============================================================================

function dibujarCabecera(doc: jsPDF, ctx: ContextoPdf, geo: (typeof GEO)['a4']): void {
  const pageW = doc.internal.pageSize.getWidth();
  const y = geo.margen + 5;
  doc.setTextColor(...COLOR.texto);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Cuadrante · ${ctx.meta.centroNombre}`, geo.margen, y);
  doc.text(mesLabel(ctx.meta.año, ctx.meta.mes), pageW - geo.margen, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.textoSuave);
  doc.text(
    `Estado: ${ctx.meta.estado} · Generado el ${formatoFechaHora(ctx.meta.generadoEn)}`,
    geo.margen,
    y + 5,
  );
  // Leyenda en la cabecera (misma altura que se reservó al medirla).
  flujoLeyenda(doc, ctx, geo, y + 10, true);
}

function dibujarPie(doc: jsPDF, ctx: ContextoPdf, geo: (typeof GEO)['a4'], pagina: number): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const y = pageH - geo.margen + 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLOR.textoSuave);
  doc.text(`Generado por Albius el ${formatoFechaHora(ctx.meta.generadoEn)}`, geo.margen, y);
  doc.text(`Página ${pagina} de ${PLACEHOLDER_TOTAL}`, pageW - geo.margen, y, { align: 'right' });
}

function dibujarMarcaAgua(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  doc.setGState(doc.GState({ opacity: 0.16 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(pageW > 400 ? 150 : 110);
  doc.setTextColor(...COLOR.marcaAgua);
  doc.text('BORRADOR', pageW / 2, pageH / 2 + 15, { align: 'center', angle: 22 });
  doc.restoreGraphicsState();
}

function decorarPagina(doc: jsPDF, ctx: ContextoPdf, geo: (typeof GEO)['a4'], pagina: number, marcaAgua: boolean): void {
  dibujarCabecera(doc, ctx, geo);
  dibujarPie(doc, ctx, geo, pagina);
  if (marcaAgua) dibujarMarcaAgua(doc);
}

// ============================================================================
//  Leyenda (en la cabecera de cada página)
// ============================================================================

const LEYENDA_FONT = 7.5;
const LEYENDA_ALTO_FILA = 4.2;

interface ItemLeyenda {
  etiqueta: string;
  fondo: RGB | null;
  texto: RGB;
  italic?: boolean;
}

function itemsLeyenda(ctx: ContextoPdf): ItemLeyenda[] {
  const items: ItemLeyenda[] = ctx.lineas
    .filter((l) => l.color)
    .map((l) => ({
      etiqueta: `Línea ${l.codigo} — ${l.nombre}`,
      fondo: rgbDe(tinteClaro(l.color!)),
      texto: COLOR.texto,
    }));
  items.push({
    etiqueta: 'V, B, AP… ausencia (código de la empresa)',
    fondo: COLOR.ausenciaFondo,
    texto: COLOR.ausenciaTexto,
    italic: true,
  });
  items.push({ etiqueta: 'D descanso', fondo: null, texto: COLOR.descanso });
  return items;
}

/**
 * Recorre los items en flujo horizontal (con salto de línea) y, si `dibujar`,
 * los pinta. Devuelve el número de filas que ocupa: se llama primero SIN
 * dibujar para reservar la altura de la cabecera, y después en cada página.
 */
function flujoLeyenda(
  doc: jsPDF,
  ctx: ContextoPdf,
  geo: (typeof GEO)['a4'],
  y0: number,
  dibujar: boolean,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const xMax = pageW - geo.margen;
  doc.setFontSize(LEYENDA_FONT);
  let x = geo.margen;
  let y = y0;
  let filas = 1;
  for (const it of itemsLeyenda(ctx)) {
    doc.setFont('helvetica', it.italic ? 'italic' : 'normal');
    const anchoSwatch = it.fondo ? 5.5 : 0;
    const ancho = anchoSwatch + doc.getTextWidth(it.etiqueta) + 6;
    if (x + ancho > xMax && x > geo.margen) {
      x = geo.margen;
      y += LEYENDA_ALTO_FILA;
      filas++;
    }
    if (dibujar) {
      if (it.fondo) {
        doc.setFillColor(...it.fondo);
        doc.setDrawColor(...COLOR.borde);
        doc.rect(x, y - 2.7, 4, 3.2, 'FD');
      }
      doc.setTextColor(...it.texto);
      doc.text(it.etiqueta, x + anchoSwatch, y);
    }
    x += ancho;
  }
  return filas;
}

// ============================================================================
//  Entrada
// ============================================================================

/** Genera el PDF y devuelve sus bytes (para `descargarFichero`). */
export function generarPdfCuadrante(ctx: ContextoPdf): ArrayBuffer {
  const geo = GEO[ctx.formato];
  const { rejilla } = ctx;
  const { dias, filas } = rejilla;
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: ctx.formato,
    compress: true,
  });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marcaAgua = ctx.meta.estado === 'borrador';

  // --- Geometría de la tabla ---
  const anchoTabla = pageW - 2 * geo.margen;
  const anchoDia = (anchoTabla - geo.anchoNombre) / dias.length;
  const paddingH = 0.4;
  const textos = new Set<string>(['D']);
  for (const f of filas) for (const c of f.celdas.values()) textos.add(textoCeldaExport(c));
  const { fontSize } = ajustarFontCeldas(
    doc,
    [...textos],
    anchoDia,
    paddingH,
    geo.fontMax,
    geo.fontMin,
  );
  // Altura real de la cabecera = base + filas que ocupe la leyenda (medida).
  const filasLeyenda = flujoLeyenda(doc, ctx, geo, 0, false);
  const topTabla = geo.margen + geo.altoCabecera + filasLeyenda * LEYENDA_ALTO_FILA + 1;
  const altoCabTabla = 9;
  const altoDisponible = pageH - topTabla - geo.margen - geo.altoPie - altoCabTabla;
  const minCellHeight = Math.max(4.5, Math.floor((altoDisponible / geo.filasObjetivo) * 10) / 10);

  const head = [['Conductor', ...dias.map((d) => `${d.dia}\n${d.abrev}`)]];
  const body = filas.map((f) => [
    etiquetaConductorExport(f),
    ...dias.map((d) => textoCeldaExport(f.celdas.get(d.dia))),
  ]);

  const columnStyles: Record<number, { cellWidth: number; halign?: 'left'; fontStyle?: 'bold'; overflow?: 'ellipsize' }> = {
    0: { cellWidth: geo.anchoNombre, halign: 'left', fontStyle: 'bold', overflow: 'ellipsize' },
  };
  dias.forEach((_, i) => {
    columnStyles[i + 1] = { cellWidth: anchoDia };
  });

  const estiloCelda = (data: CellHookData, celda: CeldaRejilla | undefined, esFinde: boolean) => {
    const s = data.cell.styles;
    if (celda?.turno) {
      s.fillColor = celda.turno.bg ? rgbDe(tinteClaro(celda.turno.bg)) : COLOR.sinLinea;
      s.textColor = COLOR.texto;
      s.fontStyle = 'bold';
      return;
    }
    if (celda?.ausencia) {
      s.fillColor = COLOR.ausenciaFondo;
      s.textColor = COLOR.ausenciaTexto;
      s.fontStyle = 'italic';
      return;
    }
    s.textColor = COLOR.descanso;
    if (esFinde) s.fillColor = COLOR.finde;
  };

  autoTable(doc, {
    head,
    body,
    startY: topTabla,
    margin: {
      left: geo.margen,
      right: geo.margen,
      top: topTabla,
      bottom: geo.margen + geo.altoPie,
    },
    tableWidth: anchoTabla,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: {
      font: 'helvetica',
      fontSize,
      cellPadding: { top: 0.6, bottom: 0.6, left: paddingH, right: paddingH },
      halign: 'center',
      valign: 'middle',
      lineColor: COLOR.borde,
      lineWidth: 0.15,
      textColor: COLOR.texto,
      minCellHeight,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: COLOR.cabecera,
      textColor: COLOR.texto,
      fontStyle: 'bold',
      fontSize: Math.max(fontSize, 7),
      minCellHeight: altoCabTabla,
      valign: 'middle',
    },
    columnStyles,
    didParseCell: (data: CellHookData) => {
      const col = data.column.index;
      if (col === 0) {
        if (data.section === 'body') data.cell.styles.fontSize = Math.max(fontSize, 7);
        return;
      }
      const dia = dias[col - 1];
      if (!dia) return;
      if (data.section === 'head') {
        if (dia.esFinde) data.cell.styles.fillColor = COLOR.cabeceraFinde;
        return;
      }
      if (data.section !== 'body') return;
      const fila = filas[data.row.index];
      estiloCelda(data, fila?.celdas.get(dia.dia), dia.esFinde);
    },
    didDrawPage: (data: HookData) => {
      decorarPagina(doc, ctx, geo, data.pageNumber, marcaAgua);
    },
  });

  doc.putTotalPages(PLACEHOLDER_TOTAL);
  return doc.output('arraybuffer');
}
