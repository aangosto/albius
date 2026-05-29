import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import NoAutorizadoView from '@/components/shared/NoAutorizadoView';
import CambiarEstadoTenantDialog from '@/components/tenants/CambiarEstadoTenantDialog';
import TenantFormDialog from '@/components/tenants/TenantFormDialog';
import TenantsTable from '@/components/tenants/TenantsTable';
import { useAuth } from '@/contexts/AuthContext';
import { listarTenants } from '@/lib/services/tenants';
import type { EstadoTenant, Tenant } from '@albius/shared';

/**
 * Página de gestión de Tenants (super_admin only).
 *
 * Implementa las canónicas del Bloque 10:
 *   - D4.7 Dialog modal para alta/edición (no rutas separadas).
 *   - D4.8 Listado client-side con re-fetch tras mutación.
 *   - D4.9 Toda I/O Firebase encapsulada en services/tenants.ts.
 *   - D4.11 Soft-delete en botón secundario destructivo (no en select).
 *   - D4.13 Gate suave de rol: NoAutorizadoView si user.rol !== 'super_admin'.
 *
 * Estructura: el gate D4.13 vive en el componente exportado para que los
 * hooks no se invoquen cuando el usuario no tiene permiso (evita cualquier
 * sorpresa con Rules of Hooks si el rol cambia entre renders). El contenido
 * autorizado vive en TenantsPageAuthorized.
 */

export default function TenantsPage() {
  const { user } = useAuth();
  if (user?.rol !== 'super_admin') {
    return <NoAutorizadoView />;
  }
  return <TenantsPageAuthorized />;
}

function TenantsPageAuthorized() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoTenant>(
    'activo',
  );
  const [busqueda, setBusqueda] = useState('');
  const [crearOpen, setCrearOpen] = useState(false);
  const [editarTarget, setEditarTarget] = useState<Tenant | null>(null);
  const [cambiarEstadoTarget, setCambiarEstadoTarget] = useState<{
    tenant: Tenant;
    accion: 'cancelar' | 'reactivar';
  } | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorListado(null);
    try {
      setTenants(await listarTenants());
    } catch (err) {
      console.error('[tenants] listado error:', err);
      setErrorListado(
        'No se pudo cargar el listado. Recarga la página.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const tenantsVisibles = useMemo(
    () =>
      tenants
        .filter((t) => filtroEstado === 'todos' || t.estado === filtroEstado)
        .filter((t) => matchBusqueda(t, busqueda)),
    [tenants, filtroEstado, busqueda],
  );

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Tenants</h1>
        <Button onClick={() => setCrearOpen(true)}>Nuevo tenant</Button>
      </header>

      <FiltrosBar
        filtroEstado={filtroEstado}
        setFiltroEstado={setFiltroEstado}
        busqueda={busqueda}
        setBusqueda={setBusqueda}
      />

      {errorListado && (
        <Alert variant="destructive">
          <AlertDescription>{errorListado}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <TenantsTable
          tenants={tenantsVisibles}
          totalSinFiltros={tenants.length}
          onEditar={setEditarTarget}
          onCancelar={(t) =>
            setCambiarEstadoTarget({ tenant: t, accion: 'cancelar' })
          }
          onReactivar={(t) =>
            setCambiarEstadoTarget({ tenant: t, accion: 'reactivar' })
          }
        />
      )}

      <TenantFormDialog
        open={crearOpen}
        modo="alta"
        onClose={() => setCrearOpen(false)}
        onSuccess={cargar}
      />
      <TenantFormDialog
        open={editarTarget !== null}
        modo="edicion"
        tenantInicial={editarTarget ?? undefined}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
      <CambiarEstadoTenantDialog
        target={cambiarEstadoTarget}
        onClose={() => setCambiarEstadoTarget(null)}
        onSuccess={cargar}
      />
    </section>
  );
}

// ============================================================================
//  Helpers locales
// ============================================================================

interface FiltrosBarProps {
  filtroEstado: 'todos' | EstadoTenant;
  setFiltroEstado: (v: 'todos' | EstadoTenant) => void;
  busqueda: string;
  setBusqueda: (v: string) => void;
}

function FiltrosBar({
  filtroEstado,
  setFiltroEstado,
  busqueda,
  setBusqueda,
}: FiltrosBarProps) {
  return (
    <div className="flex gap-3 items-end">
      <div className="flex-1 space-y-1">
        <Label>Buscar</Label>
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre, CIF, provincia…"
        />
      </div>
      <div className="space-y-1">
        <Label>Estado</Label>
        <Select
          value={filtroEstado}
          onValueChange={(v) =>
            setFiltroEstado(v as 'todos' | EstadoTenant)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activo">Activo</SelectItem>
            <SelectItem value="suspendido">Suspendido</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function matchBusqueda(t: Tenant, q: string): boolean {
  const norm = q.toLowerCase().trim();
  if (!norm) return true;
  return [
    t.nombre,
    t.nombreComercial ?? '',
    t.cif,
    t.provincia,
    t.comunidadAutonoma,
  ].some((s) => s.toLowerCase().includes(norm));
}
