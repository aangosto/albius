import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Cuadrante } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCuadranteIdPayload } from "../validation";

/**
 * Callable publicarCuadrante (B26). Transición de estado 'borrador' → 'publicado'.
 * Sella fechaPublicacion + publicadoPor. (El horizonte de 2 meses y la apertura
 * de intercambios son del bloque futuro; aquí solo la transición de estado.)
 *
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el doc.
 *   - Solo desde 'borrador' (else 'failed-precondition').
 *   - Auditoría D4.1.
 *
 * NOTA: los snapshots de versión (versiones_cuadrante) se difieren al bloque de
 * Intercambios; publicar NO incrementa versionActual en B26.
 */
export const publicarCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { cuadranteId } = validateCuadranteIdPayload(
    request.data,
    "publicarCuadrante",
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
        "Un jefe de tráfico no puede publicar cuadrantes de otro centro o tenant.",
      );
    }
  }

  if (doc.estado !== "borrador") {
    throw new HttpsError(
      "failed-precondition",
      `Solo se puede publicar un cuadrante en borrador (estado actual: ${doc.estado}).`,
    );
  }

  logger.info("Publicando cuadrante", {
    cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update({
      estado: "publicado",
      fechaPublicacion: FieldValue.serverTimestamp(),
      publicadoPor: invocadorUid,
      actualizadoPor: invocadorUid, // D4.1
      actualizadoEn: FieldValue.serverTimestamp(), // D4.1
    });
  } catch (err) {
    logger.error("Error inesperado al publicar cuadrante", { err, cuadranteId });
    throw new HttpsError(
      "internal",
      "Error inesperado al publicar el cuadrante.",
    );
  }

  logger.info("Cuadrante publicado", { cuadranteId });
  return { ok: true as const, cuadranteId };
});
