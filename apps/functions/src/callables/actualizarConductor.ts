import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Conductor } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateActualizarConductorPayload } from "../validation";

/**
 * Callable actualizarConductor (B21, cierra TODO[conductor-campos-operativos-en-alta]).
 * Clon del molde de actualizarLinea/actualizarTipoTurno.
 *
 * Edita SOLO los campos que viven exclusivamente en /conductores: las
 * preferencias operativas (lineasPreferentes, lineasSecundarias,
 * tiposTurnoPermitidos, tiposTurnoExcluidos), maxHorasSemanales, observaciones,
 * puedeSerReserva y el estado operativo (EstadoConductor). El validator veta la
 * identidad/pertenencia (id/tenantId/centroId/dni/usuarioId/numeroEmpleado/
 * categoria/fechas) y los campos dual-homed con /usuarios (email/telefono/
 * nombre/apellidos → actualizarUsuario, D5.4) para no driftear.
 *
 *   - Auditoría D4.1 (actualizadoPor/En) en TODA modificación, incluso no-ops.
 *   - TODO[conductor-fechabaja-cascada]: NO valida que los IDs de líneas/tipos
 *     referencien docs reales (paridad con crearConductor; assertOptionalStringArray
 *     solo valida formato; la UI ofrece solo IDs del centro vía los pickers).
 *     Y NO gestiona fechaBaja al pasar a 'baja_definitiva' (sin cascada en MVP,
 *     sin turnos asignados). Ambas se revisarán cuando exista el cuadrante.
 *
 * Invocable por super_admin o jefe_trafico. Si invoca jefe, anti cross-tenant +
 * anti cross-centro contra el DOC (no el payload, que no puede cambiarlos),
 * simétrico a actualizarLinea/actualizarTipoTurno.
 */
export const actualizarConductor = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones + lectura previa
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarConductorPayload(request.data);
  const db = getFirestore();

  const docRef = db
    .collection(COLLECTIONS.CONDUCTORES)
    .doc(payload.conductorId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El conductor '${payload.conductorId}' no existe.`,
    );
  }
  const doc = snap.data() as Conductor;

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar conductores de otro tenant.",
      );
    }
    if (claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar conductores de otro centro.",
      );
    }
  }

  // ==========================================================================
  //  FASE 2 — Construcción del diff
  // ==========================================================================
  const cambios: Record<string, unknown> = {};

  if (payload.lineasPreferentes !== undefined)
    cambios["lineasPreferentes"] = payload.lineasPreferentes;
  if (payload.lineasSecundarias !== undefined)
    cambios["lineasSecundarias"] = payload.lineasSecundarias;
  if (payload.tiposTurnoPermitidos !== undefined)
    cambios["tiposTurnoPermitidos"] = payload.tiposTurnoPermitidos;
  if (payload.tiposTurnoExcluidos !== undefined)
    cambios["tiposTurnoExcluidos"] = payload.tiposTurnoExcluidos;
  if (payload.maxHorasSemanales !== undefined)
    cambios["maxHorasSemanales"] = payload.maxHorasSemanales;
  if (payload.observaciones !== undefined)
    cambios["observaciones"] = payload.observaciones;
  if (payload.puedeSerReserva !== undefined)
    cambios["puedeSerReserva"] = payload.puedeSerReserva;
  if (payload.estado !== undefined) cambios["estado"] = payload.estado;

  // Auditoría D4.1 — SIEMPRE.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando conductor", {
    conductorId: payload.conductorId,
    tenantId: doc.tenantId,
    centroId: doc.centroId,
    campos: Object.keys(cambios).filter(
      (k) => k !== "actualizadoPor" && k !== "actualizadoEn",
    ),
    invocadorUid,
    rolInvocador: claims.rol,
  });

  // ==========================================================================
  //  FASE 3 — Escritura
  // ==========================================================================
  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar conductor", {
      err,
      conductorId: payload.conductorId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el conductor.",
    );
  }

  logger.info("Conductor actualizado", { conductorId: payload.conductorId });

  return {
    ok: true as const,
    conductorId: payload.conductorId,
  };
});
