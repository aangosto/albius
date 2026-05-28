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
  actualizarTenant,
  crearTenant,
  type ActualizarTenantInput,
  type CrearTenantInput,
} from '@/lib/services/tenants';
import type { Tenant } from '@albius/shared';
import TenantForm from './TenantForm';

/**
 * Dialog modal unificado para alta y edición de Tenants (DI10.4).
 *
 * Composición:
 *   - State propio del dialog: `submitting` y `errorRemoto`.
 *   - Reset de state propio cuando `open` pasa a true (useEffect). El reset
 *     de los campos del form vive en TenantForm vía DI10.15 (key prop), no
 *     aquí.
 *   - handleSubmit single try/catch: si cualquier paso (callable o refetch)
 *     falla, muestra el error mapeado. Compromiso aceptado: si el callable
 *     OK pero onSuccess (refetch) falla, el operador ve "Error inesperado"
 *     aunque la mutación se haya aplicado. Patrón documentado por el
 *     prompt B10; refactorizar si surge ruido.
 *
 * UX bloqueada durante submit (DI10.12):
 *   - onOpenChange filtra cierre si submitting=true (X / Esc / click overlay).
 *   - showCloseButton={!submitting} oculta visualmente la X mientras dura
 *     el submit para feedback coherente con el bloqueo.
 */

export interface TenantFormDialogProps {
  open: boolean;
  modo: 'alta' | 'edicion';
  tenantInicial?: Tenant;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function TenantFormDialog({
  open,
  modo,
  tenantInicial,
  onClose,
  onSuccess,
}: TenantFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(
    input: CrearTenantInput | ActualizarTenantInput,
  ) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (modo === 'alta') {
        await crearTenant(input as CrearTenantInput);
      } else {
        await actualizarTenant(input as ActualizarTenantInput);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[tenants] callable error:', err);
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
              ? 'Nuevo tenant'
              : `Editar: ${tenantInicial?.nombre ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {modo === 'alta'
              ? 'Crea un nuevo tenant (empresa cliente del SaaS).'
              : 'Modifica los datos del tenant. El CIF no es editable.'}
          </DialogDescription>
        </DialogHeader>
        <TenantForm
          key={tenantInicial?.id ?? 'alta'}
          modo={modo}
          tenantInicial={tenantInicial}
          submitting={submitting}
          errorRemoto={errorRemoto}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
