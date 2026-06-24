import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCuadranteIdPayload } from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";
import { limpiarAsignacionesCuadrante } from "../logic/asignaciones";

/**
 * Callable eliminarAsignacionesCuadrante (B28). Vacía TODAS las asignaciones de un
 * cuadrante en borrador (útil para que el jefe limpie un borrador; lo reutiliza la
 * regeneración del optimizador como primer paso). Hard-delete en batches.
 *
 *   - Solo si el cuadrante está en 'borrador' (assertCuadranteEditable).
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 */
export const eliminarAsignacionesCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { cuadranteId } = validateCuadranteIdPayload(
    request.data,
    "eliminarAsignacionesCuadrante",
  );
  const db = getFirestore();

  const cuadrante = await assertCuadranteEditable(db, cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  logger.info("Limpiando asignaciones del cuadrante", {
    cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  let resultado: { eliminadas: number };
  try {
    resultado = await limpiarAsignacionesCuadrante(db, {
      cuadranteId,
      actorId: invocadorUid,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("Error inesperado al limpiar asignaciones del cuadrante", {
      err,
      cuadranteId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al limpiar las asignaciones del cuadrante.",
    );
  }

  logger.info("Asignaciones del cuadrante limpiadas", {
    cuadranteId,
    eliminadas: resultado.eliminadas,
  });

  return { ok: true as const, eliminadas: resultado.eliminadas };
});
