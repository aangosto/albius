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
import type { EstadoTenant, PlanTenant, Tenant } from '@albius/shared';

/**
 * Tabla de tenants con badges de estado, badge auxiliar de "forzado" para
 * CIF aceptado con validación forzada (D4.4) y acciones inline por fila.
 *
 * Empty state diferenciado (DI10.11):
 *   - totalSinFiltros === 0 → EmptyInicial (nunca ha habido tenants).
 *   - totalSinFiltros > 0 + tenants vacíos → EmptySinMatch (filtros activos).
 *
 * Acciones por fila (D4.11):
 *   - estado !== 'cancelado' → "Editar" + "Cancelar".
 *   - estado === 'cancelado' → "Reactivar" solo.
 * El botón "Cancelar" abre Dialog destructivo de confirmación en el padre;
 * aquí es `variant="ghost"` (no destructive) porque la acción real vive en
 * el Dialog.
 */

const ESTADO_VARIANT: Record<
  EstadoTenant,
  'default' | 'secondary' | 'destructive'
> = {
  activo: 'default',
  suspendido: 'secondary',
  cancelado: 'destructive',
};

const ESTADO_LABEL: Record<EstadoTenant, string> = {
  activo: 'Activo',
  suspendido: 'Suspendido',
  cancelado: 'Cancelado',
};

const PLAN_LABEL: Record<PlanTenant, string> = {
  basico: 'Básico',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export interface TenantsTableProps {
  tenants: Tenant[];
  totalSinFiltros: number;
  onEditar: (t: Tenant) => void;
  onCancelar: (t: Tenant) => void;
  onReactivar: (t: Tenant) => void;
}

export default function TenantsTable({
  tenants,
  totalSinFiltros,
  onEditar,
  onCancelar,
  onReactivar,
}: TenantsTableProps) {
  if (tenants.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>CIF</TableHead>
            <TableHead>Provincia</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <div className="font-medium">{t.nombre}</div>
                {t.nombreComercial && (
                  <div className="text-xs text-muted-foreground">
                    {t.nombreComercial}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <span className="font-mono text-sm">{t.cif}</span>
                {t.cifValidacionForzada && (
                  <Badge
                    variant="outline"
                    className="ml-2 text-xs"
                    title="CIF aceptado con validación forzada (D4.4)"
                  >
                    forzado
                  </Badge>
                )}
              </TableCell>
              <TableCell>{t.provincia}</TableCell>
              <TableCell>{PLAN_LABEL[t.plan]}</TableCell>
              <TableCell>
                <Badge variant={ESTADO_VARIANT[t.estado]}>
                  {ESTADO_LABEL[t.estado]}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-2 justify-end">
                  {t.estado !== 'cancelado' ? (
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
                        onClick={() => onCancelar(t)}
                      >
                        Cancelar
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
        Aún no hay tenants. Crea el primero con &laquo;Nuevo tenant&raquo;.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay tenants que coincidan con los filtros aplicados. Cambia el
        estado o la búsqueda.
      </p>
    </Card>
  );
}
