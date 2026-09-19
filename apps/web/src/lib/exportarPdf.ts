/**
 * PDF del cuadrante (B36.3 + B36.4) — el que va al TABLÓN. Se carga con
 * `import()` desde `ExportarCuadranteMenu`, así que `jspdf` + `jspdf-autotable`
 * (~430 kB min) viven en su propio chunk y NO entran en el bundle principal.
 *
 * Por qué jspdf + autotable (aprobación §10 en B36.3): pdfmake pesa ~2 MB por
 * las fuentes embebidas y pdf-lib no tiene layout de tablas; autotable da
 * tabla con salto de página automático, cabecera repetida y estilo por celda.
 *
 * Dos layouts sobre la MISMA rejilla (`construirRejilla`, ausencias cruzadas):
 *
 *   MENSUAL (`generarPdfCuadrante`, B36.3): A4/A3 apaisado, el mes completo
 *   en columnas, FILAS PARTIDAS en bloques de ~30 conductores por página con
 *   CABECERA REPETIDA. Nada de 60 filas a 6 pt: ilegible en un tablón.
 *
 *   SEMANAL (`generarPdfCuadranteSemanal`, B36.4): A4 apaisado, 7 columnas
 *   lunes→domingo, UNA SEMANA POR PÁGINA, todas las semanas del mes en un solo
 *   PDF (el jefe imprime y cuelga la que toca sin exportar cinco veces). Las
 *   semanas son naturales RECORTADAS AL MES (`semanasDelMes`: no se mezclan
 *   días de otro cuadrante; los huecos de fuera del mes van en gris y vacíos
 *   para que el lunes sea siempre la primera columna). Es el formato de los
 *   cuadrantes reales de TUCARSA: con 7 columnas las celdas son ~4× más
 *   anchas, la letra sube a 9-10 pt y el nombre cabe entero. Los conductores
 *   se reparten en páginas IGUALES por semana (60 → 2 páginas de 30, no
 *   38 + 22): con la altura mínima legible (7 pt) caben ~38 filas por página
 *   A4, así que 60 en una sola página exigiría filas de 2,6 mm (≈4,5 pt) y se
 *   descartó.
 *
 * Decisiones comunes (recon B36.0, confirmadas en papel):
 *   - TINTE CLARO del color de línea con texto negro (`tinteClaro`): los
 *     tablones se imprimen en B/N con frecuencia.
 *   - Descanso como `D`; ausencia con su código; gana el turno (B36.1).
 *   - Se exporta en CUALQUIER estado; si NO está publicado/cerrado lleva
 *     MARCA DE AGUA "BORRADOR" en cada página (el jefe lo imprime para
 *     revisarlo en papel; la marca evita que acabe en el tablón por error).
 *   - Cabecera: centro, periodo (mes o semana), estado, fecha de generación
 *     del fichero y la LEYENDA de líneas en una línea compacta (muestras de
 *     color) en CADA página: no roba filas (la altura de la cabecera se
 *     calcula midiendo la leyenda y las filas se reparten en el resto). Sin
 *     KPIs (roban espacio; están en el Excel). Pie: "Generado por Albius el …"
 *     + "Página n de N".
 *   - Tamaño de letra ADAPTATIVO (`ajustarFontCeldas`): se mide el texto más
 *     ancho y se baja la letra hasta que quepa en la columna sin cortarse.
 *     Se aplica a los códigos de turno (p.ej. `SP8AT`) Y, desde B36.4, a la
 *     COLUMNA DEL NOMBRE. Si ni así cabe, autotable parte el texto (turnos)
 *     o lo elide con «…» (nombre).
 *   - Columna del nombre (B36.4): en el MENSUAL va la etiqueta COMPACTA
 *     "Apellidos, N. (nº)" — los apellidos y el nº de empleado son el
 *     identificador real en una empresa de transporte, y antes se cortaba
 *     justo el final del nombre completo, que era lo que distinguía a una
 *     persona de otra. En el SEMANAL hay sitio y va el nombre completo.
 *
 * Fuentes estándar de jsPDF (Helvetica, WinAnsi): ñ, acentos, «·» y «—»
 * salen bien sin embeber nada.
 */
import { jsPDF } from 'jspdf';
import { autoTable, type CellHookData } from 'jspdf-autotable';
import type { Cuadrante, Linea } from '@albius/shared';
import {
  semanasDelMes,
  textoCeldaExport,
  type CeldaRejilla,
  type DiaColumna,
  type Rejilla,
  type SemanaDelMes,
} from '@/lib/calendario';
import {
  etiquetaConductorCompacta,
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

/** El semanal es siempre A4 apaisado. */
export type ContextoPdfSemanal = Omit<ContextoPdf, 'formato'>;

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
  fueraMes: [235, 235, 235] as RGB,
  sinLinea: [241, 245, 249] as RGB,
  borde: [190, 190, 190] as RGB,
  marcaAgua: [140, 140, 140] as RGB,
};

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Índice = lunes 0 … domingo 6 (columnas del semanal). */
const DIAS_SEMANA_LARGO = [
  'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo',
];

interface Geo {
  margen: number;
  altoCabecera: number;
  altoPie: number;
  anchoNombre: number;
  fontMax: number;
  fontMin: number;
  /** Letra de la columna del nombre: se adapta entre estos dos. */
  fontNombreMax: number;
  fontNombreMin: number;
}

/** Geometría por formato (mm) del MENSUAL. */
const GEO: Record<FormatoPagina, Geo & { filasObjetivo: number }> = {
  a4: { margen: 10, altoCabecera: 12, altoPie: 8, anchoNombre: 47, filasObjetivo: 30, fontMax: 8, fontMin: 5.5, fontNombreMax: 8, fontNombreMin: 6 },
  a3: { margen: 12, altoCabecera: 13, altoPie: 8, anchoNombre: 52, filasObjetivo: 38, fontMax: 9.5, fontMin: 6, fontNombreMax: 9.5, fontNombreMin: 7 },
};

/** Geometría del SEMANAL (A4 apaisado). */
const GEO_SEMANAL: Geo = {
  margen: 10, altoCabecera: 12, altoPie: 8, anchoNombre: 72, fontMax: 10, fontMin: 7, fontNombreMax: 10, fontNombreMin: 7,
};

const PLACEHOLDER_TOTAL = '{total_pages}';
const PADDING_V = 0.6;
const PADDING_H_NOMBRE = 1;
/** Altura de línea de Helvetica en mm por pt (1 pt = 0,3528 mm, interlineado 1,15). */
const MM_POR_PT = 0.3528 * 1.15;

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

function ddmm(d: DiaColumna, mes: number): string {
  return `${String(d.dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`;
}

// ============================================================================
//  Tamaño de letra adaptativo
// ============================================================================

/**
 * Mayor tamaño de letra en [fontMin, fontMax] con el que el texto más ancho de
 * las celdas cabe en `anchoCol` (descontando el padding). Mide con la fuente
 * en NEGRITA (la de los turnos y del nombre, la más ancha). Devuelve también
 * si cabe.
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

/** Altura mínima de una fila (mm) para que quepa una línea a `fontSize` pt. */
function altoFilaPara(fontSize: number): number {
  return fontSize * MM_POR_PT + 2 * PADDING_V;
}

// ============================================================================
//  Cabecera, pie, marca de agua (por página)
// ============================================================================

type ContextoComun = Omit<ContextoPdf, 'formato'>;

function dibujarCabecera(doc: jsPDF, ctx: ContextoComun, geo: Geo, periodo: string): void {
  const pageW = doc.internal.pageSize.getWidth();
  const y = geo.margen + 5;
  doc.setTextColor(...COLOR.texto);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`Cuadrante · ${ctx.meta.centroNombre}`, geo.margen, y);
  doc.text(periodo, pageW - geo.margen, y, { align: 'right' });
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

function dibujarPie(doc: jsPDF, ctx: ContextoComun, geo: Geo): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const y = pageH - geo.margen + 4;
  const pagina = doc.getCurrentPageInfo().pageNumber;
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

function decorarPagina(doc: jsPDF, ctx: ContextoComun, geo: Geo, periodo: string): void {
  dibujarCabecera(doc, ctx, geo, periodo);
  dibujarPie(doc, ctx, geo);
  if (ctx.meta.estado === 'borrador') dibujarMarcaAgua(doc);
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

function itemsLeyenda(ctx: ContextoComun): ItemLeyenda[] {
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
  ctx: ContextoComun,
  geo: Geo,
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
//  Piezas comunes de la tabla
// ============================================================================

/** Altura de la cabecera (título + estado + leyenda medida) → y de la tabla. */
function topTablaDe(doc: jsPDF, ctx: ContextoComun, geo: Geo): number {
  const filasLeyenda = flujoLeyenda(doc, ctx, geo, 0, false);
  return geo.margen + geo.altoCabecera + filasLeyenda * LEYENDA_ALTO_FILA + 1;
}

/** Todos los textos de celda de la rejilla (para medir la letra). */
function textosCeldas(rejilla: Rejilla): string[] {
  const textos = new Set<string>(['D']);
  for (const f of rejilla.filas) for (const c of f.celdas.values()) textos.add(textoCeldaExport(c));
  return [...textos];
}

function estiloCelda(data: CellHookData, celda: CeldaRejilla | undefined, esFinde: boolean): void {
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
}

function nuevoDoc(formato: FormatoPagina): jsPDF {
  return new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: formato,
    compress: true,
  });
}

/** Estilos base de autotable compartidos por los dos layouts. */
function estilosBase(fontSize: number, paddingH: number, minCellHeight: number, altoCabTabla: number) {
  return {
    styles: {
      font: 'helvetica' as const,
      fontSize,
      cellPadding: { top: PADDING_V, bottom: PADDING_V, left: paddingH, right: paddingH },
      halign: 'center' as const,
      valign: 'middle' as const,
      lineColor: COLOR.borde,
      lineWidth: 0.15,
      textColor: COLOR.texto,
      minCellHeight,
      overflow: 'linebreak' as const,
    },
    headStyles: {
      fillColor: COLOR.cabecera,
      textColor: COLOR.texto,
      fontStyle: 'bold' as const,
      fontSize: Math.max(fontSize, 7),
      minCellHeight: altoCabTabla,
      valign: 'middle' as const,
    },
  };
}

type EstiloColumna = {
  cellWidth: number;
  halign?: 'left';
  fontStyle?: 'bold';
  overflow?: 'ellipsize';
};

function columnaNombre(ancho: number): EstiloColumna {
  return { cellWidth: ancho, halign: 'left', fontStyle: 'bold', overflow: 'ellipsize' };
}

// ============================================================================
//  MENSUAL
// ============================================================================

/** Genera el PDF mensual y devuelve sus bytes (para `descargarFichero`). */
export function generarPdfCuadrante(ctx: ContextoPdf): ArrayBuffer {
  const geo = GEO[ctx.formato];
  const { dias, filas } = ctx.rejilla;
  const doc = nuevoDoc(ctx.formato);
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // --- Geometría de la tabla ---
  const anchoTabla = pageW - 2 * geo.margen;
  const anchoDia = (anchoTabla - geo.anchoNombre) / dias.length;
  const paddingH = 0.4;
  const { fontSize } = ajustarFontCeldas(
    doc, textosCeldas(ctx.rejilla), anchoDia, paddingH, geo.fontMax, geo.fontMin,
  );
  const etiquetas = filas.map(etiquetaConductorCompacta);
  const { fontSize: fontNombre } = ajustarFontCeldas(
    doc, etiquetas, geo.anchoNombre, PADDING_H_NOMBRE, geo.fontNombreMax, geo.fontNombreMin,
  );
  const topTabla = topTablaDe(doc, ctx, geo);
  const altoCabTabla = 9;
  const altoDisponible = pageH - topTabla - geo.margen - geo.altoPie - altoCabTabla;
  const minCellHeight = Math.max(4.5, Math.floor((altoDisponible / geo.filasObjetivo) * 10) / 10);

  const head = [['Conductor', ...dias.map((d) => `${d.dia}\n${d.abrev}`)]];
  const body = filas.map((f, i) => [
    etiquetas[i] ?? '',
    ...dias.map((d) => textoCeldaExport(f.celdas.get(d.dia))),
  ]);

  const columnStyles: Record<number, EstiloColumna> = { 0: columnaNombre(geo.anchoNombre) };
  dias.forEach((_, i) => {
    columnStyles[i + 1] = { cellWidth: anchoDia };
  });
  const periodo = mesLabel(ctx.meta.año, ctx.meta.mes);

  autoTable(doc, {
    head,
    body,
    startY: topTabla,
    margin: { left: geo.margen, right: geo.margen, top: topTabla, bottom: geo.margen + geo.altoPie },
    tableWidth: anchoTabla,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    ...estilosBase(fontSize, paddingH, minCellHeight, altoCabTabla),
    columnStyles,
    didParseCell: (data: CellHookData) => {
      const col = data.column.index;
      if (col === 0) {
        if (data.section === 'body') {
          data.cell.styles.fontSize = fontNombre;
          data.cell.styles.cellPadding = { top: PADDING_V, bottom: PADDING_V, left: PADDING_H_NOMBRE, right: PADDING_H_NOMBRE };
        }
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
    didDrawPage: () => decorarPagina(doc, ctx, geo, periodo),
  });

  doc.putTotalPages(PLACEHOLDER_TOTAL);
  return doc.output('arraybuffer');
}

// ============================================================================
//  SEMANAL
// ============================================================================

/** "Semana del 31/08 al 06/09 · septiembre 2026" (recortada al mes). */
export function etiquetaSemana(semana: SemanaDelMes, meta: Pick<MetadatosExport, 'año' | 'mes'>): string {
  return `Semana del ${ddmm(semana.desde, meta.mes)} al ${ddmm(semana.hasta, meta.mes)} · ${mesLabel(meta.año, meta.mes)}`;
}

/**
 * Reparto de filas por página del semanal: páginas IGUALES (60 → 2 × 30, no
 * 38 + 22) con la fila más baja que admite la letra mínima. Exportado para
 * poder medirlo sin generar el PDF.
 */
export function repartoFilasSemanal(
  nFilas: number,
  altoDisponible: number,
  fontMin: number,
): { paginas: number; filasPorPagina: number } {
  const maxPorPagina = Math.max(1, Math.floor(altoDisponible / altoFilaPara(fontMin)));
  const paginas = Math.max(1, Math.ceil(nFilas / maxPorPagina));
  return { paginas, filasPorPagina: Math.max(1, Math.ceil(nFilas / paginas)) };
}

/**
 * Genera el PDF SEMANAL (todas las semanas del mes, una por página, A4
 * apaisado) y devuelve sus bytes.
 */
export function generarPdfCuadranteSemanal(ctx: ContextoPdfSemanal): ArrayBuffer {
  const geo = GEO_SEMANAL;
  const { dias, filas } = ctx.rejilla;
  const semanas = semanasDelMes(dias);
  const doc = nuevoDoc('a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // --- Geometría de la tabla ---
  const anchoTabla = pageW - 2 * geo.margen;
  const anchoDia = (anchoTabla - geo.anchoNombre) / 7;
  const paddingH = 1;
  const topTabla = topTablaDe(doc, ctx, geo);
  const altoCabTabla = 10;
  const altoDisponible = pageH - topTabla - geo.margen - geo.altoPie - altoCabTabla;
  const { filasPorPagina } = repartoFilasSemanal(filas.length, altoDisponible, geo.fontMin);
  const minCellHeight = Math.floor((altoDisponible / filasPorPagina) * 10) / 10;
  // Letra: la mayor que cabe en la columna Y en la altura de fila repartida.
  const { fontSize: fontAncho } = ajustarFontCeldas(
    doc, textosCeldas(ctx.rejilla), anchoDia, paddingH, geo.fontMax, geo.fontMin,
  );
  const fontAlto = Math.floor(((minCellHeight - 2 * PADDING_V) / MM_POR_PT) * 2) / 2;
  const fontSize = Math.max(geo.fontMin, Math.min(fontAncho, fontAlto));
  const etiquetas = filas.map(etiquetaConductorExport);
  const { fontSize: fontNombre } = ajustarFontCeldas(
    doc, etiquetas, geo.anchoNombre, PADDING_H_NOMBRE, Math.min(geo.fontNombreMax, fontSize), geo.fontNombreMin,
  );

  const columnStyles: Record<number, EstiloColumna> = { 0: columnaNombre(geo.anchoNombre) };
  for (let i = 1; i <= 7; i++) columnStyles[i] = { cellWidth: anchoDia };

  semanas.forEach((semana, idx) => {
    if (idx > 0) doc.addPage();
    const periodo = etiquetaSemana(semana, ctx.meta);
    const head = [[
      'Conductor',
      ...semana.huecos.map((d, i) =>
        d ? `${DIAS_SEMANA_LARGO[i]}\n${ddmm(d, ctx.meta.mes)}` : `${DIAS_SEMANA_LARGO[i]}\n—`,
      ),
    ]];
    const body = filas.map((f, i) => [
      etiquetas[i] ?? '',
      ...semana.huecos.map((d) => (d ? textoCeldaExport(f.celdas.get(d.dia)) : '')),
    ]);

    autoTable(doc, {
      head,
      body,
      startY: topTabla,
      margin: { left: geo.margen, right: geo.margen, top: topTabla, bottom: geo.margen + geo.altoPie },
      tableWidth: anchoTabla,
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      ...estilosBase(fontSize, paddingH, minCellHeight, altoCabTabla),
      columnStyles,
      didParseCell: (data: CellHookData) => {
        const col = data.column.index;
        if (col === 0) {
          if (data.section === 'body') {
            data.cell.styles.fontSize = fontNombre;
            data.cell.styles.cellPadding = { top: PADDING_V, bottom: PADDING_V, left: PADDING_H_NOMBRE, right: PADDING_H_NOMBRE };
          }
          return;
        }
        const dia = semana.huecos[col - 1];
        const esFinde = col >= 6;
        if (data.section === 'head') {
          if (dia === null) data.cell.styles.fillColor = COLOR.fueraMes;
          else if (esFinde) data.cell.styles.fillColor = COLOR.cabeceraFinde;
          return;
        }
        if (data.section !== 'body') return;
        if (!dia) {
          data.cell.styles.fillColor = COLOR.fueraMes;
          return;
        }
        const fila = filas[data.row.index];
        estiloCelda(data, fila?.celdas.get(dia.dia), esFinde);
      },
      didDrawPage: () => decorarPagina(doc, ctx, geo, periodo),
    });
  });

  doc.putTotalPages(PLACEHOLDER_TOTAL);
  return doc.output('arraybuffer');
}
