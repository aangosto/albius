import { HttpsError } from "firebase-functions/v2/https";
import type { CategoriaConductor } from "@albius/shared";

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

// ============================================================================
//  VALIDATORS DE ALTO NIVEL
// ============================================================================

const CATEGORIAS_CONDUCTOR_PERMITIDAS = ["conductor"] as const;

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
