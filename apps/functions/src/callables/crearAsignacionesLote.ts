import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearAsignacionesLotePayload } from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";
import { escribirAsignacionesLote } from "../logic/asignaciones";

/**
 * Callable crearAsignacionesLote (B26; refactor B28). Escribe en LOTE las
 * asignaciones que el optimizador volcará de golpe. Mismo contrato que crearAsignacion
 * pero N a la vez, todas del MISMO cuadrante.
 *
 * B28: la lógica de escritura se extrajo a `escribirAsignacionesLote` (logic/
 * asignaciones.ts), reutilizable por el orquestador del optimizador sin pasar por
 * `request.auth`. El callable mantiene aquí la AUTH + anti-cross (que dependen del
 * token) y delega la escritura. Comportamiento del callable sin cambios (mismo
 * payload, misma validación, misma salida).
 *
 *   - Solo si el cuadrante está en 'borrador' (assertCuadranteEditable, dentro de
 *     escribirAsignacionesLote; aquí se llama también para el anti-cross del jefe).
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 *   - tenantId/centroId DERIVADOS del cuadrante. 'libre' rechazado por el validator.
 */
export const crearAsignacionesLote = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearAsignacionesLotePayload(request.data);
  const db = getFirestore();

  // Anti-cross del jefe: necesita los tenant/centro del cuadrante (el doc se
  // re-lee dentro de escribirAsignacionesLote, lectura barata sobre el padre).
  const cuadrante = await assertCuadranteEditable(db, payload.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  logger.info("Creando asignaciones en lote", {
    cuadranteId: payload.cuadranteId,
    total: payload.asignaciones.length,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  let resultado: { creadas: number; asignacionIds: string[] };
  try {
    resultado = await escribirAsignacionesLote(db, {
      cuadranteId: payload.cuadranteId,
      asignaciones: payload.asignaciones,
      actorId: invocadorUid,
    });
  } catch (err) {
    // Re-lanza los HttpsError de validación de dominio (fecha-en-mes, etc.).
    if (err instanceof HttpsError) throw err;
    logger.error("Error inesperado al crear asignaciones en lote", {
      err,
      cuadranteId: payload.cuadranteId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al crear las asignaciones en lote.",
    );
  }

  logger.info("Asignaciones en lote creadas", {
    cuadranteId: payload.cuadranteId,
    total: resultado.creadas,
  });

  return {
    ok: true as const,
    creadas: resultado.creadas,
    asignacionIds: resultado.asignacionIds,
  };
});
