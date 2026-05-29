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
import CambiarEstadoUsuarioDialog from '@/components/usuarios/CambiarEstadoUsuarioDialog';
import CrearUsuarioDialog from '@/components/usuarios/CrearUsuarioDialog';
import EditarUsuarioDialog from '@/components/usuarios/EditarUsuarioDialog';
import UsuariosTable from '@/components/usuarios/UsuariosTable';
import { useAuth } from '@/contexts/AuthContext';
import { ROL_LABEL } from '@/lib/navigation';
import { listarCentros } from '@/lib/services/centros';
import { listarTenants } from '@/lib/services/tenants';
import { listarUsuarios } from '@/lib/services/usuarios';
import type { Centro, EstadoUsuario, Tenant, Usuario } from '@albius/shared';

/**
 * Página de gestión de Usuarios (super_admin only).
 *
 * Implementa las canónicas:
 *   - D4.7 Dialog modal para alta/edición (no rutas separadas).
 *   - D4.8 Listado client-side con re-fetch tras mutación, sin onSnapshot.
 *   - D4.9 Toda I/O Firebase encapsulada en services/usuarios.ts +
 *     services/tenants.ts + services/centros.ts (estos dos últimos para
 *     hidratar los selectores de alta y los lookups de la tabla).
 *   - D4.13 Gate suave de rol: NoAutorizadoView si user.rol !== 'super_admin'.
 *     El gate vive en el componente exportado para que los hooks no se
 *     invoquen sin permiso; el contenido autorizado vive en
 *     UsuariosPageAuthorized.
 *   - D5.3 Estado binario (activo/suspendido): transición por
 *     CambiarEstadoUsuarioDialog, no en el form de edición.
 *
 * Carga inicial: Promise.all([listarUsuarios(), listarTenants(),
 * listarCentros()]) — tres recursos independientes que la página necesita
 * todos antes de mostrar la tabla con lookups. `loading` cubre el conjunto.
 *
 * Dos altas heterogéneas (jefe_trafico vs conductor) → dos botones; un único
 * CrearUsuarioDialog parametrizado por rol (DI14.2). La edición es
 * role-agnostic (DI14.1).
 *
 * DI14.9 — el dropdown del filtro de tenant se deriva del listado de
 * usuarios (tenants con ≥1 usuario), incluyendo tenants no-activos que aún
 * tengan usuarios. Paralelo a tenantsConCentros de CentrosPage.
 */

export default function UsuariosPage() {
  const { user } = useAuth();
  if (user?.rol !== 'super_admin') {
    return <NoAutorizadoView />;
  }
  return <UsuariosPageAuthorized />;
}

type FiltroRol = 'todos' | Usuario['rol'];

function UsuariosPageAuthorized() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [centros, setCentros] = useState<Centro[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroRol, setFiltroRol] = useState<FiltroRol>('todos');
  const [filtroTenant, setFiltroTenant] = useState<'todos' | string>('todos');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoUsuario>(
    'todos',
  );
  const [busqueda, setBusqueda] = useState('');
  const [crearTarget, setCrearTarget] = useState<
    'jefe_trafico' | 'conductor' | null
  >(null);
  const [editarTarget, setEditarTarget] = useState<Usuario | null>(null);
  const [cambiarEstadoTarget, setCambiarEstadoTarget] = useState<{
    usuario: Usuario;
    accion: 'suspender' | 'reactivar';
  } | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorListado(null);
    try {
      const [u, t, c] = await Promise.all([
        listarUsuarios(),
        listarTenants(),
        listarCentros(),
      ]);
      setUsuarios(u);
      setTenants(t);
      setCentros(c);
    } catch (err) {
      console.error('[usuarios] listado error:', err);
      setErrorListado(
        'No se pudo cargar el listado de usuarios. Inténtalo de nuevo.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Lookups O(1) para columnas de tabla, búsqueda y form de edición.
  const tenantsById = useMemo(
    () => new Map(tenants.map((t) => [t.id, t])),
    [tenants],
  );
  const centrosById = useMemo(
    () => new Map(centros.map((c) => [c.id, c])),
    [centros],
  );

  // Selectores de alta (Q7): solo entidades activas.
  const tenantsActivos = useMemo(
    () => tenants.filter((t) => t.estado === 'activo'),
    [tenants],
  );
  const centrosActivos = useMemo(
    () => centros.filter((c) => c.estado === 'activo'),
    [centros],
  );

  // Dropdown del filtro de tenant (DI14.9): tenants con ≥1 usuario, derivado
  // del listado COMPLETO de usuarios (incluye tenants no-activos con usuarios).
  const tenantsConUsuarios = useMemo(
    () => tenants.filter((t) => usuarios.some((u) => u.tenantId === t.id)),
    [tenants, usuarios],
  );

  const usuariosVisibles = useMemo(
    () =>
      usuarios
        .filter((u) => filtroRol === 'todos' || u.rol === filtroRol)
        .filter(
          (u) => filtroTenant === 'todos' || u.tenantId === filtroTenant,
        )
        .filter((u) => filtroEstado === 'todos' || u.estado === filtroEstado)
        .filter((u) => matchBusqueda(u, tenantsById, busqueda)),
    [usuarios, filtroRol, filtroTenant, filtroEstado, busqueda, tenantsById],
  );

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Usuarios</h1>
        <div className="flex gap-2">
          <Button onClick={() => setCrearTarget('jefe_trafico')}>
            Nuevo jefe de tráfico
          </Button>
          <Button onClick={() => setCrearTarget('conductor')}>
            Nuevo conductor
          </Button>
        </div>
      </header>

      <FiltrosBar
        filtroRol={filtroRol}
        setFiltroRol={setFiltroRol}
        filtroTenant={filtroTenant}
        setFiltroTenant={setFiltroTenant}
        filtroEstado={filtroEstado}
        setFiltroEstado={setFiltroEstado}
        tenantsConUsuarios={tenantsConUsuarios}
        busqueda={busqueda}
        setBusqueda={setBusqueda}
      />

      {errorListado ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{errorListado}</span>
            <Button variant="outline" size="sm" onClick={() => void cargar()}>
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <UsuariosTable
          usuarios={usuariosVisibles}
          totalSinFiltros={usuarios.length}
          tenantsById={tenantsById}
          centrosById={centrosById}
          onEditar={setEditarTarget}
          onSuspender={(u) =>
            setCambiarEstadoTarget({ usuario: u, accion: 'suspender' })
          }
          onReactivar={(u) =>
            setCambiarEstadoTarget({ usuario: u, accion: 'reactivar' })
          }
        />
      )}

      <CrearUsuarioDialog
        open={crearTarget !== null}
        rol={crearTarget ?? 'jefe_trafico'}
        tenantsActivos={tenantsActivos}
        centrosActivos={centrosActivos}
        onClose={() => setCrearTarget(null)}
        onSuccess={cargar}
      />
      <EditarUsuarioDialog
        open={editarTarget !== null}
        usuarioInicial={editarTarget}
        tenantsById={tenantsById}
        centrosById={centrosById}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
      <CambiarEstadoUsuarioDialog
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
  filtroRol: FiltroRol;
  setFiltroRol: (v: FiltroRol) => void;
  filtroTenant: 'todos' | string;
  setFiltroTenant: (v: 'todos' | string) => void;
  filtroEstado: 'todos' | EstadoUsuario;
  setFiltroEstado: (v: 'todos' | EstadoUsuario) => void;
  tenantsConUsuarios: Tenant[];
  busqueda: string;
  setBusqueda: (v: string) => void;
}

function FiltrosBar({
  filtroRol,
  setFiltroRol,
  filtroTenant,
  setFiltroTenant,
  filtroEstado,
  setFiltroEstado,
  tenantsConUsuarios,
  busqueda,
  setBusqueda,
}: FiltrosBarProps) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex-1 min-w-[200px] space-y-1">
        <Label>Buscar</Label>
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre, email, teléfono, tenant…"
        />
      </div>
      <div className="space-y-1">
        <Label>Rol</Label>
        <Select
          value={filtroRol}
          onValueChange={(v) => setFiltroRol(v as FiltroRol)}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="super_admin">{ROL_LABEL.super_admin}</SelectItem>
            <SelectItem value="jefe_trafico">
              {ROL_LABEL.jefe_trafico}
            </SelectItem>
            <SelectItem value="conductor">{ROL_LABEL.conductor}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Tenant</Label>
        <Select value={filtroTenant} onValueChange={(v) => setFiltroTenant(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {tenantsConUsuarios.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Estado</Label>
        <Select
          value={filtroEstado}
          onValueChange={(v) => setFiltroEstado(v as 'todos' | EstadoUsuario)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="activo">Activo</SelectItem>
            <SelectItem value="suspendido">Suspendido</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function matchBusqueda(
  u: Usuario,
  tenantsById: Map<string, Tenant>,
  q: string,
): boolean {
  const norm = q.toLowerCase().trim();
  if (!norm) return true;
  const tenantNombre = u.tenantId
    ? (tenantsById.get(u.tenantId)?.nombre ?? '')
    : '';
  return [u.nombreCompleto, u.email, u.telefono ?? '', tenantNombre].some(
    (s) => s.toLowerCase().includes(norm),
  );
}
