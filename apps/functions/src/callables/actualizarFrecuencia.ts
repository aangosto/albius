import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Frecuencia } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import {
  validateActualizarFrecuenciaPayload,
  assertHoraInicioAntesFin,
} from "../validation";
import { assertNoSolapeFrecuencia } from "../refs";

/**
 * Callable actualizarFrecuencia (B23). Clon de actualizarTipoTurno.
 *
 *   - Auditoría D4.1 (actualizadoPor/En) en TODA modificación.
 *   - Soft-delete D4.3 vía `activa` (true↔false), sin cascada.
 *   - Validación con valores EFECTIVOS (payload ?? doc): horaInicio<horaFin y
 *     no-solape se evalúan con el estado resultante, no solo con lo que llega.
 *     El no-solape solo se comprueba si la frecuencia queda activa.
 *
 * Inmutables vetados por el validator (id/tenantId/centroId/lineaId/creadoPor/
 * creadoEn). Auth super_admin libre + jefe anti-cross contra el doc.
 */
export const actualizarFrecuencia = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarFrecuenciaPayload(request.data);
  const db = getFirestore();

  const docRef = db
    .collection(COLLECTIONS.FRECUENCIAS)
    .doc(payload.frecuenciaId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La frecuencia '${payload.frecuenciaId}' no existe.`,
    );
  }
  const doc = snap.data() as Frecuencia;

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar frecuencias de otro tenant.",
      );
    }
    if (claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar frecuencias de otro centro.",
      );
    }
  }

  // Valores efectivos tras el update.
  const horaInicio = payload.horaInicio ?? doc.horaInicio;
  const horaFin = payload.horaFin ?? doc.horaFin;
  assertHoraInicioAntesFin(horaInicio, horaFin);
  const tipoDia = payload.tipoDia ?? doc.tipoDia;
  const sentido = payload.sentido ?? doc.sentido;
  const activa = payload.activa ?? doc.activa;

  if (activa === true) {
    await assertNoSolapeFrecuencia(db, {
      lineaId: doc.lineaId,
      tipoDia,
      sentido,
      horaInicio,
      horaFin,
      excludeId: payload.frecuenciaId,
    });
  }

  const cambios: Record<string, unknown> = {};
  if (payload.tipoDia !== undefined) cambios["tipoDia"] = payload.tipoDia;
  if (payload.horaInicio !== undefined)
    cambios["horaInicio"] = payload.horaInicio;
  if (payload.horaFin !== undefined) cambios["horaFin"] = payload.horaFin;
  if (payload.intervaloMinutos !== undefined)
    cambios["intervaloMinutos"] = payload.intervaloMinutos;
  if (payload.sentido !== undefined) cambios["sentido"] = payload.sentido;
  if (payload.activa !== undefined) cambios["activa"] = payload.activa;

  cambios["actualizadoPor"] = invocadorUid; // D4.1
  cambios["actualizadoEn"] = FieldValue.serverTimestamp(); // D4.1

  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar frecuencia", {
      err,
      frecuenciaId: payload.frecuenciaId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar la frecuencia.",
    );
  }

  logger.info("Frecuencia actualizada", {
    frecuenciaId: payload.frecuenciaId,
  });

  return { ok: true as const, frecuenciaId: payload.frecuenciaId };
});
