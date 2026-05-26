import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Tenant } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdmin } from "../auth-guards";
import { validateActualizarTenantPayload } from "../validation";

/**
 * Callable actualizarTenant.
 *
 * Actualiza un tenant existente con:
 *   - Auditoría D4.1 (actualizadoPor, actualizadoEn) en TODA modificación,
 *     incluyendo no-ops (Opción A: si payload.estado === doc.estado, se
 *     escribe audit pero no se toca el estado — refleja el intento).
 *   - Soft-delete D4.3 vía cambio de estado a 'cancelado', con
 *     verificación D4.6 de centros activos antes de aceptar el cambio.
 *   - Reactivación 'cancelado' → 'activo' borra fechaCancelacion con
 *     FieldValue.delete().
 *   - Configuracion replace completo en UPDATE (D4.5): el validator
 *     exige que llegue con ambos sub-campos (zonaHoraria, idioma).
 *
 * No edita campos inmutables (cif, id, fechaAlta, creadoPor, creadoEn):
 * el validator de payload los rechaza con `invalid-argument` mostrando
 * mensaje específico que apunta a TODO[edit-cif-procedimiento] para el
 * caso del CIF.
 *
 * Solo invocable por super_admin.
 */
export const actualizarTenant = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones
  // ==========================================================================
  const { uid: invocadorUid } = assertSuperAdmin(request);
  const payload = validateActualizarTenantPayload(request.data);
  const db = getFirestore();

  // Lectura previa del doc actual.
  const docRef = db.collection(COLLECTIONS.TENANTS).doc(payload.tenantId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El tenant '${payload.tenantId}' no existe.`,
    );
  }
  // Cast permisivo: confiamos en que el doc fue creado por crearTenant
  // (que escribe todos los campos required). Si en el futuro hubiera otra
  // fuente de escritura, este cast podría enmascarar undefined fields.
  const doc = snap.data() as Tenant;

  // ==========================================================================
  //  FASE 2 — Construcción del diff
  // ==========================================================================
  const cambios: Record<string, unknown> = {};

  if (payload.nombre !== undefined) cambios["nombre"] = payload.nombre;
  if (payload.nombreComercial !== undefined)
    cambios["nombreComercial"] = payload.nombreComercial;
  if (payload.comunidadAutonoma !== undefined)
    cambios["comunidadAutonoma"] = payload.comunidadAutonoma;
  if (payload.provincia !== undefined)
    cambios["provincia"] = payload.provincia;
  if (payload.plan !== undefined) cambios["plan"] = payload.plan;
  if (payload.logoUrl !== undefined) cambios["logoUrl"] = payload.logoUrl;
  // D4.5 UPDATE: replace literal del objeto entero. El validator garantizó
  // que ambos sub-campos (zonaHoraria, idioma) están presentes si llega.
  if (payload.configuracion !== undefined)
    cambios["configuracion"] = payload.configuracion;

  // Transición de estado (Opción A: si payload.estado === doc.estado, no-op
  // silencioso — no entramos al if; el audit se escribirá igual).
  if (payload.estado !== undefined && payload.estado !== doc.estado) {
    if (payload.estado === "cancelado" && doc.estado === "activo") {
      // D4.6: verificar centros activos antes de cancelar.
      const centrosActivos = await db
        .collection(COLLECTIONS.CENTROS)
        .where("tenantId", "==", payload.tenantId)
        .where("estado", "==", "activo")
        .limit(1)
        .get();
      if (!centrosActivos.empty) {
        throw new HttpsError(
          "failed-precondition",
          "No puede cancelarse un tenant con centros activos. Inactiva primero los centros del tenant.",
        );
      }
      cambios["estado"] = "cancelado";
      cambios["fechaCancelacion"] = FieldValue.serverTimestamp();
    } else if (payload.estado === "activo" && doc.estado === "cancelado") {
      cambios["estado"] = "activo";
      cambios["fechaCancelacion"] = FieldValue.delete();
    } else {
      // Otras transiciones libres en MVP (activo↔suspendido,
      // suspendido↔cancelado, etc.). No tocamos fechaCancelacion.
      cambios["estado"] = payload.estado;
    }
  }

  // Auditoría D4.1 — SIEMPRE, sin excepción.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando tenant", {
    tenantId: payload.tenantId,
    campos: Object.keys(cambios).filter(
      (k) => k !== "actualizadoPor" && k !== "actualizadoEn",
    ),
    invocadorUid,
  });

  // ==========================================================================
  //  FASE 3 — Escritura
  // ==========================================================================
  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar tenant", {
      err,
      tenantId: payload.tenantId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el tenant.",
    );
  }

  logger.info("Tenant actualizado", { tenantId: payload.tenantId });

  return {
    ok: true as const,
    tenantId: payload.tenantId,
  };
});
