import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Cuadrante } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCuadranteIdPayload } from "../validation";

/**
 * Callable cerrarCuadrante (B26). Transición de estado 'publicado' → 'cerrado'
 * (mes pasado/congelado, ya no editable ni intercambiable).
 *
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el doc.
 *   - Solo desde 'publicado' (else 'failed-precondition').
 *   - Auditoría D4.1.
 */
export const cerrarCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { cuadranteId } = validateCuadranteIdPayload(
    request.data,
    "cerrarCuadrante",
  );
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.CUADRANTES).doc(cuadranteId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El cuadrante '${cuadranteId}' no existe.`,
    );
  }
  const doc = snap.data() as Cuadrante;

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId || claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede cerrar cuadrantes de otro centro o tenant.",
      );
    }
  }

  if (doc.estado !== "publicado") {
    throw new HttpsError(
      "failed-precondition",
      `Solo se puede cerrar un cuadrante publicado (estado actual: ${doc.estado}).`,
    );
  }

  logger.info("Cerrando cuadrante", {
    cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update({
      estado: "cerrado",
      actualizadoPor: invocadorUid, // D4.1
      actualizadoEn: FieldValue.serverTimestamp(), // D4.1
    });
  } catch (err) {
    logger.error("Error inesperado al cerrar cuadrante", { err, cuadranteId });
    throw new HttpsError("internal", "Error inesperado al cerrar el cuadrante.");
  }

  logger.info("Cuadrante cerrado", { cuadranteId });
  return { ok: true as const, cuadranteId };
});
