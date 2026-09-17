import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import AusenciaFormDialog from '@/components/ausencias/AusenciaFormDialog';
import AusenciasTable, {
  CATEGORIA_AUSENCIA_LABEL,
} from '@/components/ausencias/AusenciasTable';
import EliminarAusenciaDialog from '@/components/ausencias/EliminarAusenciaDialog';
import { useAuth } from '@/contexts/AuthContext';
import { listarAusencias, tsToISODateUTC } from '@/lib/services/ausencias';
import { listarConductores } from '@/lib/services/conductores';
import type { Ausencia, CategoriaAusencia, Conductor } from '@albius/shared';

/**
 * Página de gestión de Ausencias (OPERATIVA del jefe de tráfico, B32.2).
 * Molde: LineasPage / ConductoresPage.
 *
 *   - Gate D4.13 split rolRequerido='jefe_trafico' (centro de claims).
 *   - Carga paralela de ausencias + conductores del centro (para mostrar
 *     NOMBRES, poblar el Select del form y el filtro por conductor).
 *   - Filtros client-side: conductor, categoría y mes (input type="month":
 *     "quién está ausente en octubre" = ausencias cuyo rango SOLAPA el mes).
 *   - Query param `?conductorId=X`: llegada filtrada desde ConductoresTable
 *     (botón «Ausencias» por fila). El filtro es editable y se refleja en la
 *     URL (setSearchParams) para que el back del navegador funcione.
 *   - D4.7 dialogs (alta/edición + destructivo), D4.8 re-fetch tras mutación,
 *     D4.9 I/O en services/ausencias.ts.
 *
 * Fechas SIEMPRE en UTC (tsToISODateUTC); el filtro por mes compara "YYYY-MM-DD"
 * lexicográficamente (== cronológico) contra el primer/último día del mes.
 */

const PARAM_CONDUCTOR = 'conductorId';
const TODOS = 'todos';

export default function AusenciasPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <AusenciasPageAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
    />
  );
}

function AusenciasPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filtroConductor = searchParams.get(PARAM_CONDUCTOR) ?? TODOS;

  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [conductores, setConductores] = useState<Conductor[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState<
    typeof TODOS | CategoriaAusencia
  >(TODOS);
  const [filtroMes, setFiltroMes] = useState(''); // "YYYY-MM" o vacío
  const [crearOpen, setCrearOpen] = useState(false);
  const [editarTarget, setEditarTarget] = useState<Ausencia | null>(null);
  const [eliminarTarget, setEliminarTarget] = useState<Ausencia | null>(null);

  const cargar = useCallback(async () => {
    if (!tenantId || !centroId) return;
    setLoading(true);
    setErrorListado(null);
    try {
      const [a, c] = await Promise.all([
        listarAusencias(tenantId, centroId),
        listarConductores(tenantId, centroId),
      ]);
      setAusencias(a);
      setConductores(
        [...c].sort((x, y) =>
          `${x.apellidos} ${x.nombre}`.localeCompare(
            `${y.apellidos} ${y.nombre}`,
            'es',
          ),
        ),
      );
    } catch (err) {
      console.error('[ausencias] listado error:', err);
      setErrorListado('No se pudo cargar el listado. Recarga la página.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const conductoresById = useMemo(
    () => new Map(conductores.map((c) => [c.id, c])),
    [conductores],
  );

  const ausenciasVisibles = useMemo(() => {
    // Límites del mes filtrado como "YYYY-MM-DD" (UTC, comparación lexicográfica).
    let mesIni = '';
    let mesFin = '';
    if (/^\d{4}-\d{2}$/.test(filtroMes)) {
      const [y, m] = filtroMes.split('-').map(Number);
      if (y && m) {
        mesIni = `${filtroMes}-01`;
        const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
        mesFin = `${filtroMes}-${String(ultimo).padStart(2, '0')}`;
      }
    }
    return ausencias
      .filter(
        (a) => filtroConductor === TODOS || a.conductorId === filtroConductor,
      )
      .filter(
        (a) => filtroCategoria === TODOS || a.categoria === filtroCategoria,
      )
      .filter((a) => {
        if (!mesIni) return true;
        // Solape cerrado del rango con el mes.
        const ini = tsToISODateUTC(a.fechaInicio);
        const fin = tsToISODateUTC(a.fechaFin);
        return ini <= mesFin && fin >= mesIni;
      });
  }, [ausencias, filtroConductor, filtroCategoria, filtroMes]);

  function setFiltroConductor(v: string) {
    const next = new URLSearchParams(searchParams);
    if (v === TODOS) next.delete(PARAM_CONDUCTOR);
    else next.set(PARAM_CONDUCTOR, v);
    setSearchParams(next, { replace: true });
  }

  const conductorFiltrado =
    filtroConductor !== TODOS ? conductoresById.get(filtroConductor) : undefined;

  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Ausencias</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se pueden mostrar
            ausencias. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ausencias</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vacaciones, bajas y permisos de los conductores de tu centro. El
            optimizador no les asignará turnos en esos días.
          </p>
        </div>
        <Button onClick={() => setCrearOpen(true)} disabled={loading}>
          Nueva ausencia
        </Button>
      </header>

      <FiltrosBar
        conductores={conductores}
        filtroConductor={filtroConductor}
        setFiltroConductor={setFiltroConductor}
        filtroCategoria={filtroCategoria}
        setFiltroCategoria={setFiltroCategoria}
        filtroMes={filtroMes}
        setFiltroMes={setFiltroMes}
      />

      {filtroConductor !== TODOS && !loading && !conductorFiltrado && (
        <Alert>
          <AlertDescription>
            El conductor indicado en la URL no existe en tu centro. Mostrando
            solo sus ausencias (si las hubiera).
          </AlertDescription>
        </Alert>
      )}

      {errorListado && (
        <Alert variant="destructive">
          <AlertDescription>{errorListado}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <AusenciasTable
          ausencias={ausenciasVisibles}
          conductoresById={conductoresById}
          totalSinFiltros={ausencias.length}
          onEditar={setEditarTarget}
          onEliminar={setEliminarTarget}
        />
      )}

      <AusenciaFormDialog
        open={crearOpen}
        modo="alta"
        conductores={conductores}
        conductorIdInicial={
          filtroConductor !== TODOS ? filtroConductor : undefined
        }
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setCrearOpen(false)}
        onSuccess={cargar}
      />
      <AusenciaFormDialog
        open={editarTarget !== null}
        modo="edicion"
        ausenciaInicial={editarTarget ?? undefined}
        conductores={conductores}
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
      <EliminarAusenciaDialog
        target={eliminarTarget}
        conductoresById={conductoresById}
        onClose={() => setEliminarTarget(null)}
        onSuccess={cargar}
      />
    </section>
  );
}

// ============================================================================
//  Helpers locales
// ============================================================================

interface FiltrosBarProps {
  conductores: Conductor[];
  filtroConductor: string;
  setFiltroConductor: (v: string) => void;
  filtroCategoria: typeof TODOS | CategoriaAusencia;
  setFiltroCategoria: (v: typeof TODOS | CategoriaAusencia) => void;
  filtroMes: string;
  setFiltroMes: (v: string) => void;
}

function FiltrosBar({
  conductores,
  filtroConductor,
  setFiltroConductor,
  filtroCategoria,
  setFiltroCategoria,
  filtroMes,
  setFiltroMes,
}: FiltrosBarProps) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="min-w-[16rem] flex-1 space-y-1">
        <Label>Conductor</Label>
        <Select value={filtroConductor} onValueChange={setFiltroConductor}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos</SelectItem>
            {conductores.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.apellidos}, {c.nombre}
                {c.numeroEmpleado ? ` (nº ${c.numeroEmpleado})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Categoría</Label>
        <Select
          value={filtroCategoria}
          onValueChange={(v) =>
            setFiltroCategoria(v as typeof TODOS | CategoriaAusencia)
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            {(Object.keys(CATEGORIA_AUSENCIA_LABEL) as CategoriaAusencia[]).map(
              (k) => (
                <SelectItem key={k} value={k}>
                  {CATEGORIA_AUSENCIA_LABEL[k]}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="filtro-mes">Mes</Label>
        <div className="flex items-center gap-2">
          <Input
            id="filtro-mes"
            type="month"
            className="w-[170px]"
            value={filtroMes}
            onChange={(e) => setFiltroMes(e.target.value)}
          />
          {filtroMes && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFiltroMes('')}
            >
              Quitar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
