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
import type { Ausencia, CategoriaAusencia, Conductor } from '@albius/shared';
import { CATEGORIA_AUSENCIA_LABEL } from '@/components/ausencias/AusenciasTable';
import {
  tsToISODateUTC,
  type ActualizarAusenciaInput,
  type CrearAusenciaInput,
} from '@/lib/services/ausencias';

/**
 * Form reutilizable para alta (modo='alta') y edición (modo='edicion') de
 * Ausencias (B32.2). Plantilla de LineaForm.
 *
 *   - Conductor: Select poblado con los conductores del centro (ordenados por
 *     apellidos, "Apellidos, Nombre (nº)"). En EDICIÓN es inmutable (el backend
 *     veta conductorId) → se muestra en caja read-only, sin Select.
 *     Sin buscador (60 opciones, Select simple ordenado): no empeora el
 *     picker existente; el buscador queda en TODO[catalogo-turnos-escala-ux].
 *   - Categoría cerrada (vacaciones/baja/permiso); código libre opcional
 *     (sigla de la empresa: V, B, AP, PS…).
 *   - Fechas como "YYYY-MM-DD" del input date, enviadas tal cual (el backend
 *     las parsea a medianoche UTC). Precarga en edición con tsToISODateUTC
 *     (getUTC*, nunca local — evita el off-by-one de Europe/Madrid).
 *   - Rango CERRADO: fechaFin >= fechaInicio (iguales = día suelto). Espejo de
 *     assertRangoAusenciaCoherente. Submit-blocking.
 *   - ATAJO "Un solo día": oculta fechaFin y la iguala a fechaInicio (permisos
 *     AP/PS frecuentes). En edición arranca marcado si inicio == fin.
 *   - El SOLAPE con otras ausencias lo valida el backend (failed-precondition);
 *     llega por errorRemoto vía mapCallableError.
 *   - DI10.13 delta omit-only en edición; DI10.15 reset por `key` del Dialog.
 */

function labelConductor(c: Conductor): string {
  const num = c.numeroEmpleado ? ` (nº ${c.numeroEmpleado})` : '';
  return `${c.apellidos}, ${c.nombre}${num}`;
}

export interface AusenciaFormProps {
  modo: 'alta' | 'edicion';
  ausenciaInicial?: Ausencia;
  /** Conductores del centro (ya ordenados por apellidos). */
  conductores: Conductor[];
  /** Preselección del conductor en alta (llegada desde Conductores). */
  conductorIdInicial?: string;
  /** Del claim del jefe. Inmutables: solo se usan para armar el alta. */
  tenantId: string;
  centroId: string;
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (
    input: CrearAusenciaInput | ActualizarAusenciaInput,
  ) => Promise<void>;
}

export default function AusenciaForm({
  modo,
  ausenciaInicial,
  conductores,
  conductorIdInicial,
  tenantId,
  centroId,
  submitting,
  errorRemoto,
  onSubmit,
}: AusenciaFormProps) {
  const iniISO = ausenciaInicial ? tsToISODateUTC(ausenciaInicial.fechaInicio) : '';
  const finISO = ausenciaInicial ? tsToISODateUTC(ausenciaInicial.fechaFin) : '';

  const [conductorId, setConductorId] = useState(
    ausenciaInicial?.conductorId ?? conductorIdInicial ?? '',
  );
  const [categoria, setCategoria] = useState<CategoriaAusencia>(
    ausenciaInicial?.categoria ?? 'vacaciones',
  );
  const [codigo, setCodigo] = useState(ausenciaInicial?.codigo ?? '');
  const [fechaInicio, setFechaInicio] = useState(iniISO);
  const [fechaFin, setFechaFin] = useState(finISO);
  const [unSoloDia, setUnSoloDia] = useState(
    ausenciaInicial ? iniISO === finISO : false,
  );
  const [observaciones, setObservaciones] = useState(
    ausenciaInicial?.observaciones ?? '',
  );

  // Fin EFECTIVO: con "un solo día" marcado, el fin es el propio inicio.
  const finEfectivo = unSoloDia ? fechaInicio : fechaFin;

  // Comparación lexicográfica de "YYYY-MM-DD" == cronológica. Rango CERRADO.
  const rangoError =
    fechaInicio && finEfectivo && finEfectivo < fechaInicio
      ? 'La fecha de fin debe ser igual o posterior a la de inicio.'
      : null;

  const conductorById = new Map(conductores.map((c) => [c.id, c]));
  const conductorInicial = ausenciaInicial
    ? conductorById.get(ausenciaInicial.conductorId)
    : undefined;

  // Delta omit-only para edición (DI10.13).
  function buildDelta(): ActualizarAusenciaInput | null {
    if (!ausenciaInicial) return null;
    const delta: ActualizarAusenciaInput = { ausenciaId: ausenciaInicial.id };
    if (categoria !== ausenciaInicial.categoria) delta.categoria = categoria;
    const codTrim = codigo.trim();
    if (codTrim && codTrim !== (ausenciaInicial.codigo ?? '')) {
      delta.codigo = codTrim;
    }
    if (fechaInicio && fechaInicio !== iniISO) delta.fechaInicio = fechaInicio;
    if (finEfectivo && finEfectivo !== finISO) delta.fechaFin = finEfectivo;
    const obsTrim = observaciones.trim();
    if (obsTrim && obsTrim !== (ausenciaInicial.observaciones ?? '')) {
      delta.observaciones = obsTrim;
    }
    return Object.keys(delta).length === 1 ? null : delta;
  }

  const sinCambios = modo === 'edicion' && buildDelta() === null;
  const requeridosFaltan =
    (modo === 'alta' && !conductorId) || !fechaInicio || !finEfectivo;
  const submitDeshabilitado =
    submitting || rangoError !== null || requeridosFaltan || sinCambios;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (rangoError || requeridosFaltan) return;
    if (modo === 'alta') {
      const input: CrearAusenciaInput = {
        tenantId,
        centroId,
        conductorId,
        categoria,
        fechaInicio,
        fechaFin: finEfectivo,
        ...(codigo.trim() && { codigo: codigo.trim() }),
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
      <Field label="Conductor" required>
        {modo === 'alta' ? (
          <Select value={conductorId} onValueChange={setConductorId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Elige un conductor…" />
            </SelectTrigger>
            <SelectContent>
              {conductores.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {labelConductor(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="rounded-md border bg-muted px-3 py-2 text-sm">
            {conductorInicial
              ? labelConductor(conductorInicial)
              : (ausenciaInicial?.conductorId ?? '')}
          </div>
        )}
        {modo === 'edicion' && (
          <p className="text-xs text-muted-foreground">
            El conductor no es editable. Si te equivocaste, elimina esta
            ausencia y crea otra.
          </p>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoría" required>
          <Select
            value={categoria}
            onValueChange={(v) => setCategoria(v as CategoriaAusencia)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CATEGORIA_AUSENCIA_LABEL) as CategoriaAusencia[]).map(
                (k) => (
                  <SelectItem key={k} value={k}>
                    {CATEGORIA_AUSENCIA_LABEL[k]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Código">
          <Input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="V, B, AP, PS…"
            maxLength={8}
          />
        </Field>
      </div>

      <fieldset className="border rounded-md p-3 space-y-3">
        <legend className="text-sm font-medium px-2">Fechas</legend>
        <div className="flex items-center gap-2">
          <Checkbox
            id="unSoloDia"
            checked={unSoloDia}
            onCheckedChange={(v) => setUnSoloDia(v === true)}
          />
          <Label htmlFor="unSoloDia" className="cursor-pointer">
            Un solo día
          </Label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={unSoloDia ? 'Día' : 'Desde'} required>
            <Input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              required
            />
          </Field>
          {!unSoloDia && (
            <Field label="Hasta" required>
              <Input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                required
              />
            </Field>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Ambas fechas incluidas. El optimizador no asignará turnos al conductor
          en esos días.
        </p>
        {rangoError && (
          <Alert>
            <AlertDescription>{rangoError}</AlertDescription>
          </Alert>
        )}
      </fieldset>

      <Field label="Observaciones">
        <Textarea
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Motivo, referencia del parte, etc."
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
              ? 'Registrar ausencia'
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
