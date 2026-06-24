import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearFrecuenciaExcepcionalPayload } from "../validation";
import {
  assertLineaActiva,
  assertNoSolapeFrecuenciaExcepcional,
} from "../refs";

/**
 * Callable crearFrecuenciaExcepcional (B23). Como crearFrecuencia pero con una
 * `fecha` concreta (reemplaza a la habitual ese día) en vez de `tipoDia`.
 *
 *   - D5.1/D5.2: assertLineaActiva + coherencia tenant/centro.
 *   - No-solape acotado a la MISMA fecha (assertNoSolapeFrecuenciaExcepcional).
 *   - Default D4.2: activa = payload.activa ?? true. Auditoría D3.7.
 *
 * `fecha` viaja como ISO string en el wire (assertISODate) y se persiste como
 * Timestamp (Timestamp.fromDate), igual que las fechas de Conductor/Línea.
 */
export const crearFrecuenciaExcepcional = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearFrecuenciaExcepcionalPayload(request.data);

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear frecuencias excepcionales en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear frecuencias excepcionales en otro centro.",
      );
    }
  }

  const db = getFirestore();

  const linea = await assertLineaActiva(db, payload.lineaId);
  if (
    linea.tenantId !== payload.tenantId ||
    linea.centroId !== payload.centroId
  ) {
    throw new HttpsError(
      "invalid-argument",
      `La línea '${payload.lineaId}' no pertenece al tenant/centro indicado.`,
    );
  }

  await assertNoSolapeFrecuenciaExcepcional(db, {
    lineaId: payload.lineaId,
    fecha: payload.fecha,
    sentido: payload.sentido,
    horaInicio: payload.horaInicio,
    horaFin: payload.horaFin,
  });

  const docRef = db.collection(COLLECTIONS.FRECUENCIAS_EXCEPCIONALES).doc();
  const doc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    lineaId: payload.lineaId,
    fecha: Timestamp.fromDate(payload.fecha),
    horaInicio: payload.horaInicio,
    horaFin: payload.horaFin,
    intervaloMinutos: payload.intervaloMinutos,
    sentido: payload.sentido,
    activa: payload.activa ?? true, // D4.2
    ...(payload.motivo !== undefined && { motivo: payload.motivo }),
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  try {
    await docRef.set(doc);
  } catch (err) {
    logger.error("Error inesperado al crear frecuencia excepcional", {
      err,
      lineaId: payload.lineaId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al crear la frecuencia excepcional.",
    );
  }

  logger.info("Frecuencia excepcional creada", {
    frecuenciaExcepcionalId: docRef.id,
    lineaId: payload.lineaId,
  });

  return { ok: true as const, frecuenciaExcepcionalId: docRef.id };
});
