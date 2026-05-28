import { HttpsError } from "firebase-functions/v2/https";
import type {
  CategoriaConductor,
  EstadoCentro,
  EstadoTenant,
  PlanTenant,
} from "@albius/shared";

/**
 * Validación de payloads de callables (D4: type guards a mano, sin Zod).
 *
 * Cada validator de alto nivel recibe el `data` desconocido que llega al
 * callable y devuelve un payload tipado y saneado. Cualquier campo inválido
 * lanza HttpsError('invalid-argument', mensaje claro en español).
 *
 * Este módulo solo valida FORMATO. La existencia de referencias en Firestore
 * (tenant, centro) vive en refs.ts. Las relaciones temporales entre fechas
 * (ej. fechaAntiguedad <= fechaIncorporacion) NO se validan: si surge la
 * necesidad en uso real se añade aquí o en una capa intermedia.
 *
 * Reservado a 'invalid-argument' por D6. Los códigos de autenticación
 * ('unauthenticated', 'permission-denied', 'failed-precondition') viven en
 * auth-guards.ts.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
//  TIPOS DE PAYLOAD
// ============================================================================

export interface CrearJefeTraficoPayload {
  email: string;
  nombreCompleto: string;
  telefono?: string;
  tenantId: string;
  centroId: string;
}

export interface CrearConductorPayload {
  numeroEmpleado: string;
  nombre: string;
  apellidos: string;
  dni: string;
  email: string;
  telefono?: string;
  tenantId: string;
  centroId: string;
  categoria: CategoriaConductor;
  fechaAntiguedad: Date;
  fechaIncorporacion: Date;
  puedeSerReserva: boolean;
  lineasPreferentes?: string[];
  lineasSecundarias?: string[];
  tiposTurnoPermitidos?: string[];
  tiposTurnoExcluidos?: string[];
  maxHorasSemanales?: number;
  observaciones?: string;
}

/**
 * Payload de crearTenant (D4.2: defaults backend, NO en frontend).
 * Por D4.5 (objetos compuestos en CREATE), `configuracion` admite parcial:
 * los huecos los rellena el callable con DEFAULTS_CONFIGURACION.
 *
 * `forzarCIF` es el escape hatch documentado en D4.4: si true, un CIF que
 * no pasa `validateCIF` se acepta y se persiste `cifValidacionForzada=true`
 * en el doc Tenant para auditoría.
 */
export interface CrearTenantPayload {
  nombre: string;
  nombreComercial?: string;
  cif: string;
  comunidadAutonoma: string;
  provincia: string;
  plan?: PlanTenant;
  configuracion?: { zonaHoraria?: string; idioma?: string };
  forzarCIF?: boolean;
}

/**
 * Payload de actualizarTenant. `tenantId` siempre obligatorio; el resto
 * opcional, pero el validator exige que al menos uno esté presente
 * (helper `assertAtLeastOneField`).
 *
 * Por D4.5 (objetos compuestos en UPDATE), `configuracion` se REEMPLAZA
 * completo: si se envía, ambos sub-campos (`zonaHoraria`, `idioma`) son
 * required. El frontend debe hidratar el objeto entero antes de editar.
 *
 * Por D4.4 + canónica del Bloque 8, `cif` y `cifValidacionForzada` NO son
 * editables: el validator los rechaza con `invalid-argument`. Para typos
 * en CIF, ver TODO[edit-cif-procedimiento].
 */
export interface ActualizarTenantPayload {
  tenantId: string;
  nombre?: string;
  nombreComercial?: string;
  comunidadAutonoma?: string;
  provincia?: string;
  plan?: PlanTenant;
  estado?: EstadoTenant;
  configuracion?: { zonaHoraria: string; idioma: string };
  logoUrl?: string;
}

/**
 * Coordenadas geográficas planas (latitud/longitud en grados decimales). Es
 * la forma "wire" del GeoPoint de Firestore: el frontend manda un objeto
 * plano JSON y el callable lo convierte a `new GeoPoint(lat, lon)` en la
 * escritura. Validado por `assertOptionalCoordenadas` con rangos estándar.
 */
export interface CoordenadasPayload {
  latitude: number;
  longitude: number;
}

/**
 * Payload de crearCentro (D4.2: defaults backend, solo estado='activo'
 * hard-coded — Centro no tiene `configuracion` ni `plan` que defaultar).
 * `direccion` y `coordenadas` son opcionales por el modelo.
 *
 * Sin validador de dominio (no hay CIF ni equivalente para Centro).
 */
export interface CrearCentroPayload {
  tenantId: string;
  nombre: string;
  ciudad: string;
  provincia: string;
  direccion?: string;
  coordenadas?: CoordenadasPayload;
}

/**
 * Payload de actualizarCentro. `centroId` siempre obligatorio; el resto
 * opcional, pero el validator exige al menos uno presente vía
 * `assertAtLeastOneField`.
 *
 * Inmutables vetados explícitamente (defensa en profundidad sobre las
 * reglas Firestore, que también los bloquean): `tenantId`, `id`,
 * `fechaCreacion`, `creadoPor`, `creadoEn`. Mensajes específicos.
 *
 * `coordenadas` en UPDATE sigue patrón "omit = no tocar" (MVP). Borrado
 * explícito de coordenadas no soportado — ver `TODO[delete-on-empty-fields]`.
 */
export interface ActualizarCentroPayload {
  centroId: string;
  nombre?: string;
  direccion?: string;
  ciudad?: string;
  provincia?: string;
  coordenadas?: CoordenadasPayload;
  estado?: EstadoCentro;
}

// ============================================================================
//  HELPERS ATÓMICOS
// ============================================================================

/**
 * Garantiza que el payload entrante es un objeto plano (no array, no null,
 * no primitivo). Combina los tres checks porque `typeof null === 'object'`
 * y `typeof [] === 'object'` en JS.
 */
export function assertPayloadObject(
  value: unknown,
  contextLabel: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpsError(
      "invalid-argument",
      `El payload de ${contextLabel} debe ser un objeto.`,
    );
  }
  return value as Record<string, unknown>;
}

export function assertNonEmptyString(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' es requerido y debe ser texto.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' no puede estar vacío.`,
    );
  }
  return trimmed;
}

export function assertOptionalNonEmptyString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return assertNonEmptyString(value, fieldName);
}

/**
 * Email con regex pragmática. La validación dura la hace Firebase Auth al
 * crear el usuario; si llega un formato exótico, createUser fallará y el
 * callable convertirá el error en 'invalid-argument'.
 */
export function assertEmail(value: unknown, fieldName: string): string {
  const str = assertNonEmptyString(value, fieldName);
  if (!EMAIL_REGEX.test(str)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' no tiene formato de email válido.`,
    );
  }
  return str;
}

/**
 * Booleano estricto: no acepta strings 'true'/'false' ni 0/1. Si el frontend
 * manda algo distinto a `true`/`false`, es un bug del frontend que conviene
 * detectar en el origen.
 */
export function assertBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' es requerido y debe ser booleano.`,
    );
  }
  return value;
}

/**
 * Número positivo finito (rechaza NaN, Infinity, negativos y cero) u omitido.
 * Si en el futuro 0 debe ser válido (ej. "sin restricción"), revisar.
 */
export function assertOptionalPositiveNumber(
  value: unknown,
  fieldName: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser un número positivo finito.`,
    );
  }
  return value;
}

export function assertOptionalStringArray(
  value: unknown,
  fieldName: string,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser un array de texto.`,
    );
  }
  return value.map((item: unknown, index: number) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new HttpsError(
        "invalid-argument",
        `El campo '${fieldName}[${index}]' debe ser texto no vacío.`,
      );
    }
    return item.trim();
  });
}

/**
 * Valida que el valor pertenece al conjunto de literales permitidos.
 * Usar con `as const` en el array para que TS infiera el tipo literal:
 *   assertEnum(data.categoria, ["conductor"] as const, "categoria")
 */
export function assertEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser uno de: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

/**
 * Fecha ISO. Acepta tanto "YYYY-MM-DD" como "YYYY-MM-DDTHH:mm:ssZ" — cualquier
 * string que el constructor de Date interprete sin devolver NaN. Devuelve Date
 * ya validado para que el callable solo tenga que pasarlo a Timestamp.fromDate.
 */
export function assertISODate(value: unknown, fieldName: string): Date {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' es requerido y debe ser una fecha ISO en string.`,
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser una fecha ISO válida.`,
    );
  }
  return date;
}

/**
 * Booleano opcional. Si el valor es `undefined`/`null`, devuelve `undefined`.
 * Si está presente, exige tipo booleano estricto (delega en assertBoolean).
 */
export function assertOptionalBoolean(
  value: unknown,
  fieldName: string,
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return assertBoolean(value, fieldName);
}

/**
 * Enum opcional. Símil a assertEnum pero acepta omitido.
 */
export function assertOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string,
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return assertEnum(value, allowed, fieldName);
}

/**
 * Configuración del Tenant en modo CREATE (D4.5): admite parcial.
 * Cada sub-campo es opcional; los huecos se rellenan luego en el callable
 * con DEFAULTS_CONFIGURACION.
 */
export function assertOptionalConfiguracionParcial(
  value: unknown,
  fieldName: string,
): { zonaHoraria?: string; idioma?: string } | undefined {
  if (value === undefined || value === null) return undefined;
  const obj = assertPayloadObject(value, fieldName);
  const result: { zonaHoraria?: string; idioma?: string } = {};
  if (obj["zonaHoraria"] !== undefined) {
    result.zonaHoraria = assertNonEmptyString(
      obj["zonaHoraria"],
      `${fieldName}.zonaHoraria`,
    );
  }
  if (obj["idioma"] !== undefined) {
    result.idioma = assertNonEmptyString(obj["idioma"], `${fieldName}.idioma`);
  }
  return result;
}

/**
 * Configuración del Tenant en modo UPDATE (D4.5): si se envía, debe venir
 * COMPLETA (ambos sub-campos requeridos). Replace literal en el callable.
 */
export function assertOptionalConfiguracionCompleta(
  value: unknown,
  fieldName: string,
): { zonaHoraria: string; idioma: string } | undefined {
  if (value === undefined || value === null) return undefined;
  const obj = assertPayloadObject(value, fieldName);
  return {
    zonaHoraria: assertNonEmptyString(
      obj["zonaHoraria"],
      `${fieldName}.zonaHoraria`,
    ),
    idioma: assertNonEmptyString(obj["idioma"], `${fieldName}.idioma`),
  };
}

/**
 * Coordenadas geográficas. Si el valor llega `undefined`/`null`, devuelve
 * `undefined`. Si está presente, valida rangos estándar:
 *   - latitude  ∈ [-90, 90]
 *   - longitude ∈ [-180, 180]
 *   - ambos `Number.isFinite` (rechaza NaN, Infinity).
 *
 * El callable convertirá el objeto plano resultante a `new GeoPoint(lat, lon)`
 * en la escritura. NO se hace aquí para mantener validation.ts libre de
 * dependencias de firebase-admin.
 */
export function assertOptionalCoordenadas(
  value: unknown,
  fieldName: string,
): { latitude: number; longitude: number } | undefined {
  if (value === undefined || value === null) return undefined;
  const obj = assertPayloadObject(value, fieldName);
  const lat = obj["latitude"];
  const lon = obj["longitude"];
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}.latitude' debe ser un número entre -90 y 90.`,
    );
  }
  if (
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}.longitude' debe ser un número entre -180 y 180.`,
    );
  }
  return { latitude: lat, longitude: lon };
}

/**
 * En callables `actualizar*`: garantiza que el payload tiene al menos un
 * campo de la lista presente (no `undefined`). Distingue "no envías nada"
 * de "envías un campo inválido". Mirar el payload RAW antes de validar
 * cada campo individualmente: si todos los campos opcionales están
 * ausentes, lanza `invalid-argument` antes de cualquier otra validación.
 */
export function assertAtLeastOneField(
  payload: Record<string, unknown>,
  fields: readonly string[],
  contextLabel: string,
): void {
  const presentes = fields.filter((f) => payload[f] !== undefined);
  if (presentes.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      `Debes incluir al menos un campo a actualizar en ${contextLabel}: ${fields.join(", ")}.`,
    );
  }
}

// ============================================================================
//  VALIDATORS DE ALTO NIVEL
// ============================================================================

const CATEGORIAS_CONDUCTOR_PERMITIDAS = ["conductor"] as const;
const PLANES_TENANT_PERMITIDOS = ["basico", "pro", "enterprise"] as const;
const ESTADOS_TENANT_PERMITIDOS = [
  "activo",
  "suspendido",
  "cancelado",
] as const;
const ESTADOS_CENTRO_PERMITIDOS = ["activo", "inactivo"] as const;

export function validateCrearJefeTraficoPayload(
  data: unknown,
): CrearJefeTraficoPayload {
  const payload = assertPayloadObject(data, "crearJefeTrafico");
  return {
    email: assertEmail(payload["email"], "email"),
    nombreCompleto: assertNonEmptyString(payload["nombreCompleto"], "nombreCompleto"),
    telefono: assertOptionalNonEmptyString(payload["telefono"], "telefono"),
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
  };
}

export function validateCrearConductorPayload(
  data: unknown,
): CrearConductorPayload {
  const payload = assertPayloadObject(data, "crearConductor");
  return {
    numeroEmpleado: assertNonEmptyString(payload["numeroEmpleado"], "numeroEmpleado"),
    nombre: assertNonEmptyString(payload["nombre"], "nombre"),
    apellidos: assertNonEmptyString(payload["apellidos"], "apellidos"),
    dni: assertNonEmptyString(payload["dni"], "dni"),
    email: assertEmail(payload["email"], "email"),
    telefono: assertOptionalNonEmptyString(payload["telefono"], "telefono"),
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
    categoria: assertEnum(
      payload["categoria"],
      CATEGORIAS_CONDUCTOR_PERMITIDAS,
      "categoria",
    ),
    fechaAntiguedad: assertISODate(payload["fechaAntiguedad"], "fechaAntiguedad"),
    fechaIncorporacion: assertISODate(
      payload["fechaIncorporacion"],
      "fechaIncorporacion",
    ),
    puedeSerReserva: assertBoolean(payload["puedeSerReserva"], "puedeSerReserva"),
    lineasPreferentes: assertOptionalStringArray(
      payload["lineasPreferentes"],
      "lineasPreferentes",
    ),
    lineasSecundarias: assertOptionalStringArray(
      payload["lineasSecundarias"],
      "lineasSecundarias",
    ),
    tiposTurnoPermitidos: assertOptionalStringArray(
      payload["tiposTurnoPermitidos"],
      "tiposTurnoPermitidos",
    ),
    tiposTurnoExcluidos: assertOptionalStringArray(
      payload["tiposTurnoExcluidos"],
      "tiposTurnoExcluidos",
    ),
    maxHorasSemanales: assertOptionalPositiveNumber(
      payload["maxHorasSemanales"],
      "maxHorasSemanales",
    ),
    observaciones: assertOptionalNonEmptyString(payload["observaciones"], "observaciones"),
  };
}

export function validateCrearTenantPayload(
  data: unknown,
): CrearTenantPayload {
  const payload = assertPayloadObject(data, "crearTenant");
  const result: CrearTenantPayload = {
    nombre: assertNonEmptyString(payload["nombre"], "nombre"),
    cif: assertNonEmptyString(payload["cif"], "cif"),
    comunidadAutonoma: assertNonEmptyString(
      payload["comunidadAutonoma"],
      "comunidadAutonoma",
    ),
    provincia: assertNonEmptyString(payload["provincia"], "provincia"),
  };
  const nombreComercial = assertOptionalNonEmptyString(
    payload["nombreComercial"],
    "nombreComercial",
  );
  if (nombreComercial !== undefined) result.nombreComercial = nombreComercial;
  const plan = assertOptionalEnum(
    payload["plan"],
    PLANES_TENANT_PERMITIDOS,
    "plan",
  );
  if (plan !== undefined) result.plan = plan;
  const configuracion = assertOptionalConfiguracionParcial(
    payload["configuracion"],
    "configuracion",
  );
  if (configuracion !== undefined) result.configuracion = configuracion;
  const forzarCIF = assertOptionalBoolean(payload["forzarCIF"], "forzarCIF");
  if (forzarCIF !== undefined) result.forzarCIF = forzarCIF;
  return result;
}

export function validateActualizarTenantPayload(
  data: unknown,
): ActualizarTenantPayload {
  const payload = assertPayloadObject(data, "actualizarTenant");

  // Veto explícito de campos no editables (D4.4 + canónica B8):
  // mensaje específico, antes de cualquier otra validación.
  if ("cif" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El CIF no es editable. Para corregir typos, ver procedimiento manual en TODO[edit-cif-procedimiento].",
    );
  }
  if ("cifValidacionForzada" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "cifValidacionForzada se establece automáticamente durante crearTenant y no es editable directamente.",
    );
  }

  // tenantId siempre obligatorio.
  const tenantId = assertNonEmptyString(payload["tenantId"], "tenantId");

  // Al menos un campo a actualizar (excluyendo tenantId).
  const CAMPOS_OPCIONALES_ACTUALIZAR = [
    "nombre",
    "nombreComercial",
    "comunidadAutonoma",
    "provincia",
    "plan",
    "estado",
    "configuracion",
    "logoUrl",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES_ACTUALIZAR,
    "actualizarTenant",
  );

  // Validación campo a campo.
  const result: ActualizarTenantPayload = { tenantId };
  const nombre = assertOptionalNonEmptyString(payload["nombre"], "nombre");
  if (nombre !== undefined) result.nombre = nombre;
  const nombreComercial = assertOptionalNonEmptyString(
    payload["nombreComercial"],
    "nombreComercial",
  );
  if (nombreComercial !== undefined) result.nombreComercial = nombreComercial;
  const comunidadAutonoma = assertOptionalNonEmptyString(
    payload["comunidadAutonoma"],
    "comunidadAutonoma",
  );
  if (comunidadAutonoma !== undefined)
    result.comunidadAutonoma = comunidadAutonoma;
  const provincia = assertOptionalNonEmptyString(
    payload["provincia"],
    "provincia",
  );
  if (provincia !== undefined) result.provincia = provincia;
  const plan = assertOptionalEnum(
    payload["plan"],
    PLANES_TENANT_PERMITIDOS,
    "plan",
  );
  if (plan !== undefined) result.plan = plan;
  const estado = assertOptionalEnum(
    payload["estado"],
    ESTADOS_TENANT_PERMITIDOS,
    "estado",
  );
  if (estado !== undefined) result.estado = estado;
  const configuracion = assertOptionalConfiguracionCompleta(
    payload["configuracion"],
    "configuracion",
  );
  if (configuracion !== undefined) result.configuracion = configuracion;
  const logoUrl = assertOptionalNonEmptyString(payload["logoUrl"], "logoUrl");
  if (logoUrl !== undefined) result.logoUrl = logoUrl;
  return result;
}

export function validateCrearCentroPayload(
  data: unknown,
): CrearCentroPayload {
  const payload = assertPayloadObject(data, "crearCentro");
  const result: CrearCentroPayload = {
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    nombre: assertNonEmptyString(payload["nombre"], "nombre"),
    ciudad: assertNonEmptyString(payload["ciudad"], "ciudad"),
    provincia: assertNonEmptyString(payload["provincia"], "provincia"),
  };
  const direccion = assertOptionalNonEmptyString(
    payload["direccion"],
    "direccion",
  );
  if (direccion !== undefined) result.direccion = direccion;
  const coordenadas = assertOptionalCoordenadas(
    payload["coordenadas"],
    "coordenadas",
  );
  if (coordenadas !== undefined) result.coordenadas = coordenadas;
  return result;
}

export function validateActualizarCentroPayload(
  data: unknown,
): ActualizarCentroPayload {
  const payload = assertPayloadObject(data, "actualizarCentro");

  // Veto explícito de campos no editables (defensa en profundidad sobre
  // las reglas Firestore, que también los bloquean). Mensajes específicos.
  if ("tenantId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El tenantId no es editable. Un centro pertenece permanentemente al tenant donde se creó.",
    );
  }
  if ("id" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'id' no es editable.",
    );
  }
  if ("fechaCreacion" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'fechaCreacion' no es editable.",
    );
  }
  if ("creadoPor" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'creadoPor' no es editable.",
    );
  }
  if ("creadoEn" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'creadoEn' no es editable.",
    );
  }

  // centroId siempre obligatorio.
  const centroId = assertNonEmptyString(payload["centroId"], "centroId");

  // Al menos un campo a actualizar (excluyendo centroId).
  const CAMPOS_OPCIONALES_ACTUALIZAR = [
    "nombre",
    "direccion",
    "ciudad",
    "provincia",
    "coordenadas",
    "estado",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES_ACTUALIZAR,
    "actualizarCentro",
  );

  // Validación campo a campo.
  const result: ActualizarCentroPayload = { centroId };
  const nombre = assertOptionalNonEmptyString(payload["nombre"], "nombre");
  if (nombre !== undefined) result.nombre = nombre;
  const direccion = assertOptionalNonEmptyString(
    payload["direccion"],
    "direccion",
  );
  if (direccion !== undefined) result.direccion = direccion;
  const ciudad = assertOptionalNonEmptyString(payload["ciudad"], "ciudad");
  if (ciudad !== undefined) result.ciudad = ciudad;
  const provincia = assertOptionalNonEmptyString(
    payload["provincia"],
    "provincia",
  );
  if (provincia !== undefined) result.provincia = provincia;
  const coordenadas = assertOptionalCoordenadas(
    payload["coordenadas"],
    "coordenadas",
  );
  if (coordenadas !== undefined) result.coordenadas = coordenadas;
  const estado = assertOptionalEnum(
    payload["estado"],
    ESTADOS_CENTRO_PERMITIDOS,
    "estado",
  );
  if (estado !== undefined) result.estado = estado;
  return result;
}
