import { useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TipoTurno, TramoPartido } from '@albius/shared';
import type {
  ActualizarTipoTurnoInput,
  CrearTipoTurnoInput,
} from '@/lib/services/tiposTurno';

/**
 * Form reutilizable para alta (modo='alta') y edición (modo='edicion') de Tipos
 * de turno. Plantilla de LineaForm con las diferencias de B19:
 *
 *   - SIN selector de centro (B17/B19): tenantId+centroId llegan por props
 *     desde los claims del jefe. En edición ambos son inmutables y ni se
 *     muestran.
 *   - Estado BINARIO (D5.3, patrón Centro): el form NO incluye Select de
 *     estado. En alta se crea siempre 'activo' (hard-coded, como crearCentro).
 *     Las transiciones activo↔obsoleto van por botones de la tabla +
 *     CambiarEstadoTipoTurnoDialog. Es la diferencia clave vs LineaForm (que sí
 *     lleva Select por el enum-3 D6.2).
 *   - Turno PARTIDO: checkbox `esPartido` que, al activarse, muestra una lista
 *     DINÁMICA de tramos (añadir/quitar, cada uno con inicio/fin en "HH:mm").
 *     Cuando esPartido está desactivado los tramos no se muestran ni se envían.
 *   - Horas como inputs type="time" ("HH:mm"); duraciones como type="number".
 *     D6.6: la duración se DECLARA, el form NO la calcula desde las horas.
 *   - esNocturno: checkbox simple, ortogonal a esPartido (ambos pueden coexistir).
 *   - color: opcional con preview + validación HEX cliente (espejo del backend).
 *   - DI10.13 — vaciar color preexistente NO envía cambio (delete-on-empty no
 *     soportado por el backend, TODO[delete-on-empty-fields]).
 *   - DI10.15 — reset entre aperturas por `key` prop del Dialog padre.
 *
 * Validación cliente espejo del backend (validation.ts B18):
 *   - HH:mm en horas y tramos (los inputs type="time" ya garantizan formato).
 *   - duracionEfectivaMinutos <= duracionMinutos, ambas > 0.
 *   - esPartido exige >= 1 tramo, cada tramo inicio<fin y (si el turno NO cruza
 *     medianoche) dentro de [horaInicio, horaFin].
 */

const COLOR_HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

interface TramoState {
  inicio: string;
  fin: string;
}

function tramosEqual(a: TramoPartido[], b: TramoPartido[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t.inicio === b[i]?.inicio && t.fin === b[i]?.fin);
}

export interface TipoTurnoFormProps {
  modo: 'alta' | 'edicion';
  tipoInicial?: TipoTurno;
  /** Del claim del jefe. Inmutables: solo se usan para armar el alta. */
  tenantId: string;
  centroId: string;
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (
    input: CrearTipoTurnoInput | ActualizarTipoTurnoInput,
  ) => Promise<void>;
}

export default function TipoTurnoForm({
  modo,
  tipoInicial,
  tenantId,
  centroId,
  submitting,
  errorRemoto,
  onSubmit,
}: TipoTurnoFormProps) {
  const [codigo, setCodigo] = useState(tipoInicial?.codigo ?? '');
  const [nombre, setNombre] = useState(tipoInicial?.nombre ?? '');
  const [horaInicio, setHoraInicio] = useState(tipoInicial?.horaInicio ?? '');
  const [horaFin, setHoraFin] = useState(tipoInicial?.horaFin ?? '');
  const [duracionMinutos, setDuracionMinutos] = useState(
    tipoInicial ? String(tipoInicial.duracionMinutos) : '',
  );
  const [duracionEfectivaMinutos, setDuracionEfectivaMinutos] = useState(
    tipoInicial ? String(tipoInicial.duracionEfectivaMinutos) : '',
  );
  const [esPartido, setEsPartido] = useState(tipoInicial?.esPartido ?? false);
  const [tramos, setTramos] = useState<TramoState[]>(
    tipoInicial?.tramosPartido?.map((t) => ({ inicio: t.inicio, fin: t.fin })) ??
      [],
  );
  const [esNocturno, setEsNocturno] = useState(
    tipoInicial?.esNocturno ?? false,
  );
  const [color, setColor] = useState(tipoInicial?.color ?? '');
  const [colorTouched, setColorTouched] = useState(false);

  // --- Validaciones derivadas (espejo del backend) ---

  const colorTrim = color.trim();
  const colorError =
    colorTrim !== '' && !COLOR_HEX_REGEX.test(colorTrim)
      ? 'El color debe ser un HEX de 6 dígitos (ej: #1F77B4).'
      : null;
  const colorValido = colorTrim !== '' && colorError === null;

  const durTotalNum = Number(duracionMinutos);
  const durEfNum = Number(duracionEfectivaMinutos);
  const durTotalValido =
    duracionMinutos.trim() !== '' &&
    Number.isFinite(durTotalNum) &&
    durTotalNum > 0;
  const durEfValido =
    duracionEfectivaMinutos.trim() !== '' &&
    Number.isFinite(durEfNum) &&
    durEfNum > 0;
  const duracionError =
    durTotalValido && durEfValido && durEfNum > durTotalNum
      ? 'La duración efectiva no puede superar la total.'
      : null;

  // Comparación lexicográfica de "HH:mm" == cronológica (24h con cero-padding).
  const cruzaMedianoche =
    horaInicio !== '' && horaFin !== '' && horaFin <= horaInicio;

  function tramoError(t: TramoState): string | null {
    if (!t.inicio || !t.fin) return 'Completa inicio y fin.';
    if (t.inicio >= t.fin) return 'El inicio debe ser anterior al fin.';
    if (
      horaInicio &&
      horaFin &&
      !cruzaMedianoche &&
      (t.inicio < horaInicio || t.fin > horaFin)
    ) {
      return `Debe estar dentro de ${horaInicio}–${horaFin}.`;
    }
    return null;
  }

  const tramosError = esPartido
    ? tramos.length === 0
      ? 'Añade al menos un tramo cuando el turno es partido.'
      : tramos.some((t) => tramoError(t) !== null)
        ? 'Revisa los tramos: hay alguno incompleto o fuera de rango.'
        : null
    : null;

  const requeridosFaltan =
    !codigo.trim() ||
    !nombre.trim() ||
    !horaInicio ||
    !horaFin ||
    !durTotalValido ||
    !durEfValido;

  // --- Delta omit-only para edición (DI10.13) ---

  function buildDelta(): ActualizarTipoTurnoInput | null {
    if (!tipoInicial) return null;
    const delta: ActualizarTipoTurnoInput = { tipoTurnoId: tipoInicial.id };
    if (codigo.trim() !== tipoInicial.codigo) delta.codigo = codigo.trim();
    if (nombre.trim() !== tipoInicial.nombre) delta.nombre = nombre.trim();
    if (horaInicio !== tipoInicial.horaInicio) delta.horaInicio = horaInicio;
    if (horaFin !== tipoInicial.horaFin) delta.horaFin = horaFin;
    if (durTotalNum !== tipoInicial.duracionMinutos) {
      delta.duracionMinutos = durTotalNum;
    }
    if (durEfNum !== tipoInicial.duracionEfectivaMinutos) {
      delta.duracionEfectivaMinutos = durEfNum;
    }
    if (esNocturno !== tipoInicial.esNocturno) delta.esNocturno = esNocturno;
    // color: vaciar uno preexistente NO se envía (DI10.13). Solo si hay valor
    // válido y difiere del inicial.
    if (colorValido && colorTrim !== (tipoInicial.color ?? '')) {
      delta.color = colorTrim;
    }
    // esPartido + tramos (validación cruzada del backend):
    //  - false→true: enviar esPartido:true Y tramosPartido (no vacío).
    //  - true→false: enviar solo esPartido:false (el backend rechaza tramos
    //    con esPartido false; el tramosPartido viejo queda en el doc, inerte —
    //    el backend no soporta delete-on-empty, TODO[delete-on-empty-fields]).
    //  - true→true con tramos cambiados: enviar solo tramosPartido.
    const esPartidoChanged = esPartido !== tipoInicial.esPartido;
    if (esPartidoChanged) delta.esPartido = esPartido;
    if (esPartido) {
      const tramosNorm: TramoPartido[] = tramos.map((t) => ({
        inicio: t.inicio,
        fin: t.fin,
      }));
      const tramosChanged = !tramosEqual(
        tramosNorm,
        tipoInicial.tramosPartido ?? [],
      );
      if (esPartidoChanged || tramosChanged) {
        delta.tramosPartido = tramosNorm;
      }
    }
    return Object.keys(delta).length === 1 ? null : delta;
  }

  const sinCambios = modo === 'edicion' && buildDelta() === null;
  const submitDeshabilitado =
    submitting ||
    colorError !== null ||
    duracionError !== null ||
    tramosError !== null ||
    requeridosFaltan ||
    sinCambios;

  // --- Tramos: handlers de la lista dinámica ---

  function addTramo() {
    setTramos((prev) => [...prev, { inicio: '', fin: '' }]);
  }
  function removeTramo(index: number) {
    setTramos((prev) => prev.filter((_, i) => i !== index));
  }
  function updateTramo(index: number, campo: 'inicio' | 'fin', valor: string) {
    setTramos((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [campo]: valor } : t)),
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      colorError ||
      duracionError ||
      tramosError ||
      requeridosFaltan
    ) {
      return;
    }
    if (modo === 'alta') {
      const input: CrearTipoTurnoInput = {
        tenantId,
        centroId,
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        horaInicio,
        horaFin,
        duracionMinutos: durTotalNum,
        duracionEfectivaMinutos: durEfNum,
        esPartido,
        esNocturno,
        estado: 'activo', // D5.3: alta siempre activo (patrón crearCentro).
        ...(colorValido && { color: colorTrim }),
        ...(esPartido && {
          tramosPartido: tramos.map((t) => ({ inicio: t.inicio, fin: t.fin })),
        }),
      };
      await onSubmit(input);
    } else {
      const delta = buildDelta();
      if (delta) await onSubmit(delta);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Código" required>
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="M-LARGO, T1, P-COM…"
            required
          />
        </Field>
        <Field label="Nombre" required>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Mañana largo"
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Hora inicio" required>
          <Input
            type="time"
            value={horaInicio}
            onChange={(e) => setHoraInicio(e.target.value)}
            required
          />
        </Field>
        <Field label="Hora fin" required>
          <Input
            type="time"
            value={horaFin}
            onChange={(e) => setHoraFin(e.target.value)}
            required
          />
        </Field>
      </div>
      {cruzaMedianoche && (
        <p className="text-xs text-muted-foreground">
          La hora de fin es anterior a la de inicio: el turno cruza la
          medianoche (termina al día siguiente).
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Duración total (min)" required>
          <Input
            type="number"
            min={1}
            value={duracionMinutos}
            onChange={(e) => setDuracionMinutos(e.target.value)}
            placeholder="480"
            required
          />
        </Field>
        <Field label="Duración efectiva (min)" required>
          <Input
            type="number"
            min={1}
            value={duracionEfectivaMinutos}
            onChange={(e) => setDuracionEfectivaMinutos(e.target.value)}
            placeholder="450"
            required
          />
        </Field>
      </div>
      {duracionError && (
        <p className="text-xs text-destructive">{duracionError}</p>
      )}
      <p className="text-xs text-muted-foreground">
        La duración se declara a mano (puede diferir de fin − inicio: cortes,
        cruce de medianoche, cómputo del convenio).
      </p>

      <div className="flex items-center gap-2">
        <Checkbox
          id="esNocturno"
          checked={esNocturno}
          onCheckedChange={(v) => setEsNocturno(v === true)}
        />
        <Label htmlFor="esNocturno" className="cursor-pointer">
          Turno nocturno
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="esPartido"
          checked={esPartido}
          onCheckedChange={(v) => setEsPartido(v === true)}
        />
        <Label htmlFor="esPartido" className="cursor-pointer">
          Turno partido (con corte intermedio)
        </Label>
      </div>

      {esPartido && (
        <fieldset className="border rounded-md p-3 space-y-3">
          <legend className="text-sm font-medium px-2">Tramos del turno</legend>
          {tramos.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aún no hay tramos. Añade al menos uno.
            </p>
          )}
          {tramos.map((t, i) => {
            const err = tramoError(t);
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Inicio</Label>
                    <Input
                      type="time"
                      value={t.inicio}
                      onChange={(e) => updateTramo(i, 'inicio', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fin</Label>
                    <Input
                      type="time"
                      value={t.fin}
                      onChange={(e) => updateTramo(i, 'fin', e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTramo(i)}
                    aria-label={`Quitar tramo ${i + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {err && <p className="text-xs text-destructive">{err}</p>}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addTramo}
          >
            + Añadir tramo
          </Button>
        </fieldset>
      )}

      <Field label="Color">
        <div className="flex items-center gap-2">
          <Input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            onBlur={() => setColorTouched(true)}
            placeholder="#FFD700"
          />
          <span
            aria-label="vista previa del color"
            className="size-9 shrink-0 rounded-md border"
            style={colorValido ? { backgroundColor: colorTrim } : undefined}
          />
        </div>
        {colorTouched && colorError && (
          <p className="text-xs text-destructive">{colorError}</p>
        )}
      </Field>

      {errorRemoto && (
        <Alert variant="destructive">
          <AlertDescription>{errorRemoto}</AlertDescription>
        </Alert>
      )}

      {sinCambios && (
        <p className="text-xs text-muted-foreground">
          No hay cambios que guardar.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitDeshabilitado}>
          {submitting
            ? 'Guardando…'
            : modo === 'alta'
              ? 'Crear tipo de turno'
              : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}
