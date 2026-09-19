import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Cuadrante } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCuadranteIdPayload } from "../validation";
import { notificarCuadrantePublicado } from "../logic/notificaciones";

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
 *
 * B38.5: tras sellar la publicación, notifica a los conductores del cuadrante
 * (best-effort, ver más abajo). Devuelve `notificados` para que el verify y la
 * UI puedan comprobarlo sin leer la colección.
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

  // B33.1: no se publica con el optimizador en marcha. Sin este guard, el worker
  // (~5 min después) chocaría con assertCuadranteEditable al volcar el plan,
  // marcaría estadoGeneracion='error' y dejaría un cuadrante publicado y vacío.
  if (doc.estadoGeneracion === "generando") {
    throw new HttpsError(
      "failed-precondition",
      `No se puede publicar el cuadrante '${cuadranteId}': hay una generación en curso. Espera a que termine.`,
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

  // B38.5 — avisa a los conductores con asignaciones en el cuadrante. BEST
  // EFFORT: la publicación ya está sellada y es lo que importa; si notificar
  // falla (query, batch, permisos), NO se revierte ni se propaga el error —
  // se loggea y el callable devuelve ok. El precio de propagarlo sería que el
  // jefe viera "error al publicar" sobre un cuadrante que SÍ está publicado.
  let notificados = 0;
  try {
    const res = await notificarCuadrantePublicado(db, {
      cuadranteId,
      tenantId: doc.tenantId,
      centroId: doc.centroId,
      año: doc.año,
      mes: doc.mes,
    });
    notificados = res.creadas;
    logger.info("Notificaciones de publicación creadas", {
      cuadranteId,
      creadas: res.creadas,
      // Conductores con asignaciones pero sin cuenta de acceso enlazada: no es
      // un fallo, pero conviene verlo en los logs si el número no es 0.
      sinUsuario: res.sinUsuario,
    });
  } catch (err) {
    logger.error("Error notificando la publicación (no bloqueante)", {
      err,
      cuadranteId,
    });
  }

  return { ok: true as const, cuadranteId, notificados };
});
