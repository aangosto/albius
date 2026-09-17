import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { mapCallableError } from '@/lib/callable-errors';
import {
  actualizarAusencia,
  crearAusencia,
  type ActualizarAusenciaInput,
  type CrearAusenciaInput,
} from '@/lib/services/ausencias';
import type { Ausencia, Conductor } from '@albius/shared';
import AusenciaForm from './AusenciaForm';
import { formatRango, nombreConductor } from './AusenciasTable';

/**
 * Dialog modal unificado para alta y edición de Ausencias (D4.7), plantilla de
 * LineaFormDialog. State propio `submitting`/`errorRemoto`, reset al abrir;
 * reset de campos vía `key` en AusenciaForm (DI10.15). Cierre bloqueado durante
 * submit. Errores del backend (solape, rango, conductor de otro centro…)
 * traducidos con mapCallableError (D4.10).
 */

export interface AusenciaFormDialogProps {
  open: boolean;
  modo: 'alta' | 'edicion';
  ausenciaInicial?: Ausencia;
  conductores: Conductor[];
  conductorIdInicial?: string;
  tenantId: string;
  centroId: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function AusenciaFormDialog({
  open,
  modo,
  ausenciaInicial,
  conductores,
  conductorIdInicial,
  tenantId,
  centroId,
  onClose,
  onSuccess,
}: AusenciaFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(
    input: CrearAusenciaInput | ActualizarAusenciaInput,
  ) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (modo === 'alta') {
        await crearAusencia(input as CrearAusenciaInput);
      } else {
        await actualizarAusencia(input as ActualizarAusenciaInput);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[ausencias] callable error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const tituloEdicion = ausenciaInicial
    ? `Editar: ${nombreConductor(ausenciaInicial.conductorId, conductoresById)} · ${formatRango(ausenciaInicial)}`
    : 'Editar ausencia';

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle>
            {modo === 'alta' ? 'Nueva ausencia' : tituloEdicion}
          </DialogTitle>
          <DialogDescription>
            {modo === 'alta'
              ? 'Registra vacaciones, una baja o un permiso de un conductor de tu centro.'
              : 'Modifica la categoría, el código, las fechas o las observaciones.'}
          </DialogDescription>
        </DialogHeader>
        <AusenciaForm
          key={ausenciaInicial?.id ?? `alta-${conductorIdInicial ?? ''}`}
          modo={modo}
          ausenciaInicial={ausenciaInicial}
          conductores={conductores}
          conductorIdInicial={conductorIdInicial}
          tenantId={tenantId}
          centroId={centroId}
          submitting={submitting}
          errorRemoto={errorRemoto}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
