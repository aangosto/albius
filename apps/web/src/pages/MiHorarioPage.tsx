import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import NoAutorizadoView from '@/components/shared/NoAutorizadoView';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificaciones } from '@/hooks/useNotificaciones';
import { marcarNotificacionesLeidas } from '@/lib/services/notificaciones';
import { cuadranteIdDe } from '@/lib/services/cuadrantes';
import {
  listarCuadrantesVisibles,
  listarMisAsignaciones,
  listarMisAusencias,
} from '@/lib/services/miHorario';
import { listarLineas } from '@/lib/services/lineas';
import { listarTiposTurno } from '@/lib/services/tiposTurno';
import {
  descripcionAusencia,
  diasDelMes,
  duracionMinutos,
  fechaISOUTC,
  hoyISO,
  sumarDiasISO,
  textoSobreColor,
  type DiaColumna,
} from '@/lib/calendario';
import { cn } from '@/lib/utils';
import {
  expandirAusenciaEnMes,
  type Asignacion,
  type Ausencia,
  type Cuadrante,
  type Linea,
  type TipoAsignacion,
  type TipoTurno,
} from '@albius/shared';

/**
 * MI HORARIO del conductor (B34.2). Móvil primero.
 *
 * Ve SOLO cuadrantes publicados/cerrados (borrador = trabajo en curso; las
 * reglas B34.1 lo vetan y `listarCuadrantesVisibles` lo constriñe, D6.5).
 * Estructura: (1) PRÓXIMOS TURNOS (hoy / mañana / resto de la semana) si el
 * mes incluye días futuros; (2) resumen (turnos, horas, días libres);
 * (3) EL MES en lista vertical, una fila por día — con un solo conductor una
 * rejilla no aporta y en móvil es inusable. Las AUSENCIAS se cruzan
 * (`expandirAusenciaEnMes`): sin ellas un conductor de vacaciones vería
 * "libre" toda la semana. Sin compañeros de turno (chocaría con las reglas).
 *
 * `conductorId` viene de AuthContext (doc /usuarios, B34.1). Fechas en UTC
 * (D6.22). Gate D4.13 split: rol conductor.
 */
export default function MiHorarioPage() {
  const { user } = useAuth();
  if (user?.rol !== 'conductor') {
    return <NoAutorizadoView />;
  }
  return (
    <MiHorarioAuthorized
      tenantId={user.tenantId}
      centroId={user.centroId}
      conductorId={user.conductorId}
    />
  );
}

function ahoraAnioMes(): { año: number; mes: number } {
  const d = new Date();
  return { año: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
}

type EstadoVista = 'cargando' | 'error' | 'sin-publicar' | 'ok';

interface Datos {
  cuadrantes: Cuadrante[];
  asignaciones: Asignacion[];
  ausencias: Ausencia[];
  tipos: TipoTurno[];
  lineas: Linea[];
}

function MiHorarioAuthorized({
  tenantId,
  centroId,
  conductorId,
}: {
  tenantId: string | null;
  centroId: string | null;
  conductorId: string | null;
}) {
  const [{ año, mes }, setPeriodo] = useState(ahoraAnioMes);
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [recargar, setRecargar] = useState(0);

  const cargar = useCallback(async () => {
    if (!tenantId || !centroId || !conductorId) return;
    setEstado('cargando');
    setDatos(null);
    try {
      const visibles = await listarCuadrantesVisibles(tenantId, centroId);
      const delMes = visibles.filter((c) => c.año === año && c.mes === mes);
      if (delMes.length === 0) {
        setEstado('sin-publicar');
        return;
      }
      const ids = new Set(delMes.map((c) => c.id));
      const [asignaciones, ausencias, tipos, lineas] = await Promise.all([
        listarMisAsignaciones(tenantId, conductorId, año, mes, ids),
        listarMisAusencias(tenantId, conductorId),
        listarTiposTurno(tenantId, centroId),
        listarLineas(tenantId, centroId),
      ]);
      setDatos({ cuadrantes: delMes, asignaciones, ausencias, tipos, lineas });
      setEstado('ok');
    } catch (err) {
      console.error('[mi-horario] error de carga:', err);
      setEstado('error');
    }
  }, [tenantId, centroId, conductorId, año, mes]);

  useEffect(() => {
    void cargar();
  }, [cargar, recargar]);

  if (!tenantId || !centroId || !conductorId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Mi horario</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no está vinculada a una ficha de conductor, así que no se
            puede mostrar tu horario. Contacta con tu jefe de tráfico.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mi horario</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tus turnos publicados, ausencias y días libres.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="periodo-mi-horario">Mes</Label>
          <Input
            id="periodo-mi-horario"
            type="month"
            className="w-[210px]"
            value={`${año}-${String(mes).padStart(2, '0')}`}
            onChange={(e) => {
              const [a, m] = e.target.value.split('-');
              if (a && m) setPeriodo({ año: Number(a), mes: Number(m) });
            }}
          />
        </div>
      </header>

      <AvisoNotificaciones centroId={centroId} año={año} mes={mes} />

      {estado === 'cargando' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      )}

      {estado === 'error' && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            No se pudo cargar tu horario. Puede ser un problema temporal.
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

      {estado === 'sin-publicar' && (
        <Alert data-testid="sin-publicar">
          <AlertDescription>
            Tu horario de {mesLabel(año, mes)} aún no está publicado. Cuando tu
            jefe de tráfico lo publique, lo verás aquí.
          </AlertDescription>
        </Alert>
      )}

      {estado === 'ok' && datos && (
        <HorarioOk año={año} mes={mes} datos={datos} />
      )}
    </section>
  );
}

// ============================================================================
//  Aviso de notificaciones del mes (B38.5)
// ============================================================================

/**
 * Banner de notificaciones NO LEÍDAS que afectan al mes que el conductor está
 * mirando. La campana del Topbar existe y sirve, pero en móvil es un icono de
 * 36px en una barra con otros dos botones: el conductor vive en esta página, y
 * "te han cambiado el turno del jueves" no puede depender de que se fije en un
 * punto rojo. Aquí ocupa el ancho entero, encima de su horario.
 *
 * RELEVANCIA AL MES: se cruza `datosContexto.cuadranteId` con el id
 * determinista del mes mostrado (`cua_{centroId}_{año}_{mes}`), con respaldo
 * en `datosContexto.año`/`mes` por si una notificación futura no lleva el id.
 * Sin ese filtro, al navegar a un mes cualquiera saldría el aviso de otro.
 *
 * Marcar como leídas es EXPLÍCITO aquí (botón), no al aparecer: un banner que
 * se auto-marca al renderizar desaparecería en el siguiente montaje sin que el
 * conductor haya hecho nada. La campana sí marca al abrir porque abrirla ES el
 * gesto de leerlas.
 */
function AvisoNotificaciones({
  centroId,
  año,
  mes,
}: {
  centroId: string;
  año: number;
  mes: number;
}) {
  const { noLeidas } = useNotificaciones();
  const [marcando, setMarcando] = useState(false);

  const cuadranteId = cuadranteIdDe(centroId, año, mes);
  const relevantes = noLeidas.filter((n) => {
    const ctx = n.datosContexto ?? {};
    if (typeof ctx['cuadranteId'] === 'string') {
      return ctx['cuadranteId'] === cuadranteId;
    }
    return ctx['año'] === año && ctx['mes'] === mes;
  });

  if (relevantes.length === 0) return null;

  async function marcarLeidas() {
    setMarcando(true);
    try {
      await marcarNotificacionesLeidas({
        notificacionIds: relevantes.map((n) => n.id),
      });
      // El onSnapshot vacía `relevantes` y el banner se desmonta solo.
    } catch (err) {
      console.error('[mi-horario] marcar notificaciones leídas:', err);
      setMarcando(false);
    }
  }

  return (
    <Alert data-testid="aviso-notificaciones">
      <AlertDescription className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {relevantes.map((n) => (
            <p key={n.id} className="text-sm">
              <span className="font-medium">{n.titulo}</span> — {n.mensaje}
            </p>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void marcarLeidas()}
          disabled={marcando}
        >
          {marcando ? 'Marcando…' : 'Marcar como leídas'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

// ============================================================================
//  Modelo de vista
// ============================================================================

interface TurnoVista {
  codigo: string;
  horario: string;
  minutos: number;
  color?: string;
  fg: string;
  lineaLabel?: string;
}

interface DiaVista extends DiaColumna {
  fechaISO: string;
  esHoy: boolean;
  turno?: TurnoVista;
  ausencia?: { label: string };
}

const ABREV_TIPO_ASIGNACION: Record<TipoAsignacion, string> = {
  turno: 'Turno',
  reserva_presencial: 'Reserva presencial',
  reserva_localizable: 'Reserva localizable',
  libre: 'Libre',
  vacaciones: 'Vacaciones',
  baja: 'Baja',
};

function HorarioOk({
  año,
  mes,
  datos,
}: {
  año: number;
  mes: number;
  datos: Datos;
}) {
  const hoy = hoyISO();

  const dias = useMemo<DiaVista[]>(() => {
    const tiposById = new Map(datos.tipos.map((t) => [t.id, t]));
    const lineasById = new Map(datos.lineas.map((l) => [l.id, l]));
    const asigPorDia = new Map<string, Asignacion>();
    for (const a of datos.asignaciones) {
      const k = fechaISOUTC(a.fecha);
      if (!asigPorDia.has(k)) asigPorDia.set(k, a);
    }
    const ausPorDia = new Map<string, Ausencia>();
    for (const au of datos.ausencias) {
      for (const d of expandirAusenciaEnMes(
        au.fechaInicio.toDate(),
        au.fechaFin.toDate(),
        año,
        mes,
      )) {
        ausPorDia.set(d, au);
      }
    }
    return diasDelMes(año, mes).map((d) => {
      const fechaISO = d.fecha.toISOString().slice(0, 10);
      const a = asigPorDia.get(fechaISO);
      const au = ausPorDia.get(fechaISO);
      let turno: TurnoVista | undefined;
      if (a) {
        const tipo = a.tipoTurnoId ? tiposById.get(a.tipoTurnoId) : undefined;
        const linea = tipo?.lineaId ? lineasById.get(tipo.lineaId) : undefined;
        const color = linea?.color;
        turno = {
          codigo: tipo?.codigo ?? ABREV_TIPO_ASIGNACION[a.tipoAsignacion],
          horario: `${a.horaInicio}–${a.horaFin}`,
          minutos: tipo?.duracionMinutos ?? duracionMinutos(a.horaInicio, a.horaFin),
          color,
          fg: textoSobreColor(color),
          lineaLabel: linea ? `Línea ${linea.codigo}` : undefined,
        };
      }
      return {
        ...d,
        fechaISO,
        esHoy: fechaISO === hoy,
        turno,
        ausencia: au
          ? {
              label: descripcionAusencia(au),
            }
          : undefined,
      };
    });
  }, [datos, año, mes, hoy]);

  const resumen = useMemo(() => {
    const turnos = dias.filter((d) => d.turno);
    const minutos = turnos.reduce((acc, d) => acc + (d.turno?.minutos ?? 0), 0);
    const ausentes = dias.filter((d) => !d.turno && d.ausencia).length;
    return {
      turnos: turnos.length,
      horas: Math.round((minutos / 60) * 10) / 10,
      libres: dias.length - turnos.length - ausentes,
    };
  }, [dias]);

  const proximos = useMemo(() => construirProximos(dias, hoy), [dias, hoy]);

  return (
    <div className="space-y-6">
      {proximos.length > 0 && <ProximosTurnos items={proximos} />}

      <div
        className="grid grid-cols-3 gap-2 text-center"
        data-testid="resumen"
      >
        <Kpi label="Turnos" value={String(resumen.turnos)} />
        <Kpi label="Horas" value={String(resumen.horas)} />
        <Kpi label="Días libres" value={String(resumen.libres)} />
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">
          {mesLabelLargo(año, mes)}
        </h2>
        <ul className="divide-y rounded-md border" data-testid="lista-mes">
          {dias.map((d) => (
            <FilaDia key={d.fechaISO} dia={d} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================================
//  Próximos turnos
// ============================================================================

interface ProximoItem {
  clave: string;
  etiqueta: string;
  dia: DiaVista;
}

/**
 * Hoy, mañana y el resto de la semana natural (hasta el domingo), solo los
 * días que caen dentro del mes mostrado. Vacío si el mes ya pasó entero.
 */
function construirProximos(dias: DiaVista[], hoy: string): ProximoItem[] {
  const porISO = new Map(dias.map((d) => [d.fechaISO, d]));
  const ultimo = dias[dias.length - 1];
  if (!ultimo || ultimo.fechaISO < hoy) return [];
  const items: ProximoItem[] = [];
  const push = (iso: string, etiqueta: string, clave: string) => {
    const d = porISO.get(iso);
    if (d) items.push({ clave, etiqueta, dia: d });
  };
  push(hoy, 'Hoy', 'hoy');
  const manana = sumarDiasISO(hoy, 1);
  push(manana, 'Mañana', 'manana');
  // Resto de la semana: desde pasado mañana hasta el domingo.
  const diaSemanaHoy = new Date(`${hoy}T00:00:00.000Z`).getUTCDay(); // 0=dom
  const hastaDomingo = diaSemanaHoy === 0 ? 0 : 7 - diaSemanaHoy;
  for (let i = 2; i <= hastaDomingo; i++) {
    const iso = sumarDiasISO(hoy, i);
    const d = porISO.get(iso);
    if (d) push(iso, `${d.abrev} ${d.dia}`, iso);
  }
  return items;
}

function ProximosTurnos({ items }: { items: ProximoItem[] }) {
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">Próximos turnos</h2>
      <ul className="space-y-2">
        {items.map(({ clave, etiqueta, dia }) => (
          <li key={clave}>
            <Card data-testid={`proximo-${clave}`}>
              <CardContent className="flex items-center gap-3 p-3">
                <div className="w-20 shrink-0">
                  <p className="text-sm font-semibold">{etiqueta}</p>
                  <p className="text-xs text-muted-foreground">
                    {fechaCorta(dia.fechaISO)}
                  </p>
                </div>
                <EstadoDia dia={dia} grande />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
//  Lista del mes
// ============================================================================

function FilaDia({ dia }: { dia: DiaVista }) {
  return (
    <li
      data-testid={`dia-${dia.fechaISO}`}
      className={cn(
        'flex items-center gap-3 px-3 py-2',
        dia.esFinde && 'bg-muted/40',
        dia.esHoy && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
      )}
    >
      <div className="w-12 shrink-0 text-center">
        <p className="text-[10px] uppercase leading-none text-muted-foreground">
          {dia.abrev}
        </p>
        <p className={cn('text-lg leading-tight', dia.esHoy && 'font-bold')}>
          {dia.dia}
        </p>
      </div>
      <EstadoDia dia={dia} />
    </li>
  );
}

/** Turno (código + horario + color de línea) o estado del día (libre / ausencia). */
function EstadoDia({ dia, grande }: { dia: DiaVista; grande?: boolean }) {
  if (dia.turno) {
    const t = dia.turno;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-1 font-semibold',
            grande ? 'text-base' : 'text-sm',
            !t.color && 'bg-muted',
          )}
          style={t.color ? { backgroundColor: t.color, color: t.fg } : undefined}
        >
          {t.codigo}
        </span>
        <div className="min-w-0">
          <p className={cn('font-medium', grande ? 'text-base' : 'text-sm')}>
            {t.horario}
          </p>
          {t.lineaLabel && (
            <p className="truncate text-xs text-muted-foreground">
              {t.lineaLabel}
            </p>
          )}
        </div>
        {dia.ausencia && (
          <span className="ml-auto shrink-0 text-xs text-amber-700">
            {dia.ausencia.label}
          </span>
        )}
      </div>
    );
  }
  if (dia.ausencia) {
    return (
      <p className={cn('font-medium text-amber-700', grande ? 'text-base' : 'text-sm')}>
        {dia.ausencia.label}
      </p>
    );
  }
  return (
    <p className={cn('text-muted-foreground', grande ? 'text-base' : 'text-sm')}>
      Libre
    </p>
  );
}

// ============================================================================
//  Helpers
// ============================================================================

function mesLabel(año: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${año}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function mesLabelLargo(año: number, mes: number): string {
  const nombre = MESES[mes - 1] ?? String(mes);
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${año}`;
}

/** "YYYY-MM-DD" → "DD/MM". */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
