import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Centro, Tenant } from '@albius/shared';
import type { CrearJefeTraficoInput } from '@/lib/services/usuarios';
import TenantCentroSelect from './TenantCentroSelect';

/**
 * Form de alta de jefe_trafico.
 *
 * Decisiones implementadas:
 *   - Q5 — el jefe usa UN solo campo "Nombre completo" (a diferencia del
 *     conductor, que separa nombre + apellidos). Va directo al doc /usuarios
 *     y al displayName de Auth.
 *   - D5.7 — los selectores tenant→centro se delegan a TenantCentroSelect
 *     (reset del hijo encapsulado allí). El form solo posee el state
 *     `tenantId`/`centroId` y los pasa controlados.
 *
 * Sin pantalla de éxito (D5.6): el link de configuración de contraseña que
 * devuelve el callable lo muestra el Dialog padre (CrearUsuarioDialog). Este
 * form solo emite el input vía onSubmit; el padre orquesta submitting/error.
 *
 * Hooks incondicionales. Sin gate de rol propio (vive en la página, D4.13).
 */

export interface JefeFormProps {
  tenantsActivos: Tenant[];
  centrosActivos: Centro[];
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: CrearJefeTraficoInput) => void;
}

export default function JefeForm({
  tenantsActivos,
  centrosActivos,
  submitting,
  errorRemoto,
  onSubmit,
}: JefeFormProps) {
  const [nombreCompleto, setNombreCompleto] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [centroId, setCentroId] = useState('');

  const submitDeshabilitado =
    submitting ||
    !nombreCompleto.trim() ||
    !email.trim() ||
    !tenantId ||
    !centroId;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit({
      nombreCompleto: nombreCompleto.trim(),
      email: email.trim(),
      ...(telefono.trim() && { telefono: telefono.trim() }),
      tenantId,
      centroId,
    });
  }

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

      <TenantCentroSelect
        tenantsActivos={tenantsActivos}
        centrosActivos={centrosActivos}
        tenantId={tenantId}
        centroId={centroId}
        onTenantChange={setTenantId}
        onCentroChange={setCentroId}
      />

      {errorRemoto && (
        <Alert variant="destructive">
          <AlertDescription>{errorRemoto}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitDeshabilitado}>
          {submitting ? 'Creando…' : 'Crear jefe de tráfico'}
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
