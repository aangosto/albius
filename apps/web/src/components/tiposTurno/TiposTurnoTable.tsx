import { Moon, SplitSquareHorizontal } from 'lucide-react';
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
import type { EstadoTipoTurno, TipoTurno } from '@albius/shared';

/**
 * Tabla de tipos de turno (operativa del jefe de tráfico). Columnas: Código,
 * Nombre, Horario (inicio–fin, con marca "cruza medianoche" si horaFin <
 * horaInicio), Duración (total + efectiva), Marcas (Badges Nocturno/Partido),
 * Estado (Badge), Acciones.
 *
 * Estado BINARIO (D5.3, patrón Centro — NO el enum-3 de Línea): las
 * transiciones van por botones secundarios + Dialog de confirmación, NO por un
 * Select dentro del form. Acciones por fila:
 *   - estado === 'activo'    → "Editar" + "Marcar obsoleto".
 *   - estado === 'obsoleto'  → "Reactivar" solo.
 * El botón "Marcar obsoleto" es `variant="ghost"` (no destructive) porque la
 * acción real y su confirmación viven en CambiarEstadoTipoTurnoDialog.
 *
 * Empty state diferenciado:
 *   - totalSinFiltros === 0 → EmptyInicial (el centro aún no tiene tipos).
 *   - totalSinFiltros > 0 + lista vacía → EmptySinMatch (filtros activos).
 *
 * ESTADO_TIPO_TURNO_LABEL exportado como SSOT de etiquetas para que los filtros
 * de la página reusen las mismas cadenas (patrón TIPO_LABEL/ESTADO_LABEL de
 * LineasTable, ROL_LABEL de navigation.ts).
 */

export const ESTADO_TIPO_TURNO_LABEL: Record<EstadoTipoTurno, string> = {
  activo: 'Activo',
  obsoleto: 'Obsoleto',
};

const ESTADO_VARIANT: Record<EstadoTipoTurno, 'default' | 'secondary'> = {
  activo: 'default',
  obsoleto: 'secondary',
};

/** "06:00–14:00" + sufijo si cruza medianoche (horaFin <= horaInicio). */
function formatHorario(t: TipoTurno): string {
  const cruza = t.horaFin <= t.horaInicio;
  return `${t.horaInicio}–${t.horaFin}${cruza ? ' (+1 día)' : ''}`;
}

export interface TiposTurnoTableProps {
  tipos: TipoTurno[];
  totalSinFiltros: number;
  onEditar: (t: TipoTurno) => void;
  onMarcarObsoleto: (t: TipoTurno) => void;
  onReactivar: (t: TipoTurno) => void;
}

export default function TiposTurnoTable({
  tipos,
  totalSinFiltros,
  onEditar,
  onMarcarObsoleto,
  onReactivar,
}: TiposTurnoTableProps) {
  if (tipos.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Código</TableHead>
            <TableHead>Nombre</TableHead>
            <TableHead>Horario</TableHead>
            <TableHead>Duración</TableHead>
            <TableHead>Marcas</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tipos.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">{t.codigo}</TableCell>
              <TableCell>{t.nombre}</TableCell>
              <TableCell className="text-sm">{formatHorario(t)}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {t.duracionMinutos} min
                <span className="text-xs"> ({t.duracionEfectivaMinutos} ef.)</span>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {t.esNocturno && (
                    <span
                      title="Turno nocturno"
                      aria-label="nocturno"
                      className="inline-flex"
                    >
                      <Moon className="size-4 text-muted-foreground" />
                    </span>
                  )}
                  {t.esPartido && (
                    <span
                      title="Turno partido"
                      aria-label="partido"
                      className="inline-flex"
                    >
                      <SplitSquareHorizontal className="size-4 text-muted-foreground" />
                    </span>
                  )}
                  {!t.esNocturno && !t.esPartido && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={ESTADO_VARIANT[t.estado]}>
                  {ESTADO_TIPO_TURNO_LABEL[t.estado]}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-2 justify-end">
                  {t.estado === 'activo' ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onEditar(t)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onMarcarObsoleto(t)}
                      >
                        Marcar obsoleto
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReactivar(t)}
                    >
                      Reactivar
                    </Button>
                  )}
                </div>
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
        Este centro aún no tiene tipos de turno. Crea el primero con
        &laquo;Nuevo tipo de turno&raquo;.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay tipos de turno que coincidan con los filtros aplicados. Cambia el
        estado o la búsqueda.
      </p>
    </Card>
  );
}
