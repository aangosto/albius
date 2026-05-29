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
  actualizarUsuario,
  type ActualizarUsuarioInput,
} from '@/lib/services/usuarios';
import type { Centro, Tenant, Usuario } from '@albius/shared';
import UsuarioEditForm from './UsuarioEditForm';

/**
 * Dialog de edición de usuario. Patrón idéntico a EditarCentroDialog:
 * submitting/errorRemoto propios, reset al abrir, cierre+refetch al éxito
 * (sin pantalla intermedia — actualizarUsuario solo devuelve { ok, usuarioId }).
 *
 * `key={usuarioInicial?.id}` en el form fuerza remontaje al cambiar de
 * usuario objetivo (reset de los campos derivados de props, DI10.15).
 *
 * UX bloqueada durante submit (DI10.12): onOpenChange filtra cierre si
 * submitting; showCloseButton oculta la X de la esquina.
 */

export interface EditarUsuarioDialogProps {
  open: boolean;
  usuarioInicial: Usuario | null;
  tenantsById: Map<string, Tenant>;
  centrosById: Map<string, Centro>;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function EditarUsuarioDialog({
  open,
  usuarioInicial,
  tenantsById,
  centrosById,
  onClose,
  onSuccess,
}: EditarUsuarioDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  async function handleSubmit(input: ActualizarUsuarioInput) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      await actualizarUsuario(input);
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[usuarios] editar callable error:', err);
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
            {usuarioInicial
              ? `Editar: ${usuarioInicial.nombreCompleto}`
              : 'Editar usuario'}
          </DialogTitle>
          <DialogDescription>
            Modifica nombre, email o teléfono. El rol, el tenant y el centro
            no son editables aquí.
          </DialogDescription>
        </DialogHeader>
        {usuarioInicial && (
          <UsuarioEditForm
            key={usuarioInicial.id}
            usuarioInicial={usuarioInicial}
            tenantsById={tenantsById}
            centrosById={centrosById}
            submitting={submitting}
            errorRemoto={errorRemoto}
            onSubmit={handleSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
