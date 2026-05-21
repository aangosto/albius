import { initializeApp } from "firebase-admin/app";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

/**
 * Callable mínimo de scaffold.
 *
 * Verifica end-to-end que:
 *  - El SDK Admin se inicializa correctamente.
 *  - El emulator carga la función.
 *  - El flujo callable-con-auth funciona (rechaza llamadas anónimas).
 *  - Los custom claims del token llegan al backend (devuelve `rol`).
 *
 * Sin lógica de negocio. Eliminar o sustituir al añadir el primer callable real.
 */
export const ping = onCall((request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Se requiere autenticación.");
  }

  const claims = request.auth.token as Record<string, unknown>;
  const rol = typeof claims["rol"] === "string" ? (claims["rol"] as string) : null;

  return {
    ok: true,
    uid: request.auth.uid,
    rol,
    timestamp: new Date().toISOString(),
  };
});
