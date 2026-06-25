import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import NoAutorizadoView from '@/components/shared/NoAutorizadoView';
import { useAuth } from '@/contexts/AuthContext';
import { mapCallableError } from '@/lib/callable-errors';
import {
  crearCuadrante,
  cuadranteIdDe,
  generarCuadrante,
  listarAsignaciones,
  suscribirCuadrante,
} from '@/lib/services/cuadrantes';
import type { Asignacion, Cuadrante, EstadoGeneracion } from '@albius/shared';

/**
 * Página del Cuadrante (B29 Fase C.4) — vista mínima pero real y ampliable.
 *
 * El jefe ve el cuadrante de SU centro para un mes, lo crea en borrador si no
 * existe, y lo GENERA con el optimizador. La generación es ASÍNCRONA (~5 min):
 * el callable devuelve en <1s y el plan llega vía onSnapshot (estadoGeneracion
 * 'generando'→'completado'/'error'). El botón NO espera el plan.
 *
 * Gate D4.13 (split): el componente exportado solo hace useAuth + gate a
 * jefe_trafico; los hooks viven en el Authorized. (El super_admin tiene el link
 * en su nav pero esta vista es centro-céntrica —centro de claims—; una vista
 * super_admin con selector de centro queda para más adelante.)
 */
export default function CuadrantePage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <CuadrantePageAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
    />
  );
}

function ahoraAnioMes(): { año: number; mes: number } {
  const d = new Date();
  return { año: d.getFullYear(), mes: d.getMonth() + 1 };
}

function CuadrantePageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [{ año, mes }, setPeriodo] = useState(ahoraAnioMes);
  const [cuadrante, setCuadrante] = useState<Cuadrante | null>(null);
  const [cargandoDoc, setCargandoDoc] = useState(true);
  const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
  const [cargandoAsig, setCargandoAsig] = useState(false);
  const [lanzando, setLanzando] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);

  const id = centroId ? cuadranteIdDe(centroId, año, mes) : null;
  const estadoGen: EstadoGeneracion = cuadrante?.estadoGeneracion ?? 'idle';

  // --- Suscripción reactiva al doc del cuadrante (onSnapshot) ---
  useEffect(() => {
    if (!id) return;
    setCargandoDoc(true);
    setCuadrante(null);
    setAsignaciones([]);
    const unsub = suscribirCuadrante(id, (c) => {
      setCuadrante(c);
      setCargandoDoc(false);
    });
    return () => unsub();
  }, [id]);

  // --- Carga del plan cuando la generación está completada ---
  useEffect(() => {
    if (!tenantId || !id || estadoGen !== 'completado') {
      setAsignaciones([]);
      return;
    }
    let activo = true;
    setCargandoAsig(true);
    listarAsignaciones(tenantId, id)
      .then((a) => {
        if (activo) setAsignaciones(a);
      })
      .catch((err) => {
        console.error('[cuadrante] asignaciones error:', err);
      })
      .finally(() => {
        if (activo) setCargandoAsig(false);
      });
    return () => {
      activo = false;
    };
  }, [tenantId, id, estadoGen]);

  const handleCrearBorrador = useCallback(async () => {
    if (!tenantId || !centroId) return;
    setAccionError(null);
    setLanzando(true);
    try {
      await crearCuadrante({ tenantId, centroId, año, mes });
      // El onSnapshot recogerá el nuevo doc.
    } catch (err) {
      setAccionError(mapCallableError(err));
    } finally {
      setLanzando(false);
    }
  }, [tenantId, centroId, año, mes]);

  const handleGenerar = useCallback(async () => {
    if (!id) return;
    setAccionError(null);
    setLanzando(true);
    try {
      await generarCuadrante({ cuadranteId: id });
      // No esperamos el plan: el onSnapshot reflejará 'generando'→'completado'.
    } catch (err) {
      setAccionError(mapCallableError(err));
    } finally {
      setLanzando(false);
    }
  }, [id]);

  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Cuadrante</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se puede mostrar el
            cuadrante. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const generando = estadoGen === 'generando' || lanzando;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cuadrante</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Genera el cuadrante mensual de tu centro con el optimizador.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="periodo-cuadrante">Mes</Label>
          <Input
            id="periodo-cuadrante"
            type="month"
            className="w-[180px]"
            value={`${año}-${String(mes).padStart(2, '0')}`}
            onChange={(e) => {
              const [a, m] = e.target.value.split('-');
              if (a && m) setPeriodo({ año: Number(a), mes: Number(m) });
            }}
          />
        </div>
      </header>

      {accionError && (
        <Alert variant="destructive">
          <AlertDescription>{accionError}</AlertDescription>
        </Alert>
      )}

      {cargandoDoc ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !cuadrante ? (
        <SinCuadrante
          año={año}
          mes={mes}
          onCrear={handleCrearBorrador}
          creando={lanzando}
        />
      ) : (
        <>
          <EstadoCuadranteCard
            cuadrante={cuadrante}
            estadoGen={estadoGen}
            generando={generando}
            onGenerar={handleGenerar}
          />

          {estadoGen === 'error' && cuadrante.errorGeneracion && (
            <Alert variant="destructive">
              <AlertDescription>
                La generación falló: {cuadrante.errorGeneracion}
              </AlertDescription>
            </Alert>
          )}

          {estadoGen === 'completado' && (
            <>
              {cuadrante.estadisticas && (
                <KpiGrid estadisticas={cuadrante.estadisticas} />
              )}
              <AsignacionesTabla
                asignaciones={asignaciones}
                cargando={cargandoAsig}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

// ============================================================================
//  Sub-componentes
// ============================================================================

function SinCuadrante({
  año,
  mes,
  onCrear,
  creando,
}: {
  año: number;
  mes: number;
  onCrear: () => void;
  creando: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No hay cuadrante para {mesLabel(año, mes)}</CardTitle>
        <CardDescription>
          Crea el cuadrante en borrador para este mes y luego genéralo con el
          optimizador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onCrear} disabled={creando}>
          {creando && <Loader2 className="mr-2 size-4 animate-spin" />}
          Crear cuadrante borrador
        </Button>
      </CardContent>
    </Card>
  );
}

const ESTADO_CUADRANTE_VARIANT = {
  borrador: 'secondary',
  publicado: 'default',
  cerrado: 'outline',
} as const;

const ESTADO_GEN_LABEL: Record<EstadoGeneracion, string> = {
  idle: 'Sin generar',
  generando: 'Generando…',
  completado: 'Generado',
  error: 'Error',
};

const ESTADO_GEN_VARIANT: Record<
  EstadoGeneracion,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  idle: 'outline',
  generando: 'secondary',
  completado: 'default',
  error: 'destructive',
};

function EstadoCuadranteCard({
  cuadrante,
  estadoGen,
  generando,
  onGenerar,
}: {
  cuadrante: Cuadrante;
  estadoGen: EstadoGeneracion;
  generando: boolean;
  onGenerar: () => void;
}) {
  const esBorrador = cuadrante.estado === 'borrador';
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{mesLabel(cuadrante.año, cuadrante.mes)}</CardTitle>
          <Badge variant={ESTADO_CUADRANTE_VARIANT[cuadrante.estado]}>
            {cuadrante.estado}
          </Badge>
          <Badge variant={ESTADO_GEN_VARIANT[estadoGen]}>
            {ESTADO_GEN_LABEL[estadoGen]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {estadoGen === 'generando' ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Generando cuadrante, esto puede tardar unos minutos… Puedes salir de
            esta página; el progreso se guarda.
          </div>
        ) : !esBorrador ? (
          <p className="text-sm text-muted-foreground">
            El cuadrante está {cuadrante.estado}; la generación solo se ejecuta
            sobre un borrador.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {estadoGen === 'completado'
                ? 'Puedes volver a generar para recalcular el plan.'
                : estadoGen === 'error'
                  ? 'Reintenta la generación.'
                  : 'Lanza el optimizador para asignar conductores a turnos.'}
            </p>
            <Button onClick={onGenerar} disabled={generando}>
              {generando && <Loader2 className="mr-2 size-4 animate-spin" />}
              {estadoGen === 'completado'
                ? 'Volver a generar'
                : estadoGen === 'error'
                  ? 'Reintentar generación'
                  : 'Generar con optimizador'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KpiGrid({
  estadisticas,
}: {
  estadisticas: NonNullable<Cuadrante['estadisticas']>;
}) {
  const kpis: { label: string; value: string }[] = [
    {
      label: 'Cobertura',
      value: `${formatNum(estadisticas.coberturaServicios)}%`,
    },
    {
      label: 'Satisfacción media',
      value: `${formatNum(estadisticas.satisfaccionMedia)}%`,
    },
    {
      label: 'Preferencias cumplidas',
      value: String(estadisticas.preferenciasCumplidas),
    },
    {
      label: 'Preferencias no cumplidas',
      value: String(estadisticas.preferenciasNoCumplidas),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {kpis.map((k) => (
        <Card key={k.label}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {k.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const MAX_FILAS = 200;

function AsignacionesTabla({
  asignaciones,
  cargando,
}: {
  asignaciones: Asignacion[];
  cargando: boolean;
}) {
  const visibles = useMemo(
    () => asignaciones.slice(0, MAX_FILAS),
    [asignaciones],
  );

  if (cargando) {
    return <p className="text-sm text-muted-foreground">Cargando plan…</p>;
  }
  if (asignaciones.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        El cuadrante se generó sin asignaciones.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Asignaciones</h2>
        <span className="text-sm text-muted-foreground">
          {asignaciones.length} en total
          {asignaciones.length > MAX_FILAS &&
            ` (mostrando las primeras ${MAX_FILAS})`}
        </span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conductor</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Horario</TableHead>
              <TableHead>Tipo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.conductorId}</TableCell>
                <TableCell>{fechaISO(a.fecha)}</TableCell>
                <TableCell>{a.tipoTurnoId ?? '—'}</TableCell>
                <TableCell>
                  {a.horaInicio}–{a.horaFin}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{a.tipoAsignacion}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============================================================================
//  Helpers
// ============================================================================

function mesLabel(año: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${año}`;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Fecha de la asignación en ISO "YYYY-MM-DD" (UTC, sin desplazamiento de tz). */
function fechaISO(ts: Asignacion['fecha']): string {
  try {
    return ts.toDate().toISOString().slice(0, 10);
  } catch {
    return '—';
  }
}
