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
  actualizarConductor,
  type ActualizarConductorInput,
} from '@/lib/services/conductores';
import type { Conductor } from '@albius/shared';
import ConductorEditForm from './ConductorEditForm';

/**
 * Dialog modal de edición de la config operativa del conductor (B22), molde de
 * LineaFormDialog. Solo edición (el alta es super_admin-only, opción A).
 *
 * - State propio: `submitting` y `errorRemoto`. Reset al abrir. El reset de los
 *   campos del form vive en ConductorEditForm vía `key` (el conductor.id del
 *   padre desmonta/remonta el form al cambiar de target).
 * - handleSubmit: actualizarConductor + onSuccess (refetch) + onClose. Error →
 *   mapCallableError (D4.10).
 * - Cierre bloqueado durante submit.
 */

export interface ConductorEditDialogProps {
  conductor: Conductor | null;
  tenantId: string;
  centroId: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function ConductorEditDialog({
  conductor,
  tenantId,
  centroId,
  onClose,
  onSuccess,
}: ConductorEditDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);
  const open = conductor !== null;

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(input: ActualizarConductorInput) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      await actualizarConductor(input);
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[conductores] callable error:', err);
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
            {conductor
              ? `Editar: ${conductor.nombre} ${conductor.apellidos}`
              : 'Editar conductor'}
          </DialogTitle>
          <DialogDescription>
            Configura las líneas, tipos de turno y el estado operativo. La
            identidad y los datos de contacto se gestionan desde Usuarios.
          </DialogDescription>
        </DialogHeader>
        {conductor && (
          <ConductorEditForm
            key={conductor.id}
            conductor={conductor}
            tenantId={tenantId}
            centroId={centroId}
            submitting={submitting}
            errorRemoto={errorRemoto}
            onSubmit={handleSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
