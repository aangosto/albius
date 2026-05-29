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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { mapCallableError } from '@/lib/callable-errors';
import {
  crearConductor,
  crearJefeTrafico,
  type CrearConductorInput,
  type CrearJefeTraficoInput,
} from '@/lib/services/usuarios';
import type { Centro, Tenant } from '@albius/shared';
import ConductorForm from './ConductorForm';
import JefeForm from './JefeForm';

/**
 * Dialog de alta de usuario, parametrizado por rol (DI14.2): un único dialog
 * renderiza JefeForm o ConductorForm según `rol`. Motivo: la pantalla de
 * éxito D5.6 es idéntica para ambos (los dos callables devuelven
 * `linkPasswordReset`), así que centralizarla aquí la mantiene DRY.
 *
 * D5.6 — secreto de un solo uso:
 *   - El callable devuelve `linkPasswordReset` (link de configuración de
 *     contraseña, hoy distribuido manualmente — TODO[email-transport]).
 *   - Al éxito, el Dialog NO cierra: muestra una pantalla intermedia con el
 *     link en un Input readonly + botón Copiar + aviso "no se mostrará de
 *     nuevo" + botón Cerrar explícito.
 *   - REFINAMIENTO secret-before-refetch: el link se renderiza ANTES del
 *     refetch del listado. El refetch (onSuccess) va en background con
 *     `.catch` que solo loggea — un fallo de refetch NUNCA puede ocultar el
 *     secreto de un solo uso.
 *   - Cierre por overlay/Esc bloqueado mientras `submitting` o mientras la
 *     pantalla de éxito está visible (`successResult !== null`): solo el
 *     botón Cerrar explícito cierra.
 *
 * Duda 3 — clipboard: navigator.clipboard.writeText sin fallback complejo
 * (funciona en HTTPS y en localhost, contextos seguros). Error → try/catch
 * silencioso + console.warn. El link queda siempre visible y seleccionable
 * en el Input readonly como respaldo de copia manual.
 *
 * Reset: al abrir (open false→true) se resetea el state del dialog. Los
 * campos de los forms se resetean solos porque Radix desmonta el
 * DialogContent al cerrar y lo remonta al abrir.
 */

interface SuccessResult {
  link: string;
  usuarioId: string;
  conductorId?: string;
}

export interface CrearUsuarioDialogProps {
  open: boolean;
  rol: 'jefe_trafico' | 'conductor';
  tenantsActivos: Tenant[];
  centrosActivos: Centro[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}

export default function CrearUsuarioDialog({
  open,
  rol,
  tenantsActivos,
  centrosActivos,
  onClose,
  onSuccess,
}: CrearUsuarioDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<SuccessResult | null>(
    null,
  );
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (open) {
      setSubmitting(false);
      setErrorRemoto(null);
      setSuccessResult(null);
      setCopiado(false);
    }
  }, [open]);

  async function handleSubmit(
    input: CrearJefeTraficoInput | CrearConductorInput,
  ) {
    setSubmitting(true);
    setErrorRemoto(null);
    try {
      if (rol === 'jefe_trafico') {
        const res = await crearJefeTrafico(input as CrearJefeTraficoInput);
        // D5.6: mostrar el secreto ANTES del refetch.
        setSuccessResult({ link: res.linkPasswordReset, usuarioId: res.usuarioId });
      } else {
        const res = await crearConductor(input as CrearConductorInput);
        setSuccessResult({
          link: res.linkPasswordReset,
          usuarioId: res.usuarioId,
          conductorId: res.conductorId,
        });
      }
      // Refetch en background, NO bloqueante: un fallo aquí no debe ocultar
      // el link de un solo uso ya mostrado.
      void onSuccess().catch((err) => {
        console.error('[usuarios] refetch tras alta:', err);
      });
    } catch (err) {
      console.error('[usuarios] alta callable error:', err);
      setErrorRemoto(mapCallableError(err));
      setSubmitting(false);
    }
  }

  function handleClose() {
    setSuccessResult(null);
    setSubmitting(false);
    setErrorRemoto(null);
    setCopiado(false);
    onClose();
  }

  async function handleCopiar() {
    if (!successResult) return;
    try {
      await navigator.clipboard.writeText(successResult.link);
      setCopiado(true);
    } catch (err) {
      console.warn('[usuarios] clipboard writeText falló:', err);
    }
  }

  const titulo =
    rol === 'jefe_trafico' ? 'Nuevo jefe de tráfico' : 'Nuevo conductor';
  const cierreBloqueado = submitting || successResult !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Bloquea overlay/Esc durante submit y durante la pantalla de éxito.
        if (!v && !cierreBloqueado) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl"
        showCloseButton={!cierreBloqueado}
      >
        {successResult === null ? (
          <>
            <DialogHeader>
              <DialogTitle>{titulo}</DialogTitle>
              <DialogDescription>
                {rol === 'jefe_trafico'
                  ? 'Crea un jefe de tráfico y asígnalo a un tenant y centro.'
                  : 'Crea un conductor con cuenta de acceso y perfil operativo.'}
              </DialogDescription>
            </DialogHeader>
            {rol === 'jefe_trafico' ? (
              <JefeForm
                tenantsActivos={tenantsActivos}
                centrosActivos={centrosActivos}
                submitting={submitting}
                errorRemoto={errorRemoto}
                onSubmit={handleSubmit}
              />
            ) : (
              <ConductorForm
                tenantsActivos={tenantsActivos}
                centrosActivos={centrosActivos}
                submitting={submitting}
                errorRemoto={errorRemoto}
                onSubmit={handleSubmit}
              />
            )}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Usuario creado</DialogTitle>
              <DialogDescription>
                {rol === 'jefe_trafico'
                  ? 'El jefe de tráfico se ha creado correctamente.'
                  : `El conductor se ha creado correctamente${
                      successResult.conductorId
                        ? ` (ID: ${successResult.conductorId})`
                        : ''
                    }.`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Enlace de configuración de contraseña</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={successResult.link}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCopiar}
                  >
                    {copiado ? 'Copiado ✓' : 'Copiar'}
                  </Button>
                </div>
              </div>
              <Alert>
                <AlertDescription>
                  Copia este enlace y entrégaselo al usuario para que configure
                  su contraseña. Solo se muestra ahora;{' '}
                  <strong>no se volverá a mostrar</strong>.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter>
              <Button type="button" onClick={handleClose}>
                Cerrar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
