import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import NoAutorizadoView from '@/components/shared/NoAutorizadoView';
import EditarCeldaDialog, {
  type CeldaTarget,
} from '@/components/calendario/EditarCeldaDialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  cuadranteIdDe,
  listarAsignaciones,
  obtenerCuadrante,
} from '@/lib/services/cuadrantes';
import { listarAusencias } from '@/lib/services/ausencias';
import { listarConductores } from '@/lib/services/conductores';
import { obtenerConvenio } from '@/lib/services/convenio';
import { listarLineas } from '@/lib/services/lineas';
import { listarTiposTurno } from '@/lib/services/tiposTurno';
import {
  diaDelMesUTC,
  diasDelMes,
  fechaISODia,
  jornadaDeAsignacion,
  textoSobreColor,
  type DiaColumna,
} from '@/lib/calendario';
import { cn } from '@/lib/utils';
import {
  expandirAusenciaEnMes,
  type Asignacion,
  type Ausencia,
  type Conductor,
  type Convenio,
  type Cuadrante,
  type Linea,
  type TipoAsignacion,
  type TipoTurno,
} from '@albius/shared';

/**
 * Vista CALENDARIO del cuadrante (B30.3 + edición manual B33.2).
 *
 * Rejilla conductor×día del mes, cada turno coloreado por su LÍNEA (linea.color).
 * Desde B33.2 es la HERRAMIENTA DE TRABAJO del jefe: en un cuadrante en
 * BORRADOR cada celda es clicable y abre `EditarCeldaDialog` (asignar / cambiar
 * / quitar turno). Publicado o cerrado → solo lectura con el motivo visible.
 *
 * Cambios B33.2 respecto a B30.3:
 *   - Las filas salen de TODOS los conductores del centro (no solo de los que
 *     tienen asignaciones): un conductor libre todo el mes aparece con fila
 *     vacía para poder darle turno.
 *   - La rejilla se muestra en cuanto EXISTE el cuadrante (antes exigía
 *     estadoGeneracion==='completado'): un cuadrante nunca generado se rellena
 *     a mano sobre la rejilla vacía.
 *   - La celda guarda la `Asignacion` completa (su id es necesario para mutar).
 *   - Carga además ausencias y convenio para los avisos del dialog.
 *   - Tras cada mutación se recargan solo las asignaciones (sin desmontar la
 *     rejilla).
 *
 * ⚠️ Fechas en UTC en todo (helpers de lib/calendario, D6.22).
 *
 * Gate D4.13 split: el componente exportado solo hace useAuth + gate; los hooks
 * viven en el Authorized.
 */
export default function CalendarioPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <CalendarioPageAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
    />
  );
}

function ahoraAnioMes(): { año: number; mes: number } {
  const d = new Date();
  return { año: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

type EstadoVista = 'cargando' | 'error' | 'sin-cuadrante' | 'ok';

interface Datos {
  asignaciones: Asignacion[];
  conductores: Conductor[];
  tipos: TipoTurno[];
  lineas: Linea[];
  ausencias: Ausencia[];
  convenio: Convenio | null;
}

function CalendarioPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [{ año, mes }, setPeriodo] = useState(ahoraAnioMes);
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [cuadrante, setCuadrante] = useState<Cuadrante | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [recargar, setRecargar] = useState(0);

  const id = centroId ? cuadranteIdDe(centroId, año, mes) : null;

  const cargar = useCallback(async () => {
    if (!tenantId || !id) return;
    setEstado('cargando');
    setCuadrante(null);
    setDatos(null);
    try {
      const cua = await obtenerCuadrante(id);
      if (!cua) {
        setEstado('sin-cuadrante');
        return;
      }
      setCuadrante(cua);
      const [asignaciones, conductores, tipos, lineas, ausencias, convenio] =
        await Promise.all([
          listarAsignaciones(tenantId, id),
          listarConductores(tenantId, centroId!),
          listarTiposTurno(tenantId, centroId!),
          listarLineas(tenantId, centroId!),
          listarAusencias(tenantId, centroId!),
          obtenerConvenio(centroId!),
        ]);
      setDatos({ asignaciones, conductores, tipos, lineas, ausencias, convenio });
      setEstado('ok');
    } catch (err) {
      // Error EXPLÍCITO (no enmascarar como "0 asignaciones",
      // TODO[cuadrante-asignaciones-error-state]).
      console.error('[calendario] error de carga:', err);
      setEstado('error');
    }
  }, [tenantId, centroId, id]);

  useEffect(() => {
    void cargar();
  }, [cargar, recargar]);

  /**
   * Recarga SOLO cuadrante + asignaciones tras una mutación (sin desmontar la
   * rejilla ni volver a pedir conductores/tipos/líneas/ausencias). El doc del
   * cuadrante se relee por si cambió de estado desde la página Cuadrante.
   */
  const recargarAsignaciones = useCallback(async () => {
    if (!tenantId || !id) return;
    const [cua, asignaciones] = await Promise.all([
      obtenerCuadrante(id),
      listarAsignaciones(tenantId, id),
    ]);
    setCuadrante(cua);
    setDatos((d) => (d ? { ...d, asignaciones } : d));
  }, [tenantId, id]);

  if (!centroId || !tenantId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Calendario</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se puede mostrar el
            calendario. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendario</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rejilla de turnos por conductor y día, coloreada por línea. En
            borrador, haz clic en una celda para asignar o cambiar un turno.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="periodo-calendario">Mes</Label>
          <Input
            id="periodo-calendario"
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

      {estado === 'cargando' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      )}

      {estado === 'error' && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            No se pudo cargar el calendario. Puede ser un problema temporal.
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRecargar((n) => n + 1)}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {estado === 'sin-cuadrante' && <SinCuadrante año={año} mes={mes} />}

      {estado === 'ok' && datos && cuadrante && (
        <CalendarioOk
          año={año}
          mes={mes}
          datos={datos}
          cuadrante={cuadrante}
          onMutacion={recargarAsignaciones}
        />
      )}
    </section>
  );
}

// ============================================================================
//  Estados informativos
// ============================================================================

function SinCuadrante({ año, mes }: { año: number; mes: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No hay cuadrante para {mesLabel(año, mes)}</CardTitle>
        <CardDescription>
          Crea el cuadrante del mes en la sección Cuadrante (en borrador, y
          genéralo con el optimizador o rellénalo a mano desde aquí).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/cuadrante">Ir a Cuadrante</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
//  Rejilla
// ============================================================================

interface Celda {
  asignacion: Asignacion;
  texto: string;
  /** Color de fondo (HEX de la línea) o undefined → neutro. */
  bg?: string;
  /** Color de texto legible sobre bg. */
  fg: string;
  title: string;
}

interface FilaConductor {
  conductorId: string;
  conductor?: Conductor;
  label: string;
  numeroEmpleado?: string;
  porDia: Map<number, Celda>;
}

const ABREV_TIPO_ASIGNACION: Record<TipoAsignacion, string> = {
  turno: 'T',
  reserva_presencial: 'R.P',
  reserva_localizable: 'R.L',
  libre: '·',
  vacaciones: 'VAC',
  baja: 'BAJA',
};

const ESTADO_LECTURA_MOTIVO: Record<Cuadrante['estado'], string | null> = {
  borrador: null,
  publicado:
    'El cuadrante está publicado: solo lectura. Reábrelo desde Cuadrante para editarlo.',
  cerrado: 'El cuadrante está cerrado: es definitivo y no se puede editar.',
};

function CalendarioOk({
  año,
  mes,
  datos,
  cuadrante,
  onMutacion,
}: {
  año: number;
  mes: number;
  datos: Datos;
  cuadrante: Cuadrante;
  onMutacion: () => Promise<void>;
}) {
  const [celdaSel, setCeldaSel] = useState<CeldaTarget | null>(null);
  const editable = cuadrante.estado === 'borrador';

  const { dias, filas } = useMemo(() => {
    const dias = diasDelMes(año, mes);
    const tiposById = new Map(datos.tipos.map((t) => [t.id, t]));
    const lineasById = new Map(datos.lineas.map((l) => [l.id, l]));
    const conductoresById = new Map(datos.conductores.map((c) => [c.id, c]));

    const celdaDe = (a: Asignacion): Celda => {
      const tipo = a.tipoTurnoId ? tiposById.get(a.tipoTurnoId) : undefined;
      const linea = tipo?.lineaId ? lineasById.get(tipo.lineaId) : undefined;
      const texto = tipo?.codigo ?? ABREV_TIPO_ASIGNACION[a.tipoAsignacion];
      const bg = linea?.color;
      return {
        asignacion: a,
        texto,
        bg,
        fg: textoSobreColor(bg),
        title: [
          tipo ? `Turno ${tipo.codigo}` : a.tipoAsignacion,
          `${a.horaInicio}–${a.horaFin}`,
          linea ? `Línea ${linea.codigo} — ${linea.nombre}` : 'Sin línea',
        ].join(' · '),
      };
    };

    // conductorId -> (día del mes -> celda). R1 la garantiza el backend
    // (assertConductorLibreEnFecha, B33.2); "primero gana" solo como defensa.
    const porConductor = new Map<string, Map<number, Celda>>();
    // Todos los conductores del centro (fila vacía si no tienen asignaciones).
    for (const c of datos.conductores) porConductor.set(c.id, new Map());
    for (const a of datos.asignaciones) {
      const dia = diaDelMesUTC(a.fecha);
      let m = porConductor.get(a.conductorId);
      if (!m) {
        m = new Map();
        porConductor.set(a.conductorId, m);
      }
      if (!m.has(dia)) m.set(dia, celdaDe(a));
    }

    const filas: FilaConductor[] = [...porConductor.entries()]
      .map(([conductorId, porDia]) => {
        const c = conductoresById.get(conductorId);
        return {
          conductorId,
          conductor: c,
          label: c ? `${c.apellidos}, ${c.nombre}` : conductorId,
          numeroEmpleado: c?.numeroEmpleado,
          porDia,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));

    return { dias, filas };
  }, [año, mes, datos]);

  // conductorId -> (fechaISO -> Ausencia) para el aviso "ausente ese día".
  const ausenciaPorDia = useMemo(() => {
    const idx = new Map<string, Map<string, Ausencia>>();
    for (const au of datos.ausencias) {
      const dias = expandirAusenciaEnMes(
        au.fechaInicio.toDate(),
        au.fechaFin.toDate(),
        año,
        mes,
      );
      if (dias.length === 0) continue;
      let m = idx.get(au.conductorId);
      if (!m) {
        m = new Map();
        idx.set(au.conductorId, m);
      }
      for (const d of dias) m.set(d, au);
    }
    return idx;
  }, [datos.ausencias, año, mes]);

  const abrirCelda = useCallback(
    (fila: FilaConductor, dia: number) => {
      if (!editable || !fila.conductor) return;
      const fechaISO = fechaISODia(año, mes, dia);
      const etiquetaDe = (c: Celda) => c.texto;
      const ant = fila.porDia.get(dia - 1);
      const sig = fila.porDia.get(dia + 1);
      setCeldaSel({
        conductor: fila.conductor,
        fechaISO,
        asignacion: fila.porDia.get(dia)?.asignacion,
        ausencia: ausenciaPorDia.get(fila.conductorId)?.get(fechaISO),
        anterior: ant
          ? jornadaDeAsignacion(ant.asignacion, etiquetaDe(ant))
          : undefined,
        siguiente: sig
          ? jornadaDeAsignacion(sig.asignacion, etiquetaDe(sig))
          : undefined,
      });
    },
    [editable, año, mes, ausenciaPorDia],
  );

  const motivoLectura = ESTADO_LECTURA_MOTIVO[cuadrante.estado];
  const sinGenerar = cuadrante.estadoGeneracion !== 'completado';

  return (
    <div className="space-y-3">
      {motivoLectura && (
        <Alert>
          <Lock className="size-4" />
          <AlertDescription>{motivoLectura}</AlertDescription>
        </Alert>
      )}
      {editable && sinGenerar && datos.asignaciones.length === 0 && (
        <Alert>
          <AlertDescription>
            El cuadrante de {mesLabel(año, mes)} aún no tiene asignaciones.
            Puedes generarlo con el optimizador desde Cuadrante o rellenarlo a
            mano haciendo clic en las celdas.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filas.length} conductores · {datos.asignaciones.length} asignaciones ·{' '}
          {mesLabel(año, mes)} · {cuadrante.estado}
        </p>
        <LeyendaLineas lineas={datos.lineas} />
      </div>
      {filas.length === 0 ? (
        <Alert>
          <AlertDescription>
            El centro no tiene conductores; no hay filas que mostrar.
          </AlertDescription>
        </Alert>
      ) : (
        <RejillaTabla
          dias={dias}
          filas={filas}
          editable={editable}
          onCelda={abrirCelda}
        />
      )}

      <EditarCeldaDialog
        target={celdaSel}
        cuadranteId={cuadrante.id}
        tipos={datos.tipos}
        descansoMinimoHoras={datos.convenio?.descansoMinimoEntreJornadasHoras}
        onClose={() => setCeldaSel(null)}
        onSuccess={onMutacion}
      />
    </div>
  );
}

function LeyendaLineas({ lineas }: { lineas: Linea[] }) {
  const conColor = lineas.filter((l) => l.color);
  if (conColor.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {conColor.map((l) => (
        <span key={l.id} className="flex items-center gap-1">
          <span
            aria-hidden
            className="size-3 rounded-sm border"
            style={{ backgroundColor: l.color }}
          />
          {l.codigo} — {l.nombre}
        </span>
      ))}
    </div>
  );
}

function RejillaTabla({
  dias,
  filas,
  editable,
  onCelda,
}: {
  dias: DiaColumna[];
  filas: FilaConductor[];
  editable: boolean;
  onCelda: (fila: FilaConductor, dia: number) => void;
}) {
  return (
    <div className="overflow-auto rounded-md border max-h-[calc(100vh-16rem)]">
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-52 min-w-52 border-b border-r bg-background px-3 py-2 text-left font-medium">
              Conductor
            </th>
            {dias.map((d) => (
              <th
                key={d.dia}
                className={cn(
                  'sticky top-0 z-20 min-w-[2.75rem] border-b px-1 py-1 text-center font-medium',
                  d.esFinde
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-background',
                )}
              >
                <div className="text-[10px] uppercase leading-none">
                  {d.abrev}
                </div>
                <div className="leading-tight">{d.dia}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const clicable = editable && f.conductor !== undefined;
            return (
              <tr key={f.conductorId}>
                <td className="sticky left-0 z-10 w-52 min-w-52 border-b border-r bg-background px-3 py-1.5">
                  <div className="truncate font-medium">{f.label}</div>
                  {f.numeroEmpleado && (
                    <div className="text-xs text-muted-foreground">
                      nº {f.numeroEmpleado}
                    </div>
                  )}
                </td>
                {dias.map((d) => {
                  const celda = f.porDia.get(d.dia);
                  const interaccion = clicable
                    ? {
                        role: 'button' as const,
                        tabIndex: 0,
                        'aria-label': `${f.label}, día ${d.dia}: ${celda ? celda.title : 'libre'}`,
                        onClick: () => onCelda(f, d.dia),
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onCelda(f, d.dia);
                          }
                        },
                      }
                    : {};
                  if (!celda) {
                    return (
                      <td
                        key={d.dia}
                        {...interaccion}
                        className={cn(
                          'border-b border-l text-center text-muted-foreground/40',
                          d.esFinde && 'bg-muted/30',
                          clicable &&
                            'cursor-pointer hover:bg-accent hover:text-accent-foreground focus-visible:outline-2',
                        )}
                      >
                        ·
                      </td>
                    );
                  }
                  return (
                    <td
                      key={d.dia}
                      {...interaccion}
                      title={celda.title}
                      className={cn(
                        'border-b border-l px-0.5 py-1 text-center text-xs font-medium',
                        !celda.bg && 'bg-muted text-foreground',
                        clicable &&
                          'cursor-pointer hover:brightness-110 hover:ring-2 hover:ring-inset hover:ring-ring focus-visible:outline-2',
                      )}
                      style={
                        celda.bg
                          ? { backgroundColor: celda.bg, color: celda.fg }
                          : undefined
                      }
                    >
                      {celda.texto}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
//  Helpers
// ============================================================================

function mesLabel(año: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${año}`;
}
