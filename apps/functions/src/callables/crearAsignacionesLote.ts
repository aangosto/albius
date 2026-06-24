import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import {
  validateCrearAsignacionesLotePayload,
  assertFechaEnMes,
} from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";

// Límite de operaciones por writeBatch de Firestore.
const BATCH_SIZE = 500;

/**
 * Callable crearAsignacionesLote (B26). Escribe en LOTE las asignaciones que el
 * optimizador (B27) volcará de golpe (decenas/cientos de filas). Mismo contrato
 * que crearAsignacion pero N a la vez, todas del MISMO cuadrante.
 *
 *   - Solo si el cuadrante está en 'borrador' (assertCuadranteEditable).
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 *   - tenantId/centroId DERIVADOS del cuadrante. fecha de cada item DENTRO del
 *     mes (assertFechaEnMes). 'libre' rechazado por el validator.
 *   - Escritura atómica por chunk: writeBatch de hasta 500 ops; si el lote excede
 *     500 se parte en varios batches (cada batch es atómico, el conjunto NO es
 *     una única transacción — aceptable para el volcado del optimizador, que
 *     regenera el cuadrante completo). El validator ya capó el tamaño (LOTE_MAX).
 *
 * Devuelve el nº de asignaciones creadas y sus ids.
 */
export const crearAsignacionesLote = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearAsignacionesLotePayload(request.data);
  const db = getFirestore();

  const cuadrante = await assertCuadranteEditable(db, payload.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  // Pre-construye todos los docs (valida fecha-en-mes antes de escribir nada).
  const docs = payload.asignaciones.map((item) => {
    assertFechaEnMes(item.fecha, cuadrante.año, cuadrante.mes);
    const ref = db.collection(COLLECTIONS.ASIGNACIONES).doc();
    return {
      ref,
      data: {
        id: ref.id,
        tenantId: cuadrante.tenantId,
        centroId: cuadrante.centroId,
        cuadranteId: payload.cuadranteId,
        conductorId: item.conductorId,
        fecha: Timestamp.fromDate(item.fecha),
        ...(item.tipoTurnoId !== undefined && {
          tipoTurnoId: item.tipoTurnoId,
        }),
        horaInicio: item.horaInicio,
        horaFin: item.horaFin,
        tipoAsignacion: item.tipoAsignacion,
        esIntercambiada: false,
        estado: item.estado ?? "planificada",
        creadoPor: invocadorUid, // D3.7
        creadoEn: FieldValue.serverTimestamp(), // D3.7
      },
    };
  });

  logger.info("Creando asignaciones en lote", {
    cuadranteId: payload.cuadranteId,
    total: docs.length,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { ref, data } of docs.slice(i, i + BATCH_SIZE)) {
        batch.set(ref, data);
      }
      await batch.commit();
    }
  } catch (err) {
    logger.error("Error inesperado al crear asignaciones en lote", {
      err,
      cuadranteId: payload.cuadranteId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al crear las asignaciones en lote.",
    );
  }

  logger.info("Asignaciones en lote creadas", {
    cuadranteId: payload.cuadranteId,
    total: docs.length,
  });

  return {
    ok: true as const,
    creadas: docs.length,
    asignacionIds: docs.map((d) => d.ref.id),
  };
});
