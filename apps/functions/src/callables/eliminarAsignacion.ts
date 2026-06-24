import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import type { Asignacion } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateEliminarAsignacionPayload } from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";

/**
 * Callable eliminarAsignacion (B26). HARD-DELETE de una asignación. Coherente con
 * la regla de modelado "ausencia de fila = libre": borrar la asignación de un
 * conductor en un día equivale a dejarlo libre ese día (no es un soft-delete por
 * estado como otras entidades). Solo si su cuadrante sigue en 'borrador'.
 *
 *   - Lee la asignación → su cuadranteId → assertCuadranteEditable.
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 */
export const eliminarAsignacion = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { asignacionId } = validateEliminarAsignacionPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.ASIGNACIONES).doc(asignacionId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La asignación '${asignacionId}' no existe.`,
    );
  }
  const doc = snap.data() as Asignacion;

  const cuadrante = await assertCuadranteEditable(db, doc.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  logger.info("Eliminando asignación", {
    asignacionId,
    cuadranteId: doc.cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.delete();
  } catch (err) {
    logger.error("Error inesperado al eliminar asignación", {
      err,
      asignacionId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al eliminar la asignación.",
    );
  }

  return { ok: true as const, asignacionId };
});
