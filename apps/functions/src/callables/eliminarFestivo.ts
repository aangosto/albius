import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import type { Festivo } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateEliminarFestivoPayload } from "../validation";
import {
  assertPuedeTocarFestivoDoc,
  assertFestivoEditable,
} from "./actualizarFestivo";

/**
 * Callable eliminarFestivo (B27). HARD-DELETE (Festivo no tiene estado/ciclo de
 * vida; es un registro de calendario). Mismo gate de scope + protección
 * esEditable que actualizarFestivo.
 */
export const eliminarFestivo = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { festivoId } = validateEliminarFestivoPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.FESTIVOS).doc(festivoId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El festivo '${festivoId}' no existe.`,
    );
  }
  const doc = snap.data() as Festivo;

  assertPuedeTocarFestivoDoc(claims, doc);
  assertFestivoEditable(doc);

  logger.info("Eliminando festivo", {
    festivoId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.delete();
  } catch (err) {
    logger.error("Error inesperado al eliminar festivo", { err, festivoId });
    throw new HttpsError("internal", "Error inesperado al eliminar el festivo.");
  }

  return { ok: true as const, festivoId };
});
