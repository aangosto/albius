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
import { actualizarTipoTurno } from '@/lib/services/tiposTurno';
import type { TipoTurno } from '@albius/shared';

/**
 * Dialog destructivo unificado para marcar obsoleto y reactivar Tipos de turno
 * (D5.3 + D4.11 reusado), plantilla de CambiarEstadoCentroDialog. Estado
 * BINARIO activo↔obsoleto. La transición a 'obsoleto' lleva visualmente la
 * carga destructiva; la reactivación usa botón default sin tinte rojo.
 *
 * El target combina `tipo` + `accion`; `open` se deriva de `target !== null`.
 * Optional chaining + fallback vacío para sobrevivir al fade-out de Radix
 * (target ya es null durante la animación de cierre).
 *
 * Soft-delete sin verificación de dependencias (B18): marcar un tipo obsoleto
 * NO comprueba conductores que lo referencien — un tipo obsoleto sigue siendo
 * referenciable históricamente (TODO[tipoturno-obsoleto-conductores]). Por eso
 * el copy no promete cascada.
 *
 * UX bloqueada durante submit (DI10.12): onOpenChange filtra cierre,
 * showCloseButton={!submitting}, botón "Cerrar" disabled.
 */

export interface CambiarEstadoTipoTurnoDialogProps {
  target: {
    tipo: TipoTurno;
    accion: 'marcar-obsoleto' | 'reactivar';
  } | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CambiarEstadoTipoTurnoDialog({
  target,
  onClose,
  onSuccess,
}: CambiarEstadoTipoTurnoDialogProps) {
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
      await actualizarTipoTurno({
        tipoTurnoId: target.tipo.id,
        estado: target.accion === 'marcar-obsoleto' ? 'obsoleto' : 'activo',
      });
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[tipos-turno] cambiar estado error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const esObsoletar = target?.accion === 'marcar-obsoleto';
  const nombre = target?.tipo.nombre ?? '';
  const codigo = target?.tipo.codigo ?? '';

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
            {esObsoletar
              ? 'Marcar tipo de turno como obsoleto'
              : 'Reactivar tipo de turno'}
          </DialogTitle>
          <DialogDescription>
            {esObsoletar
              ? `¿Marcar «${codigo} · ${nombre}» como obsoleto? Dejará de proponerse para turnos nuevos. Los datos no se borran y puedes reactivarlo más tarde.`
              : `¿Reactivar «${codigo} · ${nombre}»? Volverá al estado «activo».`}
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
            variant={esObsoletar ? 'destructive' : 'default'}
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting
              ? 'Procesando…'
              : esObsoletar
                ? 'Marcar obsoleto'
                : 'Reactivar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
