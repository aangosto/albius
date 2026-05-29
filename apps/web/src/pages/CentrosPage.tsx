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
import CambiarEstadoCentroDialog from '@/components/centros/CambiarEstadoCentroDialog';
import CentroFormDialog from '@/components/centros/CentroFormDialog';
import CentrosTable from '@/components/centros/CentrosTable';
import { useAuth } from '@/contexts/AuthContext';
import { listarCentros } from '@/lib/services/centros';
import { listarTenants } from '@/lib/services/tenants';
import type { Centro, EstadoCentro, Tenant } from '@albius/shared';

/**
 * Página de gestión de Centros (super_admin only).
 *
 * Implementa las canónicas:
 *   - D4.7 Dialog modal para alta/edición (no rutas separadas).
 *   - D4.8 Listado client-side con re-fetch tras mutación, sin onSnapshot.
 *   - D4.9 Toda I/O Firebase encapsulada en services/centros.ts y
 *     services/tenants.ts (este último para hidratar el selector de tenant
 *     padre y el lookup de nombre en la tabla).
 *   - D4.11 + D5.3 Soft-delete (inactivar/reactivar) en botones secundarios;
 *     Centro tiene solo 2 estados así que el form no incluye Select de
 *     estado.
 *   - D4.13 Gate suave de rol: NoAutorizadoView si user.rol !== 'super_admin'.
 *
 * Carga inicial: Promise.all([listarCentros(), listarTenants()]) — los dos
 * recursos son independientes y la página los necesita ambos antes de
 * mostrar la tabla con lookups de tenant. `loading` cubre el conjunto.
 *
 * Estructura: el gate D4.13 vive en el componente exportado para que los
 * hooks no se invoquen cuando el usuario no tiene permiso. El contenido
 * autorizado vive en CentrosPageAuthorized.
 */

export default function CentrosPage() {
  const { user } = useAuth();
  if (user?.rol !== 'super_admin') {
    return <NoAutorizadoView />;
  }
  return <CentrosPageAuthorized />;
}

function CentrosPageAuthorized() {
  const [centros, setCentros] = useState<Centro[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoCentro>(
    'activo',
  );
  const [filtroTenant, setFiltroTenant] = useState<'todos' | string>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [crearOpen, setCrearOpen] = useState(false);
  const [editarTarget, setEditarTarget] = useState<Centro | null>(null);
  const [cambiarEstadoTarget, setCambiarEstadoTarget] = useState<{
    centro: Centro;
    accion: 'inactivar' | 'reactivar';
  } | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorListado(null);
    try {
      const [c, t] = await Promise.all([listarCentros(), listarTenants()]);
      setCentros(c);
      setTenants(t);
    } catch (err) {
      console.error('[centros] listado error:', err);
      setErrorListado('No se pudo cargar el listado. Recarga la página.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Lookup O(1) por tenantId para columna de tabla y búsqueda multicampo.
  const tenantsById = useMemo(
    () => new Map(tenants.map((t) => [t.id, t])),
    [tenants],
  );

  // Selector de tenant padre en CentroForm (modo='alta'). Solo activos
  // (D5.1): si pasas un tenant suspendido/cancelado, el backend rechaza
  // con failed-precondition. Evita la fricción frontend mostrando solo
  // los válidos.
  const tenantsActivos = useMemo(
    () => tenants.filter((t) => t.estado === 'activo'),
    [tenants],
  );

  // Dropdown del filtro de tenant en el listado: SOLO tenants que tengan
  // al menos un centro. Derivado del listado COMPLETO (centros, no
  // centrosVisibles) para que el dropdown no se reduzca al cambiar el
  // filtro de estado del centro.
  const tenantsConCentros = useMemo(
    () => tenants.filter((t) => centros.some((c) => c.tenantId === t.id)),
    [tenants, centros],
  );

  const centrosVisibles = useMemo(
    () =>
      centros
        .filter((c) => filtroEstado === 'todos' || c.estado === filtroEstado)
        .filter(
          (c) => filtroTenant === 'todos' || c.tenantId === filtroTenant,
        )
        .filter((c) => matchBusqueda(c, tenantsById, busqueda)),
    [centros, filtroEstado, filtroTenant, busqueda, tenantsById],
  );

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Centros</h1>
        <Button onClick={() => setCrearOpen(true)}>Nuevo centro</Button>
      </header>

      <FiltrosBar
        filtroEstado={filtroEstado}
        setFiltroEstado={setFiltroEstado}
        filtroTenant={filtroTenant}
        setFiltroTenant={setFiltroTenant}
        tenantsConCentros={tenantsConCentros}
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
        <CentrosTable
          centros={centrosVisibles}
          totalSinFiltros={centros.length}
          tenantsById={tenantsById}
          onEditar={setEditarTarget}
          onInactivar={(c) =>
            setCambiarEstadoTarget({ centro: c, accion: 'inactivar' })
          }
          onReactivar={(c) =>
            setCambiarEstadoTarget({ centro: c, accion: 'reactivar' })
          }
        />
      )}

      <CentroFormDialog
        open={crearOpen}
        modo="alta"
        tenantsActivos={tenantsActivos}
        tenants={tenants}
        onClose={() => setCrearOpen(false)}
        onSuccess={cargar}
      />
      <CentroFormDialog
        open={editarTarget !== null}
        modo="edicion"
        centroInicial={editarTarget ?? undefined}
        tenantsActivos={tenantsActivos}
        tenants={tenants}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
      <CambiarEstadoCentroDialog
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
  filtroEstado: 'todos' | EstadoCentro;
  setFiltroEstado: (v: 'todos' | EstadoCentro) => void;
  filtroTenant: 'todos' | string;
  setFiltroTenant: (v: 'todos' | string) => void;
  tenantsConCentros: Tenant[];
  busqueda: string;
  setBusqueda: (v: string) => void;
}

function FiltrosBar({
  filtroEstado,
  setFiltroEstado,
  filtroTenant,
  setFiltroTenant,
  tenantsConCentros,
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
          placeholder="Nombre, ciudad, provincia, dirección, tenant…"
        />
      </div>
      <div className="space-y-1">
        <Label>Estado</Label>
        <Select
          value={filtroEstado}
          onValueChange={(v) => setFiltroEstado(v as 'todos' | EstadoCentro)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activo">Activo</SelectItem>
            <SelectItem value="inactivo">Inactivo</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Tenant</Label>
        <Select
          value={filtroTenant}
          onValueChange={(v) => setFiltroTenant(v)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {tenantsConCentros.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function matchBusqueda(
  c: Centro,
  tenantsById: Map<string, Tenant>,
  q: string,
): boolean {
  const norm = q.toLowerCase().trim();
  if (!norm) return true;
  const tenantNombre = tenantsById.get(c.tenantId)?.nombre ?? '';
  return [
    c.nombre,
    c.ciudad,
    c.provincia,
    c.direccion ?? '',
    tenantNombre,
  ].some((s) => s.toLowerCase().includes(norm));
}
