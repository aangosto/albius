import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NoAutorizadoView from '@/components/shared/NoAutorizadoView';
import FestivoFormDialog from '@/components/festivos/FestivoFormDialog';
import FestivosTable from '@/components/festivos/FestivosTable';
import EliminarFestivoDialog from '@/components/festivos/EliminarFestivoDialog';
import { useAuth } from '@/contexts/AuthContext';
import { listarFestivosDelCentro } from '@/lib/services/festivos';
import { fechaISOUTC } from '@/lib/calendario';
import type { Festivo } from '@albius/shared';

/**
 * Página de FESTIVOS del jefe (B35.1, cierra TODO[festivos-frontend]). Molde
 * AusenciasPage: listado por fecha + filtro por año o mes + dialogs de
 * alta/edición y borrado.
 *
 *   - Muestra los festivos APLICABLES al centro: los suyos + los tenant-wide
 *     (misma regla que el motor). Los tenant-wide y los oficiales van en solo
 *     lectura (FestivosTable); el jefe solo crea/edita/borra los de su centro.
 *   - Filtro por periodo: input type="month" (vacío = todos). Comparación de
 *     "YYYY-MM-DD" lexicográfica en UTC (D6.22).
 *   - D4.7 dialogs, D4.8 re-fetch tras mutación, D4.9 I/O en services/festivos.ts.
 */
export default function FestivosPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <FestivosPageAuthorized tenantId={user.tenantId} centroId={user.centroId} />
  );
}

function FestivosPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [festivos, setFestivos] = useState<Festivo[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorListado, setErrorListado] = useState<string | null>(null);
  const [filtroMes, setFiltroMes] = useState(''); // "YYYY-MM" o vacío
  const [crearOpen, setCrearOpen] = useState(false);
  const [editarTarget, setEditarTarget] = useState<Festivo | null>(null);
  const [eliminarTarget, setEliminarTarget] = useState<Festivo | null>(null);

  const cargar = useCallback(async () => {
    if (!tenantId || !centroId) return;
    setLoading(true);
    setErrorListado(null);
    try {
      setFestivos(await listarFestivosDelCentro(tenantId, centroId));
    } catch (err) {
      console.error('[festivos] listado error:', err);
      setErrorListado('No se pudo cargar el listado. Recarga la página.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(filtroMes)) return festivos;
    return festivos.filter((f) => fechaISOUTC(f.fecha).startsWith(filtroMes));
  }, [festivos, filtroMes]);

  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Festivos</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se pueden mostrar
            festivos. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Festivos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Festivos que aplican a tu centro. El optimizador cubre cada uno con
            el cuadro de turnos de su tipo de tráfico. Los de «Todos los
            centros» los gestiona administración.
          </p>
        </div>
        <Button onClick={() => setCrearOpen(true)} disabled={loading}>
          Nuevo festivo
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="filtro-mes-festivos">Mes</Label>
          <div className="flex items-center gap-2">
            <Input
              id="filtro-mes-festivos"
              type="month"
              className="w-[190px]"
              value={filtroMes}
              onChange={(e) => setFiltroMes(e.target.value)}
            />
            {filtroMes && (
              <Button variant="ghost" size="sm" onClick={() => setFiltroMes('')}>
                Quitar
              </Button>
            )}
          </div>
        </div>
        <p className="pb-2 text-sm text-muted-foreground">
          {visibles.length} de {festivos.length}
        </p>
      </div>

      {errorListado && (
        <Alert variant="destructive">
          <AlertDescription>{errorListado}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <FestivosTable
          festivos={visibles}
          totalSinFiltros={festivos.length}
          onEditar={setEditarTarget}
          onEliminar={setEliminarTarget}
        />
      )}

      <FestivoFormDialog
        open={crearOpen}
        modo="alta"
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setCrearOpen(false)}
        onSuccess={cargar}
      />
      <FestivoFormDialog
        open={editarTarget !== null}
        modo="edicion"
        festivoInicial={editarTarget ?? undefined}
        tenantId={tenantId}
        centroId={centroId}
        onClose={() => setEditarTarget(null)}
        onSuccess={cargar}
      />
      <EliminarFestivoDialog
        target={eliminarTarget}
        onClose={() => setEliminarTarget(null)}
        onSuccess={cargar}
      />
    </section>
  );
}
