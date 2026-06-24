import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { TipoTurno } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateActualizarTipoTurnoPayload } from "../validation";
import { assertCodigoTipoTurnoUnico } from "../refs";

/**
 * Callable actualizarTipoTurno (B18). Clon de actualizarLinea.
 *
 *   - Auditoría D4.1 (actualizadoPor/En) en TODA modificación, incluso no-ops.
 *   - Soft-delete D4.3 vía `estado` 'activo'↔'obsoleto' (UPDATE normal del
 *     campo, sin verificación de dependencias). TODO[tipoturno-obsoleto-conductores]:
 *     los conductores referencian tipos por ID (tiposTurnoPermitidos/Excluidos);
 *     marcar un tipo 'obsoleto' NO los desreferencia ni se bloquea — un tipo
 *     obsoleto sigue siendo referenciable históricamente. Revisar si conviene
 *     una verificación/cascada cuando exista el cuadrante (asignaciones reales).
 *   - D6.3: revalida unicidad por centro solo si `codigo` cambia (excludeId).
 *
 * No edita inmutables (id, tenantId, centroId, creadoPor, creadoEn): el
 * validator los rechaza. Reglas Firestore en /tipos_turno también los bloquean.
 *
 * Invocable por super_admin o jefe_trafico. Si invoca jefe, anti cross-tenant +
 * anti cross-centro contra el doc (no el payload, que no puede cambiarlos).
 */
export const actualizarTipoTurno = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones + lectura previa
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarTipoTurnoPayload(request.data);
  const db = getFirestore();

  const docRef = db.collection(COLLECTIONS.TIPOS_TURNO).doc(payload.tipoTurnoId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El tipo de turno '${payload.tipoTurnoId}' no existe.`,
    );
  }
  const doc = snap.data() as TipoTurno;

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar tipos de turno de otro tenant.",
      );
    }
    if (claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar tipos de turno de otro centro.",
      );
    }
  }

  // D6.3 en UPDATE: solo si el código cambia de valor real.
  if (payload.codigo !== undefined && payload.codigo !== doc.codigo) {
    await assertCodigoTipoTurnoUnico(
      db,
      doc.centroId,
      payload.codigo,
      payload.tipoTurnoId,
    );
  }

  // ==========================================================================
  //  FASE 2 — Construcción del diff
  // ==========================================================================
  const cambios: Record<string, unknown> = {};

  if (payload.codigo !== undefined) cambios["codigo"] = payload.codigo;
  if (payload.nombre !== undefined) cambios["nombre"] = payload.nombre;
  if (payload.horaInicio !== undefined)
    cambios["horaInicio"] = payload.horaInicio;
  if (payload.horaFin !== undefined) cambios["horaFin"] = payload.horaFin;
  if (payload.duracionMinutos !== undefined)
    cambios["duracionMinutos"] = payload.duracionMinutos;
  if (payload.duracionEfectivaMinutos !== undefined)
    cambios["duracionEfectivaMinutos"] = payload.duracionEfectivaMinutos;
  if (payload.esPartido !== undefined)
    cambios["esPartido"] = payload.esPartido;
  if (payload.esNocturno !== undefined)
    cambios["esNocturno"] = payload.esNocturno;
  if (payload.estado !== undefined) cambios["estado"] = payload.estado;
  if (payload.tiposDiaAplicables !== undefined)
    cambios["tiposDiaAplicables"] = payload.tiposDiaAplicables;
  if (payload.color !== undefined) cambios["color"] = payload.color;
  if (payload.tramosPartido !== undefined)
    cambios["tramosPartido"] = payload.tramosPartido;

  // Auditoría D4.1 — SIEMPRE.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando tipo de turno", {
    tipoTurnoId: payload.tipoTurnoId,
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
    logger.error("Error inesperado al actualizar tipo de turno", {
      err,
      tipoTurnoId: payload.tipoTurnoId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el tipo de turno.",
    );
  }

  logger.info("Tipo de turno actualizado", {
    tipoTurnoId: payload.tipoTurnoId,
  });

  return {
    ok: true as const,
    tipoTurnoId: payload.tipoTurnoId,
  };
});
