import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Festivo } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico, type Claims } from "../auth-guards";
import { validateActualizarFestivoPayload } from "../validation";

/**
 * Auth sobre un festivo EXISTENTE (por su scope): tenant-wide (sin centroId) →
 * super_admin only; de centro → jefe de ESE centro (anti-cross) o super_admin.
 * Compartido por actualizar/eliminarFestivo (B27).
 */
export function assertPuedeTocarFestivoDoc(
  claims: Claims,
  doc: { tenantId: string; centroId?: string },
): void {
  if (doc.centroId === undefined) {
    if (claims.rol !== "super_admin") {
      throw new HttpsError(
        "permission-denied",
        "Solo un super_admin puede modificar festivos de todo el tenant.",
      );
    }
    return;
  }
  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId || claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede modificar festivos de otro centro o tenant.",
      );
    }
  }
}

/**
 * Lanza failed-precondition si el festivo es oficial protegido (esEditable=false).
 * Compartido por actualizar/eliminarFestivo.
 */
export function assertFestivoEditable(doc: Festivo): void {
  if (doc.esEditable === false) {
    throw new HttpsError(
      "failed-precondition",
      "Este festivo es oficial (no editable) y no puede modificarse ni eliminarse.",
    );
  }
}

/**
 * Callable actualizarFestivo (B27). Edita un festivo si su scope lo permite y no
 * es oficial protegido. Veta inmutables (id/tenantId/centroId/creadoPor/creadoEn).
 * Auditoría D4.1.
 */
export const actualizarFestivo = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarFestivoPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.FESTIVOS).doc(payload.festivoId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El festivo '${payload.festivoId}' no existe.`,
    );
  }
  const doc = snap.data() as Festivo;

  assertPuedeTocarFestivoDoc(claims, doc);
  assertFestivoEditable(doc);

  const cambios: Record<string, unknown> = {};
  if (payload.fecha !== undefined)
    cambios["fecha"] = Timestamp.fromDate(payload.fecha);
  if (payload.nombre !== undefined) cambios["nombre"] = payload.nombre;
  if (payload.ambito !== undefined) cambios["ambito"] = payload.ambito;
  if (payload.tipoTraficoAplicable !== undefined)
    cambios["tipoTraficoAplicable"] = payload.tipoTraficoAplicable;
  if (payload.esEditable !== undefined)
    cambios["esEditable"] = payload.esEditable;

  // Auditoría D4.1 — SIEMPRE.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando festivo", {
    festivoId: payload.festivoId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar festivo", {
      err,
      festivoId: payload.festivoId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el festivo.",
    );
  }

  return { ok: true as const, festivoId: payload.festivoId };
});
