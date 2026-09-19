import { useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Cuadrante, Linea } from '@albius/shared';
import type { Rejilla } from '@/lib/calendario';
import {
  descargarFichero,
  generarCSVCuadrante,
  nombreFicheroCuadrante,
  type MetadatosExport,
} from '@/lib/exportar';

/**
 * Menú "Exportar" del cuadrante (B36.1 → B36.4). Un solo punto de entrada
 * para los formatos: PDF mensual A4 / A3 y PDF SEMANAL (`jspdf` +
 * `jspdf-autotable`, B36.4), Excel (`exceljs`) y CSV (sin deps). Las
 * librerías se cargan con `import()` al pulsar para que no entren en el
 * bundle inicial. Con tres variantes de PDF los items planos eran cinco: los
 * PDF van agrupados en un SUBMENÚ "PDF" (A4 · A3 · Semanal) y Excel / CSV
 * quedan planos.
 *
 * Construido sobre el primitivo DropdownMenu que ya trae `radix-ui` (mismo
 * criterio que `MobileNavDrawer`: sin dependencia nueva, §10). Recibe la
 * rejilla YA construida (con ausencias, D6.29), el cuadrante (estado, KPIs,
 * fechas) y las líneas (leyenda); no hace I/O.
 *
 * Estado: los tres formatos se exportan en CUALQUIER estado del cuadrante.
 * El PDF, si no está publicado/cerrado, lleva marca de agua "BORRADOR" en
 * cada página (el jefe lo imprime para revisarlo en papel; la marca evita que
 * acabe en el tablón por error).
 */

export interface ExportarCuadranteMenuProps {
  rejilla: Rejilla;
  cuadrante: Cuadrante;
  lineas: Linea[];
  /** Nombre del centro (o su id si no se pudo leer). */
  centroNombre: string;
}

interface ContextoFormato {
  rejilla: Rejilla;
  meta: MetadatosExport;
  cuadrante: Cuadrante;
  lineas: Linea[];
}

interface Formato {
  id: string;
  label: string;
  descripcion: string;
  Icono: typeof FileText;
  ejecutar: (ctx: ContextoFormato) => Promise<void>;
}

const ITEM_CLASS =
  'flex cursor-pointer select-none items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';

const FORMATOS_PDF: Formato[] = [
  {
    id: 'pdf-a4',
    label: 'A4 (mes completo)',
    descripcion: 'Para imprimir y colgar. ~30 conductores por página.',
    Icono: Printer,
    ejecutar: async (ctx) => {
      const { generarPdfCuadrante, MIME_PDF } = await import('@/lib/exportarPdf');
      const bytes = generarPdfCuadrante({ ...ctx, formato: 'a4' });
      descargarFichero(nombreFicheroCuadrante(ctx.meta, 'pdf'), bytes, MIME_PDF);
    },
  },
  {
    id: 'pdf-a3',
    label: 'A3 (mes completo)',
    descripcion: 'Mismo formato, letra mayor y más filas por página.',
    Icono: Printer,
    ejecutar: async (ctx) => {
      const { generarPdfCuadrante, MIME_PDF } = await import('@/lib/exportarPdf');
      const bytes = generarPdfCuadrante({ ...ctx, formato: 'a3' });
      descargarFichero(
        nombreFicheroCuadrante(ctx.meta, 'pdf').replace(/\.pdf$/, '_A3.pdf'),
        bytes,
        MIME_PDF,
      );
    },
  },
  {
    id: 'pdf-semanal',
    label: 'Semanal (A4)',
    descripcion: 'Una semana por página, 7 columnas. Todo el mes en un PDF.',
    Icono: CalendarDays,
    ejecutar: async (ctx) => {
      const { generarPdfCuadranteSemanal, MIME_PDF } = await import('@/lib/exportarPdf');
      const bytes = generarPdfCuadranteSemanal(ctx);
      descargarFichero(
        nombreFicheroCuadrante(ctx.meta, 'pdf').replace(/\.pdf$/, '_semanal.pdf'),
        bytes,
        MIME_PDF,
      );
    },
  },
];

const FORMATOS: Formato[] = [
  {
    id: 'excel',
    label: 'Excel (.xlsx)',
    descripcion: 'Colores por línea, paneles fijos y hoja de resumen.',
    Icono: FileSpreadsheet,
    ejecutar: async (ctx) => {
      // Chunk diferido: exceljs solo se descarga la primera vez que se pulsa.
      const { generarExcelCuadrante, MIME_XLSX } = await import('@/lib/exportarExcel');
      const bytes = await generarExcelCuadrante(ctx);
      descargarFichero(nombreFicheroCuadrante(ctx.meta, 'xlsx'), bytes, MIME_XLSX);
    },
  },
  {
    id: 'csv',
    label: 'CSV',
    descripcion: 'Se abre en Excel. Sin colores.',
    Icono: FileText,
    ejecutar: async (ctx) => {
      descargarFichero(
        nombreFicheroCuadrante(ctx.meta, 'csv'),
        generarCSVCuadrante(ctx.rejilla, ctx.meta),
        'text/csv;charset=utf-8',
      );
    },
  },
];

export default function ExportarCuadranteMenu({
  rejilla,
  cuadrante,
  lineas,
  centroNombre,
}: ExportarCuadranteMenuProps) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sinFilas = rejilla.filas.length === 0;

  const ejecutar = async (f: Formato) => {
    setOcupado(true);
    setError(null);
    try {
      await f.ejecutar({
        rejilla,
        cuadrante,
        lineas,
        meta: {
          centroNombre,
          año: cuadrante.año,
          mes: cuadrante.mes,
          estado: cuadrante.estado,
          generadoEn: new Date(),
        },
      });
    } catch (err) {
      console.error(`[exportar] error generando ${f.id}:`, err);
      setError(`No se pudo generar el ${f.label}. Inténtalo de nuevo.`);
    } finally {
      setOcupado(false);
    }
  };

  const itemFormato = (f: Formato) => (
    <DropdownMenu.Item
      key={f.id}
      className={ITEM_CLASS}
      onSelect={() => {
        void ejecutar(f);
      }}
    >
      <f.Icono className="mt-0.5 size-4 shrink-0" />
      <span className="flex flex-col">
        <span className="font-medium">{f.label}</span>
        <span className="text-xs text-muted-foreground">{f.descripcion}</span>
      </span>
    </DropdownMenu.Item>
  );

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button variant="outline" size="sm" disabled={sinFilas || ocupado}>
            {ocupado ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            <span>Exportar</span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">
              Cuadrante completo · {String(cuadrante.mes).padStart(2, '0')}/
              {cuadrante.año}
            </DropdownMenu.Label>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger
                className={cn(ITEM_CLASS, 'data-[state=open]:bg-accent')}
              >
                <Printer className="mt-0.5 size-4 shrink-0" />
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">PDF</span>
                  <span className="text-xs text-muted-foreground">
                    Para el tablón: mes completo o semana a semana.
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 opacity-60" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={4}
                  alignOffset={-4}
                  className="z-50 min-w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
                >
                  {FORMATOS_PDF.map(itemFormato)}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            {FORMATOS.map(itemFormato)}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
