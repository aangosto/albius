import { ChevronDown, Download, FileText } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Button } from '@/components/ui/button';
import type { Rejilla } from '@/lib/calendario';
import {
  descargarFichero,
  generarCSVCuadrante,
  nombreFicheroCuadrante,
  type MetadatosExport,
} from '@/lib/exportar';

/**
 * Menú "Exportar" del cuadrante (B36.1). Un solo punto de entrada para los
 * formatos: hoy CSV; Excel (B36.2) y PDF (B36.3) se añaden como items nuevos
 * en `FORMATOS`, cargando su librería con `import()` dentro de `ejecutar` para
 * que no entre en el bundle inicial.
 *
 * Construido sobre el primitivo DropdownMenu que ya trae `radix-ui` (mismo
 * criterio que `MobileNavDrawer`: sin dependencia nueva, §10). Recibe la
 * rejilla YA construida (con ausencias, D6.29) y los metadatos de cabecera; no
 * hace I/O.
 */

export interface ExportarCuadranteMenuProps {
  rejilla: Rejilla;
  meta: Omit<MetadatosExport, 'generadoEn'>;
}

interface Formato {
  id: string;
  label: string;
  descripcion: string;
  ejecutar: (rejilla: Rejilla, meta: MetadatosExport) => void | Promise<void>;
}

const FORMATOS: Formato[] = [
  {
    id: 'csv',
    label: 'CSV',
    descripcion: 'Se abre en Excel. Sin colores.',
    ejecutar: (rejilla, meta) => {
      descargarFichero(
        nombreFicheroCuadrante(meta, 'csv'),
        generarCSVCuadrante(rejilla, meta),
        'text/csv;charset=utf-8',
      );
    },
  },
];

export default function ExportarCuadranteMenu({
  rejilla,
  meta,
}: ExportarCuadranteMenuProps) {
  const sinFilas = rejilla.filas.length === 0;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" size="sm" disabled={sinFilas}>
          <Download className="size-4" />
          Exportar
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">
            Cuadrante completo · {String(meta.mes).padStart(2, '0')}/{meta.año}
          </DropdownMenu.Label>
          {FORMATOS.map((f) => (
            <DropdownMenu.Item
              key={f.id}
              className="flex cursor-pointer select-none items-start gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              onSelect={() => {
                void f.ejecutar(rejilla, { ...meta, generadoEn: new Date() });
              }}
            >
              <FileText className="mt-0.5 size-4 shrink-0" />
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
  );
}
