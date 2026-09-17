import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Ausencia } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico, type Claims } from "../auth-guards";
import {
  validateActualizarAusenciaPayload,
  assertRangoAusenciaCoherente,
} from "../validation";
import { assertNoSolapeAusencia } from "../refs";

/**
 * Auth sobre una ausencia EXISTENTE: super_admin libre; jefe_trafico solo si
 * la ausencia es de SU tenant y SU centro (anti-cross contra el DOC, no el
 * payload — patrón actualizarLinea/TipoTurno). Compartido por
 * actualizar/eliminarAusencia (B32).
 */
export function assertPuedeTocarAusenciaDoc(
  claims: Claims,
  doc: { tenantId: string; centroId: string },
): void {
  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId || claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede modificar ausencias de otro centro o tenant.",
      );
    }
  }
}

/**
 * Callable actualizarAusencia (B32). Edita categoria/codigo/fechas/observaciones
 * de una ausencia. Veta inmutables (id/tenantId/centroId/conductorId/creadoPor/
 * creadoEn — en el validator). El rango y el no-solape se revalidan con los
 * valores EFECTIVOS (payload ?? doc): si solo llega una fecha, se cruza contra
 * la persistida. Auditoría D4.1.
 */
export const actualizarAusencia = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarAusenciaPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.AUSENCIAS).doc(payload.ausenciaId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La ausencia '${payload.ausenciaId}' no existe.`,
    );
  }
  const doc = snap.data() as Ausencia;

  assertPuedeTocarAusenciaDoc(claims, doc);

  // Rango EFECTIVO (payload ?? persistido) — cruzado siempre, aunque solo
  // llegue una de las dos fechas.
  const fechaInicioEfectiva = payload.fechaInicio ?? doc.fechaInicio.toDate();
  const fechaFinEfectiva = payload.fechaFin ?? doc.fechaFin.toDate();
  if (payload.fechaInicio !== undefined || payload.fechaFin !== undefined) {
    assertRangoAusenciaCoherente(fechaInicioEfectiva, fechaFinEfectiva);
    await assertNoSolapeAusencia(db, {
      conductorId: doc.conductorId,
      fechaInicio: fechaInicioEfectiva,
      fechaFin: fechaFinEfectiva,
      excludeId: payload.ausenciaId,
    });
  }

  const cambios: Record<string, unknown> = {};
  if (payload.categoria !== undefined) cambios["categoria"] = payload.categoria;
  if (payload.codigo !== undefined) cambios["codigo"] = payload.codigo;
  if (payload.fechaInicio !== undefined)
    cambios["fechaInicio"] = Timestamp.fromDate(payload.fechaInicio);
  if (payload.fechaFin !== undefined)
    cambios["fechaFin"] = Timestamp.fromDate(payload.fechaFin);
  if (payload.observaciones !== undefined)
    cambios["observaciones"] = payload.observaciones;

  // Auditoría D4.1 — SIEMPRE.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando ausencia", {
    ausenciaId: payload.ausenciaId,
    conductorId: doc.conductorId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar ausencia", {
      err,
      ausenciaId: payload.ausenciaId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar la ausencia.",
    );
  }

  return { ok: true as const, ausenciaId: payload.ausenciaId };
});
