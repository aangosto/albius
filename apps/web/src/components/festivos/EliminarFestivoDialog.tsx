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
import { eliminarFestivo } from '@/lib/services/festivos';
import { isoToDisplay } from '@/lib/services/ausencias';
import { fechaISOUTC } from '@/lib/calendario';
import type { Festivo } from '@albius/shared';

/**
 * Dialog destructivo de borrado de un festivo del centro (B35.1), molde de
 * EliminarAusenciaDialog. HARD-DELETE (un festivo es un registro de
 * calendario sin ciclo de vida). Los oficiales y los tenant-wide no llegan
 * aquí (la tabla no ofrece el botón).
 */
export default function EliminarFestivoDialog({
  target,
  onClose,
  onSuccess,
}: {
  target: Festivo | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
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
      await eliminarFestivo({ festivoId: target.id });
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[festivos] eliminar error:', err);
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
      <DialogContent showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>Eliminar festivo</DialogTitle>
          <DialogDescription>
            ¿Eliminar «{target?.nombre ?? ''}» del{' '}
            {target ? isoToDisplay(fechaISOUTC(target.fecha)) : ''}? El
            optimizador volverá a tratar ese día como un día normal. No se
            puede deshacer.
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
          <Button variant="destructive" onClick={handleConfirmar} disabled={submitting}>
            {submitting ? 'Eliminando…' : 'Eliminar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
