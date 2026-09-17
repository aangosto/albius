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
import ExportarCuadranteMenu from '@/components/calendario/ExportarCuadranteMenu';
import { useAuth } from '@/contexts/AuthContext';
import {
  cuadranteIdDe,
  listarAsignaciones,
  obtenerCuadrante,
} from '@/lib/services/cuadrantes';
import { listarAusencias } from '@/lib/services/ausencias';
import { obtenerCentro } from '@/lib/services/centros';
import { listarConductores } from '@/lib/services/conductores';
import { obtenerConvenio } from '@/lib/services/convenio';
import { listarLineas } from '@/lib/services/lineas';
import { listarTiposTurno } from '@/lib/services/tiposTurno';
import {
  construirRejilla,
  fechaISODia,
  jornadaDeAsignacion,
  type CeldaRejilla,
  type DiaColumna,
  type FilaRejilla,
} from '@/lib/calendario';
import { cn } from '@/lib/utils';
import type {
  Asignacion,
  Ausencia,
  Centro,
  Conductor,
  Convenio,
  Cuadrante,
  Linea,
  TipoTurno,
} from '@albius/shared';

/**
 * Vista CALENDARIO del cuadrante (B30.3 + edición manual B33.2 + B36.1).
 *
 * Rejilla conductor×día del mes, cada turno coloreado por su LÍNEA (linea.color).
 * Desde B33.2 es la HERRAMIENTA DE TRABAJO del jefe: en un cuadrante en
 * BORRADOR cada celda es clicable y abre `EditarCeldaDialog` (asignar / cambiar
 * / quitar turno). Publicado o cerrado → solo lectura con el motivo visible.
 *
 * Cambios B36.1 respecto a B33.2:
 *   - La rejilla la construye `construirRejilla` (lib/calendario, puro),
 *     compartido con las exportaciones (CSV aquí; Excel y PDF después).
 *   - Las AUSENCIAS SE PINTAN en la celda (D6.29; antes solo alimentaban el
 *     aviso del dialog y un conductor de vacaciones se veía libre). Etiqueta =
 *     `codigo` de la empresa (V, B, AP) o la categoría; estilo distinto al de
 *     un turno. Si el día tiene turno Y ausencia, GANA EL TURNO en la celda y
 *     la ausencia va al tooltip/aria-label (con un contorno discontinuo).
 *   - Botón "Exportar" (menú) con el cuadrante completo en CSV. Carga además
 *     el centro (nombre para la cabecera del fichero).
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
  centro: Centro | null;
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
      const [
        asignaciones,
        conductores,
        tipos,
        lineas,
        ausencias,
        convenio,
        centro,
      ] = await Promise.all([
        listarAsignaciones(tenantId, id),
        listarConductores(tenantId, centroId!),
        listarTiposTurno(tenantId, centroId!),
        listarLineas(tenantId, centroId!),
        listarAusencias(tenantId, centroId!),
        obtenerConvenio(centroId!),
        obtenerCentro(centroId!),
      ]);
      setDatos({
        asignaciones,
        conductores,
        tipos,
        lineas,
        ausencias,
        convenio,
        centro,
      });
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
          centroId={centroId}
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
  centroId,
  onMutacion,
}: {
  año: number;
  mes: number;
  datos: Datos;
  cuadrante: Cuadrante;
  centroId: string;
  onMutacion: () => Promise<void>;
}) {
  const [celdaSel, setCeldaSel] = useState<CeldaTarget | null>(null);
  const editable = cuadrante.estado === 'borrador';

  // Rejilla compartida con las exportaciones (B36.1), ausencias ya cruzadas.
  const rejilla = useMemo(
    () => construirRejilla(datos, año, mes),
    [datos, año, mes],
  );
  const { dias, filas } = rejilla;

  const abrirCelda = useCallback(
    (fila: FilaRejilla, dia: number) => {
      if (!editable || !fila.conductor) return;
      const fechaISO = fechaISODia(año, mes, dia);
      const celda = fila.celdas.get(dia);
      const ant = fila.celdas.get(dia - 1)?.turno;
      const sig = fila.celdas.get(dia + 1)?.turno;
      setCeldaSel({
        conductor: fila.conductor,
        fechaISO,
        asignacion: celda?.turno?.asignacion,
        ausencia: celda?.ausencia?.ausencia,
        anterior: ant ? jornadaDeAsignacion(ant.asignacion, ant.texto) : undefined,
        siguiente: sig ? jornadaDeAsignacion(sig.asignacion, sig.texto) : undefined,
      });
    },
    [editable, año, mes],
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
        <div className="flex flex-wrap items-center gap-3">
          <LeyendaLineas lineas={datos.lineas} />
          <ExportarCuadranteMenu
            rejilla={rejilla}
            meta={{
              centroNombre: datos.centro?.nombre ?? centroId,
              año,
              mes,
              estado: cuadrante.estado,
            }}
          />
        </div>
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

/** Descripción accesible de una celda (tooltip + aria-label). */
function descripcionCelda(celda: CeldaRejilla | undefined): string {
  if (!celda) return 'libre';
  const partes: string[] = [];
  if (celda.turno) partes.push(celda.turno.title);
  if (celda.ausencia) partes.push(`Ausente: ${celda.ausencia.descripcion}`);
  return partes.join(' · ');
}

function RejillaTabla({
  dias,
  filas,
  editable,
  onCelda,
}: {
  dias: DiaColumna[];
  filas: FilaRejilla[];
  editable: boolean;
  onCelda: (fila: FilaRejilla, dia: number) => void;
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
                  const celda = f.celdas.get(d.dia);
                  const descripcion = descripcionCelda(celda);
                  const interaccion = clicable
                    ? {
                        role: 'button' as const,
                        tabIndex: 0,
                        'aria-label': `${f.label}, día ${d.dia}: ${descripcion}`,
                        onClick: () => onCelda(f, d.dia),
                        onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onCelda(f, d.dia);
                          }
                        },
                      }
                    : {};
                  const turno = celda?.turno;
                  if (turno) {
                    // Turno (gana sobre la ausencia, que va al tooltip y se
                    // señala con un contorno discontinuo).
                    return (
                      <td
                        key={d.dia}
                        {...interaccion}
                        title={descripcion}
                        className={cn(
                          'border-b border-l px-0.5 py-1 text-center text-xs font-medium',
                          !turno.bg && 'bg-muted text-foreground',
                          celda?.ausencia &&
                            'outline-1 outline-dashed -outline-offset-2 outline-foreground/70',
                          clicable &&
                            'cursor-pointer hover:brightness-110 hover:ring-2 hover:ring-inset hover:ring-ring focus-visible:outline-2',
                        )}
                        style={
                          turno.bg
                            ? { backgroundColor: turno.bg, color: turno.fg }
                            : undefined
                        }
                      >
                        {turno.texto}
                      </td>
                    );
                  }
                  if (celda?.ausencia) {
                    // Ausencia sin turno: NO es un día libre (D6.29). Estilo
                    // propio, sin color de línea: es otra cosa que un turno.
                    return (
                      <td
                        key={d.dia}
                        {...interaccion}
                        title={descripcion}
                        className={cn(
                          'border-b border-l bg-muted/60 px-0.5 py-1 text-center text-xs italic text-muted-foreground',
                          clicable &&
                            'cursor-pointer hover:bg-accent hover:text-accent-foreground focus-visible:outline-2',
                        )}
                      >
                        {celda.ausencia.etiqueta}
                      </td>
                    );
                  }
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
