import { type CallableRequest, HttpsError } from "firebase-functions/v2/https";
import type { Rol } from "@albius/shared";

/**
 * Helpers de autenticación y rol para callables.
 *
 * Validan que la llamada está autenticada y que el invocador tiene el rol
 * adecuado antes de que el callable ejecute lógica de negocio. Centralizan
 * los códigos de error formales de Firebase Callables:
 *   - 'unauthenticated'      → sin token.
 *   - 'permission-denied'    → rol incorrecto o claim `rol` corrupto.
 *   - 'failed-precondition'  → rol correcto pero claims accesorios ausentes
 *                              (alta del usuario incompleta).
 *
 * D6 reserva 'invalid-argument' para validación de payload (ver validation.ts).
 */

const ROLES_VALIDOS: ReadonlySet<string> = new Set<Rol>([
  "super_admin",
  "jefe_trafico",
  "conductor",
]);

export interface Claims {
  rol: Rol;
  tenantId?: string;
  centroId?: string;
}

/**
 * Versión "afilada" de CallableRequest tras pasar assertAuth: `auth` deja de
 * ser nullable. Permite acceder a `request.auth.uid` sin `!` ni narrowing extra.
 */
export type AuthenticatedRequest<T> = CallableRequest<T> & {
  auth: NonNullable<CallableRequest<T>["auth"]>;
};

/**
 * TS assertion function. Lanza 'unauthenticated' si no hay token. Tras llamarla,
 * el compilador sabe que `request.auth` ya no es undefined.
 */
export function assertAuth<T>(
  request: CallableRequest<T>,
): asserts request is AuthenticatedRequest<T> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Se requiere autenticación.");
  }
}

function isRolValido(value: unknown): value is Rol {
  return typeof value === "string" && ROLES_VALIDOS.has(value);
}

/**
 * Lee y valida los custom claims del token. Lanza 'permission-denied' si el
 * claim `rol` está ausente o no es uno de los tres valores del union `Rol`.
 */
export function extractClaims(request: AuthenticatedRequest<unknown>): Claims {
  const token = request.auth.token as Record<string, unknown>;
  const rolRaw = token["rol"];
  if (!isRolValido(rolRaw)) {
    throw new HttpsError(
      "permission-denied",
      "El token no contiene un rol válido.",
    );
  }
  const tenantIdRaw = token["tenantId"];
  const centroIdRaw = token["centroId"];
  return {
    rol: rolRaw,
    tenantId: typeof tenantIdRaw === "string" ? tenantIdRaw : undefined,
    centroId: typeof centroIdRaw === "string" ? centroIdRaw : undefined,
  };
}

/**
 * Combina assertAuth + extractClaims + exige rol = 'super_admin'.
 * Devuelve uid y claims del invocador.
 */
export function assertSuperAdmin<T>(
  request: CallableRequest<T>,
): { uid: string; claims: Claims } {
  assertAuth(request);
  const claims = extractClaims(request);
  if (claims.rol !== "super_admin") {
    throw new HttpsError(
      "permission-denied",
      "Esta operación requiere rol super_admin.",
    );
  }
  return { uid: request.auth.uid, claims };
}

/**
 * Exige rol = 'jefe_trafico' Y la presencia de tenantId y centroId en claims
 * (necesarios para toda operación de un jefe). Si faltan claims accesorios,
 * lanza 'failed-precondition' — no es un problema de permisos, es un alta
 * incompleta que requiere intervención del super_admin.
 */
export function assertJefeTrafico<T>(
  request: CallableRequest<T>,
): { uid: string; claims: Claims & { tenantId: string; centroId: string } } {
  assertAuth(request);
  const claims = extractClaims(request);
  if (claims.rol !== "jefe_trafico") {
    throw new HttpsError(
      "permission-denied",
      "Esta operación requiere rol jefe_trafico.",
    );
  }
  if (claims.tenantId === undefined || claims.centroId === undefined) {
    throw new HttpsError(
      "failed-precondition",
      "El token de jefe_trafico no contiene tenantId/centroId. Contacta con administración.",
    );
  }
  return {
    uid: request.auth.uid,
    claims: {
      rol: claims.rol,
      tenantId: claims.tenantId,
      centroId: claims.centroId,
    },
  };
}

/**
 * Atajo para callables que aceptan ambos roles (ej. crearConductor según D5/DUDA-5).
 * No exige tenantId/centroId en claims — el callable decide qué hacer según el rol
 * que llega (super_admin no tiene esos claims por diseño).
 */
export function assertSuperAdminOrJefeTrafico<T>(
  request: CallableRequest<T>,
): { uid: string; claims: Claims } {
  assertAuth(request);
  const claims = extractClaims(request);
  if (claims.rol !== "super_admin" && claims.rol !== "jefe_trafico") {
    throw new HttpsError(
      "permission-denied",
      "Esta operación requiere rol super_admin o jefe_trafico.",
    );
  }
  return { uid: request.auth.uid, claims };
}
