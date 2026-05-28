import { MapPin } from 'lucide-react';
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
import type { Centro, EstadoCentro, Tenant } from '@albius/shared';

/**
 * Tabla de centros. Columnas: Nombre (+ direccion subtexto), Tenant padre
 * (+ sufijo "(suspendido)/(cancelado)" en muted si el tenant no está
 * activo, opción (a) sutil del PASO 2), Ciudad (+ provincia subtexto),
 * Coordenadas (icono MapPin de lucide-react con tooltip nativo), Estado
 * (Badge) y Acciones.
 *
 * Empty state diferenciado (DI10.11):
 *   - totalSinFiltros === 0 → EmptyInicial (nunca ha habido centros).
 *   - totalSinFiltros > 0 + centros vacíos → EmptySinMatch (filtros activos).
 *
 * Acciones por fila (D4.11 + D5.3):
 *   - estado === 'activo'   → "Editar" + "Inactivar".
 *   - estado === 'inactivo' → "Reactivar" solo.
 * Centro tiene solo 2 estados (D5.3: form sin Select de estado; transiciones
 * por botones secundarios + Dialog destructivo). El botón "Inactivar" abre
 * Dialog destructivo de confirmación en el padre; aquí es `variant="ghost"`
 * (no destructive) porque la acción real vive en el Dialog.
 *
 * Lookup del tenant padre: `tenantsById.get(centro.tenantId)` puede devolver
 * `undefined` si el doc referenciado no existe (caso degenerado tras
 * inconsistencias manuales en consola Firebase). Se renderiza "—" en ese
 * caso para no romper la tabla.
 *
 * GeoPoint del SDK Web Firebase: `centro.coordenadas` es instancia GeoPoint
 * cuando existe; sus propiedades `.latitude` y `.longitude` se acceden
 * idénticas a un plain object. `.toFixed(4)` da 4 decimales (~11 metros de
 * precisión, suficiente para identificar un centro en tooltip).
 */

const ESTADO_VARIANT: Record<EstadoCentro, 'default' | 'secondary'> = {
  activo: 'default',
  inactivo: 'secondary',
};

const ESTADO_LABEL: Record<EstadoCentro, string> = {
  activo: 'Activo',
  inactivo: 'Inactivo',
};

const TENANT_SUFIJO: Partial<Record<Tenant['estado'], string>> = {
  suspendido: ' (suspendido)',
  cancelado: ' (cancelado)',
  // 'activo' no lleva sufijo
};

export interface CentrosTableProps {
  centros: Centro[];
  totalSinFiltros: number;
  tenantsById: Map<string, Tenant>;
  onEditar: (c: Centro) => void;
  onInactivar: (c: Centro) => void;
  onReactivar: (c: Centro) => void;
}

export default function CentrosTable({
  centros,
  totalSinFiltros,
  tenantsById,
  onEditar,
  onInactivar,
  onReactivar,
}: CentrosTableProps) {
  if (centros.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Ciudad</TableHead>
            <TableHead>Coords.</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {centros.map((c) => {
            const tenant = tenantsById.get(c.tenantId);
            const coord = c.coordenadas;
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <div className="font-medium">{c.nombre}</div>
                  {c.direccion && (
                    <div className="text-xs text-muted-foreground">
                      {c.direccion}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {tenant ? (
                    <span>
                      {tenant.nombre}
                      {TENANT_SUFIJO[tenant.estado] && (
                        <span className="text-muted-foreground">
                          {TENANT_SUFIJO[tenant.estado]}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div>{c.ciudad}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.provincia}
                  </div>
                </TableCell>
                <TableCell>
                  {coord ? (
                    <span
                      title={`${coord.latitude.toFixed(4)}, ${coord.longitude.toFixed(4)}`}
                      aria-label="coordenadas"
                      className="inline-flex"
                    >
                      <MapPin className="size-4 text-muted-foreground" />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={ESTADO_VARIANT[c.estado]}>
                    {ESTADO_LABEL[c.estado]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-2 justify-end">
                    {c.estado === 'activo' ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEditar(c)}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onInactivar(c)}
                        >
                          Inactivar
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onReactivar(c)}
                      >
                        Reactivar
                      </Button>
                    )}
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
        Aún no hay centros. Crea el primero con &laquo;Nuevo centro&raquo;.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay centros que coincidan con los filtros aplicados. Cambia el
        estado, el tenant o la búsqueda.
      </p>
    </Card>
  );
}
