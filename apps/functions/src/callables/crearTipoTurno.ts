import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearTipoTurnoPayload } from "../validation";
import { assertCentroActivo, assertCodigoTipoTurnoUnico } from "../refs";

/**
 * Callable crearTipoTurno (B18). Clon de crearLinea: entidad operativa del jefe
 * que cuelga de un centro.
 *
 *   - Documento /tipos_turno/{auto-id} (ID generado por Firestore).
 *   - Auditoría D3.7 (creadoPor + creadoEn). NO escribe actualizado* (D4.1 UPDATE).
 *   - D5.1: assertCentroActivo (códigos D5.2: invalid-argument si no existe,
 *     failed-precondition si existe pero no activo).
 *   - D6.3: assertCodigoTipoTurnoUnico (unicidad de código por centro).
 *   - Sin defaults D4.2: todos los campos required vienen del payload (estado,
 *     esPartido, esNocturno son required; el validator ya gateó tramosPartido
 *     según esPartido).
 *
 * Invocable por super_admin o jefe_trafico. Si invoca jefe, anti cross-tenant +
 * anti cross-centro (D3.6 ampliado), simétrico a crearLinea/crearConductor.
 */
export const crearTipoTurno = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearTipoTurnoPayload(request.data);

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear tipos de turno en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear tipos de turno en otro centro.",
      );
    }
  }

  const db = getFirestore();

  await assertCentroActivo(db, payload.centroId); // D5.1
  await assertCodigoTipoTurnoUnico(db, payload.centroId, payload.codigo); // D6.3

  logger.info("Creando tipo de turno", {
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    codigo: payload.codigo,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  // ==========================================================================
  //  FASE 2 — Escritura única
  // ==========================================================================
  const docRef = db.collection(COLLECTIONS.TIPOS_TURNO).doc();

  const tipoTurnoDoc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    codigo: payload.codigo,
    nombre: payload.nombre,
    horaInicio: payload.horaInicio,
    horaFin: payload.horaFin,
    duracionMinutos: payload.duracionMinutos,
    duracionEfectivaMinutos: payload.duracionEfectivaMinutos,
    esPartido: payload.esPartido,
    esNocturno: payload.esNocturno,
    estado: payload.estado,
    ...(payload.color !== undefined && { color: payload.color }),
    ...(payload.tramosPartido !== undefined && {
      tramosPartido: payload.tramosPartido,
    }),
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  try {
    await docRef.set(tipoTurnoDoc);
  } catch (err) {
    logger.error("Error inesperado al crear tipo de turno", {
      err,
      centroId: payload.centroId,
      codigo: payload.codigo,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al crear el tipo de turno.",
    );
  }

  logger.info("Tipo de turno creado", {
    tipoTurnoId: docRef.id,
    centroId: payload.centroId,
    codigo: payload.codigo,
  });

  return {
    ok: true as const,
    tipoTurnoId: docRef.id,
  };
});
