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
import CambiarEstadoTipoTurnoDialog from '@/components/tiposTurno/CambiarEstadoTipoTurnoDialog';
import TipoTurnoFormDialog from '@/components/tiposTurno/TipoTurnoFormDialog';
import TiposTurnoTable, {
  ESTADO_TIPO_TURNO_LABEL,
} from '@/components/tiposTurno/TiposTurnoTable';
import { useAuth } from '@/contexts/AuthContext';
import { listarTiposTurno } from '@/lib/services/tiposTurno';
import type { EstadoTipoTurno, TipoTurno } from '@albius/shared';

/**
 * Página de gestión de Tipos de turno (OPERATIVA del jefe de tráfico, B19).
 * Segunda entidad operativa del jefe tras Líneas, mismo molde que LineasPage:
 *
 *   - Gate D4.13 con rolRequerido = 'jefe_trafico' (NO super_admin). Vive en la
 *     sidebar del jefe (navigation.ts), no en Gobierno.
 *   - SIN selector de centro: tenantId+centroId llegan por los claims del jefe
 *     (useAuth). Los tipos se listan/crean en SU centro.
 *   - D4.8 listado client-side con re-fetch tras mutación, sin onSnapshot.
 *   - D6.5 la query del servicio constriñe tenantId+centroId.
 *
 * Diferencia clave vs LineasPage: estado BINARIO (D5.3, patrón Centro). Las
 * transiciones activo↔obsoleto van por botones de la tabla +
 * CambiarEstadoTipoTurnoDialog (NO por un Select en el form).
 *
 * El gate vive en el componente exportado (solo useAuth); los hooks viven en
 * TiposTurnoPageAuthorized para no invocarse cuando el usuario no tiene permiso.
 */

export default function TiposTurnoPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <TiposTurnoPageAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
    />
  );
}

function TiposTurnoPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [tipos, setTipos] = useState<TipoTurno[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoTipoTurno>(
    'todos',
  );
  const [busqueda, setBusqueda] = useState('');
  const [crearOpen, setCrearOpen] = useState(false);
  const [editarTarget, setEditarTarget] = useState<TipoTurno | null>(null);
  const [cambiarEstadoTarget, setCambiarEstadoTarget] = useState<{
    tipo: TipoTurno;
    accion: 'marcar-obsoleto' | 'reactivar';
  } | null>(null);

  const cargar = useCallback(async () => {
    if (!tenantId || !centroId) return; // sin tenant/centro no hay query (gate abajo)
    setLoading(true);
    setErrorListado(null);
    try {
      const t = await listarTiposTurno(tenantId, centroId);
      setTipos(t);
    } catch (err) {
      console.error('[tipos-turno] listado error:', err);
      setErrorListado('No se pudo cargar el listado. Recarga la página.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const tiposVisibles = useMemo(
    () =>
      tipos
        .filter((t) => filtroEstado === 'todos' || t.estado === filtroEstado)
        .filter((t) => matchBusqueda(t, busqueda)),
    [tipos, filtroEstado, busqueda],
  );

  // Gate de claims incompletos (TODO[jefe-claims-incompletos]): un jefe sin
  // tenantId/centroId en claims no puede operar. Mensaje claro en vez de query
  // rota. El narrowing posterior garantiza string no-null al Dialog/servicio.
  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Tipos de turno</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se pueden mostrar
            tipos de turno. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Tipos de turno</h1>
        <Button onClick={() => setCrearOpen(true)}>Nuevo tipo de turno</Button>
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
        <TiposTurnoTable
          tipos={tiposVisibles}
          totalSinFiltros={tipos.length}
          onEditar={setEditarTarget}
          onMarcarObsoleto={(t) =>
            setCambiarEstadoTarget({ tipo: t, accion: 'marcar-obsoleto' })
          }
          onReactivar={(t) =>
            setCambiarEstadoTarget({ tipo: t, accion: 'reactivar' })
          }
        />
      )}

      <TipoTurnoFormDialog
        open={crearOpen}
        modo="alta"
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setCrearOpen(false)}
        onSuccess={cargar}
      />
      <TipoTurnoFormDialog
        open={editarTarget !== null}
        modo="edicion"
        tipoInicial={editarTarget ?? undefined}
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
      <CambiarEstadoTipoTurnoDialog
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
  filtroEstado: 'todos' | EstadoTipoTurno;
  setFiltroEstado: (v: 'todos' | EstadoTipoTurno) => void;
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
          placeholder="Código o nombre…"
        />
      </div>
      <div className="space-y-1">
        <Label>Estado</Label>
        <Select
          value={filtroEstado}
          onValueChange={(v) =>
            setFiltroEstado(v as 'todos' | EstadoTipoTurno)
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {(Object.keys(ESTADO_TIPO_TURNO_LABEL) as EstadoTipoTurno[]).map(
              (e) => (
                <SelectItem key={e} value={e}>
                  {ESTADO_TIPO_TURNO_LABEL[e]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function matchBusqueda(t: TipoTurno, q: string): boolean {
  const norm = q.toLowerCase().trim();
  if (!norm) return true;
  return [t.codigo, t.nombre].some((s) => s.toLowerCase().includes(norm));
}
