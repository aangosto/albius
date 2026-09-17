import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isoToDisplay, tsToISODateUTC } from '@/lib/services/ausencias';
import type { Ausencia, CategoriaAusencia, Conductor } from '@albius/shared';

/**
 * Tabla de ausencias del centro del jefe (B32.2). Columnas: Conductor (NOMBRE,
 * cruzado con el listado de conductores — no el id), Categoría (Badge) +
 * código de la empresa, Rango (DD/MM/AAAA – DD/MM/AAAA, o un solo día),
 * Observaciones, Acciones (Editar / Eliminar).
 *
 * `CATEGORIA_AUSENCIA_LABEL` exportado como SSOT de etiquetas (patrón
 * TIPO_LABEL de LineasTable) para el filtro de la página y el Select del form.
 *
 * Fechas SIEMPRE en UTC (tsToISODateUTC): las ausencias se persisten a
 * medianoche UTC; getDate() local desplazaría el día en Europe/Madrid.
 *
 * Empty state diferenciado (patrón ConductoresTable):
 *   - totalSinFiltros === 0 → no hay ausencias registradas en el centro.
 *   - totalSinFiltros > 0 + lista vacía → los filtros no dejan ninguna.
 */

export const CATEGORIA_AUSENCIA_LABEL: Record<CategoriaAusencia, string> = {
  vacaciones: 'Vacaciones',
  baja: 'Baja',
  permiso: 'Permiso',
};

const CATEGORIA_VARIANT: Record<
  CategoriaAusencia,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  vacaciones: 'default',
  baja: 'destructive',
  permiso: 'secondary',
};

/** "Apellidos, Nombre" del conductor, o el id si no se resolvió. */
export function nombreConductor(
  conductorId: string,
  conductoresById: Map<string, Conductor>,
): string {
  const c = conductoresById.get(conductorId);
  return c ? `${c.apellidos}, ${c.nombre}` : conductorId;
}

export function formatRango(a: Ausencia): string {
  const ini = tsToISODateUTC(a.fechaInicio);
  const fin = tsToISODateUTC(a.fechaFin);
  return ini === fin
    ? isoToDisplay(ini)
    : `${isoToDisplay(ini)} – ${isoToDisplay(fin)}`;
}

/** Nº de días del rango cerrado (inclusive). */
function diasRango(a: Ausencia): number {
  const ms =
    a.fechaFin.toDate().getTime() - a.fechaInicio.toDate().getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000)) + 1;
}

export interface AusenciasTableProps {
  ausencias: Ausencia[];
  conductoresById: Map<string, Conductor>;
  totalSinFiltros: number;
  onEditar: (a: Ausencia) => void;
  onEliminar: (a: Ausencia) => void;
}

export default function AusenciasTable({
  ausencias,
  conductoresById,
  totalSinFiltros,
  onEditar,
  onEliminar,
}: AusenciasTableProps) {
  if (ausencias.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Conductor</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Fechas</TableHead>
            <TableHead>Observaciones</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ausencias.map((a) => {
            const c = conductoresById.get(a.conductorId);
            const dias = diasRango(a);
            return (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium">
                    {nombreConductor(a.conductorId, conductoresById)}
                  </div>
                  {c?.numeroEmpleado && (
                    <div className="text-xs text-muted-foreground">
                      Nº {c.numeroEmpleado}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Badge variant={CATEGORIA_VARIANT[a.categoria]}>
                      {CATEGORIA_AUSENCIA_LABEL[a.categoria]}
                    </Badge>
                    {a.codigo && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {a.codigo}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div>{formatRango(a)}</div>
                  <div className="text-xs text-muted-foreground">
                    {dias === 1 ? '1 día' : `${dias} días`}
                  </div>
                </TableCell>
                <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">
                  {a.observaciones ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditar(a)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onEliminar(a)}
                    >
                      Eliminar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function EmptyInicial() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay ausencias registradas. Usa «Nueva ausencia» para dar de alta
        vacaciones, bajas o permisos de tus conductores.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay ausencias que coincidan con los filtros aplicados. Cambia el
        conductor, la categoría o el mes.
      </p>
    </Card>
  );
}
