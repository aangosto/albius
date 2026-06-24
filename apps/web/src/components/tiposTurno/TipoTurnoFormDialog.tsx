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
  actualizarTipoTurno,
  crearTipoTurno,
  type ActualizarTipoTurnoInput,
  type CrearTipoTurnoInput,
} from '@/lib/services/tiposTurno';
import type { TipoTurno } from '@albius/shared';
import TipoTurnoForm from './TipoTurnoForm';

/**
 * Dialog modal unificado para alta y edición de Tipos de turno (D4.7),
 * plantilla de LineaFormDialog.
 *
 * - State propio: `submitting` y `errorRemoto`. Reset cuando `open` pasa a true.
 *   El reset de los campos del form vive en TipoTurnoForm vía `key` prop (DI10.15).
 * - handleSubmit single try/catch: crearTipoTurno/actualizarTipoTurno +
 *   onSuccess (refetch) + onClose. Error → mapCallableError (D4.10).
 * - Cierre bloqueado durante submit (onOpenChange filtra !submitting,
 *   showCloseButton={!submitting}).
 *
 * tenantId/centroId vienen de los claims del jefe (la página los pasa). En
 * edición no se usan (TipoTurnoForm no muestra ni edita centro/tenant), pero se
 * pasan igual para mantener una sola firma del form.
 */

export interface TipoTurnoFormDialogProps {
  open: boolean;
  modo: 'alta' | 'edicion';
  tipoInicial?: TipoTurno;
  tenantId: string;
  centroId: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function TipoTurnoFormDialog({
  open,
  modo,
  tipoInicial,
  tenantId,
  centroId,
  onClose,
  onSuccess,
}: TipoTurnoFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(
    input: CrearTipoTurnoInput | ActualizarTipoTurnoInput,
  ) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (modo === 'alta') {
        await crearTipoTurno(input as CrearTipoTurnoInput);
      } else {
        await actualizarTipoTurno(input as ActualizarTipoTurnoInput);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[tipos-turno] callable error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        showCloseButton={!submitting}
      >
        <DialogHeader>
          <DialogTitle>
            {modo === 'alta'
              ? 'Nuevo tipo de turno'
              : `Editar: ${tipoInicial?.codigo ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {modo === 'alta'
              ? 'Crea un nuevo tipo de turno en tu centro.'
              : 'Modifica los datos del tipo de turno. El centro no es editable.'}
          </DialogDescription>
        </DialogHeader>
        <TipoTurnoForm
          key={tipoInicial?.id ?? 'alta'}
          modo={modo}
          tipoInicial={tipoInicial}
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
