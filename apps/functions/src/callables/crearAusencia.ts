import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearAusenciaPayload } from "../validation";
import {
  assertCentroActivo,
  assertConductorDelCentro,
  assertNoSolapeAusencia,
} from "../refs";

/**
 * Callable crearAusencia (B32). Registra una ausencia por RANGO (vacaciones /
 * baja / permiso) de un conductor del centro. Molde: crearFestivo (B27).
 *
 *   - Auth: super_admin libre; jefe_trafico scoped a su tenant+centro
 *     (anti-cross contra el payload).
 *   - D5.1: assertCentroActivo. El conductor debe existir y ser del centro
 *     (assertConductorDelCentro, laxo: no exige estado activo).
 *   - Rango cerrado inicio<=fin (validator) + no-solape con otras ausencias del
 *     mismo conductor (assertNoSolapeAusencia → failed-precondition).
 *   - NO se materializa como Asignacion (D6.10 + regenerarAsignaciones la
 *     borraría): vive solo en `ausencias`.
 *   - Auditoría D3.7. id autogenerado.
 */
export const crearAusencia = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearAusenciaPayload(request.data);

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede registrar ausencias en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede registrar ausencias en otro centro.",
      );
    }
  }

  const db = getFirestore();
  await assertCentroActivo(db, payload.centroId); // D5.1
  await assertConductorDelCentro(db, payload.conductorId, payload.centroId);
  await assertNoSolapeAusencia(db, {
    conductorId: payload.conductorId,
    fechaInicio: payload.fechaInicio,
    fechaFin: payload.fechaFin,
  });

  const docRef = db.collection(COLLECTIONS.AUSENCIAS).doc();
  const ausenciaDoc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    conductorId: payload.conductorId,
    categoria: payload.categoria,
    ...(payload.codigo !== undefined && { codigo: payload.codigo }),
    fechaInicio: Timestamp.fromDate(payload.fechaInicio),
    fechaFin: Timestamp.fromDate(payload.fechaFin),
    ...(payload.observaciones !== undefined && {
      observaciones: payload.observaciones,
    }),
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  logger.info("Creando ausencia", {
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    conductorId: payload.conductorId,
    categoria: payload.categoria,
    fechaInicio: payload.fechaInicio.toISOString().slice(0, 10),
    fechaFin: payload.fechaFin.toISOString().slice(0, 10),
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.set(ausenciaDoc);
  } catch (err) {
    logger.error("Error inesperado al crear ausencia", { err });
    throw new HttpsError("internal", "Error inesperado al crear la ausencia.");
  }

  return { ok: true as const, ausenciaId: docRef.id };
});
