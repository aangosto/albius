import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { FrecuenciaExcepcional } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import {
  validateActualizarFrecuenciaExcepcionalPayload,
  assertHoraInicioAntesFin,
} from "../validation";
import { assertNoSolapeFrecuenciaExcepcional } from "../refs";

/**
 * Callable actualizarFrecuenciaExcepcional (B23). Clon de actualizarFrecuencia
 * adaptado (fecha en vez de tipoDia). Auditoría D4.1, soft-delete vía `activa`,
 * validación con valores efectivos (payload ?? doc) + no-solape por fecha si
 * queda activa. Inmutables vetados por el validator.
 */
export const actualizarFrecuenciaExcepcional = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarFrecuenciaExcepcionalPayload(request.data);
  const db = getFirestore();

  const docRef = db
    .collection(COLLECTIONS.FRECUENCIAS_EXCEPCIONALES)
    .doc(payload.frecuenciaExcepcionalId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La frecuencia excepcional '${payload.frecuenciaExcepcionalId}' no existe.`,
    );
  }
  const doc = snap.data() as FrecuenciaExcepcional;

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar frecuencias excepcionales de otro tenant.",
      );
    }
    if (claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar frecuencias excepcionales de otro centro.",
      );
    }
  }

  const horaInicio = payload.horaInicio ?? doc.horaInicio;
  const horaFin = payload.horaFin ?? doc.horaFin;
  assertHoraInicioAntesFin(horaInicio, horaFin);
  const sentido = payload.sentido ?? doc.sentido;
  const activa = payload.activa ?? doc.activa;
  // doc.fecha es Timestamp; payload.fecha es Date.
  const fecha = payload.fecha ?? doc.fecha.toDate();

  if (activa === true) {
    await assertNoSolapeFrecuenciaExcepcional(db, {
      lineaId: doc.lineaId,
      fecha,
      sentido,
      horaInicio,
      horaFin,
      excludeId: payload.frecuenciaExcepcionalId,
    });
  }

  const cambios: Record<string, unknown> = {};
  if (payload.fecha !== undefined)
    cambios["fecha"] = Timestamp.fromDate(payload.fecha);
  if (payload.horaInicio !== undefined)
    cambios["horaInicio"] = payload.horaInicio;
  if (payload.horaFin !== undefined) cambios["horaFin"] = payload.horaFin;
  if (payload.intervaloMinutos !== undefined)
    cambios["intervaloMinutos"] = payload.intervaloMinutos;
  if (payload.sentido !== undefined) cambios["sentido"] = payload.sentido;
  if (payload.motivo !== undefined) cambios["motivo"] = payload.motivo;
  if (payload.activa !== undefined) cambios["activa"] = payload.activa;

  cambios["actualizadoPor"] = invocadorUid; // D4.1
  cambios["actualizadoEn"] = FieldValue.serverTimestamp(); // D4.1

  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar frecuencia excepcional", {
      err,
      frecuenciaExcepcionalId: payload.frecuenciaExcepcionalId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar la frecuencia excepcional.",
    );
  }

  logger.info("Frecuencia excepcional actualizada", {
    frecuenciaExcepcionalId: payload.frecuenciaExcepcionalId,
  });

  return {
    ok: true as const,
    frecuenciaExcepcionalId: payload.frecuenciaExcepcionalId,
  };
});
