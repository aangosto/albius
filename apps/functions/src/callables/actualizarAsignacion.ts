import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Asignacion } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import {
  validateActualizarAsignacionPayload,
  assertFechaEnMes,
} from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";

/**
 * Callable actualizarAsignacion (B26). Edita una asignación existente (el jefe
 * ajusta a mano un turno generado). Solo si su cuadrante sigue en 'borrador'.
 *
 *   - Lee la asignación → obtiene su cuadranteId → assertCuadranteEditable.
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 *   - Si cambia la fecha, debe seguir DENTRO del mes del cuadrante.
 *   - Veta inmutables (id/cuadranteId/tenantId/centroId/creadoPor/creadoEn) y los
 *     campos de intercambio (el validator). Auditoría D4.1.
 */
export const actualizarAsignacion = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarAsignacionPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.ASIGNACIONES).doc(payload.asignacionId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La asignación '${payload.asignacionId}' no existe.`,
    );
  }
  const doc = snap.data() as Asignacion;

  const cuadrante = await assertCuadranteEditable(db, doc.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  if (payload.fecha !== undefined) {
    assertFechaEnMes(payload.fecha, cuadrante.año, cuadrante.mes);
  }

  const cambios: Record<string, unknown> = {};
  if (payload.conductorId !== undefined)
    cambios["conductorId"] = payload.conductorId;
  if (payload.fecha !== undefined)
    cambios["fecha"] = Timestamp.fromDate(payload.fecha);
  if (payload.tipoAsignacion !== undefined)
    cambios["tipoAsignacion"] = payload.tipoAsignacion;
  if (payload.tipoTurnoId !== undefined)
    cambios["tipoTurnoId"] = payload.tipoTurnoId;
  if (payload.horaInicio !== undefined)
    cambios["horaInicio"] = payload.horaInicio;
  if (payload.horaFin !== undefined) cambios["horaFin"] = payload.horaFin;
  if (payload.estado !== undefined) cambios["estado"] = payload.estado;

  // Auditoría D4.1 — SIEMPRE.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando asignación", {
    asignacionId: payload.asignacionId,
    cuadranteId: doc.cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar asignación", {
      err,
      asignacionId: payload.asignacionId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar la asignación.",
    );
  }

  return { ok: true as const, asignacionId: payload.asignacionId };
});
