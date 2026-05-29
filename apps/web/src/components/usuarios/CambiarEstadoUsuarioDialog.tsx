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
import { actualizarUsuario } from '@/lib/services/usuarios';
import type { Usuario } from '@albius/shared';

/**
 * Dialog de confirmación para suspender/reactivar un usuario (D5.3, estado
 * binario activo↔suspendido). Espejo de CambiarEstadoCentroDialog: la
 * suspensión lleva la carga destructiva; la reactivación usa botón default.
 *
 * Sin cascada D4.6 (no aplica a usuarios): suspender SOLO cambia el doc, no
 * toca Auth.disabled ni revoca tokens en MVP — ver TODO[suspension-efectos-auth].
 *
 * `target` combina usuario + accion; `open` se deriva de `target !== null`.
 * Durante el fade-out de Radix `target` ya es null aquí: optional chaining +
 * fallback vacío evita render de "undefined" en los template literals.
 *
 * UX bloqueada durante submit (DI10.12): onOpenChange filtra cierre,
 * showCloseButton oculta la X, botón Cancelar disabled.
 */

export interface CambiarEstadoUsuarioDialogProps {
  target: { usuario: Usuario; accion: 'suspender' | 'reactivar' } | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CambiarEstadoUsuarioDialog({
  target,
  onClose,
  onSuccess,
}: CambiarEstadoUsuarioDialogProps) {
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
      await actualizarUsuario({
        usuarioId: target.usuario.id,
        estado: target.accion === 'suspender' ? 'suspendido' : 'activo',
      });
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[usuarios] cambiar estado error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const esSuspender = target?.accion === 'suspender';
  const nombre = target?.usuario.nombreCompleto ?? '';

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
            {esSuspender ? '¿Suspender usuario?' : '¿Reactivar usuario?'}
          </DialogTitle>
          <DialogDescription>
            {esSuspender
              ? `¿Suspender a «${nombre}»? Su estado pasará a «suspendido». Los datos no se borran y puedes reactivarlo más tarde.`
              : `¿Reactivar a «${nombre}»? Volverá al estado «activo».`}
          </DialogDescription>
        </DialogHeader>

        {errorRemoto && (
          <Alert variant="destructive">
            <AlertDescription>{errorRemoto}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant={esSuspender ? 'destructive' : 'default'}
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting
              ? 'Procesando…'
              : esSuspender
                ? 'Suspender'
                : 'Reactivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
