import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
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
import { useAuth } from '@/contexts/AuthContext';
import {
  cuadranteIdDe,
  listarAsignaciones,
  obtenerCuadrante,
} from '@/lib/services/cuadrantes';
import { listarConductores } from '@/lib/services/conductores';
import { listarLineas } from '@/lib/services/lineas';
import { listarTiposTurno } from '@/lib/services/tiposTurno';
import {
  diaDelMesUTC,
  diasDelMes,
  textoSobreColor,
  type DiaColumna,
} from '@/lib/calendario';
import { cn } from '@/lib/utils';
import type {
  Asignacion,
  Conductor,
  Cuadrante,
  Linea,
  TipoAsignacion,
  TipoTurno,
} from '@albius/shared';

/**
 * Vista CALENDARIO del cuadrante (B30.3, pieza 1).
 *
 * Rejilla conductor×día del mes, cada turno coloreado por su LÍNEA (linea.color).
 * CONSUME un cuadrante ya generado (no lo genera — eso es la página Cuadrante);
 * lectura one-shot, sin onSnapshot.
 *
 * Alcance pieza 1: filas SIMPLES (una por conductor), mes completo. Pendiente:
 * estructura conductor×línea con nombre fusionado (3.2), filtros (3.3), toggle
 * semanal (3.4).
 *
 * ⚠️ Fechas en UTC en todo (helpers de lib/calendario): el optimizador escribe a
 * medianoche UTC; getUTCDate()/Date.UTC evitan el off-by-one de Europe/Madrid.
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

type EstadoVista =
  | 'cargando'
  | 'error'
  | 'sin-cuadrante'
  | 'sin-generar'
  | 'ok';

interface Datos {
  asignaciones: Asignacion[];
  conductores: Conductor[];
  tipos: TipoTurno[];
  lineas: Linea[];
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
      if (cua.estadoGeneracion !== 'completado') {
        setEstado('sin-generar');
        return;
      }
      const [asignaciones, conductores, tipos, lineas] = await Promise.all([
        listarAsignaciones(tenantId, id),
        listarConductores(tenantId, centroId!),
        listarTiposTurno(tenantId, centroId!),
        listarLineas(tenantId, centroId!),
      ]);
      setDatos({ asignaciones, conductores, tipos, lineas });
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
            Rejilla de turnos por conductor y día, coloreada por línea.
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

      {(estado === 'sin-cuadrante' || estado === 'sin-generar') && (
        <SinPlan año={año} mes={mes} estado={estado} />
      )}

      {estado === 'ok' && datos && (
        <CalendarioOk año={año} mes={mes} datos={datos} cuadrante={cuadrante} />
      )}
    </section>
  );
}

// ============================================================================
//  Estados informativos
// ============================================================================

function SinPlan({
  año,
  mes,
  estado,
}: {
  año: number;
  mes: number;
  estado: 'sin-cuadrante' | 'sin-generar';
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {estado === 'sin-cuadrante'
            ? `No hay cuadrante para ${mesLabel(año, mes)}`
            : `El cuadrante de ${mesLabel(año, mes)} aún no está generado`}
        </CardTitle>
        <CardDescription>
          El calendario muestra un cuadrante ya generado por el optimizador.
          Créalo y genéralo primero en la sección Cuadrante.
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
  texto: string;
  /** Color de fondo (HEX de la línea) o undefined → neutro. */
  bg?: string;
  /** Color de texto legible sobre bg. */
  fg: string;
  title: string;
}

interface FilaConductor {
  conductorId: string;
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

function CalendarioOk({
  año,
  mes,
  datos,
  cuadrante,
}: {
  año: number;
  mes: number;
  datos: Datos;
  cuadrante: Cuadrante | null;
}) {
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

    // conductorId -> (día del mes -> celda). R1 garantiza ≤1 turno/conductor/día.
    const porConductor = new Map<string, Map<number, Celda>>();
    for (const a of datos.asignaciones) {
      const dia = diaDelMesUTC(a.fecha);
      let m = porConductor.get(a.conductorId);
      if (!m) {
        m = new Map();
        porConductor.set(a.conductorId, m);
      }
      if (!m.has(dia)) m.set(dia, celdaDe(a)); // primero gana si hubiera colisión
    }

    const filas: FilaConductor[] = [...porConductor.entries()]
      .map(([conductorId, porDia]) => {
        const c = conductoresById.get(conductorId);
        return {
          conductorId,
          label: c ? `${c.apellidos}, ${c.nombre}` : conductorId,
          numeroEmpleado: c?.numeroEmpleado,
          porDia,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));

    return { dias, filas };
  }, [año, mes, datos]);

  if (filas.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          El cuadrante de {mesLabel(año, mes)} está generado pero no tiene
          asignaciones que mostrar.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filas.length} conductores · {datos.asignaciones.length} asignaciones ·{' '}
          {mesLabel(año, mes)}
          {cuadrante ? ` · ${cuadrante.estado}` : ''}
        </p>
        <LeyendaLineas lineas={datos.lineas} />
      </div>
      <RejillaTabla dias={dias} filas={filas} />
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
}: {
  dias: DiaColumna[];
  filas: FilaConductor[];
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
          {filas.map((f) => (
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
                if (!celda) {
                  return (
                    <td
                      key={d.dia}
                      className={cn(
                        'border-b border-l text-center text-muted-foreground/40',
                        d.esFinde && 'bg-muted/30',
                      )}
                    >
                      ·
                    </td>
                  );
                }
                return (
                  <td
                    key={d.dia}
                    title={celda.title}
                    className={cn(
                      'border-b border-l px-0.5 py-1 text-center text-xs font-medium',
                      !celda.bg && 'bg-muted text-foreground',
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
          ))}
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
