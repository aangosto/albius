import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { mapCallableError } from '@/lib/callable-errors';
import {
  actualizarAsignacion,
  crearAsignacion,
  eliminarAsignacion,
} from '@/lib/services/cuadrantes';
import {
  calcularAvisosAsignacion,
  conductorHabilitadoPara,
  type VecinoJornada,
} from '@/lib/calendario';
import { cn } from '@/lib/utils';
import type {
  Asignacion,
  Ausencia,
  Conductor,
  TipoTurno,
} from '@albius/shared';

/**
 * Dialog de EDICIÓN MANUAL de una celda conductor×día del Calendario (B33.2).
 *
 * Operaciones (una por confirmación, sin "mover de A a B" — no hay callable de
 * swap ni transacción; ver TODO[mover-asignacion-atomico]):
 *   - celda VACÍA  → Select de tipo de turno + "Asignar"      (crearAsignacion)
 *   - celda CON turno → Select para cambiarlo + "Guardar"     (actualizarAsignacion)
 *                        y "Quitar turno" = dejarlo libre     (eliminarAsignacion, D6.10)
 *
 * Solo materializa `tipoAsignacion='turno'`: vacaciones/baja/permiso viven en
 * el módulo de Ausencias (D6.19), no se crean desde aquí.
 *
 * Validación híbrida B33.2: el backend RECHAZA lo estructural (R1, referencias)
 * y el error llega por `mapCallableError`; lo de convenio se calcula en
 * cliente con `calcularAvisosAsignacion` y se AVISA sin bloquear (el jefe ve
 * qué se salta y confirma "de todos modos").
 *
 * `open` se deriva de `target !== null`; UX bloqueada durante submit.
 */

export interface CeldaTarget {
  conductor: Conductor;
  /** "YYYY-MM-DD" (UTC). */
  fechaISO: string;
  /** Asignación existente en la celda, si la hay. */
  asignacion?: Asignacion;
  /** Ausencia del conductor ese día, si la hay. */
  ausencia?: Ausencia;
  /** Jornadas del día anterior/siguiente del mismo conductor (para el descanso). */
  anterior?: VecinoJornada;
  siguiente?: VecinoJornada;
}

export interface EditarCeldaDialogProps {
  target: CeldaTarget | null;
  cuadranteId: string;
  tipos: TipoTurno[];
  descansoMinimoHoras?: number;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function EditarCeldaDialog({
  target,
  cuadranteId,
  tipos,
  descansoMinimoHoras,
  onClose,
  onSuccess,
}: EditarCeldaDialogProps) {
  const [tipoSel, setTipoSel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);
  const open = target !== null;

  useEffect(() => {
    if (open) {
      setTipoSel(target?.asignacion?.tipoTurnoId ?? '');
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open, target]);

  const tiposById = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const tipoElegido = tipoSel ? tiposById.get(tipoSel) : undefined;

  const avisos = useMemo(() => {
    if (!target || !tipoElegido) return [];
    return calcularAvisosAsignacion({
      conductor: target.conductor,
      tipo: tipoElegido,
      fechaISO: target.fechaISO,
      ausencia: target.ausencia,
      anterior: target.anterior,
      siguiente: target.siguiente,
      descansoMinimoHoras,
    });
  }, [target, tipoElegido, descansoMinimoHoras]);

  const existente = target?.asignacion;
  const sinCambio = existente !== undefined && tipoSel === (existente.tipoTurnoId ?? '');

  async function ejecutar(fn: () => Promise<unknown>) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      await fn();
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[calendario] editar celda error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  function handleGuardar() {
    if (!target || !tipoElegido) return;
    const base = {
      tipoAsignacion: 'turno' as const,
      tipoTurnoId: tipoElegido.id,
      horaInicio: tipoElegido.horaInicio,
      horaFin: tipoElegido.horaFin,
    };
    if (existente) {
      void ejecutar(() =>
        actualizarAsignacion({ asignacionId: existente.id, ...base }),
      );
    } else {
      void ejecutar(() =>
        crearAsignacion({
          cuadranteId,
          conductorId: target.conductor.id,
          fecha: target.fechaISO,
          ...base,
        }),
      );
    }
  }

  function handleQuitar() {
    if (!existente) return;
    void ejecutar(() => eliminarAsignacion({ asignacionId: existente.id }));
  }

  const nombre = target
    ? `${target.conductor.apellidos}, ${target.conductor.nombre}`
    : '';
  const actual = existente
    ? `${existente.tipoTurnoId ? (tiposById.get(existente.tipoTurnoId)?.codigo ?? existente.tipoTurnoId) : existente.tipoAsignacion} · ${existente.horaInicio}–${existente.horaFin}`
    : null;
  const conAvisos = avisos.length > 0;

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
            {existente ? 'Editar turno' : 'Asignar turno'}
          </DialogTitle>
          <DialogDescription>
            {nombre} · {target ? isoADisplay(target.fechaISO) : ''}
            {actual ? ` · actualmente ${actual}` : ' · libre'}
          </DialogDescription>
        </DialogHeader>

        {target?.ausencia && (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertDescription>
              Este conductor está ausente ese día ({target.ausencia.categoria}
              {target.ausencia.codigo ? ` ${target.ausencia.codigo}` : ''}).
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="celda-tipo-turno">Tipo de turno</Label>
          <Select value={tipoSel} onValueChange={setTipoSel} disabled={submitting}>
            <SelectTrigger id="celda-tipo-turno" className="w-full">
              <SelectValue placeholder="Elige un tipo de turno" />
            </SelectTrigger>
            <SelectContent>
              {tipos.map((t) => {
                const habilitado = target
                  ? conductorHabilitadoPara(target.conductor, t.id)
                  : true;
                return (
                  <SelectItem key={t.id} value={t.id}>
                    <span className={cn(!habilitado && 'text-muted-foreground')}>
                      {t.codigo} · {t.nombre} ({t.horaInicio}–{t.horaFin})
                      {t.estado === 'obsoleto' && ' · obsoleto'}
                      {!habilitado && ' · no habilitado'}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Los turnos marcados «no habilitado» no están en los permitidos del
            conductor; puedes elegirlos igualmente.
          </p>
        </div>

        {conAvisos && (
          <Alert className="border-amber-500/50 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              <p className="font-medium">
                Esta asignación se salta reglas del convenio o del conductor:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {avisos.map((a) => (
                  <li key={a.clave}>{a.texto}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {errorRemoto && (
          <Alert variant="destructive">
            <AlertDescription>{errorRemoto}</AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          Los KPIs del cuadrante (cobertura, satisfacción) no se recalculan
          hasta volver a generar.
        </p>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {existente && (
              <Button
                variant="destructive"
                onClick={handleQuitar}
                disabled={submitting}
              >
                Quitar turno
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              onClick={handleGuardar}
              disabled={submitting || !tipoElegido || sinCambio}
            >
              {submitting
                ? 'Guardando…'
                : existente
                  ? conAvisos
                    ? 'Guardar de todos modos'
                    : 'Guardar cambio'
                  : conAvisos
                    ? 'Asignar de todos modos'
                    : 'Asignar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "YYYY-MM-DD" → "DD/MM/YYYY". */
function isoADisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
