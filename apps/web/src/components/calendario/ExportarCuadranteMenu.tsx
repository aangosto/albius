import { useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import type { Cuadrante, Linea } from '@albius/shared';
import type { Rejilla } from '@/lib/calendario';
import {
  descargarFichero,
  generarCSVCuadrante,
  nombreFicheroCuadrante,
  type MetadatosExport,
} from '@/lib/exportar';

/**
 * Menú "Exportar" del cuadrante (B36.1 + B36.2). Un solo punto de entrada
 * para los formatos: CSV (sin deps) y Excel (`exceljs`, cargado con `import()`
 * al pulsar para que no entre en el bundle inicial). El PDF (B36.3) se añade
 * como item nuevo en `FORMATOS`.
 *
 * Construido sobre el primitivo DropdownMenu que ya trae `radix-ui` (mismo
 * criterio que `MobileNavDrawer`: sin dependencia nueva, §10). Recibe la
 * rejilla YA construida (con ausencias, D6.29), el cuadrante (estado, KPIs,
 * fechas) y las líneas (leyenda); no hace I/O.
 *
 * Estado: CSV y Excel se exportan en CUALQUIER estado del cuadrante (trabajo
 * interno del jefe, no van al tablón). Las restricciones por estado son del
 * PDF (B36.3).
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
            Exportar
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
            {FORMATOS.map((f) => (
              <DropdownMenu.Item
                key={f.id}
                className="flex cursor-pointer select-none items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                onSelect={() => {
                  void ejecutar(f);
                }}
              >
                <f.Icono className="mt-0.5 size-4 shrink-0" />
                <span className="flex flex-col">
                  <span className="font-medium">{f.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {f.descripcion}
                  </span>
                </span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
