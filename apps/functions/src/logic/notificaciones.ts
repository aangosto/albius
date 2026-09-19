import { type Firestore, FieldValue } from "firebase-admin/firestore";
import type { TipoNotificacion } from "@albius/shared";

import { COLLECTIONS } from "../collections";

/**
 * LÓGICA DE ESCRITURA REUTILIZABLE de notificaciones (B38.5, patrón D6.12).
 *
 * Pura (sin `request`, sin `auth`): la llaman los callables (que ya han hecho
 * su auth) y los orquestadores de background. La colección es `write: false`
 * para el cliente, así que ÉSTA es la única vía de alta.
 *
 * Hasta B38.5 los dos únicos escritores vivían inline en
 * `tasks/generarCuadranteWorker.ts` (notificaciones al jefe que lanzó la
 * generación). Se dejan donde están —cero regresión— y este módulo recoge los
 * productores nuevos; `notificarCuadrantePublicado` es el primero y
 * `escribirNotificacionesLote` queda lista para el `cambio_turno` de B38.4.
 */

// Límite de operaciones por writeBatch de Firestore.
const BATCH_SIZE = 500;

export interface NotificacionNueva {
  destinatarioId: string; // uid de /usuarios (NO conductorId)
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  datosContexto?: Record<string, unknown>;
}

/**
 * Escribe en LOTE notificaciones in-app. `estado: 'pendiente'` y
 * `canales: ['app']` son el shape que ya usa el worker del optimizador: para
 * la campana, "no leída" es `estado !== 'leida'`, así que 'pendiente' es el
 * estado correcto de una notificación recién creada y aún no abierta.
 * ('enviada' se reserva para cuando exista transporte real — email/push, ver
 * `TODO[email-transport]`.)
 *
 * Trocea en batches de 500 (cada batch atómico; el conjunto NO es una única
 * transacción — aceptable: una notificación perdida no corrompe nada).
 */
export async function escribirNotificacionesLote(
  db: Firestore,
  params: { tenantId: string; notificaciones: NotificacionNueva[] },
): Promise<{ creadas: number }> {
  const docs = params.notificaciones.map((n) => {
    const ref = db.collection(COLLECTIONS.NOTIFICACIONES).doc();
    return {
      ref,
      data: {
        id: ref.id,
        tenantId: params.tenantId,
        destinatarioId: n.destinatarioId,
        tipo: n.tipo,
        titulo: n.titulo,
        mensaje: n.mensaje,
        ...(n.datosContexto !== undefined && {
          datosContexto: n.datosContexto,
        }),
        canales: ["app"],
        estado: "pendiente",
        fechaCreacion: FieldValue.serverTimestamp(),
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

  return { creadas: docs.length };
}

/**
 * Notifica la publicación de un cuadrante a los conductores QUE TIENEN
 * ASIGNACIONES en él (B38.5). Cierra un agujero que existía desde B33.1: el
 * conductor no tenía forma de enterarse de que su horario ya estaba publicado.
 *
 * Dos saltos de identidad, porque `Notificacion.destinatarioId` es un uid de
 * /usuarios y las asignaciones apuntan a un conductorId:
 *   asignaciones.conductorId → conductores/{id}.usuarioId → destinatarioId
 *
 * `usuarioId` es OPCIONAL en el modelo `Conductor`: una ficha sin cuenta de
 * acceso (alta administrativa sin usuario, o dato legado) no es un error — se
 * omite y se devuelve el recuento en `sinUsuario` para que el caller lo
 * loggee. Notificar es best-effort; publicar es lo importante.
 *
 * Coste: 1 query de asignaciones del cuadrante con `.select('conductorId')`
 * (solo ese campo viaja, no los ~15 de cada asignación) + 1 query de los
 * conductores del centro + N/500 batches. Con el caso TUCARSA: ~916 + ~178
 * lecturas y 1 batch. Se paga una vez al publicar.
 *
 * Republicar (reabrir → publicar de nuevo) vuelve a notificar a propósito: el
 * horario ha cambiado y el conductor debe enterarse otra vez.
 */
export async function notificarCuadrantePublicado(
  db: Firestore,
  params: {
    cuadranteId: string;
    tenantId: string;
    centroId: string;
    año: number;
    mes: number;
  },
): Promise<{ creadas: number; sinUsuario: number }> {
  const asigSnap = await db
    .collection(COLLECTIONS.ASIGNACIONES)
    .where("cuadranteId", "==", params.cuadranteId)
    .select("conductorId")
    .get();

  const conductorIds = new Set<string>();
  for (const doc of asigSnap.docs) {
    const cid = doc.get("conductorId");
    if (typeof cid === "string" && cid.length > 0) conductorIds.add(cid);
  }
  if (conductorIds.size === 0) {
    return { creadas: 0, sinUsuario: 0 };
  }

  // Los conductores del centro (~178), no un getAll por id: una query sola
  // basta y el pool de un centro es pequeño.
  const condSnap = await db
    .collection(COLLECTIONS.CONDUCTORES)
    .where("centroId", "==", params.centroId)
    .get();

  const usuarioPorConductor = new Map<string, string>();
  for (const doc of condSnap.docs) {
    const uid = doc.get("usuarioId");
    if (typeof uid === "string" && uid.length > 0) {
      usuarioPorConductor.set(doc.id, uid);
    }
  }

  const mesLabel = `${String(params.mes).padStart(2, "0")}/${params.año}`;
  const notificaciones: NotificacionNueva[] = [];
  let sinUsuario = 0;
  for (const conductorId of conductorIds) {
    const destinatarioId = usuarioPorConductor.get(conductorId);
    if (destinatarioId === undefined) {
      sinUsuario += 1;
      continue;
    }
    notificaciones.push({
      destinatarioId,
      tipo: "cuadrante_publicado",
      titulo: "Tu horario ya está publicado",
      mensaje: `El cuadrante de ${mesLabel} se ha publicado. Ya puedes consultar tus turnos en Mi horario.`,
      datosContexto: {
        cuadranteId: params.cuadranteId,
        año: params.año,
        mes: params.mes,
      },
    });
  }

  const { creadas } = await escribirNotificacionesLote(db, {
    tenantId: params.tenantId,
    notificaciones,
  });
  return { creadas, sinUsuario };
}
