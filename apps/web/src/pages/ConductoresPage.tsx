import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import ConductorEditDialog from '@/components/conductores/ConductorEditDialog';
import ConductoresTable, {
  ESTADO_CONDUCTOR_LABEL,
} from '@/components/conductores/ConductoresTable';
import { useAuth } from '@/contexts/AuthContext';
import { listarConductores } from '@/lib/services/conductores';
import type { Conductor, EstadoConductor } from '@albius/shared';

/**
 * Página de gestión de Conductores (OPERATIVA del jefe de tráfico, B22). El jefe
 * LISTA los conductores de su centro y EDITA su config operativa (líneas, tipos
 * de turno, estado, puedeSerReserva). El ALTA es super_admin-only (flujo de
 * Usuarios, opción A de B22): aquí no se crean conductores.
 *
 * Molde LineasPage/TiposTurnoPage:
 *   - Gate D4.13 con rolRequerido = 'jefe_trafico' (NO super_admin; /conductores
 *     se retiró de la nav del super_admin en B22). Si un super_admin entra por
 *     URL → NoAutorizadoView.
 *   - tenantId+centroId de claims (sin TenantCentroSelect).
 *   - D4.8 listado client-side con re-fetch tras editar, orden en memoria.
 *   - D6.5 la query del servicio constriñe tenantId+centroId.
 *
 * El gate vive en el componente exportado (solo useAuth); los hooks viven en
 * ConductoresPageAuthorized para no invocarse cuando el usuario no tiene permiso.
 */

export default function ConductoresPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <ConductoresPageAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
    />
  );
}

function ConductoresPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoConductor>(
    'todos',
  );
  const [busqueda, setBusqueda] = useState('');
  const [editarTarget, setEditarTarget] = useState<Conductor | null>(null);

  const cargar = useCallback(async () => {
    if (!tenantId || !centroId) return;
    setLoading(true);
    setErrorListado(null);
    try {
      const c = await listarConductores(tenantId, centroId);
      setConductores(c);
    } catch (err) {
      console.error('[conductores] listado error:', err);
      setErrorListado('No se pudo cargar el listado. Recarga la página.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const conductoresVisibles = useMemo(
    () =>
      conductores
        .filter((c) => filtroEstado === 'todos' || c.estado === filtroEstado)
        .filter((c) => matchBusqueda(c, busqueda))
        // Orden en memoria por apellidos, luego nombre (sin orderBy server-side
        // → sin índice nuevo).
        .sort((a, b) =>
          `${a.apellidos} ${a.nombre}`.localeCompare(
            `${b.apellidos} ${b.nombre}`,
            'es',
          ),
        ),
    [conductores, filtroEstado, busqueda],
  );

  // Gate de claims incompletos (TODO[jefe-claims-incompletos]): un jefe sin
  // tenantId/centroId no puede operar. Mensaje claro en vez de query rota.
  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Conductores</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se pueden mostrar
            conductores. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Conductores</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura las líneas, tipos de turno y estado de los conductores de tu
          centro. El alta de nuevos conductores se hace desde administración.
        </p>
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
        <ConductoresTable
          conductores={conductoresVisibles}
          totalSinFiltros={conductores.length}
          onEditar={setEditarTarget}
        />
      )}

      <ConductorEditDialog
        conductor={editarTarget}
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
    </section>
  );
}

// ============================================================================
//  Helpers locales
// ============================================================================

interface FiltrosBarProps {
  filtroEstado: 'todos' | EstadoConductor;
  setFiltroEstado: (v: 'todos' | EstadoConductor) => void;
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
          placeholder="Nombre, apellidos o nº de empleado…"
        />
      </div>
      <div className="space-y-1">
        <Label>Estado</Label>
        <Select
          value={filtroEstado}
          onValueChange={(v) =>
            setFiltroEstado(v as 'todos' | EstadoConductor)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {(Object.keys(ESTADO_CONDUCTOR_LABEL) as EstadoConductor[]).map(
              (e) => (
                <SelectItem key={e} value={e}>
                  {ESTADO_CONDUCTOR_LABEL[e]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function matchBusqueda(c: Conductor, q: string): boolean {
  const norm = q.toLowerCase().trim();
  if (!norm) return true;
  return [c.nombre, c.apellidos, c.numeroEmpleado ?? ''].some((s) =>
    s.toLowerCase().includes(norm),
  );
}
