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
import LineaFormDialog from '@/components/lineas/LineaFormDialog';
import LineasTable, {
  ESTADO_LABEL,
  TIPO_LABEL,
} from '@/components/lineas/LineasTable';
import { useAuth } from '@/contexts/AuthContext';
import { listarLineas } from '@/lib/services/lineas';
import type { EstadoLinea, Linea, TipoLinea } from '@albius/shared';

/**
 * Página de gestión de Líneas (OPERATIVA del jefe de tráfico).
 *
 * Diferencias clave vs la trilogía de Gobierno (Tenants/Centros/Usuarios):
 *   - Gate D4.13 con rolRequerido = 'jefe_trafico' (NO super_admin). Líneas
 *     vive en la sidebar del jefe (navigation.ts), no en Gobierno.
 *   - SIN selector de centro: el jefe tiene tenantId+centroId en sus claims
 *     (useAuth). Las líneas se listan/crean en SU centro.
 *   - SIN columna ni filtro de centro (solo hay uno, el del jefe).
 *
 * Canónicas reusadas: D4.7 (Dialog modal), D4.8 (listado client-side con
 * re-fetch, sin onSnapshot), D4.9 (I/O en services/lineas.ts), D4.13 (gate
 * suave split), D6.2 (estado enum-3, Select en el form).
 *
 * El gate vive en el componente exportado (solo useAuth); los hooks viven en
 * LineasPageAuthorized para no invocarse cuando el usuario no tiene permiso.
 */

export default function LineasPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <LineasPageAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
    />
  );
}

function LineasPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoLinea>(
    'todos',
  );
  const [filtroTipo, setFiltroTipo] = useState<'todos' | TipoLinea>('todos');
  const [busqueda, setBusqueda] = useState('');
  const [crearOpen, setCrearOpen] = useState(false);
  const [editarTarget, setEditarTarget] = useState<Linea | null>(null);

  const cargar = useCallback(async () => {
    if (!tenantId || !centroId) return; // sin tenant/centro no hay query (gate abajo)
    setLoading(true);
    setErrorListado(null);
    try {
      const l = await listarLineas(tenantId, centroId);
      setLineas(l);
    } catch (err) {
      console.error('[lineas] listado error:', err);
      setErrorListado('No se pudo cargar el listado. Recarga la página.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const lineasVisibles = useMemo(
    () =>
      lineas
        .filter((l) => filtroEstado === 'todos' || l.estado === filtroEstado)
        .filter((l) => filtroTipo === 'todos' || l.tipo === filtroTipo)
        .filter((l) => matchBusqueda(l, busqueda)),
    [lineas, filtroEstado, filtroTipo, busqueda],
  );

  // Gate de claims incompletos (TODO[jefe-claims-incompletos]): un jefe sin
  // tenantId/centroId en claims no puede operar. Mensaje claro en vez de query
  // rota. El narrowing posterior garantiza string no-null al Dialog/servicio.
  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Líneas</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se pueden mostrar
            líneas. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Líneas</h1>
        <Button onClick={() => setCrearOpen(true)}>Nueva línea</Button>
      </header>

      <FiltrosBar
        filtroEstado={filtroEstado}
        setFiltroEstado={setFiltroEstado}
        filtroTipo={filtroTipo}
        setFiltroTipo={setFiltroTipo}
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
        <LineasTable
          lineas={lineasVisibles}
          totalSinFiltros={lineas.length}
          onEditar={setEditarTarget}
        />
      )}

      <LineaFormDialog
        open={crearOpen}
        modo="alta"
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setCrearOpen(false)}
        onSuccess={cargar}
      />
      <LineaFormDialog
        open={editarTarget !== null}
        modo="edicion"
        lineaInicial={editarTarget ?? undefined}
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
  filtroEstado: 'todos' | EstadoLinea;
  setFiltroEstado: (v: 'todos' | EstadoLinea) => void;
  filtroTipo: 'todos' | TipoLinea;
  setFiltroTipo: (v: 'todos' | TipoLinea) => void;
  busqueda: string;
  setBusqueda: (v: string) => void;
}

function FiltrosBar({
  filtroEstado,
  setFiltroEstado,
  filtroTipo,
  setFiltroTipo,
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
          onValueChange={(v) => setFiltroEstado(v as 'todos' | EstadoLinea)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {(Object.keys(ESTADO_LABEL) as EstadoLinea[]).map((e) => (
              <SelectItem key={e} value={e}>
                {ESTADO_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label>Tipo</Label>
        <Select
          value={filtroTipo}
          onValueChange={(v) => setFiltroTipo(v as 'todos' | TipoLinea)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {(Object.keys(TIPO_LABEL) as TipoLinea[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TIPO_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function matchBusqueda(l: Linea, q: string): boolean {
  const norm = q.toLowerCase().trim();
  if (!norm) return true;
  return [l.codigo, l.nombre].some((s) => s.toLowerCase().includes(norm));
}
