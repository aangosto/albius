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
import {
  cerrarCuadrante,
  publicarCuadrante,
  reabrirCuadrante,
} from '@/lib/services/cuadrantes';

/**
 * Dialog de confirmación del ciclo de vida del cuadrante (B33.1), molde de
 * CambiarEstadoTipoTurnoDialog: UN componente parametrizado por acción
 * (publicar / cerrar / reabrir), no tres dialogs.
 *
 *   - publicar: borrador → publicado. CONGELA las asignaciones (la edición
 *     post-publicación es el bloque de Intercambios). Reversible vía reabrir.
 *   - cerrar: publicado → cerrado. DEFINITIVO (sin reabrir): carga destructiva.
 *   - reabrir: publicado → borrador. Salida de emergencia de publicar.
 *
 * `open` se deriva de `target !== null`; optional chaining para sobrevivir al
 * fade-out de Radix. UX bloqueada durante submit. No hay `onSuccess`: el
 * onSnapshot de la página refleja el nuevo estado sin recarga.
 */

export type AccionCuadrante = 'publicar' | 'cerrar' | 'reabrir';

export interface CambiarEstadoCuadranteDialogProps {
  target: { cuadranteId: string; accion: AccionCuadrante; mesLabel: string } | null;
  onClose: () => void;
}

const COPY: Record<
  AccionCuadrante,
  {
    titulo: string;
    descripcion: (mes: string) => string;
    boton: string;
    variant: 'default' | 'destructive';
  }
> = {
  publicar: {
    titulo: 'Publicar cuadrante',
    descripcion: (mes) =>
      `¿Publicar el cuadrante de ${mes}? Una vez publicado no podrás editar las asignaciones ni volver a generarlo. Podrás reabrirlo si necesitas cambios.`,
    boton: 'Publicar',
    variant: 'default',
  },
  cerrar: {
    titulo: 'Cerrar cuadrante',
    descripcion: (mes) =>
      `¿Cerrar el cuadrante de ${mes}? Cerrar es definitivo: no podrás reabrirlo ni editarlo.`,
    boton: 'Cerrar definitivamente',
    variant: 'destructive',
  },
  reabrir: {
    titulo: 'Reabrir cuadrante',
    descripcion: (mes) =>
      `¿Reabrir el cuadrante de ${mes}? Volverá a borrador para que puedas editarlo o regenerarlo, y tendrás que publicarlo de nuevo.`,
    boton: 'Reabrir',
    variant: 'default',
  },
};

const ACCIONES: Record<
  AccionCuadrante,
  (input: { cuadranteId: string }) => Promise<unknown>
> = {
  publicar: publicarCuadrante,
  cerrar: cerrarCuadrante,
  reabrir: reabrirCuadrante,
};

export default function CambiarEstadoCuadranteDialog({
  target,
  onClose,
}: CambiarEstadoCuadranteDialogProps) {
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
      await ACCIONES[target.accion]({ cuadranteId: target.cuadranteId });
      onClose();
    } catch (err) {
      console.error(`[cuadrante] ${target.accion} error:`, err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  const copy = target ? COPY[target.accion] : COPY.publicar;
  const mes = target?.mesLabel ?? '';

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{copy.titulo}</DialogTitle>
          <DialogDescription>{copy.descripcion(mes)}</DialogDescription>
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
            variant={copy.variant}
            onClick={handleConfirmar}
            disabled={submitting}
          >
            {submitting ? 'Procesando…' : copy.boton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
