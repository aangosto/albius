import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  validateCIF,
  type CIFValidationResult,
  type PlanTenant,
  type Tenant,
} from '@albius/shared';
import type {
  ActualizarTenantInput,
  CrearTenantInput,
} from '@/lib/services/tenants';

/**
 * Form reutilizable para alta (modo='alta') y edición (modo='edicion') de
 * Tenants.
 *
 * Decisiones canónicas implementadas:
 *   - D4.4 escape hatch CIF: validación onBlur + checkbox dinámico solo si
 *     el CIF no pasa el validator (D4.12). El padre del checkbox vive
 *     dentro de un Alert destructivo. Si el operador edita el CIF tras un
 *     blur, se resetea cifFueValidado Y forzarCIF (evita arrastrar el
 *     consentimiento a un CIF distinto del que se evaluó).
 *   - D4.5 configuración replace completo en UPDATE: si zonaHoraria o
 *     idioma cambian, se envía el objeto entero { zonaHoraria, idioma }.
 *   - D4.11 select estado sin 'cancelado': la transición a 'cancelado' vive
 *     en el botón "Cancelar tenant" + Dialog destructivo separado.
 *   - DI10.5 + DI10.6 delta calculado en edición + submit disabled si vacío.
 *   - DI10.13 vaciar nombreComercial preexistente NO envía cambio (limitación
 *     documentada en TODO[delete-on-empty-fields]).
 *   - DI10.15 reset entre aperturas: el padre TenantFormDialog pasa key
 *     prop derivada de tenantInicial.id; aquí NO se incluye useEffect para
 *     resetear (React desmonta/remonta vía key).
 *
 * Inputs libres para comunidadAutonoma, provincia y zonaHoraria (DI10.14);
 * Select hardcoded para idioma con 2 valores iniciales (es, en).
 *
 * El CIF es disabled en modo='edicion' (defensa en profundidad UX sobre la
 * regla Firestore + validator backend que ya lo rechazan en UPDATE).
 */

export interface TenantFormProps {
  modo: 'alta' | 'edicion';
  tenantInicial?: Tenant;
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: CrearTenantInput | ActualizarTenantInput) => Promise<void>;
}

export default function TenantForm({
  modo,
  tenantInicial,
  submitting,
  errorRemoto,
  onSubmit,
}: TenantFormProps) {
  // --- State de campos ---
  const [nombre, setNombre] = useState(tenantInicial?.nombre ?? '');
  const [nombreComercial, setNombreComercial] = useState(
    tenantInicial?.nombreComercial ?? '',
  );
  const [cif, setCif] = useState(tenantInicial?.cif ?? '');
  const [comunidadAutonoma, setComunidadAutonoma] = useState(
    tenantInicial?.comunidadAutonoma ?? '',
  );
  const [provincia, setProvincia] = useState(tenantInicial?.provincia ?? '');
  const [plan, setPlan] = useState<PlanTenant>(
    tenantInicial?.plan ?? 'basico',
  );
  // 'cancelado' deliberadamente fuera del Select (D4.11). Si tenantInicial
  // es 'cancelado', el form no debería abrirse para él (la tabla muestra
  // "Reactivar"). Defensa: defaultear a 'activo'.
  const [estado, setEstado] = useState<'activo' | 'suspendido'>(
    tenantInicial?.estado === 'suspendido' ? 'suspendido' : 'activo',
  );
  const [zonaHoraria, setZonaHoraria] = useState(
    tenantInicial?.configuracion?.zonaHoraria ?? 'Europe/Madrid',
  );
  const [idioma, setIdioma] = useState(
    tenantInicial?.configuracion?.idioma ?? 'es',
  );

  // --- State del escape hatch CIF (D4.4 + D4.12) ---
  const [cifValidationResult, setCifValidationResult] =
    useState<CIFValidationResult | null>(null);
  const [forzarCIF, setForzarCIF] = useState(false);
  const [cifFueValidado, setCifFueValidado] = useState(false);

  const cifEsInmutable = modo === 'edicion';

  function handleCifChange(v: string) {
    setCif(v);
    // Reset de validación + consentimiento si el operador edita el CIF tras
    // un blur previo. Evita arrastrar forzarCIF=true a un CIF distinto.
    if (cifFueValidado) {
      setCifFueValidado(false);
      setForzarCIF(false);
    }
  }

  function handleCifBlur() {
    if (cifEsInmutable) return;
    setCifFueValidado(true);
    setCifValidationResult(validateCIF(cif));
  }

  const cifWarningVisible =
    cifFueValidado &&
    cifValidationResult?.valid === false &&
    cifValidationResult.reason !== 'empty';

  // --- Delta en edición (DI10.5) ---
  function buildDelta(): ActualizarTenantInput | null {
    if (!tenantInicial) return null;
    const delta: ActualizarTenantInput = { tenantId: tenantInicial.id };
    if (nombre !== tenantInicial.nombre) delta.nombre = nombre;
    // DI10.13: vaciar nombreComercial preexistente NO envía cambio (backend
    // no soporta delete-on-empty hoy — ver TODO[delete-on-empty-fields]).
    if (
      nombreComercial &&
      nombreComercial !== (tenantInicial.nombreComercial ?? '')
    ) {
      delta.nombreComercial = nombreComercial;
    }
    if (comunidadAutonoma !== tenantInicial.comunidadAutonoma) {
      delta.comunidadAutonoma = comunidadAutonoma;
    }
    if (provincia !== tenantInicial.provincia) delta.provincia = provincia;
    if (plan !== tenantInicial.plan) delta.plan = plan;
    if (estado !== tenantInicial.estado) delta.estado = estado;
    // D4.5 UPDATE: replace completo de configuracion si cualquiera de los
    // dos sub-campos cambia.
    if (
      zonaHoraria !== tenantInicial.configuracion.zonaHoraria ||
      idioma !== tenantInicial.configuracion.idioma
    ) {
      delta.configuracion = { zonaHoraria, idioma };
    }
    return Object.keys(delta).length === 1 ? null : delta;
  }

  const sinCambios = modo === 'edicion' && buildDelta() === null;

  const submitDeshabilitado =
    submitting ||
    (modo === 'alta' && cifWarningVisible && !forzarCIF) ||
    sinCambios;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modo === 'alta') {
      const input: CrearTenantInput = {
        nombre,
        cif,
        comunidadAutonoma,
        provincia,
        plan,
        configuracion: { zonaHoraria, idioma },
        ...(nombreComercial && { nombreComercial }),
        ...(forzarCIF && { forzarCIF: true }),
      };
      await onSubmit(input);
    } else {
      const delta = buildDelta();
      if (delta) await onSubmit(delta);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Nombre" required>
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />
      </Field>

      <Field label="Nombre comercial">
        <Input
          value={nombreComercial}
          onChange={(e) => setNombreComercial(e.target.value)}
        />
      </Field>

      <Field label="CIF" required>
        <Input
          value={cif}
          onChange={(e) => handleCifChange(e.target.value)}
          onBlur={handleCifBlur}
          disabled={cifEsInmutable}
          required
        />
        {cifEsInmutable && (
          <p className="text-xs text-muted-foreground">
            El CIF no es editable. Para corregir un typo, contactar con
            administración.
          </p>
        )}
        {cifWarningVisible && (
          <Alert variant="destructive">
            <AlertDescription>
              <span>
                El CIF no cumple el formato español estándar (motivo:{' '}
                {cifValidationResult?.reason}).
              </span>
              <label className="flex items-center gap-2 mt-2 text-sm">
                <Checkbox
                  checked={forzarCIF}
                  onCheckedChange={(v) => setForzarCIF(v === true)}
                />
                <span>
                  Forzar el alta (empresa extranjera, autónomo con DNI,
                  sociedad civil).
                </span>
              </label>
            </AlertDescription>
          </Alert>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Comunidad autónoma" required>
          <Input
            value={comunidadAutonoma}
            onChange={(e) => setComunidadAutonoma(e.target.value)}
            required
          />
        </Field>
        <Field label="Provincia" required>
          <Input
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Plan" required>
          <Select
            value={plan}
            onValueChange={(v) => setPlan(v as PlanTenant)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="basico">Básico</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {modo === 'edicion' && (
          <Field label="Estado" required>
            <Select
              value={estado}
              onValueChange={(v) => setEstado(v as 'activo' | 'suspendido')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="suspendido">Suspendido</SelectItem>
                {/* 'cancelado' deliberadamente ausente (D4.11) */}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <fieldset className="border rounded-md p-3 space-y-3">
        <legend className="text-sm font-medium px-2">Configuración</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zona horaria" required>
            <Input
              value={zonaHoraria}
              onChange={(e) => setZonaHoraria(e.target.value)}
              required
            />
          </Field>
          <Field label="Idioma" required>
            <Select value={idioma} onValueChange={setIdioma}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
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
          {submitting
            ? 'Guardando…'
            : modo === 'alta'
              ? 'Crear tenant'
              : 'Guardar cambios'}
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
