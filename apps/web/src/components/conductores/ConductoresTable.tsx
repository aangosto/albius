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
import type { Conductor, EstadoConductor } from '@albius/shared';

/**
 * Tabla de conductores del centro del jefe (B22). Columnas: Conductor
 * (nombre+apellidos + nº empleado subtexto), Categoría, Estado (Badge), Config
 * (conteo "N líneas · M turnos"), Reserva (Badge si puedeSerReserva), Acciones
 * (Editar).
 *
 * `ESTADO_CONDUCTOR_LABEL` exportado como SSOT de etiquetas para que el filtro
 * de la página reuse las mismas cadenas (patrón TIPO_LABEL/ESTADO_LABEL de
 * LineasTable). Estado enum-4 (EstadoConductor): se edita con un Select en el
 * dialog (no binario), por eso la única acción de fila es "Editar".
 *
 * Empty state diferenciado:
 *   - totalSinFiltros === 0 → EmptyInicial (el centro aún no tiene conductores;
 *     el alta es super_admin-only, B22 opción A).
 *   - totalSinFiltros > 0 + lista vacía → EmptySinMatch (filtros activos).
 */

export const ESTADO_CONDUCTOR_LABEL: Record<EstadoConductor, string> = {
  activo: 'Activo',
  baja_temporal: 'Baja temporal',
  vacaciones: 'Vacaciones',
  baja_definitiva: 'Baja definitiva',
};

const ESTADO_VARIANT: Record<
  EstadoConductor,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  activo: 'default',
  vacaciones: 'secondary',
  baja_temporal: 'outline',
  baja_definitiva: 'destructive',
};

function contarConfig(c: Conductor): string {
  const lineas = c.lineasPreferentes.length + c.lineasSecundarias.length;
  const turnos =
    c.tiposTurnoPermitidos.length + (c.tiposTurnoExcluidos?.length ?? 0);
  return `${lineas} líneas · ${turnos} turnos`;
}

export interface ConductoresTableProps {
  conductores: Conductor[];
  totalSinFiltros: number;
  onEditar: (c: Conductor) => void;
}

export default function ConductoresTable({
  conductores,
  totalSinFiltros,
  onEditar,
}: ConductoresTableProps) {
  if (conductores.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Conductor</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Config</TableHead>
            <TableHead>Reserva</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {conductores.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="font-medium">
                  {c.nombre} {c.apellidos}
                </div>
                {c.numeroEmpleado && (
                  <div className="text-xs text-muted-foreground">
                    Nº {c.numeroEmpleado}
                  </div>
                )}
              </TableCell>
              <TableCell className="capitalize">{c.categoria}</TableCell>
              <TableCell>
                <Badge variant={ESTADO_VARIANT[c.estado]}>
                  {ESTADO_CONDUCTOR_LABEL[c.estado]}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {contarConfig(c)}
              </TableCell>
              <TableCell>
                {c.puedeSerReserva ? (
                  <Badge variant="outline">Reserva</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditar(c)}
                >
                  Editar
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function EmptyInicial() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        Este centro aún no tiene conductores. El alta de conductores se hace
        desde administración (Usuarios).
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay conductores que coincidan con los filtros aplicados. Cambia el
        estado o la búsqueda.
      </p>
    </Card>
  );
}
