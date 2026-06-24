import { HttpsError } from "firebase-functions/v2/https";
import type {
  CategoriaConductor,
  EstadoCentro,
  EstadoConductor,
  EstadoLinea,
  EstadoTenant,
  EstadoTipoTurno,
  EstadoUsuario,
  PlanTenant,
  SentidoLinea,
  TipoDia,
  TipoLinea,
  TramoPartido,
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

// Color HEX de 6 dígitos con almohadilla ("#1F77B4"). Usado por Linea.color.
const COLOR_HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Hora "HH:mm" 24h (00:00–23:59). Usado por TipoTurno (horaInicio/Fin, tramos).
const HORA_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

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

/**
 * Payload de actualizarUsuario (B13). `usuarioId` siempre obligatorio; el
 * resto opcional, pero el validator exige al menos uno presente vía
 * `assertAtLeastOneField`.
 *
 * Solo edita campos no-críticos: `nombreCompleto` y `email` son dual-homed
 * (viven también en el Auth user record; el callable hace escritura dual,
 * D5.4), `telefono` y `estado` son solo-Firestore.
 *
 * Campos vetados explícitamente (D5.5 + inmutables + passwords):
 *   - rol / tenantId / centroId / conductorId: identidad y claims, reservados
 *     a callables dedicados futuros (cambiarRolUsuario, moverUsuario);
 *     conductorId es inmutable de por vida (D3.1).
 *   - id / creadoPor / creadoEn / fechaCreacion: inmutables.
 *   - passwordChangeRequired / passwordCambiadaEn: gestionados por el flujo
 *     de cambio de contraseña (marcarPasswordCambiada).
 */
export interface ActualizarUsuarioPayload {
  usuarioId: string;
  nombreCompleto?: string;
  telefono?: string;
  email?: string;
  estado?: EstadoUsuario;
}

/**
 * Payload de crearLinea (B16, primer modelo operativo).
 *
 * `estado` es REQUERIDO (a diferencia de Centro, que hard-codea 'activo'):
 * Línea tiene enum-3 y puede crearse directamente como 'suspendida' (línea
 * estacional fuera de temporada). No se defaultea en backend (D4.2 no aplica
 * a este campo).
 *
 * `paradasIda`/`paradasVuelta` admiten vacío y se defaultean a `[]` si se
 * omiten (D4.2, como `crearConductor` con sus arrays). PROVISIONAL: la
 * relación línea↔parada se redecide en B17 (`TODO[modelo-linea-paradas]`).
 *
 * `color`, `vigenciaDesde`/`vigenciaHasta`, `observaciones` son opcionales por
 * el modelo. Fechas tipadas `Date` (parseadas de ISO string por el validator,
 * convertidas a Timestamp por el callable), igual que `CrearConductorPayload`.
 */
export interface CrearLineaPayload {
  tenantId: string;
  centroId: string;
  codigo: string;
  nombre: string;
  tipo: TipoLinea;
  esNocturna: boolean;
  estado: EstadoLinea;
  color?: string;
  paradasIda?: string[];
  paradasVuelta?: string[];
  vigenciaDesde?: Date;
  vigenciaHasta?: Date;
  observaciones?: string;
}

/**
 * Payload de actualizarLinea. `lineaId` siempre obligatorio; el resto opcional,
 * pero el validator exige al menos uno presente vía `assertAtLeastOneField`.
 *
 * Inmutables vetados explícitamente (defensa en profundidad sobre las reglas
 * Firestore): `id`, `tenantId`, `centroId`, `creadoPor`, `creadoEn`. El
 * `centroId` es inmutable: una línea pertenece permanentemente al centro donde
 * se creó (paralelo a `tenantId` en Centro).
 *
 * `codigo` SÍ es editable a nivel formato aquí; el callable revalida unicidad
 * por centro (`assertCodigoLineaUnico` con `excludeLineaId`).
 *
 * `paradasIda`/`paradasVuelta` en UPDATE siguen patrón "omit = no tocar"; si se
 * envían, reemplazan el array completo.
 */
export interface ActualizarLineaPayload {
  lineaId: string;
  codigo?: string;
  nombre?: string;
  tipo?: TipoLinea;
  esNocturna?: boolean;
  estado?: EstadoLinea;
  color?: string;
  paradasIda?: string[];
  paradasVuelta?: string[];
  vigenciaDesde?: Date;
  vigenciaHasta?: Date;
  observaciones?: string;
}

/**
 * Payload de crearTipoTurno (B18). Entidad operativa del jefe que cuelga de un
 * centro (D5.1, `centroId` requerido), hermana de Línea.
 *
 * `tramosPartido` es requerido y no vacío SOLO si `esPartido` (validación
 * cruzada). `esNocturno` es a efectos de convenio, ortogonal a `esPartido`.
 * `duracionEfectivaMinutos <= duracionMinutos`. Horas en "HH:mm"; si
 * `horaFin < horaInicio` el turno cruza medianoche (no se valida que
 * `duracionMinutos == fin-inicio`: es declarada, puede diferir del convenio).
 */
export interface CrearTipoTurnoPayload {
  tenantId: string;
  centroId: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  duracionMinutos: number;
  duracionEfectivaMinutos: number;
  esPartido: boolean;
  esNocturno: boolean;
  estado: EstadoTipoTurno;
  color?: string;
  tramosPartido?: TramoPartido[];
}

/**
 * Payload de actualizarTipoTurno. `tipoTurnoId` siempre obligatorio; el resto
 * opcional, pero el validator exige al menos uno (assertAtLeastOneField).
 *
 * Inmutables vetados (defensa en profundidad sobre reglas Firestore): `id`,
 * `tenantId`, `centroId`, `creadoPor`, `creadoEn`. `codigo` editable (el
 * callable revalida unicidad por centro con excludeId).
 */
export interface ActualizarTipoTurnoPayload {
  tipoTurnoId: string;
  codigo?: string;
  nombre?: string;
  horaInicio?: string;
  horaFin?: string;
  duracionMinutos?: number;
  duracionEfectivaMinutos?: number;
  esPartido?: boolean;
  esNocturno?: boolean;
  estado?: EstadoTipoTurno;
  color?: string;
  tramosPartido?: TramoPartido[];
}

/**
 * Payload de actualizarConductor (B21, cierra TODO[conductor-campos-operativos-en-alta]).
 * `conductorId` (= id del doc /conductores, `${tenantId}_${numeroEmpleado}`)
 * siempre obligatorio; el resto opcional, pero el validator exige al menos uno
 * (assertAtLeastOneField).
 *
 * SOLO edita campos que viven EXCLUSIVAMENTE en /conductores: las preferencias
 * operativas (4 arrays de IDs), maxHorasSemanales, observaciones, puedeSerReserva
 * y el estado operativo del conductor (EstadoConductor, distinto del estado de
 * /usuarios). Esto evita drift con /usuarios y respeta D5.5 (la identidad y la
 * pertenencia no se editan aquí).
 *
 * Campos VETADOS (invalid-argument por campo):
 *   - identidad/pertenencia: id, tenantId, centroId, dni, usuarioId,
 *     numeroEmpleado, categoria, fechaAntiguedad, fechaIncorporacion, fechaBaja.
 *   - auditoría inmutable: creadoPor, creadoEn.
 *   - dual-homed con /usuarios (se editan vía actualizarUsuario, D5.4):
 *     email, telefono, nombre, apellidos (su edición aquí drift-earía el doc
 *     /usuarios y el Auth user record).
 */
export interface ActualizarConductorPayload {
  conductorId: string;
  lineasPreferentes?: string[];
  lineasSecundarias?: string[];
  tiposTurnoPermitidos?: string[];
  tiposTurnoExcluidos?: string[];
  maxHorasSemanales?: number;
  observaciones?: string;
  puedeSerReserva?: boolean;
  estado?: EstadoConductor;
}

/**
 * Payload de crearFrecuencia (B23). Entidad operativa del jefe que cuelga de una
 * Línea (lineaId, padre directo). `sentido` 'ida'|'vuelta'|'ambos' (NO 'circular').
 * `activa` opcional en CREATE (D4.2: el callable defaultea true). Las frecuencias
 * NO cruzan medianoche: `horaInicio < horaFin` (validación cruzada). Auditoría
 * canónica D6.4.
 */
export interface CrearFrecuenciaPayload {
  tenantId: string;
  centroId: string;
  lineaId: string;
  tipoDia: TipoDia;
  horaInicio: string;
  horaFin: string;
  intervaloMinutos: number;
  sentido: SentidoLinea;
  activa?: boolean;
}

/**
 * Payload de actualizarFrecuencia. `frecuenciaId` siempre; el resto opcional
 * (assertAtLeastOneField). Inmutables vetados: id, tenantId, centroId, lineaId,
 * creadoPor, creadoEn. La línea es inmutable (una frecuencia pertenece a su línea).
 */
export interface ActualizarFrecuenciaPayload {
  frecuenciaId: string;
  tipoDia?: TipoDia;
  horaInicio?: string;
  horaFin?: string;
  intervaloMinutos?: number;
  sentido?: SentidoLinea;
  activa?: boolean;
}

/**
 * Payload de crearFrecuenciaExcepcional (B23). Como Frecuencia pero con `fecha`
 * concreta (ISO string en wire → Timestamp) en vez de `tipoDia`, + `motivo?`.
 * `activa` opcional (defaultea true). Misma regla horaInicio < horaFin.
 */
export interface CrearFrecuenciaExcepcionalPayload {
  tenantId: string;
  centroId: string;
  lineaId: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  intervaloMinutos: number;
  sentido: SentidoLinea;
  motivo?: string;
  activa?: boolean;
}

/**
 * Payload de actualizarFrecuenciaExcepcional. Inmutables vetados: id, tenantId,
 * centroId, lineaId, creadoPor, creadoEn (la línea de una excepción es inmutable).
 * `fecha` SÍ editable (corregir el día del evento).
 */
export interface ActualizarFrecuenciaExcepcionalPayload {
  frecuenciaExcepcionalId: string;
  fecha?: Date;
  horaInicio?: string;
  horaFin?: string;
  intervaloMinutos?: number;
  sentido?: SentidoLinea;
  motivo?: string;
  activa?: boolean;
}

/**
 * Payload de guardarConvenio (B25). UPSERT: un solo callable, no hay crear/
 * actualizar separados, porque `id` = `centroId` es determinista (singleton por
 * centro). `tenantId` y `centroId` son requeridos (identifican y scopean el
 * doc); los 9 campos de restricciones del convenio son requeridos. Opcionales:
 * `convenioReferencia` (string no vacío) y `computoHoras` ('jornada'|'conduccion').
 *
 * Campos server-managed VETADOS en el payload (invalid-argument): id, creadoPor,
 * creadoEn, actualizadoPor, actualizadoEn. `centroId`/`tenantId` NO se vetan
 * (son inputs requeridos) pero el callable impone que el `tenantId` no cambie en
 * UPDATE (el centro pertenece permanentemente a su tenant) y que el `centroId`
 * es inmutable por construcción (= doc id).
 */
export interface GuardarConvenioPayload {
  tenantId: string;
  centroId: string;
  convenioReferencia?: string;
  descansoMinimoEntreJornadasHoras: number;
  maxHorasSemanales: number;
  maxHorasAnuales: number;
  minDomingosLibresAño: number;
  maxFinesSemanaConsecutivosTrabajados: number;
  maxDiasConsecutivosTrabajados: number;
  descansoSemanalMinimoHoras: number;
  antelacionMinimaPublicacionDias: number;
  horasFestivoComputanComoExtras: boolean;
  computoHoras?: "jornada" | "conduccion";
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

/**
 * Color HEX opcional ("#1F77B4"). Si el valor llega `undefined`/`null`, devuelve
 * `undefined`. Si está presente, exige string que matchee `COLOR_HEX_REGEX`
 * (almohadilla + 6 dígitos hex). Introducido en B16 para `Linea.color`.
 */
export function assertOptionalColorHex(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !COLOR_HEX_REGEX.test(value)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser un color HEX de 6 dígitos (ej: '#1F77B4').`,
    );
  }
  return value;
}

/**
 * Hora "HH:mm" 24h (00:00–23:59). Devuelve el string validado. Introducido en
 * B18 para TipoTurno (horaInicio/horaFin y los tramos del partido).
 */
export function assertHoraHHmm(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !HORA_HHMM_REGEX.test(value)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser una hora 'HH:mm' (00:00–23:59).`,
    );
  }
  return value;
}

/**
 * Número positivo finito REQUERIDO (> 0). Versión no-opcional de
 * `assertOptionalPositiveNumber`. Introducido en B18 para las duraciones de
 * TipoTurno (requeridas en CREATE).
 */
export function assertPositiveNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser un número positivo finito.`,
    );
  }
  return value;
}

/**
 * Fecha ISO opcional. Si el valor llega `undefined`/`null`, devuelve `undefined`.
 * Si está presente, delega en `assertISODate` (devuelve `Date` ya validado para
 * que el callable lo pase a `Timestamp.fromDate`). Introducido en B16 para
 * `Linea.vigenciaDesde`/`vigenciaHasta`.
 */
export function assertOptionalISODate(
  value: unknown,
  fieldName: string,
): Date | undefined {
  if (value === undefined || value === null) return undefined;
  return assertISODate(value, fieldName);
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
const ESTADOS_USUARIO_PERMITIDOS = ["activo", "suspendido"] as const;
const TIPOS_LINEA_PERMITIDOS = ["urbana", "cercanias", "interurbana"] as const;
const ESTADOS_LINEA_PERMITIDOS = ["activa", "inactiva", "suspendida"] as const;
const ESTADOS_TIPO_TURNO_PERMITIDOS = ["activo", "obsoleto"] as const;
const ESTADOS_CONDUCTOR_PERMITIDOS = [
  "activo",
  "baja_temporal",
  "vacaciones",
  "baja_definitiva",
] as const;
const TIPOS_DIA_PERMITIDOS = [
  "laborable",
  "sabado",
  "domingo",
  "festivo",
] as const;
const SENTIDOS_PERMITIDOS = ["ida", "vuelta", "ambos"] as const;

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

export function validateActualizarUsuarioPayload(
  data: unknown,
): ActualizarUsuarioPayload {
  const payload = assertPayloadObject(data, "actualizarUsuario");

  // --- Vetos categorizados (mensaje específico, antes de validar) ---

  // IDENTIDAD / CLAIMS (D5.5): reservados a callables dedicados futuros.
  if ("rol" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El rol no es editable con actualizarUsuario. Usa el callable dedicado cambiarRolUsuario (futuro).",
    );
  }
  if ("tenantId" in payload || "centroId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "tenantId/centroId no son editables con actualizarUsuario. Usa el callable dedicado moverUsuario (futuro).",
    );
  }
  if ("conductorId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "conductorId es la identidad del conductor (D3.1) y no es editable.",
    );
  }

  // INMUTABLES (mensaje genérico por campo).
  if ("id" in payload) {
    throw new HttpsError("invalid-argument", "El campo 'id' no es editable.");
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
  if ("fechaCreacion" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'fechaCreacion' no es editable.",
    );
  }

  // PASSWORDS: gestionados por el flujo de cambio de contraseña.
  if ("passwordChangeRequired" in payload || "passwordCambiadaEn" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "Se gestiona vía el flujo de cambio de contraseña (marcarPasswordCambiada), no es editable aquí.",
    );
  }

  // usuarioId siempre obligatorio.
  const usuarioId = assertNonEmptyString(payload["usuarioId"], "usuarioId");

  // Al menos un campo a actualizar (excluyendo usuarioId).
  const CAMPOS_OPCIONALES_ACTUALIZAR = [
    "nombreCompleto",
    "telefono",
    "email",
    "estado",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES_ACTUALIZAR,
    "actualizarUsuario",
  );

  // Validación campo a campo.
  const result: ActualizarUsuarioPayload = { usuarioId };
  const nombreCompleto = assertOptionalNonEmptyString(
    payload["nombreCompleto"],
    "nombreCompleto",
  );
  if (nombreCompleto !== undefined) result.nombreCompleto = nombreCompleto;
  const telefono = assertOptionalNonEmptyString(
    payload["telefono"],
    "telefono",
  );
  if (telefono !== undefined) result.telefono = telefono;
  // email opcional: reutiliza assertEmail (exige no-vacío + formato) solo si
  // está presente. No existe assertOptionalEmail; se valida condicionalmente.
  if (payload["email"] !== undefined && payload["email"] !== null) {
    result.email = assertEmail(payload["email"], "email");
  }
  const estado = assertOptionalEnum(
    payload["estado"],
    ESTADOS_USUARIO_PERMITIDOS,
    "estado",
  );
  if (estado !== undefined) result.estado = estado;
  return result;
}

/**
 * Coherencia temporal de la vigencia de una Línea: si ambos extremos están
 * presentes en el payload, exige `vigenciaDesde < vigenciaHasta`. Compartido
 * entre CREATE y UPDATE. NOTA (UPDATE parcial): solo cruza los dos campos del
 * MISMO payload; si se envía un único extremo, no se contrasta contra el valor
 * almacenado (coherente con la política del módulo de no validar relaciones
 * temporales contra estado persistido).
 */
function assertVigenciaCoherente(
  desde: Date | undefined,
  hasta: Date | undefined,
): void {
  if (
    desde !== undefined &&
    hasta !== undefined &&
    desde.getTime() >= hasta.getTime()
  ) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'vigenciaDesde' debe ser anterior a 'vigenciaHasta'.",
    );
  }
}

export function validateCrearLineaPayload(data: unknown): CrearLineaPayload {
  const payload = assertPayloadObject(data, "crearLinea");
  const result: CrearLineaPayload = {
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
    codigo: assertNonEmptyString(payload["codigo"], "codigo"),
    nombre: assertNonEmptyString(payload["nombre"], "nombre"),
    tipo: assertEnum(payload["tipo"], TIPOS_LINEA_PERMITIDOS, "tipo"),
    esNocturna: assertBoolean(payload["esNocturna"], "esNocturna"),
    estado: assertEnum(payload["estado"], ESTADOS_LINEA_PERMITIDOS, "estado"),
  };
  const color = assertOptionalColorHex(payload["color"], "color");
  if (color !== undefined) result.color = color;
  // paradasIda/paradasVuelta: vacíos permitidos. Si se omiten, quedan undefined
  // aquí y el callable los defaultea a [] (D4.2, patrón crearConductor).
  const paradasIda = assertOptionalStringArray(
    payload["paradasIda"],
    "paradasIda",
  );
  if (paradasIda !== undefined) result.paradasIda = paradasIda;
  const paradasVuelta = assertOptionalStringArray(
    payload["paradasVuelta"],
    "paradasVuelta",
  );
  if (paradasVuelta !== undefined) result.paradasVuelta = paradasVuelta;
  const vigenciaDesde = assertOptionalISODate(
    payload["vigenciaDesde"],
    "vigenciaDesde",
  );
  if (vigenciaDesde !== undefined) result.vigenciaDesde = vigenciaDesde;
  const vigenciaHasta = assertOptionalISODate(
    payload["vigenciaHasta"],
    "vigenciaHasta",
  );
  if (vigenciaHasta !== undefined) result.vigenciaHasta = vigenciaHasta;
  assertVigenciaCoherente(vigenciaDesde, vigenciaHasta);
  const observaciones = assertOptionalNonEmptyString(
    payload["observaciones"],
    "observaciones",
  );
  if (observaciones !== undefined) result.observaciones = observaciones;
  return result;
}

export function validateActualizarLineaPayload(
  data: unknown,
): ActualizarLineaPayload {
  const payload = assertPayloadObject(data, "actualizarLinea");

  // Veto explícito de inmutables (defensa en profundidad sobre reglas
  // Firestore). Mensajes específicos.
  if ("id" in payload) {
    throw new HttpsError("invalid-argument", "El campo 'id' no es editable.");
  }
  if ("tenantId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El tenantId no es editable. Una línea pertenece permanentemente al tenant donde se creó.",
    );
  }
  if ("centroId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El centroId no es editable. Una línea pertenece permanentemente al centro donde se creó.",
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

  // lineaId siempre obligatorio.
  const lineaId = assertNonEmptyString(payload["lineaId"], "lineaId");

  // Al menos un campo a actualizar (excluyendo lineaId).
  const CAMPOS_OPCIONALES_ACTUALIZAR = [
    "codigo",
    "nombre",
    "tipo",
    "esNocturna",
    "estado",
    "color",
    "paradasIda",
    "paradasVuelta",
    "vigenciaDesde",
    "vigenciaHasta",
    "observaciones",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES_ACTUALIZAR,
    "actualizarLinea",
  );

  // Validación campo a campo.
  const result: ActualizarLineaPayload = { lineaId };
  const codigo = assertOptionalNonEmptyString(payload["codigo"], "codigo");
  if (codigo !== undefined) result.codigo = codigo;
  const nombre = assertOptionalNonEmptyString(payload["nombre"], "nombre");
  if (nombre !== undefined) result.nombre = nombre;
  const tipo = assertOptionalEnum(
    payload["tipo"],
    TIPOS_LINEA_PERMITIDOS,
    "tipo",
  );
  if (tipo !== undefined) result.tipo = tipo;
  const esNocturna = assertOptionalBoolean(payload["esNocturna"], "esNocturna");
  if (esNocturna !== undefined) result.esNocturna = esNocturna;
  const estado = assertOptionalEnum(
    payload["estado"],
    ESTADOS_LINEA_PERMITIDOS,
    "estado",
  );
  if (estado !== undefined) result.estado = estado;
  const color = assertOptionalColorHex(payload["color"], "color");
  if (color !== undefined) result.color = color;
  const paradasIda = assertOptionalStringArray(
    payload["paradasIda"],
    "paradasIda",
  );
  if (paradasIda !== undefined) result.paradasIda = paradasIda;
  const paradasVuelta = assertOptionalStringArray(
    payload["paradasVuelta"],
    "paradasVuelta",
  );
  if (paradasVuelta !== undefined) result.paradasVuelta = paradasVuelta;
  const vigenciaDesde = assertOptionalISODate(
    payload["vigenciaDesde"],
    "vigenciaDesde",
  );
  if (vigenciaDesde !== undefined) result.vigenciaDesde = vigenciaDesde;
  const vigenciaHasta = assertOptionalISODate(
    payload["vigenciaHasta"],
    "vigenciaHasta",
  );
  if (vigenciaHasta !== undefined) result.vigenciaHasta = vigenciaHasta;
  assertVigenciaCoherente(vigenciaDesde, vigenciaHasta);
  const observaciones = assertOptionalNonEmptyString(
    payload["observaciones"],
    "observaciones",
  );
  if (observaciones !== undefined) result.observaciones = observaciones;
  return result;
}

// ---------------------------------------------------------------------------
//  TipoTurno (B18)
// ---------------------------------------------------------------------------

function toMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Valida los tramos de un turno partido: array no vacío de `{inicio, fin}` en
 * "HH:mm", cada tramo con `inicio < fin`. Si se conocen `horaInicio`/`horaFin`
 * del turno Y el turno NO cruza medianoche, exige además que cada tramo caiga
 * dentro de `[horaInicio, horaFin]`.
 *
 * TODO[tramos-partido-dentro-de-rango]: el chequeo de rango se omite cuando el
 * turno cruza medianoche (`horaFin <= horaInicio`) o cuando no se conocen ambos
 * extremos (UPDATE parcial sin ambas horas en el payload). En esos casos solo
 * se valida formato + orden interno de cada tramo. Completar el caso medianoche
 * cuando surja un turno partido que cruce las 00:00.
 */
function assertTramosPartido(
  value: unknown,
  fieldName: string,
  horaInicio?: string,
  horaFin?: string,
): TramoPartido[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' es requerido y no puede estar vacío cuando el turno es partido.`,
    );
  }
  const rango =
    horaInicio !== undefined &&
    horaFin !== undefined &&
    toMinutos(horaFin) > toMinutos(horaInicio)
      ? { ini: toMinutos(horaInicio), fin: toMinutos(horaFin) }
      : null;
  return value.map((t: unknown, i: number) => {
    const obj = assertPayloadObject(t, `${fieldName}[${i}]`);
    const inicio = assertHoraHHmm(obj["inicio"], `${fieldName}[${i}].inicio`);
    const fin = assertHoraHHmm(obj["fin"], `${fieldName}[${i}].fin`);
    const ti = toMinutos(inicio);
    const tf = toMinutos(fin);
    if (ti >= tf) {
      throw new HttpsError(
        "invalid-argument",
        `El tramo '${fieldName}[${i}]' debe tener 'inicio' anterior a 'fin'.`,
      );
    }
    if (rango !== null && (ti < rango.ini || tf > rango.fin)) {
      throw new HttpsError(
        "invalid-argument",
        `El tramo '${fieldName}[${i}]' debe estar dentro del rango del turno (${horaInicio}–${horaFin}).`,
      );
    }
    return { inicio, fin };
  });
}

export function validateCrearTipoTurnoPayload(
  data: unknown,
): CrearTipoTurnoPayload {
  const payload = assertPayloadObject(data, "crearTipoTurno");

  const horaInicio = assertHoraHHmm(payload["horaInicio"], "horaInicio");
  const horaFin = assertHoraHHmm(payload["horaFin"], "horaFin");
  const duracionMinutos = assertPositiveNumber(
    payload["duracionMinutos"],
    "duracionMinutos",
  );
  const duracionEfectivaMinutos = assertPositiveNumber(
    payload["duracionEfectivaMinutos"],
    "duracionEfectivaMinutos",
  );
  if (duracionEfectivaMinutos > duracionMinutos) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'duracionEfectivaMinutos' no puede superar 'duracionMinutos'.",
    );
  }
  const esPartido = assertBoolean(payload["esPartido"], "esPartido");

  const result: CrearTipoTurnoPayload = {
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
    codigo: assertNonEmptyString(payload["codigo"], "codigo"),
    nombre: assertNonEmptyString(payload["nombre"], "nombre"),
    horaInicio,
    horaFin,
    duracionMinutos,
    duracionEfectivaMinutos,
    esPartido,
    esNocturno: assertBoolean(payload["esNocturno"], "esNocturno"),
    estado: assertEnum(
      payload["estado"],
      ESTADOS_TIPO_TURNO_PERMITIDOS,
      "estado",
    ),
  };
  const color = assertOptionalColorHex(payload["color"], "color");
  if (color !== undefined) result.color = color;

  // Validación cruzada esPartido ↔ tramosPartido.
  if (esPartido) {
    result.tramosPartido = assertTramosPartido(
      payload["tramosPartido"],
      "tramosPartido",
      horaInicio,
      horaFin,
    );
  } else if (payload["tramosPartido"] !== undefined) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'tramosPartido' solo se permite cuando 'esPartido' es true.",
    );
  }
  return result;
}

export function validateActualizarTipoTurnoPayload(
  data: unknown,
): ActualizarTipoTurnoPayload {
  const payload = assertPayloadObject(data, "actualizarTipoTurno");

  // Veto de inmutables (defensa en profundidad sobre reglas Firestore).
  if ("id" in payload) {
    throw new HttpsError("invalid-argument", "El campo 'id' no es editable.");
  }
  if ("tenantId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El tenantId no es editable. Un tipo de turno pertenece permanentemente al tenant donde se creó.",
    );
  }
  if ("centroId" in payload) {
    throw new HttpsError(
      "invalid-argument",
      "El centroId no es editable. Un tipo de turno pertenece permanentemente al centro donde se creó.",
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

  const tipoTurnoId = assertNonEmptyString(
    payload["tipoTurnoId"],
    "tipoTurnoId",
  );

  const CAMPOS_OPCIONALES_ACTUALIZAR = [
    "codigo",
    "nombre",
    "horaInicio",
    "horaFin",
    "duracionMinutos",
    "duracionEfectivaMinutos",
    "esPartido",
    "esNocturno",
    "estado",
    "color",
    "tramosPartido",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES_ACTUALIZAR,
    "actualizarTipoTurno",
  );

  const result: ActualizarTipoTurnoPayload = { tipoTurnoId };

  const codigo = assertOptionalNonEmptyString(payload["codigo"], "codigo");
  if (codigo !== undefined) result.codigo = codigo;
  const nombre = assertOptionalNonEmptyString(payload["nombre"], "nombre");
  if (nombre !== undefined) result.nombre = nombre;

  let horaInicio: string | undefined;
  if (payload["horaInicio"] !== undefined) {
    horaInicio = assertHoraHHmm(payload["horaInicio"], "horaInicio");
    result.horaInicio = horaInicio;
  }
  let horaFin: string | undefined;
  if (payload["horaFin"] !== undefined) {
    horaFin = assertHoraHHmm(payload["horaFin"], "horaFin");
    result.horaFin = horaFin;
  }

  let durTotal: number | undefined;
  if (payload["duracionMinutos"] !== undefined) {
    durTotal = assertPositiveNumber(
      payload["duracionMinutos"],
      "duracionMinutos",
    );
    result.duracionMinutos = durTotal;
  }
  let durEfectiva: number | undefined;
  if (payload["duracionEfectivaMinutos"] !== undefined) {
    durEfectiva = assertPositiveNumber(
      payload["duracionEfectivaMinutos"],
      "duracionEfectivaMinutos",
    );
    result.duracionEfectivaMinutos = durEfectiva;
  }
  if (
    durTotal !== undefined &&
    durEfectiva !== undefined &&
    durEfectiva > durTotal
  ) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'duracionEfectivaMinutos' no puede superar 'duracionMinutos'.",
    );
  }

  const esPartido = assertOptionalBoolean(payload["esPartido"], "esPartido");
  if (esPartido !== undefined) result.esPartido = esPartido;
  const esNocturno = assertOptionalBoolean(payload["esNocturno"], "esNocturno");
  if (esNocturno !== undefined) result.esNocturno = esNocturno;
  const estado = assertOptionalEnum(
    payload["estado"],
    ESTADOS_TIPO_TURNO_PERMITIDOS,
    "estado",
  );
  if (estado !== undefined) result.estado = estado;
  const colorTT = assertOptionalColorHex(payload["color"], "color");
  if (colorTT !== undefined) result.color = colorTT;

  // Validación cruzada esPartido ↔ tramosPartido del MISMO payload (no se
  // contrasta contra el doc almacenado, coherente con la política del módulo).
  if (payload["tramosPartido"] !== undefined) {
    if (esPartido === false) {
      throw new HttpsError(
        "invalid-argument",
        "El campo 'tramosPartido' no se permite cuando 'esPartido' es false.",
      );
    }
    result.tramosPartido = assertTramosPartido(
      payload["tramosPartido"],
      "tramosPartido",
      horaInicio,
      horaFin,
    );
  } else if (esPartido === true) {
    throw new HttpsError(
      "invalid-argument",
      "Si 'esPartido' pasa a true debes enviar 'tramosPartido' (no vacío).",
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
//  Conductor (B21) — actualizarConductor
// ---------------------------------------------------------------------------

export function validateActualizarConductorPayload(
  data: unknown,
): ActualizarConductorPayload {
  const payload = assertPayloadObject(data, "actualizarConductor");

  // --- Vetos categorizados (mensaje específico, antes de validar) ---

  // IDENTIDAD / PERTENENCIA: no se editan aquí (D5.5). El conductor pertenece
  // permanentemente a su tenant+centro; su identidad (dni/numeroEmpleado) y sus
  // datos contractuales (categoria/fechas) son inmutables por este callable.
  const VETO_IDENTIDAD: Record<string, string> = {
    id: "El campo 'id' no es editable.",
    tenantId:
      "El tenantId no es editable. Un conductor pertenece permanentemente a su tenant.",
    centroId:
      "El centroId no es editable. Un conductor pertenece permanentemente a su centro.",
    dni: "El DNI no es editable (identidad del conductor).",
    usuarioId: "El usuarioId no es editable (enlace al doc /usuarios).",
    numeroEmpleado:
      "El número de empleado no es editable (forma parte del id del conductor).",
    categoria: "La categoría no es editable.",
    fechaAntiguedad: "La fecha de antigüedad no es editable.",
    fechaIncorporacion: "La fecha de incorporación no es editable.",
    fechaBaja:
      "La fecha de baja no se edita directamente; deriva del estado del conductor.",
    creadoPor: "El campo 'creadoPor' no es editable.",
    creadoEn: "El campo 'creadoEn' no es editable.",
  };
  for (const campo of Object.keys(VETO_IDENTIDAD)) {
    if (campo in payload) {
      throw new HttpsError("invalid-argument", VETO_IDENTIDAD[campo]!);
    }
  }

  // DUAL-HOMED con /usuarios (D5.4): email/telefono/nombre/apellidos viven
  // también en el doc /usuarios (y email en el Auth user record). Editarlos
  // aquí provocaría drift. Se canalizan por actualizarUsuario.
  for (const campo of ["email", "telefono", "nombre", "apellidos"]) {
    if (campo in payload) {
      throw new HttpsError(
        "invalid-argument",
        `El campo '${campo}' no se edita con actualizarConductor (vive también en /usuarios). Usa actualizarUsuario.`,
      );
    }
  }

  // conductorId siempre obligatorio (selector del doc /conductores).
  const conductorId = assertNonEmptyString(
    payload["conductorId"],
    "conductorId",
  );

  // Al menos un campo a actualizar (excluyendo conductorId).
  const CAMPOS_OPCIONALES_ACTUALIZAR = [
    "lineasPreferentes",
    "lineasSecundarias",
    "tiposTurnoPermitidos",
    "tiposTurnoExcluidos",
    "maxHorasSemanales",
    "observaciones",
    "puedeSerReserva",
    "estado",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES_ACTUALIZAR,
    "actualizarConductor",
  );

  // Validación campo a campo (reusa validators de B13).
  const result: ActualizarConductorPayload = { conductorId };
  const lineasPreferentes = assertOptionalStringArray(
    payload["lineasPreferentes"],
    "lineasPreferentes",
  );
  if (lineasPreferentes !== undefined)
    result.lineasPreferentes = lineasPreferentes;
  const lineasSecundarias = assertOptionalStringArray(
    payload["lineasSecundarias"],
    "lineasSecundarias",
  );
  if (lineasSecundarias !== undefined)
    result.lineasSecundarias = lineasSecundarias;
  const tiposTurnoPermitidos = assertOptionalStringArray(
    payload["tiposTurnoPermitidos"],
    "tiposTurnoPermitidos",
  );
  if (tiposTurnoPermitidos !== undefined)
    result.tiposTurnoPermitidos = tiposTurnoPermitidos;
  const tiposTurnoExcluidos = assertOptionalStringArray(
    payload["tiposTurnoExcluidos"],
    "tiposTurnoExcluidos",
  );
  if (tiposTurnoExcluidos !== undefined)
    result.tiposTurnoExcluidos = tiposTurnoExcluidos;
  const maxHorasSemanales = assertOptionalPositiveNumber(
    payload["maxHorasSemanales"],
    "maxHorasSemanales",
  );
  if (maxHorasSemanales !== undefined)
    result.maxHorasSemanales = maxHorasSemanales;
  const observaciones = assertOptionalNonEmptyString(
    payload["observaciones"],
    "observaciones",
  );
  if (observaciones !== undefined) result.observaciones = observaciones;
  const puedeSerReserva = assertOptionalBoolean(
    payload["puedeSerReserva"],
    "puedeSerReserva",
  );
  if (puedeSerReserva !== undefined) result.puedeSerReserva = puedeSerReserva;
  const estado = assertOptionalEnum(
    payload["estado"],
    ESTADOS_CONDUCTOR_PERMITIDOS,
    "estado",
  );
  if (estado !== undefined) result.estado = estado;
  return result;
}

// ---------------------------------------------------------------------------
//  Frecuencia + FrecuenciaExcepcional (B23)
// ---------------------------------------------------------------------------

/**
 * Las frecuencias NO cruzan medianoche: un tramo es una franja del MISMO día,
 * `horaInicio < horaFin` (a diferencia de TipoTurno, donde horaFin < horaInicio
 * señala cruce de medianoche). Una línea nocturna que opera de madrugada se
 * modela como una frecuencia con horas de madrugada (p.ej. 00:30–05:00), todas
 * dentro del mismo día. TODO[frecuencia-cruce-medianoche]: si surge un servicio
 * real que cruza las 00:00 (p.ej. 23:30–01:00), habrá que partirlo en dos
 * frecuencias o introducir un flag de cruce como en TipoTurno.
 */
export function assertHoraInicioAntesFin(inicio: string, fin: string): void {
  if (toMinutos(inicio) >= toMinutos(fin)) {
    throw new HttpsError(
      "invalid-argument",
      "El campo 'horaInicio' debe ser anterior a 'horaFin' (las frecuencias no cruzan medianoche).",
    );
  }
}

export function validateCrearFrecuenciaPayload(
  data: unknown,
): CrearFrecuenciaPayload {
  const payload = assertPayloadObject(data, "crearFrecuencia");
  const horaInicio = assertHoraHHmm(payload["horaInicio"], "horaInicio");
  const horaFin = assertHoraHHmm(payload["horaFin"], "horaFin");
  assertHoraInicioAntesFin(horaInicio, horaFin);
  const result: CrearFrecuenciaPayload = {
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
    lineaId: assertNonEmptyString(payload["lineaId"], "lineaId"),
    tipoDia: assertEnum(payload["tipoDia"], TIPOS_DIA_PERMITIDOS, "tipoDia"),
    horaInicio,
    horaFin,
    intervaloMinutos: assertPositiveNumber(
      payload["intervaloMinutos"],
      "intervaloMinutos",
    ),
    sentido: assertEnum(payload["sentido"], SENTIDOS_PERMITIDOS, "sentido"),
  };
  const activa = assertOptionalBoolean(payload["activa"], "activa");
  if (activa !== undefined) result.activa = activa;
  return result;
}

const CAMPOS_INMUTABLES_FRECUENCIA = [
  "id",
  "tenantId",
  "centroId",
  "lineaId",
  "creadoPor",
  "creadoEn",
] as const;

function vetarInmutablesFrecuencia(
  payload: Record<string, unknown>,
  campoLineaMsg: string,
): void {
  for (const campo of CAMPOS_INMUTABLES_FRECUENCIA) {
    if (campo in payload) {
      const msg =
        campo === "lineaId"
          ? campoLineaMsg
          : campo === "tenantId"
            ? "El tenantId no es editable."
            : campo === "centroId"
              ? "El centroId no es editable."
              : `El campo '${campo}' no es editable.`;
      throw new HttpsError("invalid-argument", msg);
    }
  }
}

export function validateActualizarFrecuenciaPayload(
  data: unknown,
): ActualizarFrecuenciaPayload {
  const payload = assertPayloadObject(data, "actualizarFrecuencia");
  vetarInmutablesFrecuencia(
    payload,
    "La línea no es editable. Una frecuencia pertenece permanentemente a su línea.",
  );

  const frecuenciaId = assertNonEmptyString(
    payload["frecuenciaId"],
    "frecuenciaId",
  );

  const CAMPOS_OPCIONALES = [
    "tipoDia",
    "horaInicio",
    "horaFin",
    "intervaloMinutos",
    "sentido",
    "activa",
  ] as const;
  assertAtLeastOneField(payload, CAMPOS_OPCIONALES, "actualizarFrecuencia");

  const result: ActualizarFrecuenciaPayload = { frecuenciaId };
  const tipoDia = assertOptionalEnum(
    payload["tipoDia"],
    TIPOS_DIA_PERMITIDOS,
    "tipoDia",
  );
  if (tipoDia !== undefined) result.tipoDia = tipoDia;
  if (payload["horaInicio"] !== undefined) {
    result.horaInicio = assertHoraHHmm(payload["horaInicio"], "horaInicio");
  }
  if (payload["horaFin"] !== undefined) {
    result.horaFin = assertHoraHHmm(payload["horaFin"], "horaFin");
  }
  // El orden horaInicio<horaFin se valida en el callable con los valores
  // EFECTIVOS (payload ?? doc), porque un update parcial puede traer solo uno.
  const intervaloMinutos = assertOptionalPositiveNumber(
    payload["intervaloMinutos"],
    "intervaloMinutos",
  );
  if (intervaloMinutos !== undefined)
    result.intervaloMinutos = intervaloMinutos;
  const sentido = assertOptionalEnum(
    payload["sentido"],
    SENTIDOS_PERMITIDOS,
    "sentido",
  );
  if (sentido !== undefined) result.sentido = sentido;
  const activa = assertOptionalBoolean(payload["activa"], "activa");
  if (activa !== undefined) result.activa = activa;
  return result;
}

export function validateCrearFrecuenciaExcepcionalPayload(
  data: unknown,
): CrearFrecuenciaExcepcionalPayload {
  const payload = assertPayloadObject(data, "crearFrecuenciaExcepcional");
  const horaInicio = assertHoraHHmm(payload["horaInicio"], "horaInicio");
  const horaFin = assertHoraHHmm(payload["horaFin"], "horaFin");
  assertHoraInicioAntesFin(horaInicio, horaFin);
  const result: CrearFrecuenciaExcepcionalPayload = {
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
    lineaId: assertNonEmptyString(payload["lineaId"], "lineaId"),
    fecha: assertISODate(payload["fecha"], "fecha"),
    horaInicio,
    horaFin,
    intervaloMinutos: assertPositiveNumber(
      payload["intervaloMinutos"],
      "intervaloMinutos",
    ),
    sentido: assertEnum(payload["sentido"], SENTIDOS_PERMITIDOS, "sentido"),
  };
  const motivo = assertOptionalNonEmptyString(payload["motivo"], "motivo");
  if (motivo !== undefined) result.motivo = motivo;
  const activa = assertOptionalBoolean(payload["activa"], "activa");
  if (activa !== undefined) result.activa = activa;
  return result;
}

export function validateActualizarFrecuenciaExcepcionalPayload(
  data: unknown,
): ActualizarFrecuenciaExcepcionalPayload {
  const payload = assertPayloadObject(data, "actualizarFrecuenciaExcepcional");
  vetarInmutablesFrecuencia(
    payload,
    "La línea no es editable. Una frecuencia excepcional pertenece permanentemente a su línea.",
  );

  const frecuenciaExcepcionalId = assertNonEmptyString(
    payload["frecuenciaExcepcionalId"],
    "frecuenciaExcepcionalId",
  );

  const CAMPOS_OPCIONALES = [
    "fecha",
    "horaInicio",
    "horaFin",
    "intervaloMinutos",
    "sentido",
    "motivo",
    "activa",
  ] as const;
  assertAtLeastOneField(
    payload,
    CAMPOS_OPCIONALES,
    "actualizarFrecuenciaExcepcional",
  );

  const result: ActualizarFrecuenciaExcepcionalPayload = {
    frecuenciaExcepcionalId,
  };
  const fecha = assertOptionalISODate(payload["fecha"], "fecha");
  if (fecha !== undefined) result.fecha = fecha;
  if (payload["horaInicio"] !== undefined) {
    result.horaInicio = assertHoraHHmm(payload["horaInicio"], "horaInicio");
  }
  if (payload["horaFin"] !== undefined) {
    result.horaFin = assertHoraHHmm(payload["horaFin"], "horaFin");
  }
  const intervaloMinutos = assertOptionalPositiveNumber(
    payload["intervaloMinutos"],
    "intervaloMinutos",
  );
  if (intervaloMinutos !== undefined)
    result.intervaloMinutos = intervaloMinutos;
  const sentido = assertOptionalEnum(
    payload["sentido"],
    SENTIDOS_PERMITIDOS,
    "sentido",
  );
  if (sentido !== undefined) result.sentido = sentido;
  const motivo = assertOptionalNonEmptyString(payload["motivo"], "motivo");
  if (motivo !== undefined) result.motivo = motivo;
  const activa = assertOptionalBoolean(payload["activa"], "activa");
  if (activa !== undefined) result.activa = activa;
  return result;
}

// ============================================================================
//  CONVENIO (B25) — upsert singleton por centro
// ============================================================================

/**
 * Número finito dentro de un rango de sanidad. `exclusiveMin` para límites que
 * deben ser estrictamente positivos (ej. horas semanales > 0); `integer` para
 * conteos de días/domingos/fines de semana. Sanidad básica del convenio (no
 * clínicamente estricta): rechaza negativos, no-finitos y valores absurdos.
 */
function assertNumeroLimite(
  value: unknown,
  fieldName: string,
  opts: { min: number; max: number; integer?: boolean; exclusiveMin?: boolean },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' es requerido y debe ser un número finito.`,
    );
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe ser un número entero.`,
    );
  }
  const bajoMin = opts.exclusiveMin ? value <= opts.min : value < opts.min;
  if (bajoMin || value > opts.max) {
    const lim = opts.exclusiveMin
      ? `> ${opts.min} y <= ${opts.max}`
      : `entre ${opts.min} y ${opts.max}`;
    throw new HttpsError(
      "invalid-argument",
      `El campo '${fieldName}' debe estar ${lim}.`,
    );
  }
  return value;
}

/**
 * Valida el payload de guardarConvenio (B25 — UPSERT singleton por centro).
 * Veta campos server-managed; exige tenantId/centroId + los 9 límites; valida
 * rangos de sanidad. Devuelve un payload tipado.
 */
export function validateGuardarConvenioPayload(
  data: unknown,
): GuardarConvenioPayload {
  const payload = assertPayloadObject(data, "guardarConvenio");

  // Veto de campos server-managed (defensa en profundidad sobre reglas).
  for (const campo of [
    "id",
    "creadoPor",
    "creadoEn",
    "actualizadoPor",
    "actualizadoEn",
  ] as const) {
    if (campo in payload) {
      throw new HttpsError(
        "invalid-argument",
        `El campo '${campo}' no es editable.`,
      );
    }
  }

  const result: GuardarConvenioPayload = {
    tenantId: assertNonEmptyString(payload["tenantId"], "tenantId"),
    centroId: assertNonEmptyString(payload["centroId"], "centroId"),
    descansoMinimoEntreJornadasHoras: assertNumeroLimite(
      payload["descansoMinimoEntreJornadasHoras"],
      "descansoMinimoEntreJornadasHoras",
      { min: 0, max: 24, exclusiveMin: true },
    ),
    maxHorasSemanales: assertNumeroLimite(
      payload["maxHorasSemanales"],
      "maxHorasSemanales",
      { min: 0, max: 168, exclusiveMin: true },
    ),
    maxHorasAnuales: assertNumeroLimite(
      payload["maxHorasAnuales"],
      "maxHorasAnuales",
      { min: 0, max: 8784, exclusiveMin: true },
    ),
    minDomingosLibresAño: assertNumeroLimite(
      payload["minDomingosLibresAño"],
      "minDomingosLibresAño",
      { min: 0, max: 53, integer: true }, // puede ser 0
    ),
    maxFinesSemanaConsecutivosTrabajados: assertNumeroLimite(
      payload["maxFinesSemanaConsecutivosTrabajados"],
      "maxFinesSemanaConsecutivosTrabajados",
      { min: 0, max: 53, integer: true },
    ),
    maxDiasConsecutivosTrabajados: assertNumeroLimite(
      payload["maxDiasConsecutivosTrabajados"],
      "maxDiasConsecutivosTrabajados",
      { min: 1, max: 31, integer: true },
    ),
    descansoSemanalMinimoHoras: assertNumeroLimite(
      payload["descansoSemanalMinimoHoras"],
      "descansoSemanalMinimoHoras",
      { min: 0, max: 168, exclusiveMin: true },
    ),
    antelacionMinimaPublicacionDias: assertNumeroLimite(
      payload["antelacionMinimaPublicacionDias"],
      "antelacionMinimaPublicacionDias",
      { min: 0, max: 365, integer: true },
    ),
    horasFestivoComputanComoExtras: assertBoolean(
      payload["horasFestivoComputanComoExtras"],
      "horasFestivoComputanComoExtras",
    ),
  };

  const convenioReferencia = assertOptionalNonEmptyString(
    payload["convenioReferencia"],
    "convenioReferencia",
  );
  if (convenioReferencia !== undefined)
    result.convenioReferencia = convenioReferencia;

  const computoHoras = assertOptionalEnum(
    payload["computoHoras"],
    ["jornada", "conduccion"] as const,
    "computoHoras",
  );
  if (computoHoras !== undefined) result.computoHoras = computoHoras;

  return result;
}

