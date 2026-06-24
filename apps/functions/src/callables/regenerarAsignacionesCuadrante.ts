import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearAsignacionesLotePayload } from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";
import { regenerarAsignaciones } from "../logic/asignaciones";

/**
 * Callable regenerarAsignacionesCuadrante (B28). LIMPIA todas las asignaciones del
 * cuadrante (borrador) y VUELCA las nuevas, en una invocación. Mismo payload que
 * crearAsignacionesLote (`{ cuadranteId, asignaciones }`).
 *
 * Expuesto como callable porque: (a) permite test directo de la unidad
 * limpiar+volcar; (b) regeneración manual por el jefe; (c) el orquestador del
 * optimizador (B29) puede llamar la función interna `regenerarAsignaciones` o este
 * callable. NO es atómico (ver doc de la función).
 *
 *   - Solo si el cuadrante está en 'borrador'. Auth super_admin/jefe + anti-cross.
 */
export const regenerarAsignacionesCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearAsignacionesLotePayload(request.data);
  const db = getFirestore();

  const cuadrante = await assertCuadranteEditable(db, payload.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  logger.info("Regenerando asignaciones del cuadrante", {
    cuadranteId: payload.cuadranteId,
    nuevas: payload.asignaciones.length,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  let resultado: { eliminadas: number; creadas: number; asignacionIds: string[] };
  try {
    resultado = await regenerarAsignaciones(db, {
      cuadranteId: payload.cuadranteId,
      nuevas: payload.asignaciones,
      actorId: invocadorUid,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("Error inesperado al regenerar asignaciones", {
      err,
      cuadranteId: payload.cuadranteId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al regenerar las asignaciones del cuadrante.",
    );
  }

  logger.info("Asignaciones regeneradas", {
    cuadranteId: payload.cuadranteId,
    eliminadas: resultado.eliminadas,
    creadas: resultado.creadas,
  });

  return {
    ok: true as const,
    eliminadas: resultado.eliminadas,
    creadas: resultado.creadas,
    asignacionIds: resultado.asignacionIds,
  };
});
