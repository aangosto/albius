import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ConductorCamposOperativos, {
  type OperativosValue,
} from '@/components/usuarios/ConductorCamposOperativos';
import { ESTADO_CONDUCTOR_LABEL } from '@/components/conductores/ConductoresTable';
import type { Conductor, EstadoConductor } from '@albius/shared';
import type { ActualizarConductorInput } from '@/lib/services/conductores';

/**
 * Form de edición de la config operativa de un conductor (B22). El jefe edita
 * SOLO lo que vive exclusivamente en /conductores (las preferencias operativas,
 * estado, puedeSerReserva); la identidad y los datos dual-homed con /usuarios
 * los gestiona el super_admin (el backend de actualizarConductor los veta).
 *
 * Reutiliza `ConductorCamposOperativos` (B21) precargando `OperativosValue` con
 * los valores actuales del conductor. El centro es fijo (claims del jefe), así
 * que NO hay reset-on-centro; el componente carga las opciones de ese centro.
 *
 * `estado` (EstadoConductor enum-4) en un Select (patrón Línea, no binario).
 * `puedeSerReserva` checkbox. `buildDelta` omit-only (DI10.13): solo envía los
 * campos cambiados — de paso resuelve el edge del "id muerto" (si una línea/tipo
 * referenciada se borró, no aparece como opción; solo se reenvía un array si el
 * usuario lo modifica). Arrays comparados como CONJUNTO (orden irrelevante).
 *
 * Vaciar maxHorasSemanales/observaciones preexistentes NO se envía (el backend
 * no soporta delete-on-empty — TODO[delete-on-empty-fields]); solo se envía un
 * valor nuevo no vacío.
 */

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function operativosIniciales(c: Conductor): OperativosValue {
  return {
    lineasPreferentes: [...c.lineasPreferentes],
    lineasSecundarias: [...c.lineasSecundarias],
    tiposTurnoPermitidos: [...c.tiposTurnoPermitidos],
    tiposTurnoExcluidos: [...(c.tiposTurnoExcluidos ?? [])],
    maxHorasSemanales:
      c.maxHorasSemanales != null ? String(c.maxHorasSemanales) : '',
    observaciones: c.observaciones ?? '',
  };
}

export interface ConductorEditFormProps {
  conductor: Conductor;
  tenantId: string;
  centroId: string;
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: ActualizarConductorInput) => Promise<void>;
}

export default function ConductorEditForm({
  conductor,
  tenantId,
  centroId,
  submitting,
  errorRemoto,
  onSubmit,
}: ConductorEditFormProps) {
  const [operativos, setOperativos] = useState<OperativosValue>(() =>
    operativosIniciales(conductor),
  );
  const [estado, setEstado] = useState<EstadoConductor>(conductor.estado);
  const [puedeSerReserva, setPuedeSerReserva] = useState(
    conductor.puedeSerReserva,
  );

  function buildDelta(): ActualizarConductorInput {
    const delta: ActualizarConductorInput = { conductorId: conductor.id };

    if (!sameSet(operativos.lineasPreferentes, conductor.lineasPreferentes)) {
      delta.lineasPreferentes = operativos.lineasPreferentes;
    }
    if (!sameSet(operativos.lineasSecundarias, conductor.lineasSecundarias)) {
      delta.lineasSecundarias = operativos.lineasSecundarias;
    }
    if (
      !sameSet(operativos.tiposTurnoPermitidos, conductor.tiposTurnoPermitidos)
    ) {
      delta.tiposTurnoPermitidos = operativos.tiposTurnoPermitidos;
    }
    if (
      !sameSet(
        operativos.tiposTurnoExcluidos,
        conductor.tiposTurnoExcluidos ?? [],
      )
    ) {
      delta.tiposTurnoExcluidos = operativos.tiposTurnoExcluidos;
    }

    // maxHorasSemanales: solo un valor nuevo válido distinto del actual. Vaciar
    // uno preexistente NO se envía (sin delete-on-empty).
    const maxRaw = operativos.maxHorasSemanales.trim();
    const maxNum = Number(maxRaw);
    const maxValido = maxRaw !== '' && Number.isFinite(maxNum) && maxNum > 0;
    if (maxValido && maxNum !== (conductor.maxHorasSemanales ?? null)) {
      delta.maxHorasSemanales = maxNum;
    }

    const obsTrim = operativos.observaciones.trim();
    if (obsTrim && obsTrim !== (conductor.observaciones ?? '')) {
      delta.observaciones = obsTrim;
    }

    if (estado !== conductor.estado) delta.estado = estado;
    if (puedeSerReserva !== conductor.puedeSerReserva) {
      delta.puedeSerReserva = puedeSerReserva;
    }

    return delta;
  }

  const sinCambios = Object.keys(buildDelta()).length === 1;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const delta = buildDelta();
    if (Object.keys(delta).length === 1) return; // solo conductorId
    await onSubmit(delta);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Estado</Label>
          <Select
            value={estado}
            onValueChange={(v) => setEstado(v as EstadoConductor)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ESTADO_CONDUCTOR_LABEL) as EstadoConductor[]).map(
                (e) => (
                  <SelectItem key={e} value={e}>
                    {ESTADO_CONDUCTOR_LABEL[e]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={puedeSerReserva}
              onCheckedChange={(v) => setPuedeSerReserva(v === true)}
            />
            <span>Puede ser reserva</span>
          </label>
        </div>
      </div>

      <ConductorCamposOperativos
        tenantId={tenantId}
        centroId={centroId}
        value={operativos}
        onChange={setOperativos}
      />

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
        <Button type="submit" disabled={submitting || sinCambios}>
          {submitting ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
