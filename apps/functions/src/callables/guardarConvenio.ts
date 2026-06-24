import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Convenio } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateGuardarConvenioPayload } from "../validation";
import { assertCentroActivo } from "../refs";

/**
 * Callable guardarConvenio (B25). UPSERT del convenio SINGLETON por centro:
 * UN solo callable (no hay crear/actualizar separados) porque el doc id =
 * centroId es determinista (convenio/{centroId}, exactamente uno por centro).
 *
 *   - Auth: super_admin libre; jefe_trafico scoped a SU centro (anti cross-tenant
 *     + anti cross-centro contra el payload — el centroId del payload ES el id).
 *   - D5.1: assertCentroActivo (códigos D5.2: invalid-argument si no existe,
 *     failed-precondition si existe pero no activo).
 *   - Si NO existe convenio/{centroId} → CREATE con auditoría D3.7
 *     (creadoPor/creadoEn). Si existe → UPDATE con auditoría D4.1
 *     (actualizadoPor/actualizadoEn), preservando creadoPor/creadoEn originales
 *     (no se tocan en update) y vetando el cambio de tenantId (inmutable: el
 *     centro pertenece permanentemente a su tenant). El centroId es inmutable
 *     por construcción (= doc id).
 *   - doc id = centroId EXPLÍCITO (no autogenerado).
 *
 * Lectura: el convenio se lee por convenio/{centroId} directo desde el cliente
 * vía reglas (get-by-id), no necesita callable de lectura.
 *
 * Campos opcionales (convenioReferencia, computoHoras) siguen "omit = no tocar"
 * en UPDATE (coherente con el resto de updates del proyecto); los 9 límites son
 * requeridos y siempre se reescriben.
 */
export const guardarConvenio = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateGuardarConvenioPayload(request.data);

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede guardar el convenio de otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede guardar el convenio de otro centro.",
      );
    }
  }

  const db = getFirestore();

  await assertCentroActivo(db, payload.centroId); // D5.1

  // Campos de restricciones (comunes a CREATE y UPDATE). Los 9 límites son
  // requeridos; los 2 opcionales se incluyen solo si vienen presentes.
  const restricciones = {
    descansoMinimoEntreJornadasHoras: payload.descansoMinimoEntreJornadasHoras,
    maxHorasSemanales: payload.maxHorasSemanales,
    maxHorasAnuales: payload.maxHorasAnuales,
    minDomingosLibresAño: payload.minDomingosLibresAño,
    maxFinesSemanaConsecutivosTrabajados:
      payload.maxFinesSemanaConsecutivosTrabajados,
    maxDiasConsecutivosTrabajados: payload.maxDiasConsecutivosTrabajados,
    descansoSemanalMinimoHoras: payload.descansoSemanalMinimoHoras,
    antelacionMinimaPublicacionDias: payload.antelacionMinimaPublicacionDias,
    horasFestivoComputanComoExtras: payload.horasFestivoComputanComoExtras,
    ...(payload.convenioReferencia !== undefined && {
      convenioReferencia: payload.convenioReferencia,
    }),
    ...(payload.computoHoras !== undefined && {
      computoHoras: payload.computoHoras,
    }),
  };

  // doc id = centroId (singleton determinista).
  const docRef = db.collection(COLLECTIONS.CONVENIO).doc(payload.centroId);
  const snap = await docRef.get();
  const existe = snap.exists;

  // ==========================================================================
  //  FASE 2 — Escritura (CREATE si no existe, UPDATE si existe)
  // ==========================================================================
  if (!existe) {
    const convenioDoc = {
      id: payload.centroId,
      centroId: payload.centroId,
      tenantId: payload.tenantId,
      ...restricciones,
      creadoPor: invocadorUid, // D3.7
      creadoEn: FieldValue.serverTimestamp(), // D3.7
    };

    logger.info("Creando convenio", {
      centroId: payload.centroId,
      tenantId: payload.tenantId,
      invocadorUid,
      rolInvocador: claims.rol,
    });

    try {
      await docRef.set(convenioDoc);
    } catch (err) {
      logger.error("Error inesperado al crear convenio", {
        err,
        centroId: payload.centroId,
      });
      throw new HttpsError("internal", "Error inesperado al guardar el convenio.");
    }

    logger.info("Convenio creado", { centroId: payload.centroId });
    return { ok: true as const, centroId: payload.centroId, creado: true };
  }

  // UPDATE — el tenantId no cambia (el centro pertenece permanentemente a su
  // tenant). Defensa: rechaza si el payload trae un tenantId distinto al doc.
  const doc = snap.data() as Convenio;
  if (doc.tenantId !== payload.tenantId) {
    throw new HttpsError(
      "invalid-argument",
      "El tenantId del convenio no es editable (el centro pertenece permanentemente a su tenant).",
    );
  }

  const cambios: Record<string, unknown> = {
    ...restricciones,
    // Auditoría D4.1 — SIEMPRE. creadoPor/creadoEn se preservan (no se tocan).
    actualizadoPor: invocadorUid,
    actualizadoEn: FieldValue.serverTimestamp(),
  };

  logger.info("Actualizando convenio", {
    centroId: payload.centroId,
    tenantId: doc.tenantId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar convenio", {
      err,
      centroId: payload.centroId,
    });
    throw new HttpsError("internal", "Error inesperado al guardar el convenio.");
  }

  logger.info("Convenio actualizado", { centroId: payload.centroId });
  return { ok: true as const, centroId: payload.centroId, creado: false };
});
