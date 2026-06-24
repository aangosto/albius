import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearFrecuenciaPayload } from "../validation";
import { assertLineaActiva, assertNoSolapeFrecuencia } from "../refs";

/**
 * Callable crearFrecuencia (B23). Entidad operativa del jefe que cuelga de una
 * Línea. Clon del molde crearTipoTurno.
 *
 *   - D5.1/D5.2: assertLineaActiva (línea inexistente → invalid-argument; no
 *     activa → failed-precondition). Coherencia tenant/centro: la frecuencia
 *     debe estar en el mismo tenant+centro que su línea.
 *   - No-solape: assertNoSolapeFrecuencia (no dos frecuencias activas de la
 *     misma línea+tipoDia+sentido con tramos solapados).
 *   - Default D4.2: activa = payload.activa ?? true.
 *   - Auditoría D3.7 (creadoPor + creadoEn).
 *
 * Auth super_admin libre + jefe scoped anti-cross (tenant+centro vs payload).
 */
export const crearFrecuencia = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearFrecuenciaPayload(request.data);

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear frecuencias en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear frecuencias en otro centro.",
      );
    }
  }

  const db = getFirestore();

  const linea = await assertLineaActiva(db, payload.lineaId); // D5.1/D5.2
  if (
    linea.tenantId !== payload.tenantId ||
    linea.centroId !== payload.centroId
  ) {
    throw new HttpsError(
      "invalid-argument",
      `La línea '${payload.lineaId}' no pertenece al tenant/centro indicado.`,
    );
  }

  await assertNoSolapeFrecuencia(db, {
    lineaId: payload.lineaId,
    tipoDia: payload.tipoDia,
    sentido: payload.sentido,
    horaInicio: payload.horaInicio,
    horaFin: payload.horaFin,
  });

  const docRef = db.collection(COLLECTIONS.FRECUENCIAS).doc();
  const doc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    lineaId: payload.lineaId,
    tipoDia: payload.tipoDia,
    horaInicio: payload.horaInicio,
    horaFin: payload.horaFin,
    intervaloMinutos: payload.intervaloMinutos,
    sentido: payload.sentido,
    activa: payload.activa ?? true, // D4.2
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  try {
    await docRef.set(doc);
  } catch (err) {
    logger.error("Error inesperado al crear frecuencia", {
      err,
      lineaId: payload.lineaId,
    });
    throw new HttpsError("internal", "Error inesperado al crear la frecuencia.");
  }

  logger.info("Frecuencia creada", {
    frecuenciaId: docRef.id,
    lineaId: payload.lineaId,
    tipoDia: payload.tipoDia,
  });

  return { ok: true as const, frecuenciaId: docRef.id };
});
