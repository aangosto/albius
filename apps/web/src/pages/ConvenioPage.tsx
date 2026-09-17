import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { useAuth } from '@/contexts/AuthContext';
import { mapCallableError } from '@/lib/callable-errors';
import {
  guardarConvenio,
  obtenerConvenio,
  type GuardarConvenioInput,
} from '@/lib/services/convenio';
import type { Convenio } from '@albius/shared';

/**
 * Página del CONVENIO del centro (B35.1). Singleton por centro (D6.9): un
 * formulario plano dentro de una Card, sin dialog ni tabla. Gate D4.13 split
 * (jefe; el centro sale de claims).
 *
 * HONESTIDAD DE PRODUCTO: el motor aplica HOY 5 campos como restricción
 * (descanso entre jornadas, horas semanales, cómputo de horas y días
 * consecutivos DURAS; findes consecutivos BLANDA desde B35.2) y la antelación
 * de publicación como AVISO al publicar (B35.2). El resto (descanso semanal,
 * domingos libres, horas anuales, festivos como extras) está en el modelo y se
 * persiste, pero el optimizador AÚN NO lo aplica
 * (TODO[convenio-restricciones-no-aplicadas-mvp]). La página lo marca por grupo
 * para que el jefe no crea que se aplica lo que no se aplica.
 *
 * Sin convenio el optimizador NO puede generar (buildRequest lanza error, sin
 * defaults): el estado "sin convenio" lo dice y ofrece el mismo form vacío.
 * Los 9 límites son requeridos y se reenvían siempre (sin buildDelta);
 * validación cliente espejo de los rangos del validator (B25).
 */
export default function ConvenioPage() {
  const { user } = useAuth();
  if (user?.rol !== 'jefe_trafico') {
    return <NoAutorizadoView />;
  }
  return (
    <ConvenioPageAuthorized tenantId={user.tenantId} centroId={user.centroId} />
  );
}

type EstadoVista = 'cargando' | 'error' | 'ok';

// --- Definición de campos (SSOT de etiquetas, rangos y grupo) ---
type CampoNumerico =
  | 'descansoMinimoEntreJornadasHoras'
  | 'maxHorasSemanales'
  | 'maxDiasConsecutivosTrabajados'
  | 'maxHorasAnuales'
  | 'minDomingosLibresAño'
  | 'maxFinesSemanaConsecutivosTrabajados'
  | 'descansoSemanalMinimoHoras'
  | 'antelacionMinimaPublicacionDias';

interface DefCampo {
  key: CampoNumerico;
  label: string;
  ayuda: string;
  min: number;
  max: number;
  exclusiveMin?: boolean;
  integer?: boolean;
  unidad: string;
}

/** Campos que el optimizador APLICA hoy (R2, R3, racha). */
const CAMPOS_APLICADOS: DefCampo[] = [
  {
    key: 'descansoMinimoEntreJornadasHoras',
    label: 'Descanso mínimo entre jornadas',
    ayuda: 'Horas entre el fin de un turno y el inicio del siguiente (R2).',
    min: 0, max: 24, exclusiveMin: true, unidad: 'h',
  },
  {
    key: 'maxHorasSemanales',
    label: 'Máximo de horas semanales',
    ayuda: 'Por semana natural (R3). Un conductor puede tener un máximo propio en su ficha.',
    min: 0, max: 168, exclusiveMin: true, unidad: 'h',
  },
  {
    key: 'maxDiasConsecutivosTrabajados',
    label: 'Máximo de días consecutivos trabajados',
    ayuda: 'Racha: tras N días seguidos, descanso obligatorio.',
    min: 1, max: 31, integer: true, unidad: 'días',
  },
  {
    key: 'maxFinesSemanaConsecutivosTrabajados',
    label: 'Máximo de fines de semana consecutivos trabajados',
    ayuda:
      'Regla BLANDA (B35.2): el optimizador la penaliza pero cubre antes las plazas. Los incumplimientos se muestran en los KPIs del cuadrante. 0 = sin límite.',
    min: 0, max: 53, integer: true, unidad: 'findes',
  },
  {
    key: 'antelacionMinimaPublicacionDias',
    label: 'Antelación mínima de publicación',
    ayuda:
      'Días antes del inicio del mes con que debe publicarse. Se aplica como AVISO al publicar (no bloquea).',
    min: 0, max: 365, integer: true, unidad: 'días',
  },
];

/** Campos REGISTRADOS pero que el optimizador aún no aplica (B35.2). */
const CAMPOS_REGISTRADOS: DefCampo[] = [
  {
    key: 'descansoSemanalMinimoHoras',
    label: 'Descanso semanal mínimo',
    ayuda: 'Horas de descanso continuo por semana (habitualmente 36 h).',
    min: 0, max: 168, exclusiveMin: true, unidad: 'h',
  },
  {
    key: 'minDomingosLibresAño',
    label: 'Mínimo de domingos libres al año',
    ayuda: 'Puede ser 0.',
    min: 0, max: 53, integer: true, unidad: 'domingos',
  },
  {
    key: 'maxHorasAnuales',
    label: 'Máximo de horas anuales',
    ayuda: 'Jornada anual del convenio.',
    min: 0, max: 8784, exclusiveMin: true, unidad: 'h',
  },
];

type Valores = Record<CampoNumerico, string>;

function valoresDe(c: Convenio | null): Valores {
  const v = (k: CampoNumerico) => (c ? String(c[k]) : '');
  return {
    descansoMinimoEntreJornadasHoras: v('descansoMinimoEntreJornadasHoras'),
    maxHorasSemanales: v('maxHorasSemanales'),
    maxDiasConsecutivosTrabajados: v('maxDiasConsecutivosTrabajados'),
    maxHorasAnuales: v('maxHorasAnuales'),
    minDomingosLibresAño: v('minDomingosLibresAño'),
    maxFinesSemanaConsecutivosTrabajados: v('maxFinesSemanaConsecutivosTrabajados'),
    descansoSemanalMinimoHoras: v('descansoSemanalMinimoHoras'),
    antelacionMinimaPublicacionDias: v('antelacionMinimaPublicacionDias'),
  };
}

/** Error de validación cliente para un campo (espejo de assertNumeroLimite). */
function validarCampo(def: DefCampo, raw: string): string | null {
  if (raw.trim() === '') return 'Obligatorio.';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Debe ser un número.';
  if (def.integer && !Number.isInteger(n)) return 'Debe ser un entero.';
  if (def.exclusiveMin ? n <= def.min : n < def.min) {
    return def.exclusiveMin ? `Debe ser mayor que ${def.min}.` : `Mínimo ${def.min}.`;
  }
  if (n > def.max) return `Máximo ${def.max}.`;
  return null;
}

function ConvenioPageAuthorized({
  tenantId,
  centroId,
}: {
  tenantId: string | null;
  centroId: string | null;
}) {
  const [estado, setEstado] = useState<EstadoVista>('cargando');
  const [convenio, setConvenio] = useState<Convenio | null>(null);
  const [valores, setValores] = useState<Valores>(valoresDe(null));
  const [referencia, setReferencia] = useState('');
  const [computo, setComputo] = useState<'jornada' | 'conduccion'>('jornada');
  const [festivosExtras, setFestivosExtras] = useState(false);
  const [tocado, setTocado] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);

  const cargar = useCallback(async () => {
    if (!centroId) return;
    setEstado('cargando');
    try {
      const c = await obtenerConvenio(centroId);
      setConvenio(c);
      setValores(valoresDe(c));
      setReferencia(c?.convenioReferencia ?? '');
      setComputo(c?.computoHoras ?? 'jornada');
      setFestivosExtras(c?.horasFestivoComputanComoExtras ?? false);
      setTocado(false);
      setEstado('ok');
    } catch (err) {
      console.error('[convenio] error de carga:', err);
      setEstado('error');
    }
  }, [centroId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!tenantId || !centroId) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Convenio</h1>
        <Alert variant="destructive">
          <AlertDescription>
            Tu cuenta no tiene un centro asignado, así que no se puede mostrar el
            convenio. Contacta con administración para completar el alta.
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const todos = [...CAMPOS_APLICADOS, ...CAMPOS_REGISTRADOS];
  const errores = Object.fromEntries(
    todos.map((d) => [d.key, validarCampo(d, valores[d.key])]),
  ) as Record<CampoNumerico, string | null>;
  const hayErrores = todos.some((d) => errores[d.key] !== null);

  function setValor(k: CampoNumerico, v: string) {
    setValores((prev) => ({ ...prev, [k]: v }));
    setTocado(true);
    setGuardadoOk(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (hayErrores || !tenantId || !centroId) return;
    setSubmitting(true);
    setErrorRemoto(null);
    setGuardadoOk(false);
    const num = (k: CampoNumerico) => Number(valores[k]);
    const input: GuardarConvenioInput = {
      tenantId,
      centroId,
      descansoMinimoEntreJornadasHoras: num('descansoMinimoEntreJornadasHoras'),
      maxHorasSemanales: num('maxHorasSemanales'),
      maxHorasAnuales: num('maxHorasAnuales'),
      minDomingosLibresAño: num('minDomingosLibresAño'),
      maxFinesSemanaConsecutivosTrabajados: num('maxFinesSemanaConsecutivosTrabajados'),
      maxDiasConsecutivosTrabajados: num('maxDiasConsecutivosTrabajados'),
      descansoSemanalMinimoHoras: num('descansoSemanalMinimoHoras'),
      antelacionMinimaPublicacionDias: num('antelacionMinimaPublicacionDias'),
      horasFestivoComputanComoExtras: festivosExtras,
      computoHoras: computo,
      ...(referencia.trim() && { convenioReferencia: referencia.trim() }),
    };
    try {
      await guardarConvenio(input);
      await cargar();
      setGuardadoOk(true);
    } catch (err) {
      console.error('[convenio] guardar error:', err);
      setErrorRemoto(mapCallableError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Convenio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reglas laborales de tu centro. El optimizador las lee al generar el
          cuadrante.
        </p>
      </header>

      {estado === 'cargando' && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      )}

      {estado === 'error' && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            No se pudo cargar el convenio.
            <Button size="sm" variant="outline" onClick={() => void cargar()}>
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {estado === 'ok' && (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {!convenio && (
            <Alert variant="destructive" data-testid="sin-convenio">
              <AlertDescription>
                Este centro aún no tiene convenio. Sin convenio, el optimizador
                no puede generar el cuadrante. Rellena los valores y guarda.
              </AlertDescription>
            </Alert>
          )}

          {convenio && convenio.actualizadoEn && (
            <Alert>
              <AlertDescription>
                Si cambias el convenio, los cuadrantes en borrador ya generados
                no se recalculan: vuelve a generarlos para aplicar los cambios.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Aplicado por el optimizador</CardTitle>
                <Badge>se aplica</Badge>
              </div>
              <CardDescription>
                Estas reglas SÍ las respeta el cuadrante generado (la de fines
                de semana como penalización; la antelación, como aviso).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {CAMPOS_APLICADOS.map((d) => (
                <CampoNumero
                  key={d.key}
                  def={d}
                  value={valores[d.key]}
                  error={tocado ? errores[d.key] : null}
                  disabled={submitting}
                  onChange={(v) => setValor(d.key, v)}
                />
              ))}
              <div className="space-y-1">
                <Label htmlFor="conv-computo">Cómputo de horas</Label>
                <Select
                  value={computo}
                  onValueChange={(v) => {
                    setComputo(v as 'jornada' | 'conduccion');
                    setTocado(true);
                    setGuardadoOk(false);
                  }}
                  disabled={submitting}
                >
                  <SelectTrigger id="conv-computo" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jornada">Jornada completa</SelectItem>
                    <SelectItem value="conduccion">Solo conducción efectiva</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Qué duración del turno cuenta para el máximo semanal.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>Registrado, aún no aplicado</CardTitle>
                <Badge variant="outline">no se aplica todavía</Badge>
              </div>
              <CardDescription>
                Se guardan en el convenio, pero el optimizador todavía no las
                comprueba al generar. Revísalas a mano en el cuadrante.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {CAMPOS_REGISTRADOS.map((d) => (
                <CampoNumero
                  key={d.key}
                  def={d}
                  value={valores[d.key]}
                  error={tocado ? errores[d.key] : null}
                  disabled={submitting}
                  onChange={(v) => setValor(d.key, v)}
                />
              ))}
              <div className="flex items-start gap-2 pt-6">
                <Checkbox
                  id="conv-festivos-extras"
                  checked={festivosExtras}
                  onCheckedChange={(v) => {
                    setFestivosExtras(v === true);
                    setTocado(true);
                    setGuardadoOk(false);
                  }}
                  disabled={submitting}
                />
                <Label htmlFor="conv-festivos-extras" className="leading-tight">
                  Las horas en festivo computan como extras
                </Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-1 pt-6">
              <Label htmlFor="conv-referencia">Referencia del convenio (opcional)</Label>
              <Input
                id="conv-referencia"
                value={referencia}
                placeholder="Ej.: Convenio colectivo transporte viajeros Murcia 2024-2027"
                onChange={(e) => {
                  setReferencia(e.target.value);
                  setTocado(true);
                  setGuardadoOk(false);
                }}
                disabled={submitting}
              />
            </CardContent>
          </Card>

          {errorRemoto && (
            <Alert variant="destructive">
              <AlertDescription>{errorRemoto}</AlertDescription>
            </Alert>
          )}
          {guardadoOk && (
            <Alert data-testid="guardado-ok">
              <CheckCircle2 className="size-4" />
              <AlertDescription>Convenio guardado.</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting || (tocado && hayErrores)}>
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {convenio ? 'Guardar cambios' : 'Guardar convenio'}
            </Button>
            {tocado && hayErrores && (
              <p className="text-sm text-destructive">
                Revisa los campos marcados.
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function CampoNumero({
  def,
  value,
  error,
  disabled,
  onChange,
}: {
  def: DefCampo;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const id = `conv-${def.key}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{def.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={def.integer ? 1 : 'any'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={error !== null}
          className="w-32"
        />
        <span className="text-sm text-muted-foreground">{def.unidad}</span>
      </div>
      <p className="text-xs text-muted-foreground">{def.ayuda}</p>
      {error && (
        <p className="text-xs text-destructive" data-testid={`error-${def.key}`}>
          {error}
        </p>
      )}
    </div>
  );
}
