import { type Firestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { EstadoGeneracion, ModoGeneracion } from "@albius/shared";

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

/**
 * Marca el ESTADO DE GENERACIÓN ASÍNCRONA del cuadrante (B29 Fase C).
 *
 * Función DEDICADA, separada a propósito de `actualizarCuadranteDoc`: el progreso
 * de la generación ('generando'→'completado'/'error') es un eje ORTOGONAL a la
 * escritura de KPIs/regeneración (`estado` del documento: borrador/publicado/
 * cerrado). Por dos razones NO comparte el gate de `assertCuadranteEditable`:
 *   1. Marcar 'error' tras un fallo del motor NUNCA debe poder bloquearse por el
 *      estado del cuadrante (sería perder la señal de fallo).
 *   2. `estadoGeneracion` no es un KPI ni una regeneración: mezclarlo en la
 *      superficie de `actualizarCuadranteDoc` (y en su validator) la ensuciaría
 *      y obligaría a tocar el verify de B28. Manteniéndola aparte, B28 queda
 *      intacto (cero regresión) y cada función tiene una responsabilidad.
 * Solo verifica que el cuadrante existe y actualiza el eje + auditoría D4.1.
 *
 * `estadoGeneracion !== 'error'` LIMPIA `errorGeneracion` (FieldValue.delete): un
 * re-intento que pasa a 'generando'/'completado' no debe arrastrar el mensaje de
 * error de una corrida anterior.
 *
 * La llamarán el callable generarCuadrante (al lanzar) y el worker del optimizador
 * (B29 Fase C.3) con `actorId='optimizador'`. Pura (sin request/auth): la auth y
 * el anti-cross del jefe se quedan en el callable que la envuelve (patrón D6.12).
 */
export async function marcarEstadoGeneracion(
  db: Firestore,
  params: {
    cuadranteId: string;
    estadoGeneracion: EstadoGeneracion;
    errorGeneracion?: string;
    actorId: string;
  },
): Promise<void> {
  const ref = db.collection(COLLECTIONS.CUADRANTES).doc(params.cuadranteId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `El cuadrante '${params.cuadranteId}' no existe.`,
    );
  }

  const cambios: Record<string, unknown> = {
    estadoGeneracion: params.estadoGeneracion,
    // Auditoría D4.1 — SIEMPRE.
    actualizadoPor: params.actorId,
    actualizadoEn: FieldValue.serverTimestamp(),
  };
  if (params.estadoGeneracion === "error") {
    cambios["errorGeneracion"] =
      params.errorGeneracion ?? "Error desconocido durante la generación.";
  } else {
    // Limpia el mensaje de error de una corrida previa al re-generar / completar.
    cambios["errorGeneracion"] = FieldValue.delete();
  }

  await ref.update(cambios);
}
