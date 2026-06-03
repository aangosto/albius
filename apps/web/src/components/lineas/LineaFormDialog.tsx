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
  actualizarLinea,
  crearLinea,
  type ActualizarLineaInput,
  type CrearLineaInput,
} from '@/lib/services/lineas';
import type { Linea } from '@albius/shared';
import LineaForm from './LineaForm';

/**
 * Dialog modal unificado para alta y edición de Líneas (D4.7), plantilla de
 * CentroFormDialog.
 *
 * - State propio: `submitting` y `errorRemoto`. Reset cuando `open` pasa a true.
 *   El reset de los campos del form vive en LineaForm vía `key` prop (DI10.15).
 * - handleSubmit single try/catch: crearLinea/actualizarLinea + onSuccess
 *   (refetch) + onClose. Error → mapCallableError (D4.10). Si el callable OK
 *   pero el refetch falla, el operador ve "Error inesperado" aunque la mutación
 *   se aplicó — compromiso documentado del B10.
 * - Cierre bloqueado durante submit (onOpenChange filtra !submitting,
 *   showCloseButton={!submitting}).
 *
 * tenantId/centroId vienen de los claims del jefe (la página los pasa). En
 * edición no se usan (LineaForm no muestra ni edita centro/tenant), pero se
 * pasan igual para mantener una sola firma del form.
 */

export interface LineaFormDialogProps {
  open: boolean;
  modo: 'alta' | 'edicion';
  lineaInicial?: Linea;
  tenantId: string;
  centroId: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function LineaFormDialog({
  open,
  modo,
  lineaInicial,
  tenantId,
  centroId,
  onClose,
  onSuccess,
}: LineaFormDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(
    input: CrearLineaInput | ActualizarLineaInput,
  ) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (modo === 'alta') {
        await crearLinea(input as CrearLineaInput);
      } else {
        await actualizarLinea(input as ActualizarLineaInput);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[lineas] callable error:', err);
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
              ? 'Nueva línea'
              : `Editar: ${lineaInicial?.codigo ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {modo === 'alta'
              ? 'Crea una nueva línea en tu centro.'
              : 'Modifica los datos de la línea. El centro no es editable.'}
          </DialogDescription>
        </DialogHeader>
        <LineaForm
          key={lineaInicial?.id ?? 'alta'}
          modo={modo}
          lineaInicial={lineaInicial}
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
