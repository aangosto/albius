import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import type { Ausencia } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateEliminarAusenciaPayload } from "../validation";
import { assertPuedeTocarAusenciaDoc } from "./actualizarAusencia";

/**
 * Callable eliminarAusencia (B32). HARD-DELETE (como eliminarFestivo: una
 * ausencia es un registro de calendario sin estado ni ciclo de vida; no aplica
 * soft-delete D4.3). Mismo gate anti-cross contra el DOC que actualizarAusencia.
 */
export const eliminarAusencia = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { ausenciaId } = validateEliminarAusenciaPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.AUSENCIAS).doc(ausenciaId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La ausencia '${ausenciaId}' no existe.`,
    );
  }
  const doc = snap.data() as Ausencia;

  assertPuedeTocarAusenciaDoc(claims, doc);

  logger.info("Eliminando ausencia", {
    ausenciaId,
    conductorId: doc.conductorId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.delete();
  } catch (err) {
    logger.error("Error inesperado al eliminar ausencia", { err, ausenciaId });
    throw new HttpsError("internal", "Error inesperado al eliminar la ausencia.");
  }

  return { ok: true as const, ausenciaId };
});
