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
import { actualizarTenant } from '@/lib/services/tenants';
import type { Tenant } from '@albius/shared';

/**
 * Dialog destructivo unificado para cancelar y reactivar Tenants (DI10.4 +
 * D4.11). Cancelación lleva visualmente la carga destructiva; reactivación
 * usa botón default sin tinte rojo.
 *
 * El target combina `tenant` + `accion`; `open` se deriva de `target !== null`.
 * Cuando el padre setea target=null para cerrar, Radix Dialog mantiene el
 * contenido montado durante la animación de fade-out (~200ms). En ese
 * intervalo `target` ya es null aquí — el optional chaining + fallback
 * vacío evita render de "undefined" en los template literals.
 *
 * D4.6: si el backend rechaza con `failed-precondition` (cancelar con
 * centros activos), `mapCallableError` preserva el mensaje específico del
 * backend y el operador lo ve en el Alert dentro del Dialog. Sin lógica
 * adicional aquí — la canónica vive en backend.
 *
 * UX bloqueada durante submit (DI10.12):
 *   - onOpenChange filtra cierre si submitting=true.
 *   - showCloseButton={!submitting} oculta la X de la esquina.
 *   - Botón "Cerrar" del footer también disabled.
 */

export interface CambiarEstadoTenantDialogProps {
  target: { tenant: Tenant; accion: 'cancelar' | 'reactivar' } | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CambiarEstadoTenantDialog({
  target,
  onClose,
  onSuccess,
}: CambiarEstadoTenantDialogProps) {
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
      await actualizarTenant({
        tenantId: target.tenant.id,
        estado: target.accion === 'cancelar' ? 'cancelado' : 'activo',
      });
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[tenants] cambiar estado error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const esCancelar = target?.accion === 'cancelar';
  const nombre = target?.tenant.nombre ?? '';

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
            {esCancelar ? 'Cancelar tenant' : 'Reactivar tenant'}
          </DialogTitle>
          <DialogDescription>
            {esCancelar
              ? `¿Estás seguro de cancelar el tenant «${nombre}»? Esta acción cambia su estado a «cancelado». Los datos no se borran y puedes reactivar más tarde.`
              : `¿Reactivar el tenant «${nombre}»? Volverá al estado «activo».`}
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
            variant={esCancelar ? 'destructive' : 'default'}
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting
              ? 'Procesando…'
              : esCancelar
                ? 'Cancelar tenant'
                : 'Reactivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
