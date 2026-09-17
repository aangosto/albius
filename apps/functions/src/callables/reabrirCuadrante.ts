import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Cuadrante } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { assertCentroActivo } from "../refs";
import { validateCuadranteIdPayload } from "../validation";

/**
 * Callable reabrirCuadrante (B33.1). Transición 'publicado' → 'borrador': la
 * SALIDA DE EMERGENCIA de publicar. Publicar congela el cuadrante (las
 * asignaciones solo se editan en borrador; la edición post-publicación es el
 * bloque de Intercambios) y hasta B33.1 era irreversible: un clic equivocado
 * dejaba al jefe atascado. Reabrir devuelve el cuadrante a borrador para
 * regenerar o editar y volver a publicar.
 *
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el doc.
 *   - D5.1: assertCentroActivo (vuelve a ser editable → el centro debe operar).
 *   - Solo desde 'publicado' (else 'failed-precondition'). 'cerrado' es
 *     DEFINITIVO: no se reabre.
 *   - LIMPIA `fechaPublicacion`/`publicadoPor` (FieldValue.delete): son campos de
 *     dominio que describen la publicación VIGENTE, no un histórico (el
 *     histórico de versiones es `versiones_cuadrante`, diferido a Intercambios).
 *     Dejarlos haría que un borrador mostrara "publicado el X". Al re-publicar
 *     se vuelven a sellar. La auditoría D4.1 registra quién reabrió y cuándo.
 *   - No toca `estadoGeneracion` ni las asignaciones: el plan generado se
 *     conserva y sigue siendo editable en borrador.
 *
 * TODO[reabrir-cuadrante-vs-intercambios]: cuando exista Intercambios, revisar
 * si reabrir es legítimo con intercambios ya cursados sobre este cuadrante
 * (probablemente rechazar si hay intercambios aceptados, o exigir cancelarlos
 * antes). Hoy no hay intercambios, así que la transición es segura.
 */
export const reabrirCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { cuadranteId } = validateCuadranteIdPayload(
    request.data,
    "reabrirCuadrante",
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
        "Un jefe de tráfico no puede reabrir cuadrantes de otro centro o tenant.",
      );
    }
  }

  if (doc.estado !== "publicado") {
    throw new HttpsError(
      "failed-precondition",
      doc.estado === "cerrado"
        ? `El cuadrante '${cuadranteId}' está cerrado; cerrar es definitivo y no se puede reabrir.`
        : `Solo se puede reabrir un cuadrante publicado (estado actual: ${doc.estado}).`,
    );
  }

  await assertCentroActivo(db, doc.centroId); // D5.1

  logger.info("Reabriendo cuadrante", {
    cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update({
      estado: "borrador",
      fechaPublicacion: FieldValue.delete(),
      publicadoPor: FieldValue.delete(),
      actualizadoPor: invocadorUid, // D4.1
      actualizadoEn: FieldValue.serverTimestamp(), // D4.1
    });
  } catch (err) {
    logger.error("Error inesperado al reabrir cuadrante", { err, cuadranteId });
    throw new HttpsError(
      "internal",
      "Error inesperado al reabrir el cuadrante.",
    );
  }

  logger.info("Cuadrante reabierto", { cuadranteId });
  return { ok: true as const, cuadranteId };
});
