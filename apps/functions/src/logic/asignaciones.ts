import {
  type Firestore,
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertCuadranteEditable } from "../refs";
import { assertFechaEnMes, type AsignacionItemPayload } from "../validation";

/**
 * LÓGICA DE ESCRITURA REUTILIZABLE de asignaciones (B28, patrón nuevo).
 *
 * Estas funciones contienen la escritura PURA (sin `request`, sin `auth`): las
 * llaman tanto los callables (que las envuelven con auth/anti-cross) como el
 * orquestador del optimizador (B29), que las invoca con `actorId='optimizador'`
 * sin pasar por un usuario. La auth y el anti-cross del jefe se quedan en el
 * callable; aquí solo vive la validación de dominio (cuadrante editable, fecha en
 * mes) y la mecánica de Firestore (batches).
 *
 * `actorId` se persiste como `creadoPor` (paralelo a 'bootstrap-cli'/'system-seed'
 * para escrituras no originadas por un usuario real).
 */

// Límite de operaciones por writeBatch de Firestore.
const BATCH_SIZE = 500;

/**
 * Escribe en LOTE asignaciones nuevas en un cuadrante en borrador. Deriva
 * tenant/centro del cuadrante (no del input), valida que cada fecha cae dentro
 * del mes, y trocea en batches de 500 (cada batch atómico; el conjunto NO es una
 * única transacción — aceptable para el volcado del optimizador).
 */
export async function escribirAsignacionesLote(
  db: Firestore,
  params: {
    cuadranteId: string;
    asignaciones: AsignacionItemPayload[];
    actorId: string;
  },
): Promise<{ creadas: number; asignacionIds: string[] }> {
  const cuadrante = await assertCuadranteEditable(db, params.cuadranteId);

  const docs = params.asignaciones.map((item) => {
    assertFechaEnMes(item.fecha, cuadrante.año, cuadrante.mes);
    const ref = db.collection(COLLECTIONS.ASIGNACIONES).doc();
    return {
      ref,
      data: {
        id: ref.id,
        tenantId: cuadrante.tenantId,
        centroId: cuadrante.centroId,
        cuadranteId: params.cuadranteId,
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
        creadoPor: params.actorId, // D3.7 (actorId='optimizador' si lo lanza el servicio)
        creadoEn: FieldValue.serverTimestamp(), // D3.7
      },
    };
  });

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { ref, data } of docs.slice(i, i + BATCH_SIZE)) {
      batch.set(ref, data);
    }
    await batch.commit();
  }

  return { creadas: docs.length, asignacionIds: docs.map((d) => d.ref.id) };
}

/**
 * Borra TODAS las asignaciones de un cuadrante en borrador (para vaciar un
 * borrador o como primer paso de una regeneración). Query por `cuadranteId` +
 * borrado en batches de 500.
 */
export async function limpiarAsignacionesCuadrante(
  db: Firestore,
  params: { cuadranteId: string; actorId: string },
): Promise<{ eliminadas: number }> {
  // Exige cuadrante en borrador (no se vacían asignaciones de uno publicado/cerrado).
  await assertCuadranteEditable(db, params.cuadranteId);

  const snap = await db
    .collection(COLLECTIONS.ASIGNACIONES)
    .where("cuadranteId", "==", params.cuadranteId)
    .get();

  const refs = snap.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }

  return { eliminadas: refs.length };
}

/**
 * Regenera el contenido de un cuadrante: LIMPIA todas sus asignaciones y luego
 * VUELCA las nuevas. Unidad lógica con orden definido (primero limpia, después
 * escribe), la que llamará el orquestador del optimizador (B29) en una sola
 * invocación.
 *
 * NO es una transacción atómica: cada paso usa múltiples writeBatch (el total de
 * docs supera el límite de 500/batch y el de 500 ops/transacción de Firestore).
 * Si falla a mitad, el cuadrante puede quedar parcialmente regenerado; el
 * orquestador debe reintentar la regeneración completa (idempotente: limpia todo
 * de nuevo antes de volcar).
 */
export async function regenerarAsignaciones(
  db: Firestore,
  params: {
    cuadranteId: string;
    nuevas: AsignacionItemPayload[];
    actorId: string;
  },
): Promise<{ eliminadas: number; creadas: number; asignacionIds: string[] }> {
  const { eliminadas } = await limpiarAsignacionesCuadrante(db, {
    cuadranteId: params.cuadranteId,
    actorId: params.actorId,
  });
  const { creadas, asignacionIds } = await escribirAsignacionesLote(db, {
    cuadranteId: params.cuadranteId,
    asignaciones: params.nuevas,
    actorId: params.actorId,
  });
  return { eliminadas, creadas, asignacionIds };
}
