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
import { ROL_LABEL } from '@/lib/navigation';
import type { Centro, EstadoUsuario, Tenant, Usuario } from '@albius/shared';

/**
 * Tabla de usuarios. Columnas: Nombre completo (+ teléfono subtexto),
 * Email, Rol (Badge con ROL_LABEL reutilizado de navigation.ts), Tenant
 * (lookup), Centro (lookup), Estado (Badge) y Acciones.
 *
 * Lookups tenant/centro: super_admin no tiene tenantId/centroId → "—" en
 * ambas columnas (no "Global", decisión Q14). Un jefe/conductor cuyo
 * tenant/centro referenciado no exista (inconsistencia manual en consola)
 * también cae a "—".
 *
 * Acciones (D5.3 binario activo/suspendido + guardas DI14.4):
 *   - rol === 'super_admin'        → SOLO "Editar". Sin Suspender/Reactivar:
 *     guarda DI14.4 para no bloquear al dueño del producto desde la UI.
 *   - rol !== 'super_admin', activo     → "Editar" + "Suspender" (ghost).
 *   - rol !== 'super_admin', suspendido → "Editar" + "Reactivar".
 *
 * DI14.4 (diverge de CentrosTable, que ocultaba "Editar" en inactivo):
 * "Editar" está disponible en AMBOS estados. Un usuario suspendido puede
 * necesitar corrección administrativa (email/nombre/teléfono). La semántica
 * difiere de un centro inactivo. La transición de estado vive en el botón
 * secundario + Dialog de confirmación (D5.3), no en el form de edición.
 *
 * Empty state diferenciado (DI10.11):
 *   - totalSinFiltros === 0 → EmptyInicial (nunca ha habido usuarios). En la
 *     práctica es código muerto — siempre hay ≥1 super_admin — pero se
 *     mantiene por simetría con TenantsTable/CentrosTable (Duda 6 del PASO 2).
 *   - totalSinFiltros > 0 + usuarios vacíos → EmptySinMatch (filtros activos).
 */

const ESTADO_VARIANT: Record<EstadoUsuario, 'default' | 'secondary'> = {
  activo: 'default',
  suspendido: 'secondary',
};

const ESTADO_LABEL: Record<EstadoUsuario, string> = {
  activo: 'Activo',
  suspendido: 'Suspendido',
};

export interface UsuariosTableProps {
  usuarios: Usuario[];
  totalSinFiltros: number;
  tenantsById: Map<string, Tenant>;
  centrosById: Map<string, Centro>;
  onEditar: (u: Usuario) => void;
  onSuspender: (u: Usuario) => void;
  onReactivar: (u: Usuario) => void;
}

export default function UsuariosTable({
  usuarios,
  totalSinFiltros,
  tenantsById,
  centrosById,
  onEditar,
  onSuspender,
  onReactivar,
}: UsuariosTableProps) {
  if (usuarios.length === 0) {
    return totalSinFiltros === 0 ? <EmptyInicial /> : <EmptySinMatch />;
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead>Centro</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usuarios.map((u) => {
            const tenantNombre = u.tenantId
              ? (tenantsById.get(u.tenantId)?.nombre ?? '—')
              : '—';
            const centroNombre = u.centroId
              ? (centrosById.get(u.centroId)?.nombre ?? '—')
              : '—';
            const esSuperAdmin = u.rol === 'super_admin';
            return (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.nombreCompleto}</div>
                  {u.telefono && (
                    <div className="text-xs text-muted-foreground">
                      {u.telefono}
                    </div>
                  )}
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ROL_LABEL[u.rol]}</Badge>
                </TableCell>
                <TableCell>
                  {tenantNombre === '—' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    tenantNombre
                  )}
                </TableCell>
                <TableCell>
                  {centroNombre === '—' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    centroNombre
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={ESTADO_VARIANT[u.estado]}>
                    {ESTADO_LABEL[u.estado]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditar(u)}
                    >
                      Editar
                    </Button>
                    {/* DI14.4: super_admin no es suspendible desde la UI. */}
                    {!esSuperAdmin &&
                      (u.estado === 'activo' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onSuspender(u)}
                        >
                          Suspender
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onReactivar(u)}
                        >
                          Reactivar
                        </Button>
                      ))}
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
        Aún no hay usuarios. Crea el primero con &laquo;Nuevo jefe de
        tráfico&raquo; o &laquo;Nuevo conductor&raquo;.
      </p>
    </Card>
  );
}

function EmptySinMatch() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No hay usuarios que coincidan con los filtros aplicados. Cambia el
        rol, el tenant, el estado o la búsqueda.
      </p>
    </Card>
  );
}
