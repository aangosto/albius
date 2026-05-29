import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ROL_LABEL } from '@/lib/navigation';
import type { Centro, Tenant, Usuario } from '@albius/shared';
import type { ActualizarUsuarioInput } from '@/lib/services/usuarios';

/**
 * Form de edición de usuario, ÚNICO para los tres roles (DI14.1
 * role-agnostic).
 *
 * Motivo: `actualizarUsuario` (B13) solo toca campos comunes del doc
 * /usuarios (nombreCompleto, email, telefono, estado). La asimetría
 * jefe/conductor es exclusiva del ALTA. Aquí no hay ramas por rol salvo
 * mostrar conductorId como dato read-only cuando aplica.
 *
 * Editables: nombreCompleto, email, telefono.
 *   - email es dual-homed (D5.4): el backend lo escribe en Auth + Firestore
 *     con rollback inverso. Aquí es un input normal; el backend gatea.
 *
 * Read-only (Q10 — caja bg-muted + helper text, patrón CentroForm.tenant):
 *   rol, tenant, centro y (si rol==='conductor') conductorId. Estos campos
 *   están VETADOS por el backend (D5.5: rol/tenantId/centroId son claims,
 *   conductorId es identidad inmutable D3.1) y se reservan a callables
 *   dedicados futuros (cambiarRolUsuario, moverUsuario).
 *
 * Q11 — los campos operativos del conductor (lineasPreferentes, etc.) NO se
 * muestran: viven en /conductores, no en /usuarios, y actualizarUsuario no
 * los toca. Se editarán en una pantalla "editar conductor operativo" futura.
 *
 * `estado` NO está en este form (D5.3): la transición activo↔suspendido vive
 * en CambiarEstadoUsuarioDialog.
 *
 * Delta omit-only (DI10.13): solo se envían los campos que cambian de valor.
 * Vaciar un teléfono preexistente NO se envía (limitación
 * TODO[delete-on-empty-fields]). sinCambios → submit deshabilitado.
 *
 * Sin pantalla de éxito: actualizarUsuario devuelve solo { ok, usuarioId }.
 * El Dialog padre cierra + refetch al éxito (patrón normal, no D5.6).
 */

export interface UsuarioEditFormProps {
  usuarioInicial: Usuario;
  tenantsById: Map<string, Tenant>;
  centrosById: Map<string, Centro>;
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: ActualizarUsuarioInput) => void;
}

export default function UsuarioEditForm({
  usuarioInicial,
  tenantsById,
  centrosById,
  submitting,
  errorRemoto,
  onSubmit,
}: UsuarioEditFormProps) {
  const [nombreCompleto, setNombreCompleto] = useState(
    usuarioInicial.nombreCompleto,
  );
  const [email, setEmail] = useState(usuarioInicial.email);
  const [telefono, setTelefono] = useState(usuarioInicial.telefono ?? '');

  // Delta omit-only (DI10.13). Empieza solo con usuarioId; cada campo se añade
  // si cambió de valor. Vaciar un valor preexistente no se envía (la condición
  // `&& trim` lo impide), igual que CentroForm.direccion.
  function buildDelta(): ActualizarUsuarioInput | null {
    const delta: ActualizarUsuarioInput = { usuarioId: usuarioInicial.id };
    const nombreTrim = nombreCompleto.trim();
    const emailTrim = email.trim();
    const telefonoTrim = telefono.trim();
    if (nombreTrim && nombreTrim !== usuarioInicial.nombreCompleto) {
      delta.nombreCompleto = nombreTrim;
    }
    if (emailTrim && emailTrim !== usuarioInicial.email) {
      delta.email = emailTrim;
    }
    if (telefonoTrim && telefonoTrim !== (usuarioInicial.telefono ?? '')) {
      delta.telefono = telefonoTrim;
    }
    return Object.keys(delta).length === 1 ? null : delta;
  }

  const sinCambios = buildDelta() === null;
  const submitDeshabilitado = submitting || sinCambios;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const delta = buildDelta();
    if (delta) onSubmit(delta);
  }

  const tenantNombre = usuarioInicial.tenantId
    ? (tenantsById.get(usuarioInicial.tenantId)?.nombre ?? '—')
    : '—';
  const centroNombre = usuarioInicial.centroId
    ? (centrosById.get(usuarioInicial.centroId)?.nombre ?? '—')
    : '—';
  const esConductor = usuarioInicial.rol === 'conductor';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Nombre completo" required>
        <Input
          value={nombreCompleto}
          onChange={(e) => setNombreCompleto(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Teléfono">
          <Input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="border rounded-md p-3 space-y-3">
        <legend className="text-sm font-medium px-2">
          Identidad y asignación
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ReadOnlyField label="Rol" value={ROL_LABEL[usuarioInicial.rol]} />
          <ReadOnlyField label="Tenant" value={tenantNombre} />
          <ReadOnlyField label="Centro" value={centroNombre} />
          {esConductor && (
            <ReadOnlyField
              label="ID de conductor"
              value={usuarioInicial.conductorId ?? '—'}
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Para cambiar estos campos, usa los callables dedicados (futuros:
          cambiarRolUsuario, moverUsuario).
        </p>
      </fieldset>

      {errorRemoto && (
        <Alert variant="destructive">
          <AlertDescription>{errorRemoto}</AlertDescription>
        </Alert>
      )}

      {sinCambios && (
        <p className="text-xs text-muted-foreground">
          No hay cambios que guardar.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitDeshabilitado}>
          {submitting ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="text-sm py-2 px-3 bg-muted rounded-md">{value}</div>
    </div>
  );
}
