import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, GeoPoint } from "firebase-admin/firestore";
import type { Centro } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdmin } from "../auth-guards";
import { validateActualizarCentroPayload } from "../validation";
import { assertNoConductoresActivosEnCentro } from "../refs";

/**
 * Callable actualizarCentro.
 *
 * Actualiza un centro existente con:
 *   - Auditoría D4.1 (actualizadoPor, actualizadoEn) en TODA modificación,
 *     incluyendo no-ops (Opción A: si payload.estado === doc.estado, se
 *     escribe audit pero no se toca el estado — refleja el intento).
 *   - Soft-delete D4.3 vía cambio de estado a 'inactivo', con verificación
 *     D4.6 de conductores asignados (estados bloqueantes: activo,
 *     baja_temporal, vacaciones) antes de aceptar el cambio.
 *   - Reactivación 'inactivo' → 'activo' trivial: el modelo Centro NO tiene
 *     `fechaCancelacion` (a diferencia de Tenant), así que no hay
 *     `FieldValue.delete()` que aplicar.
 *   - Coordenadas: el wire usa `{latitude, longitude}`; la conversión a
 *     `GeoPoint` se hace AQUÍ en la construcción del diff. Patrón omit-only
 *     (MVP): omitir coordenadas significa "no tocar", no "borrar" — borrar
 *     coordenadas preexistentes no soportado, ver `TODO[delete-on-empty-fields]`.
 *
 * No edita campos inmutables (id, tenantId, fechaCreacion, creadoPor,
 * creadoEn): el validator de payload los rechaza con `invalid-argument`
 * mostrando mensaje específico para cada uno. Las reglas Firestore en
 * /centros también los bloquean por defensa en profundidad.
 *
 * Solo invocable por super_admin (coherente con crearCentro y con el
 * patrón establecido por crearTenant/actualizarTenant).
 */
export const actualizarCentro = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones + lectura previa
  // ==========================================================================
  const { uid: invocadorUid } = assertSuperAdmin(request);
  const payload = validateActualizarCentroPayload(request.data);
  const db = getFirestore();

  // Lectura previa del doc actual. Necesaria para:
  //   - Decidir transición de estado (doc.estado vs payload.estado).
  //   - Logging informativo (doc.tenantId).
  const docRef = db.collection(COLLECTIONS.CENTROS).doc(payload.centroId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El centro '${payload.centroId}' no existe.`,
    );
  }
  // Cast permisivo: confiamos en que el doc fue creado por crearCentro
  // (que escribe todos los campos required). Si en el futuro hubiera otra
  // fuente de escritura, este cast podría enmascarar undefined fields.
  const doc = snap.data() as Centro;

  // ==========================================================================
  //  FASE 2 — Construcción del diff
  // ==========================================================================
  const cambios: Record<string, unknown> = {};

  if (payload.nombre !== undefined) cambios["nombre"] = payload.nombre;
  if (payload.direccion !== undefined)
    cambios["direccion"] = payload.direccion;
  if (payload.ciudad !== undefined) cambios["ciudad"] = payload.ciudad;
  if (payload.provincia !== undefined)
    cambios["provincia"] = payload.provincia;
  if (payload.coordenadas !== undefined) {
    cambios["coordenadas"] = new GeoPoint(
      payload.coordenadas.latitude,
      payload.coordenadas.longitude,
    );
  }

  // Transición de estado (Opción A: si payload.estado === doc.estado, no-op
  // silencioso — no entramos al if; el audit se escribirá igual).
  if (payload.estado !== undefined && payload.estado !== doc.estado) {
    if (payload.estado === "inactivo" && doc.estado === "activo") {
      // D4.6: verificar que no hay conductores en estados bloqueantes
      // (activo, baja_temporal, vacaciones) antes de inactivar el centro.
      await assertNoConductoresActivosEnCentro(db, payload.centroId);
      cambios["estado"] = "inactivo";
    } else if (payload.estado === "activo" && doc.estado === "inactivo") {
      // Reactivación trivial: Centro no tiene `fechaCancelacion` que
      // borrar (a diferencia de Tenant).
      cambios["estado"] = "activo";
    } else {
      // Catch-all defensivo. Con solo 2 estados (`activo` | `inactivo`) y
      // el check de no-op anterior, esta rama no debería alcanzarse. Se
      // deja por simetría con actualizarTenant y por robustez si el union
      // `EstadoCentro` se amplía en el futuro.
      cambios["estado"] = payload.estado;
    }
  }

  // Auditoría D4.1 — SIEMPRE, sin excepción.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando centro", {
    centroId: payload.centroId,
    tenantId: doc.tenantId,
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
    logger.error("Error inesperado al actualizar centro", {
      err,
      centroId: payload.centroId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el centro.",
    );
  }

  logger.info("Centro actualizado", { centroId: payload.centroId });

  return {
    ok: true as const,
    centroId: payload.centroId,
  };
});
