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

export { crearJefeTrafico } from "./callables/crearJefeTrafico";
export { crearConductor } from "./callables/crearConductor";
export { actualizarConductor } from "./callables/actualizarConductor";
export { marcarPasswordCambiada } from "./callables/marcarPasswordCambiada";
export { crearTenant } from "./callables/crearTenant";
export { actualizarTenant } from "./callables/actualizarTenant";
export { crearCentro } from "./callables/crearCentro";
export { actualizarCentro } from "./callables/actualizarCentro";
export { actualizarUsuario } from "./callables/actualizarUsuario";
export { crearLinea } from "./callables/crearLinea";
export { actualizarLinea } from "./callables/actualizarLinea";
export { crearTipoTurno } from "./callables/crearTipoTurno";
export { actualizarTipoTurno } from "./callables/actualizarTipoTurno";
export { crearFrecuencia } from "./callables/crearFrecuencia";
export { actualizarFrecuencia } from "./callables/actualizarFrecuencia";
export { crearFrecuenciaExcepcional } from "./callables/crearFrecuenciaExcepcional";
export { actualizarFrecuenciaExcepcional } from "./callables/actualizarFrecuenciaExcepcional";
export { guardarConvenio } from "./callables/guardarConvenio";
