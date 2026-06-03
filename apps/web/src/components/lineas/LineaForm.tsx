import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import type { EstadoLinea, Linea, TipoLinea } from '@albius/shared';
import { ESTADO_LABEL, TIPO_LABEL } from '@/components/lineas/LineasTable';
import type {
  ActualizarLineaInput,
  CrearLineaInput,
} from '@/lib/services/lineas';

/**
 * Form reutilizable para alta (modo='alta') y edición (modo='edicion') de
 * Líneas. Plantilla de CentroForm con las diferencias operativas de Línea.
 *
 * Decisiones canónicas / de bloque:
 *   - SIN selector de centro (B17): tenantId+centroId llegan por props desde
 *     los claims del jefe (useAuth en la página). Una línea se crea en el
 *     centro del jefe; en edición ambos son inmutables y ni se muestran.
 *   - D6.2 — estado enum-3 ('activa'|'inactiva'|'suspendida') en un Select
 *     directo, SIN Dialog destructivo aparte (Línea no tiene estado
 *     irreversible como el 'cancelado' de Tenant). El Select se muestra TANTO
 *     en alta COMO en edición. En alta default 'activa' (caso común), pero el
 *     jefe puede elegir 'suspendida' para una línea estacional futura
 *     (coherente con "estado requerido en CREATE", B16).
 *   - color: validación HEX cliente (espejo del backend B16,
 *     /^#[0-9A-Fa-f]{6}$/), feedback solo tras blur, con preview del color.
 *     Vacío permitido (opcional).
 *   - vigencia: dos inputs date opcionales; si ambos presentes se exige
 *     desde<hasta (espejo de assertVigenciaCoherente), submit-blocking. Se
 *     envían como ISO string ("YYYY-MM-DD") que el backend convierte a
 *     Timestamp.
 *   - DI10.13 — vaciar un campo opcional preexistente (color, vigencia,
 *     observaciones) NO envía cambio (backend sin delete-on-empty, ver
 *     TODO[delete-on-empty-fields]).
 *   - DI10.15 — reset entre aperturas por `key` prop del padre Dialog.
 *
 * Paradas: NO se editan aquí (TODO[modelo-linea-paradas]): la relación
 * línea↔parada se redecide cuando exista CRUD de Paradas. El backend defaultea
 * paradasIda/Vuelta a [] en alta. Mismo criterio que B14 con los campos
 * operativos del conductor.
 */

const COLOR_HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

function tsToDateInput(ts: Linea['vigenciaDesde'] | undefined): string {
  if (!ts) return '';
  const d = ts.toDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface LineaFormProps {
  modo: 'alta' | 'edicion';
  lineaInicial?: Linea;
  /** Del claim del jefe. Inmutables: solo se usan para armar el alta. */
  tenantId: string;
  centroId: string;
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: CrearLineaInput | ActualizarLineaInput) => Promise<void>;
}

export default function LineaForm({
  modo,
  lineaInicial,
  tenantId,
  centroId,
  submitting,
  errorRemoto,
  onSubmit,
}: LineaFormProps) {
  const [codigo, setCodigo] = useState(lineaInicial?.codigo ?? '');
  const [nombre, setNombre] = useState(lineaInicial?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoLinea>(lineaInicial?.tipo ?? 'urbana');
  const [estado, setEstado] = useState<EstadoLinea>(
    lineaInicial?.estado ?? 'activa',
  );
  const [color, setColor] = useState(lineaInicial?.color ?? '');
  const [colorTouched, setColorTouched] = useState(false);
  const [esNocturna, setEsNocturna] = useState(
    lineaInicial?.esNocturna ?? false,
  );
  const [vigenciaDesde, setVigenciaDesde] = useState(
    tsToDateInput(lineaInicial?.vigenciaDesde),
  );
  const [vigenciaHasta, setVigenciaHasta] = useState(
    tsToDateInput(lineaInicial?.vigenciaHasta),
  );
  const [observaciones, setObservaciones] = useState(
    lineaInicial?.observaciones ?? '',
  );

  const colorTrim = color.trim();
  const colorError =
    colorTrim !== '' && !COLOR_HEX_REGEX.test(colorTrim)
      ? 'El color debe ser un HEX de 6 dígitos (ej: #1F77B4).'
      : null;
  const colorValido = colorTrim !== '' && colorError === null;

  // Comparación lexicográfica de "YYYY-MM-DD" == cronológica.
  const vigenciaError =
    vigenciaDesde && vigenciaHasta && vigenciaDesde >= vigenciaHasta
      ? 'La vigencia "desde" debe ser anterior a "hasta".'
      : null;

  // Delta omit-only para edición (DI10.13).
  function buildDelta(): ActualizarLineaInput | null {
    if (!lineaInicial) return null;
    const delta: ActualizarLineaInput = { lineaId: lineaInicial.id };
    if (codigo !== lineaInicial.codigo) delta.codigo = codigo;
    if (nombre !== lineaInicial.nombre) delta.nombre = nombre;
    if (tipo !== lineaInicial.tipo) delta.tipo = tipo;
    if (estado !== lineaInicial.estado) delta.estado = estado;
    if (esNocturna !== lineaInicial.esNocturna) delta.esNocturna = esNocturna;
    // color: vaciar uno preexistente NO se envía (DI10.13). Solo si hay valor
    // válido y difiere del inicial.
    if (colorValido && colorTrim !== (lineaInicial.color ?? '')) {
      delta.color = colorTrim;
    }
    // vigencia: ISO string del input date. Vaciar preexistente = omit.
    if (vigenciaDesde && vigenciaDesde !== tsToDateInput(lineaInicial.vigenciaDesde)) {
      delta.vigenciaDesde = vigenciaDesde;
    }
    if (vigenciaHasta && vigenciaHasta !== tsToDateInput(lineaInicial.vigenciaHasta)) {
      delta.vigenciaHasta = vigenciaHasta;
    }
    const obsTrim = observaciones.trim();
    if (obsTrim && obsTrim !== (lineaInicial.observaciones ?? '')) {
      delta.observaciones = obsTrim;
    }
    return Object.keys(delta).length === 1 ? null : delta;
  }

  const sinCambios = modo === 'edicion' && buildDelta() === null;
  const requeridosFaltan = !codigo.trim() || !nombre.trim();
  const submitDeshabilitado =
    submitting ||
    colorError !== null ||
    vigenciaError !== null ||
    requeridosFaltan ||
    sinCambios;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (colorError || vigenciaError || requeridosFaltan) return;
    if (modo === 'alta') {
      const input: CrearLineaInput = {
        tenantId,
        centroId,
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        tipo,
        esNocturna,
        estado,
        ...(colorValido && { color: colorTrim }),
        ...(vigenciaDesde && { vigenciaDesde }),
        ...(vigenciaHasta && { vigenciaHasta }),
        ...(observaciones.trim() && { observaciones: observaciones.trim() }),
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
            placeholder="42A, 7B, N1…"
            required
          />
        </Field>
        <Field label="Tipo" required>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoLinea)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TIPO_LABEL) as TipoLinea[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TIPO_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Nombre" required>
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Centro - Universidad"
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Estado" required>
          <Select
            value={estado}
            onValueChange={(v) => setEstado(v as EstadoLinea)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ESTADO_LABEL) as EstadoLinea[]).map((e) => (
                <SelectItem key={e} value={e}>
                  {ESTADO_LABEL[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              onBlur={() => setColorTouched(true)}
              placeholder="#1F77B4"
            />
            <span
              aria-label="vista previa del color"
              className="size-9 shrink-0 rounded-md border"
              style={
                colorValido ? { backgroundColor: colorTrim } : undefined
              }
            />
          </div>
          {colorTouched && colorError && (
            <p className="text-xs text-destructive">{colorError}</p>
          )}
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="esNocturna"
          checked={esNocturna}
          onCheckedChange={(v) => setEsNocturna(v === true)}
        />
        <Label htmlFor="esNocturna" className="cursor-pointer">
          Línea nocturna
        </Label>
      </div>

      <fieldset className="border rounded-md p-3 space-y-2">
        <legend className="text-sm font-medium px-2">Vigencia (opcional)</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">
            <Input
              type="date"
              value={vigenciaDesde}
              onChange={(e) => setVigenciaDesde(e.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={vigenciaHasta}
              onChange={(e) => setVigenciaHasta(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Para líneas estacionales. Deja ambas vacías si la línea opera siempre.
        </p>
        {vigenciaError && (
          <Alert>
            <AlertDescription>{vigenciaError}</AlertDescription>
          </Alert>
        )}
      </fieldset>

      <Field label="Observaciones">
        <Textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Notas operativas relevantes…"
        />
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
              ? 'Crear línea'
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
