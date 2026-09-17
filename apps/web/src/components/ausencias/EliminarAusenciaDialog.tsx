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
import { eliminarAusencia } from '@/lib/services/ausencias';
import type { Ausencia, Conductor } from '@albius/shared';
import {
  CATEGORIA_AUSENCIA_LABEL,
  formatRango,
  nombreConductor,
} from './AusenciasTable';

/**
 * Dialog destructivo de borrado de una Ausencia (B32.2), plantilla de
 * CambiarEstadoTipoTurnoDialog. HARD-DELETE (la ausencia es un registro de
 * calendario sin ciclo de vida; no hay soft-delete que ofrecer). Muestra
 * conductor + categoría + rango para que no se borre la equivocada.
 *
 * `open` se deriva de `target !== null`; optional chaining para sobrevivir al
 * fade-out de Radix. UX bloqueada durante submit.
 */

export interface EliminarAusenciaDialogProps {
  target: Ausencia | null;
  conductoresById: Map<string, Conductor>;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function EliminarAusenciaDialog({
  target,
  conductoresById,
  onClose,
  onSuccess,
}: EliminarAusenciaDialogProps) {
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
      await eliminarAusencia({ ausenciaId: target.id });
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[ausencias] eliminar error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const quien = target ? nombreConductor(target.conductorId, conductoresById) : '';
  const categoria = target ? CATEGORIA_AUSENCIA_LABEL[target.categoria] : '';
  const rango = target ? formatRango(target) : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>Eliminar ausencia</DialogTitle>
          <DialogDescription>
            ¿Eliminar la ausencia de «{quien}» ({categoria.toLowerCase()}
            {target?.codigo ? ` ${target.codigo}` : ''}, {rango})? Esta acción
            no se puede deshacer. Si el cuadrante del mes ya está generado,
            vuelve a generarlo para que el cambio se aplique.
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
            variant="destructive"
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting ? 'Eliminando…' : 'Eliminar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
