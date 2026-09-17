import { useEffect, useState, type FormEvent } from 'react';
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
import { Input } from '@/components/ui/input';
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
  actualizarFestivo,
  crearFestivo,
  type ActualizarFestivoInput,
} from '@/lib/services/festivos';
import { fechaISOUTC } from '@/lib/calendario';
import type {
  AmbitoFestivo,
  Festivo,
  TipoTraficoFestivo,
} from '@albius/shared';
import { AMBITO_LABEL, TRAFICO_LABEL } from './FestivosTable';

/**
 * Dialog de alta/edición de un FESTIVO DEL CENTRO (B35.1), molde de
 * AusenciaFormDialog con el form inline (4 campos: fecha, nombre, ámbito,
 * tráfico aplicable).
 *
 *   - El jefe solo crea festivos de SU centro (`centroId` de claims); los
 *     tenant-wide son de super_admin (el callable lo impone). Decisión B35.1:
 *     el jefe SÍ puede marcar ámbito 'nacional' en un festivo de su centro
 *     (raro pero inocuo; bloquearlo añade fricción sin beneficio).
 *   - `tipoTraficoAplicable` es lo que consume el motor (resolverTipoDia):
 *     festivo / como domingo / como laborable.
 *   - Fecha como "YYYY-MM-DD" del input date (el backend la parsea a
 *     medianoche UTC); precarga con fechaISOUTC (D6.22).
 *   - Edición: delta omit-only (DI10.13); reset por `key` (DI10.15).
 */

export interface FestivoFormDialogProps {
  open: boolean;
  modo: 'alta' | 'edicion';
  festivoInicial?: Festivo;
  tenantId: string;
  centroId: string;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function FestivoFormDialog(props: FestivoFormDialogProps) {
  const { open, modo, festivoInicial, onClose } = props;
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !submitting) onClose();
      }}
    >
      <DialogContent className="max-w-lg" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>
            {modo === 'alta' ? 'Nuevo festivo' : `Editar: ${festivoInicial?.nombre ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {modo === 'alta'
              ? 'Festivo de tu centro. El optimizador cubrirá ese día con el cuadro de turnos del tipo de día indicado.'
              : 'Modifica la fecha, el nombre, el ámbito o el tipo de tráfico.'}
          </DialogDescription>
        </DialogHeader>
        <FestivoForm
          key={festivoInicial?.id ?? 'alta'}
          {...props}
          submitting={submitting}
          errorRemoto={errorRemoto}
          setSubmitting={setSubmitting}
          setErrorRemoto={setErrorRemoto}
        />
      </DialogContent>
    </Dialog>
  );
}

function FestivoForm({
  modo,
  festivoInicial,
  tenantId,
  centroId,
  onClose,
  onSuccess,
  submitting,
  errorRemoto,
  setSubmitting,
  setErrorRemoto,
}: FestivoFormDialogProps & {
  submitting: boolean;
  errorRemoto: string | null;
  setSubmitting: (v: boolean) => void;
  setErrorRemoto: (v: string | null) => void;
}) {
  const [fecha, setFecha] = useState(
    festivoInicial ? fechaISOUTC(festivoInicial.fecha) : '',
  );
  const [nombre, setNombre] = useState(festivoInicial?.nombre ?? '');
  const [ambito, setAmbito] = useState<AmbitoFestivo>(
    festivoInicial?.ambito ?? 'local',
  );
  const [trafico, setTrafico] = useState<TipoTraficoFestivo>(
    festivoInicial?.tipoTraficoAplicable ?? 'festivo',
  );
  const [tocado, setTocado] = useState(false);

  const errFecha = !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ? 'Indica la fecha.' : null;
  const errNombre = nombre.trim() === '' ? 'Indica el nombre.' : null;
  const hayErrores = errFecha !== null || errNombre !== null;

  function buildDelta(): ActualizarFestivoInput | null {
    if (!festivoInicial) return null;
    const delta: ActualizarFestivoInput = { festivoId: festivoInicial.id };
    if (fecha !== fechaISOUTC(festivoInicial.fecha)) delta.fecha = fecha;
    if (nombre.trim() !== festivoInicial.nombre) delta.nombre = nombre.trim();
    if (ambito !== festivoInicial.ambito) delta.ambito = ambito;
    if (trafico !== festivoInicial.tipoTraficoAplicable) {
      delta.tipoTraficoAplicable = trafico;
    }
    return Object.keys(delta).length > 1 ? delta : null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (hayErrores) return;
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (modo === 'alta') {
        await crearFestivo({
          tenantId,
          centroId,
          fecha,
          nombre: nombre.trim(),
          ambito,
          tipoTraficoAplicable: trafico,
        });
      } else {
        const delta = buildDelta();
        if (delta) await actualizarFestivo(delta);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      console.error('[festivos] callable error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="fest-fecha">Fecha</Label>
          <Input
            id="fest-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            disabled={submitting}
            aria-invalid={tocado && errFecha !== null}
          />
          {tocado && errFecha && <p className="text-xs text-destructive">{errFecha}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="fest-nombre">Nombre</Label>
          <Input
            id="fest-nombre"
            value={nombre}
            placeholder="Ej.: Fiestas de Cartagineses y Romanos"
            onChange={(e) => setNombre(e.target.value)}
            disabled={submitting}
            aria-invalid={tocado && errNombre !== null}
          />
          {tocado && errNombre && <p className="text-xs text-destructive">{errNombre}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="fest-ambito">Ámbito</Label>
          <Select
            value={ambito}
            onValueChange={(v) => setAmbito(v as AmbitoFestivo)}
            disabled={submitting}
          >
            <SelectTrigger id="fest-ambito" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AMBITO_LABEL) as AmbitoFestivo[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {AMBITO_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="fest-trafico">Tráfico ese día</Label>
          <Select
            value={trafico}
            onValueChange={(v) => setTrafico(v as TipoTraficoFestivo)}
            disabled={submitting}
          >
            <SelectTrigger id="fest-trafico" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TRAFICO_LABEL) as TipoTraficoFestivo[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {TRAFICO_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Determina qué cuadro de turnos se cubre ese día.
          </p>
        </div>
      </div>

      {errorRemoto && (
        <Alert variant="destructive">
          <AlertDescription>{errorRemoto}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting || (tocado && hayErrores)}>
          {submitting ? 'Guardando…' : modo === 'alta' ? 'Crear festivo' : 'Guardar cambios'}
        </Button>
      </DialogFooter>
    </form>
  );
}
