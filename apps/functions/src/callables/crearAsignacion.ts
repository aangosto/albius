import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico, type Claims } from "../auth-guards";
import { validateCrearAsignacionPayload, assertFechaEnMes } from "../validation";
import { assertCuadranteEditable } from "../refs";

/**
 * Anti-cross del jefe sobre el cuadrante padre de una asignación. El
 * tenantId/centroId de la asignación se DERIVAN del cuadrante (no del payload),
 * así que el check se hace contra los del cuadrante. Compartido por
 * crear/actualizar/eliminar/lote de asignaciones (B26).
 */
export function assertJefePuedeTocarCuadrante(
  claims: Claims,
  cuadrante: { tenantId: string; centroId: string },
): void {
  if (claims.rol === "jefe_trafico") {
    if (
      claims.tenantId !== cuadrante.tenantId ||
      claims.centroId !== cuadrante.centroId
    ) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede tocar asignaciones de otro centro o tenant.",
      );
    }
  }
}

/**
 * Callable crearAsignacion (B26). Crea UNA asignación (1 conductor × 1 día ×
 * 1 turno/reserva/vacaciones/baja) en un cuadrante en borrador. El jefe la usa
 * para editar a mano; el optimizador (B27) usará crearAsignacionesLote.
 *
 *   - Solo si el cuadrante está en 'borrador' (assertCuadranteEditable, D5.2).
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 *   - tenantId/centroId DERIVADOS del cuadrante (evita drift; no viajan en payload).
 *   - fecha DENTRO del mes del cuadrante (assertFechaEnMes).
 *   - 'libre' rechazado por el validator (no se materializa el descanso).
 *   - esIntercambiada=false (los intercambios son bloque futuro). estado
 *     defaultea 'planificada'. Auditoría D3.7.
 *
 * NO valida que conductorId/tipoTurnoId referencien docs reales (paridad con la
 * laxitud del proyecto; la UI solo ofrecerá ids del centro). Ver
 * TODO[asignacion-validar-referencias] al abordar el cuadrante visual / B27.
 */
export const crearAsignacion = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearAsignacionPayload(request.data);
  const db = getFirestore();

  const cuadrante = await assertCuadranteEditable(db, payload.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);
  assertFechaEnMes(payload.fecha, cuadrante.año, cuadrante.mes);

  const docRef = db.collection(COLLECTIONS.ASIGNACIONES).doc();
  const asignacionDoc = {
    id: docRef.id,
    tenantId: cuadrante.tenantId,
    centroId: cuadrante.centroId,
    cuadranteId: payload.cuadranteId,
    conductorId: payload.conductorId,
    fecha: Timestamp.fromDate(payload.fecha),
    ...(payload.tipoTurnoId !== undefined && {
      tipoTurnoId: payload.tipoTurnoId,
    }),
    horaInicio: payload.horaInicio,
    horaFin: payload.horaFin,
    tipoAsignacion: payload.tipoAsignacion,
    esIntercambiada: false,
    estado: payload.estado ?? "planificada",
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  logger.info("Creando asignación", {
    cuadranteId: payload.cuadranteId,
    conductorId: payload.conductorId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.set(asignacionDoc);
  } catch (err) {
    logger.error("Error inesperado al crear asignación", {
      err,
      cuadranteId: payload.cuadranteId,
    });
    throw new HttpsError("internal", "Error inesperado al crear la asignación.");
  }

  return { ok: true as const, asignacionId: docRef.id };
});
