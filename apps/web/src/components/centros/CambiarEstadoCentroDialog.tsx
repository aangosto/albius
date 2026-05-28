import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { mapCallableError } from '@/lib/callable-errors';
import { actualizarCentro } from '@/lib/services/centros';
import type { Centro } from '@albius/shared';

/**
 * Dialog destructivo unificado para inactivar y reactivar Centros (D5.3 +
 * D4.11 reusado). La transición a 'inactivo' lleva visualmente la carga
 * destructiva; la reactivación usa botón default sin tinte rojo.
 *
 * El target combina `centro` + `accion`; `open` se deriva de `target !== null`.
 * Cuando el padre setea target=null para cerrar, Radix Dialog mantiene el
 * contenido montado durante la animación de fade-out (~200ms). En ese
 * intervalo `target` ya es null aquí — el optional chaining + fallback
 * vacío evita render de "undefined" en los template literals.
 *
 * D4.6: si el backend rechaza con `failed-precondition` (inactivar con
 * conductores en estados bloqueantes: activo/baja_temporal/vacaciones),
 * `mapCallableError` preserva el mensaje específico del backend que incluye
 * el conteo "los N conductores" y el operador lo ve en el Alert dentro del
 * Dialog. Sin lógica adicional aquí — la canónica vive en backend (B11).
 *
 * UX bloqueada durante submit (DI10.12):
 *   - onOpenChange filtra cierre si submitting=true.
 *   - showCloseButton={!submitting} oculta la X de la esquina.
 *   - Botón "Cerrar" del footer también disabled.
 */

export interface CambiarEstadoCentroDialogProps {
  target: { centro: Centro; accion: 'inactivar' | 'reactivar' } | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CambiarEstadoCentroDialog({
  target,
  onClose,
  onSuccess,
}: CambiarEstadoCentroDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);
  const open = target !== null;

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleConfirmar() {
    if (!target) return;
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      await actualizarCentro({
        centroId: target.centro.id,
        estado: target.accion === 'inactivar' ? 'inactivo' : 'activo',
      });
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[centros] cambiar estado error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const esInactivar = target?.accion === 'inactivar';
  const nombre = target?.centro.nombre ?? '';

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>
            {esInactivar ? 'Inactivar centro' : 'Reactivar centro'}
          </DialogTitle>
          <DialogDescription>
            {esInactivar
              ? `¿Inactivar el centro «${nombre}»? Esta acción cambia su estado a «inactivo». Los datos no se borran y puedes reactivarlo más tarde.`
              : `¿Reactivar el centro «${nombre}»? Volverá al estado «activo».`}
          </DialogDescription>
        </DialogHeader>

        {errorRemoto && (
          <Alert variant="destructive">
            <AlertDescription>{errorRemoto}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cerrar
          </Button>
          <Button
            variant={esInactivar ? 'destructive' : 'default'}
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting
              ? 'Procesando…'
              : esInactivar
                ? 'Inactivar centro'
                : 'Reactivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
