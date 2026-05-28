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
  actualizarCentro,
  crearCentro,
  type ActualizarCentroInput,
  type CrearCentroInput,
} from '@/lib/services/centros';
import type { Centro, Tenant } from '@albius/shared';
import CentroForm from './CentroForm';

/**
 * Dialog modal unificado para alta y edición de Centros (DI10.4 reusado).
 *
 * Composición:
 *   - State propio del dialog: `submitting` y `errorRemoto`.
 *   - Reset de state propio cuando `open` pasa a true (useEffect). El reset
 *     de los campos del form vive en CentroForm vía DI10.15 (key prop), no
 *     aquí.
 *   - handleSubmit single try/catch: si cualquier paso (callable o refetch)
 *     falla, muestra el error mapeado. Compromiso aceptado: si el callable
 *     OK pero onSuccess (refetch) falla, el operador ve "Error inesperado"
 *     aunque la mutación se haya aplicado. Patrón documentado del B10;
 *     refactorizar si surge ruido.
 *
 * UX bloqueada durante submit (DI10.12):
 *   - onOpenChange filtra cierre si submitting=true (X / Esc / click overlay).
 *   - showCloseButton={!submitting} oculta visualmente la X mientras dura
 *     el submit para feedback coherente con el bloqueo.
 *
 * El union `CrearCentroInput | ActualizarCentroInput` que llega de
 * CentroForm.onSubmit se discrimina por `modo` y se castea al tipo concreto
 * en handleSubmit. Patrón idéntico al de TenantFormDialog.
 */

export interface CentroFormDialogProps {
  open: boolean;
  modo: 'alta' | 'edicion';
  centroInicial?: Centro;
  tenantsActivos: Tenant[];
  tenants: Tenant[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CentroFormDialog({
  open,
  modo,
  centroInicial,
  tenantsActivos,
  tenants,
  onClose,
  onSuccess,
}: CentroFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(
    input: CrearCentroInput | ActualizarCentroInput,
  ) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (modo === 'alta') {
        await crearCentro(input as CrearCentroInput);
      } else {
        await actualizarCentro(input as ActualizarCentroInput);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[centros] callable error:', err);
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
      <DialogContent className="max-w-2xl" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>
            {modo === 'alta'
              ? 'Nuevo centro'
              : `Editar: ${centroInicial?.nombre ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {modo === 'alta'
              ? 'Crea un nuevo centro operativo dentro de un tenant.'
              : 'Modifica los datos del centro. El tenant no es editable.'}
          </DialogDescription>
        </DialogHeader>
        <CentroForm
          key={centroInicial?.id ?? 'alta'}
          modo={modo}
          centroInicial={centroInicial}
          tenantsActivos={tenantsActivos}
          tenants={tenants}
          submitting={submitting}
          errorRemoto={errorRemoto}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
