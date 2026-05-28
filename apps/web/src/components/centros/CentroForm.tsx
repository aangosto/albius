import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Centro, Tenant } from '@albius/shared';
import type {
  ActualizarCentroInput,
  CoordenadasWire,
  CrearCentroInput,
} from '@/lib/services/centros';

/**
 * Form reutilizable para alta (modo='alta') y edición (modo='edicion') de
 * Centros.
 *
 * Decisiones canónicas implementadas:
 *   - D4.5 (extensión) — coordenadas como objeto compuesto: si llegan en
 *     UPDATE, ambos sub-campos (latitude, longitude) son requeridos.
 *     Replace literal en el backend.
 *   - D4.11 — soft-delete por botón secundario destructivo separado (no en
 *     el form). Coherente con Tenants.
 *   - D5.1 — el selector de tenant en alta muestra SOLO tenants activos
 *     (`tenantsActivos`). Evita fricción frontend: el backend rechazaría
 *     un centro creado bajo tenant suspendido/cancelado con
 *     failed-precondition.
 *   - D5.3 — Centro tiene solo 2 estados; el form NO incluye Select de
 *     estado. Las transiciones activo↔inactivo se gestionan únicamente con
 *     botones secundarios "Inactivar"/"Reactivar" + Dialog de confirmación.
 *   - DI10.5 + DI10.6 (B10) — delta calculado en edición + submit disabled
 *     si vacío.
 *   - DI10.13 (B10) — vaciar campos opcionales preexistentes (direccion,
 *     coordenadas) NO envía cambio. Limitación documentada en
 *     `TODO[delete-on-empty-fields]`.
 *   - DI10.15 (B10) — reset entre aperturas con `key` prop en el padre Dialog
 *     (no useEffect aquí). Estado inicial del form se deriva de props.
 *
 * Coordenadas (Q3 del PASO 2 — patrón ambos-o-ninguno):
 *   - Inputs `type="number" step="any"` con string state para preservar la
 *     entrada del usuario (no perder decimales tipeados).
 *   - parseCoords devuelve `{ coord, error }`:
 *       ambos vacíos → coord=null, error=null (omit-only)
 *       solo uno     → coord=null, error="indica ambas o ninguna"
 *       ambos OK     → coord={latitude,longitude}, error=null
 *       ambos con rango/no-finite → coord=null, error específico
 *   - Backend (assertOptionalCoordenadas) gatea de todas formas con los
 *     mismos rangos; esta validación es para UX inmediata y submit-blocking.
 *
 * Tenant en edición:
 *   - Inmutable (defensa en profundidad: reglas Firestore + validator
 *     backend ya lo rechazan). Render como label readonly con sufijo
 *     "(suspendido)" / "(cancelado)" en muted si el tenant del centro
 *     existente no está activo, paralelo a CentrosTable.
 *   - Lookup en `tenants` (que incluye TODOS, no solo activos) para
 *     resolver el nombre del tenant aunque esté en estado no operativo.
 *
 * Hooks: incondicionales (useState al tope). El componente NO tiene gate
 * de rol propio (eso vive en la página vía D4.13).
 */

const TENANT_SUFIJO: Partial<Record<Tenant['estado'], string>> = {
  suspendido: ' (suspendido)',
  cancelado: ' (cancelado)',
};

export interface CentroFormProps {
  modo: 'alta' | 'edicion';
  centroInicial?: Centro;
  /**
   * Tenants activos para el Select en modo='alta'. Debe llegar ordenado
   * por nombre ASC (la página deriva esta lista filtrando `tenants` por
   * `estado === 'activo'`; `listarTenants` ya ordena por nombre, así que
   * filter() preserva el orden).
   */
  tenantsActivos: Tenant[];
  /**
   * Lista completa de tenants (incluye no-activos). Usada en edición para
   * resolver el nombre del tenant del centro aunque haya sido cancelado/
   * suspendido tras crearse el centro.
   */
  tenants: Tenant[];
  submitting: boolean;
  errorRemoto: string | null;
  onSubmit: (input: CrearCentroInput | ActualizarCentroInput) => Promise<void>;
}

interface ParsedCoords {
  coord: CoordenadasWire | null;
  error: string | null;
}

function parseCoords(latStr: string, lonStr: string): ParsedCoords {
  const latTrim = latStr.trim();
  const lonTrim = lonStr.trim();

  // Ambos vacíos → omit-only (válido).
  if (!latTrim && !lonTrim) {
    return { coord: null, error: null };
  }

  // Solo uno → error (no permitimos coords parciales).
  if (!latTrim || !lonTrim) {
    return {
      coord: null,
      error: 'Indica ambas coordenadas o deja ambas vacías.',
    };
  }

  // Ambos rellenos → validar rangos.
  const lat = Number(latTrim);
  const lon = Number(lonTrim);

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return {
      coord: null,
      error: 'Latitud debe ser un número entre -90 y 90.',
    };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return {
      coord: null,
      error: 'Longitud debe ser un número entre -180 y 180.',
    };
  }

  return { coord: { latitude: lat, longitude: lon }, error: null };
}

export default function CentroForm({
  modo,
  centroInicial,
  tenantsActivos,
  tenants,
  submitting,
  errorRemoto,
  onSubmit,
}: CentroFormProps) {
  // State inicial derivado de props (DI10.15: el padre Dialog desmonta/
  // remonta con key={centroInicial?.id ?? 'alta'} → state se reinicia).
  const [tenantId, setTenantId] = useState(centroInicial?.tenantId ?? '');
  const [nombre, setNombre] = useState(centroInicial?.nombre ?? '');
  const [ciudad, setCiudad] = useState(centroInicial?.ciudad ?? '');
  const [provincia, setProvincia] = useState(centroInicial?.provincia ?? '');
  const [direccion, setDireccion] = useState(centroInicial?.direccion ?? '');
  const [latitudStr, setLatitudStr] = useState(
    centroInicial?.coordenadas
      ? String(centroInicial.coordenadas.latitude)
      : '',
  );
  const [longitudStr, setLongitudStr] = useState(
    centroInicial?.coordenadas
      ? String(centroInicial.coordenadas.longitude)
      : '',
  );

  const { coord: parsedCoord, error: coordError } = parseCoords(
    latitudStr,
    longitudStr,
  );

  // Delta para edición (omit-only DI10.13).
  function buildDelta(): ActualizarCentroInput | null {
    if (!centroInicial) return null;
    const delta: ActualizarCentroInput = { centroId: centroInicial.id };
    if (nombre !== centroInicial.nombre) delta.nombre = nombre;
    if (ciudad !== centroInicial.ciudad) delta.ciudad = ciudad;
    if (provincia !== centroInicial.provincia) delta.provincia = provincia;
    // DI10.13: vaciar direccion preexistente NO envía cambio (backend no
    // soporta delete-on-empty hoy — ver TODO[delete-on-empty-fields]).
    if (direccion && direccion !== (centroInicial.direccion ?? '')) {
      delta.direccion = direccion;
    }
    // Coordenadas: solo se envían si parseCoords devuelve coord !== null Y
    // difiere de las iniciales. Si parsedCoord === null (ambos vacíos) y
    // había coordenadas iniciales → omit-only (no se envía, limitación
    // documentada en TODO[delete-on-empty-fields]).
    if (parsedCoord !== null) {
      const initLat = centroInicial.coordenadas?.latitude;
      const initLon = centroInicial.coordenadas?.longitude;
      if (
        parsedCoord.latitude !== initLat ||
        parsedCoord.longitude !== initLon
      ) {
        delta.coordenadas = parsedCoord;
      }
    }
    return Object.keys(delta).length === 1 ? null : delta;
  }

  const sinCambios = modo === 'edicion' && buildDelta() === null;
  const tenantSeleccionadoFaltante = modo === 'alta' && !tenantId;
  const submitDeshabilitado =
    submitting ||
    coordError !== null ||
    sinCambios ||
    tenantSeleccionadoFaltante;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (modo === 'alta') {
      // Defensa: el botón está disabled si tenantId vacío, pero por si
      // submit se dispara vía Enter sin selección.
      if (!tenantId) return;
      const input: CrearCentroInput = {
        tenantId,
        nombre,
        ciudad,
        provincia,
        ...(direccion && { direccion }),
        ...(parsedCoord && { coordenadas: parsedCoord }),
      };
      await onSubmit(input);
    } else {
      const delta = buildDelta();
      if (delta) await onSubmit(delta);
    }
  }

  // Lookup del tenant del centro en edición. Usa `tenants` (todos) por si
  // está suspendido/cancelado tras la creación del centro.
  const tenantDelCentro =
    centroInicial !== undefined
      ? tenants.find((t) => t.id === centroInicial.tenantId)
      : undefined;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Tenant" required>
        {modo === 'alta' ? (
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecciona un tenant…" />
            </SelectTrigger>
            <SelectContent>
              {tenantsActivos.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <div className="text-sm py-2 px-3 bg-muted rounded-md">
              {tenantDelCentro ? (
                <>
                  {tenantDelCentro.nombre}
                  {TENANT_SUFIJO[tenantDelCentro.estado] && (
                    <span className="text-muted-foreground">
                      {TENANT_SUFIJO[tenantDelCentro.estado]}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  {centroInicial?.tenantId ?? '—'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              El tenant no es editable. Un centro pertenece permanentemente
              al tenant donde se creó.
            </p>
          </>
        )}
      </Field>

      <Field label="Nombre" required>
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ciudad" required>
          <Input
            value={ciudad}
            onChange={(e) => setCiudad(e.target.value)}
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

      <Field label="Dirección">
        <Input
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
        />
      </Field>

      <fieldset className="border rounded-md p-3 space-y-2">
        <legend className="text-sm font-medium px-2">
          Coordenadas (opcional)
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitud">
            <Input
              type="number"
              step="any"
              value={latitudStr}
              onChange={(e) => setLatitudStr(e.target.value)}
              placeholder="-90 a 90"
            />
          </Field>
          <Field label="Longitud">
            <Input
              type="number"
              step="any"
              value={longitudStr}
              onChange={(e) => setLongitudStr(e.target.value)}
              placeholder="-180 a 180"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Indica ambas o deja ambas vacías. Latitud entre -90 y 90, longitud
          entre -180 y 180.
        </p>
        {coordError && (
          <Alert>
            <AlertDescription>{coordError}</AlertDescription>
          </Alert>
        )}
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
              ? 'Crear centro'
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
