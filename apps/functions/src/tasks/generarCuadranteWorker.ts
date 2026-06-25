/**
 * Worker ASÍNCRONO de generación del cuadrante (B29 Fase C). onTaskDispatched
 * (Cloud Tasks, gen2, europe-west1) — el trabajo LARGO (~5 min) que el callable
 * `generarCuadrante` encola y no espera.
 *
 * Flujo (dirección C1 + Opción C de B28): lee Firestore → compone el request →
 * llama al motor en Cloud Run (autenticado) → ESCRIBE el plan con la maquinaria
 * de B28 (regenerarAsignaciones + actualizarCuadranteDoc, actorId='optimizador')
 * → marca estadoGeneracion='completado' + notifica. Si algo falla, marca
 * estadoGeneracion='error' con un mensaje legible (el front reactivo lo muestra).
 *
 * Region europe-west1: co-localizado con el Cloud Run del motor (latencia) y con
 * la cola de Cloud Tasks. timeoutSeconds=1800 (techo de task queue, 30 min): el
 * motor mide ~5 min, el margen cubre centros grandes + cold start del Cloud Run.
 *
 * retryConfig maxAttempts=1: los errores de APLICACIÓN (sin convenio, infeasible,
 * 4xx del motor) se CAPTURAN y marcan 'error' sin relanzar → no reintentan (sería
 * determinista y caro: otro intento de 5 min). Solo un fallo de INFRAESTRUCTURA
 * (crash/timeout/OOM antes del catch) dejaría la tarea sin completar; con
 * maxAttempts=1 NO se reintenta y el cuadrante quedaría en 'generando' (el jefe
 * re-lanza manualmente; regenerarAsignaciones es idempotente). Ver
 * TODO[generacion-stuck-reset] para un reset/timeout de 'generando' colgado.
 */
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { construirOptimizarRequest } from "../optimizer/buildRequest";
import { llamarOptimizador } from "../optimizer/client";
import { regenerarAsignaciones } from "../logic/asignaciones";
import {
  actualizarCuadranteDoc,
  marcarEstadoGeneracion,
} from "../logic/cuadrante";
import type { AsignacionItemPayload } from "../validation";

const ACTOR = "optimizador";

/** Payload que el callable `generarCuadrante` encola para este worker. */
export interface GenerarCuadranteTaskData {
  cuadranteId: string;
  tenantId: string;
  centroId: string;
  año: number;
  mes: number;
  generadoPor: string; // uid del jefe que lanzó la generación (destinatario de la notificación)
}

export const generarCuadranteWorker = onTaskDispatched<GenerarCuadranteTaskData>(
  {
    region: "europe-west1",
    timeoutSeconds: 1800,
    memory: "512MiB",
    retryConfig: { maxAttempts: 1 },
    rateLimits: { maxConcurrentDispatches: 2 },
  },
  async (req) => {
    const { cuadranteId, tenantId, centroId, año, mes, generadoPor } = req.data;
    const db = getFirestore();

    logger.info("Worker generación: inicio", { cuadranteId, centroId, año, mes });

    try {
      // a. Compone el request desde Firestore.
      const optReq = await construirOptimizarRequest(db, {
        tenantId,
        centroId,
        año,
        mes,
      });

      // b. Llama al motor (Cloud Run, ~5 min).
      const plan = await llamarOptimizador(optReq);

      // c. Parsea las asignaciones (fecha ISO → Date UTC, como espera B28).
      const nuevas: AsignacionItemPayload[] = plan.asignaciones.map((a) => ({
        conductorId: a.conductorId,
        fecha: new Date(`${a.fecha}T00:00:00.000Z`),
        tipoAsignacion: a.tipoAsignacion,
        tipoTurnoId: a.tipoTurnoId,
        horaInicio: a.horaInicio,
        horaFin: a.horaFin,
        estado: a.estado,
      }));

      // d. Vuelca el plan (limpia+escribe, idempotente).
      const { creadas } = await regenerarAsignaciones(db, {
        cuadranteId,
        nuevas,
        actorId: ACTOR,
      });

      // e. KPIs + bloque de regeneración.
      await actualizarCuadranteDoc(db, {
        cuadranteId,
        estadisticas: { ...plan.estadisticas },
        regeneracion: { generadoPor, modoGeneracion: "optimizador_libre" },
        actorId: ACTOR,
      });

      // f. Marca completado (limpia errorGeneracion de corridas previas).
      await marcarEstadoGeneracion(db, {
        cuadranteId,
        estadoGeneracion: "completado",
        actorId: ACTOR,
      });

      // g. Notifica al jefe (shape exacto del modelo Notificacion).
      await db.collection(COLLECTIONS.NOTIFICACIONES).add({
        tenantId,
        destinatarioId: generadoPor,
        tipo: "cuadrante_generado",
        titulo: "Cuadrante generado",
        mensaje: `El cuadrante de ${String(mes).padStart(2, "0")}/${año} se ha generado (cobertura ${plan.estadisticas.coberturaServicios}%, ${creadas} asignaciones).`,
        datosContexto: {
          cuadranteId,
          coberturaServicios: plan.estadisticas.coberturaServicios,
          asignaciones: creadas,
        },
        canales: ["app"],
        estado: "pendiente",
        fechaCreacion: FieldValue.serverTimestamp(),
      });

      logger.info("Worker generación: completado", { cuadranteId, creadas });
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      logger.error("Worker generación: error", { cuadranteId, err });
      // El error es de aplicación (no se relanza → no reintenta). Lo dejamos
      // visible en el cuadrante para el front reactivo.
      await marcarEstadoGeneracion(db, {
        cuadranteId,
        estadoGeneracion: "error",
        errorGeneracion: mensaje,
        actorId: ACTOR,
      });
      // Notificación de error al jefe (mismo shape). tipo:'otro' — el error NO es
      // un evento de "cuadrante generado"; semánticamente es otra cosa.
      await db.collection(COLLECTIONS.NOTIFICACIONES).add({
        tenantId,
        destinatarioId: generadoPor,
        tipo: "otro",
        titulo: "Error al generar el cuadrante",
        mensaje: `No se pudo generar el cuadrante de ${String(mes).padStart(2, "0")}/${año}: ${mensaje}`,
        datosContexto: { cuadranteId, error: mensaje },
        canales: ["app"],
        estado: "pendiente",
        fechaCreacion: FieldValue.serverTimestamp(),
      });
    }
  },
);
