import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Centro, Tenant } from '@albius/shared';
import type { CrearConductorInput } from '@/lib/services/usuarios';
import TenantCentroSelect from './TenantCentroSelect';

/**
 * Form de alta de conductor.
 *
 * Decisiones implementadas:
 *   - Q5 — el conductor separa "Nombre" + "Apellidos" (el backend los
 *     concatena para el displayName/nombreCompleto del doc /usuarios).
 *   - DI14.6 — `categoria` se fija a 'conductor' AQUÍ en el submit (enum de
 *     un solo valor, Q9); no hay Select de categoría en la UI.
 *   - Q4 — campos operativos OMITIDOS (lineasPreferentes, lineasSecundarias,
 *     tiposTurnoPermitidos, tiposTurnoExcluidos, maxHorasSemanales,
 *     observaciones). El backend los defaultea. Volverán con el CRUD de
 *     líneas/tipos-turno — TODO[conductor-campos-operativos-en-alta].
 *   - Q8 — fechas con input type="date" (emiten YYYY-MM-DD, que assertISODate
 *     acepta). Sin validación de relación temporal (coherente con backend).
 *   - D5.7 — selectores tenant→centro delegados a TenantCentroSelect.
 *
 * `numeroEmpleado` y `dni` son texto libre (sin validador de formato —
 * Duda 4: cada empresa tiene su convención de numeración).
 *
 * Sin pantalla de éxito (D5.6): la muestra el Dialog padre. Hooks
 * incondicionales; sin gate de rol propio (vive en la página, D4.13).
 */

export interface ConductorFormProps {
  tenantsActivos: Tenant[];
  centrosActivos: Centro[];
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: CrearConductorInput) => void;
}

export default function ConductorForm({
  tenantsActivos,
  centrosActivos,
  submitting,
  errorRemoto,
  onSubmit,
}: ConductorFormProps) {
  const [numeroEmpleado, setNumeroEmpleado] = useState('');
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [dni, setDni] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [centroId, setCentroId] = useState('');
  const [fechaAntiguedad, setFechaAntiguedad] = useState('');
  const [fechaIncorporacion, setFechaIncorporacion] = useState('');
  const [puedeSerReserva, setPuedeSerReserva] = useState(false);

  const submitDeshabilitado =
    submitting ||
    !numeroEmpleado.trim() ||
    !nombre.trim() ||
    !apellidos.trim() ||
    !dni.trim() ||
    !email.trim() ||
    !tenantId ||
    !centroId ||
    !fechaAntiguedad ||
    !fechaIncorporacion;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit({
      numeroEmpleado: numeroEmpleado.trim(),
      nombre: nombre.trim(),
      apellidos: apellidos.trim(),
      dni: dni.trim(),
      email: email.trim(),
      ...(telefono.trim() && { telefono: telefono.trim() }),
      tenantId,
      centroId,
      categoria: 'conductor', // DI14.6: fijado aquí, no en UI.
      fechaAntiguedad,
      fechaIncorporacion,
      puedeSerReserva,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Número de empleado" required>
        <Input
          value={numeroEmpleado}
          onChange={(e) => setNumeroEmpleado(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nombre" required>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
          />
        </Field>
        <Field label="Apellidos" required>
          <Input
            value={apellidos}
            onChange={(e) => setApellidos(e.target.value)}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="DNI" required>
          <Input value={dni} onChange={(e) => setDni(e.target.value)} required />
        </Field>
        <Field label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
      </div>

      <Field label="Teléfono">
        <Input
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
      </Field>

      <TenantCentroSelect
        tenantsActivos={tenantsActivos}
        centrosActivos={centrosActivos}
        tenantId={tenantId}
        centroId={centroId}
        onTenantChange={setTenantId}
        onCentroChange={setCentroId}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Fecha de antigüedad" required>
          <Input
            type="date"
            value={fechaAntiguedad}
            onChange={(e) => setFechaAntiguedad(e.target.value)}
            required
          />
        </Field>
        <Field label="Fecha de incorporación" required>
          <Input
            type="date"
            value={fechaIncorporacion}
            onChange={(e) => setFechaIncorporacion(e.target.value)}
            required
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={puedeSerReserva}
          onCheckedChange={(v) => setPuedeSerReserva(v === true)}
        />
        <span>Puede ser reserva</span>
      </label>

      {errorRemoto && (
        <Alert variant="destructive">
          <AlertDescription>{errorRemoto}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitDeshabilitado}>
          {submitting ? 'Creando…' : 'Crear conductor'}
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
