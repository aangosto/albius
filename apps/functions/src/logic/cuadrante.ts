import { type Firestore, FieldValue } from "firebase-admin/firestore";
import type { ModoGeneracion } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertCuadranteEditable } from "../refs";

/**
 * LÓGICA DE ESCRITURA REUTILIZABLE del documento Cuadrante (B28, patrón nuevo).
 *
 * Pura (sin `request`, sin `auth`): la llaman el callable actualizarCuadrante
 * (que la envuelve con auth/anti-cross) y el orquestador del optimizador (B29),
 * que la invoca con `actorId='optimizador'` para escribir los KPIs del resultado.
 *
 * Superficie acotada (B28): `estadisticas` (KPIs) y, si el optimizador (re)genera,
 * el bloque de generación (`generadoPor`/`fechaGeneracion`/`modoGeneracion`).
 * `fechaGeneracion` se sella aquí con serverTimestamp (no viene del input).
 * Exige cuadrante en BORRADOR (assertCuadranteEditable): el caso de B28 es el
 * optimizador escribiendo en borrador. TODO[actualizar-cuadrante-estadisticas-publicado]:
 * cuando llegue Intercambios, permitir escribir `estadisticas` (solo) en estado
 * publicado (recálculo de KPIs tras intercambio); hoy se exige borrador.
 *
 * Devuelve los datos mínimos del cuadrante (tenantId/centroId) para que el callable
 * haga el anti-cross sin re-leer.
 */
export async function actualizarCuadranteDoc(
  db: Firestore,
  params: {
    cuadranteId: string;
    estadisticas?: Record<string, number>;
    regeneracion?: { generadoPor: string; modoGeneracion: ModoGeneracion };
    actorId: string;
  },
): Promise<{ tenantId: string; centroId: string }> {
  const cuadrante = await assertCuadranteEditable(db, params.cuadranteId);

  const cambios: Record<string, unknown> = {};
  if (params.estadisticas !== undefined) {
    cambios["estadisticas"] = params.estadisticas;
  }
  if (params.regeneracion !== undefined) {
    cambios["generadoPor"] = params.regeneracion.generadoPor;
    cambios["modoGeneracion"] = params.regeneracion.modoGeneracion;
    cambios["fechaGeneracion"] = FieldValue.serverTimestamp(); // server-stamped
  }

  // Auditoría D4.1 — SIEMPRE.
  cambios["actualizadoPor"] = params.actorId;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  await db
    .collection(COLLECTIONS.CUADRANTES)
    .doc(params.cuadranteId)
    .update(cambios);

  return { tenantId: cuadrante.tenantId, centroId: cuadrante.centroId };
}
