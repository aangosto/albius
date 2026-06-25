import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { GoogleAuth } from "google-auth-library";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCuadranteIdPayload } from "../validation";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";
import { marcarEstadoGeneracion } from "../logic/cuadrante";
import type { GenerarCuadranteTaskData } from "../tasks/generarCuadranteWorker";

const REGION = "europe-west1";
const WORKER_NAME = "generarCuadranteWorker";
// Techo de Cloud Tasks para el target HTTP (30 min); coincide con el
// timeoutSeconds del worker.
const DISPATCH_DEADLINE_SECONDS = 1800;

// URL del worker (Cloud Run de la function gen2) cacheada entre invocaciones.
let workerUri: string | undefined;
let authForUrl: GoogleAuth | undefined;

/**
 * Resuelve la URL del worker gen2 vía la API de Cloud Functions v2
 * (serviceConfig.uri). Necesario para encolar a Cloud Tasks: las funciones gen2
 * corren sobre Cloud Run con URL no determinista. La SA de la Function necesita
 * permiso de lectura sobre la config de la function (la compute default con
 * Editor ya lo tiene; una SA dedicada necesitaría roles/cloudfunctions.viewer).
 */
async function getWorkerUrl(): Promise<string> {
  if (workerUri) return workerUri;
  authForUrl ??= new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });
  const projectId = await authForUrl.getProjectId();
  const url = `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/${REGION}/functions/${WORKER_NAME}`;
  const client = await authForUrl.getClient();
  const res = await client.request<{ serviceConfig?: { uri?: string } }>({ url });
  const uri = res.data?.serviceConfig?.uri;
  if (!uri) {
    throw new Error(
      `No se pudo resolver la URL del worker ${WORKER_NAME} en ${REGION}.`,
    );
  }
  workerUri = uri;
  return uri;
}

/**
 * Callable generarCuadrante (B29 Fase C) — CORTO (<1s). Lanza la generación
 * ASÍNCRONA del cuadrante: valida + marca 'generando' + encola la Cloud Task que
 * dispara el worker, y devuelve el control al jefe inmediatamente. El trabajo
 * largo (~5 min, motor en Cloud Run) lo hace `generarCuadranteWorker`.
 *
 *   - region europe-west1 (co-localizado con el worker + el motor). OJO: el
 *     frontend deberá invocar este callable con esa región (hoy getFunctions usa
 *     us-central1, ver TODO[firebase-region]) — pendiente al cablear la UI (C.4).
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante (patrón
 *     B26/B28). El cuadrante debe EXISTIR y estar en 'borrador' (se genera sobre
 *     un borrador previo creado con crearCuadrante).
 *   - Rechaza si ya hay una generación en curso (estadoGeneracion=='generando').
 */
export const generarCuadrante = onCall({ region: REGION }, async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const { cuadranteId } = validateCuadranteIdPayload(request.data, "generarCuadrante");
  const db = getFirestore();

  // Lectura única: existencia + borrador + no-generando + datos para anti-cross/tarea.
  const snap = await db.collection(COLLECTIONS.CUADRANTES).doc(cuadranteId).get();
  if (!snap.exists) {
    throw new HttpsError("invalid-argument", `El cuadrante '${cuadranteId}' no existe.`);
  }
  const data = snap.data() ?? {};
  if (data["estado"] !== "borrador") {
    throw new HttpsError(
      "failed-precondition",
      `El cuadrante '${cuadranteId}' no es editable (estado=${typeof data["estado"] === "string" ? data["estado"] : "desconocido"}). Solo se genera sobre un cuadrante en borrador.`,
    );
  }
  if (data["estadoGeneracion"] === "generando") {
    throw new HttpsError(
      "failed-precondition",
      `Ya hay una generación en curso para el cuadrante '${cuadranteId}'.`,
    );
  }

  const cuadrante = {
    tenantId: typeof data["tenantId"] === "string" ? data["tenantId"] : "",
    centroId: typeof data["centroId"] === "string" ? data["centroId"] : "",
    año: typeof data["año"] === "number" ? data["año"] : 0,
    mes: typeof data["mes"] === "number" ? data["mes"] : 0,
  };
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  // Marca 'generando' (actorId = jefe que lanza). El front reactivo ya lo ve.
  await marcarEstadoGeneracion(db, {
    cuadranteId,
    estadoGeneracion: "generando",
    actorId: invocadorUid,
  });

  // Encola la tarea que dispara el worker. Si el encolado falla, revertimos a
  // 'error' para no dejar el cuadrante colgado en 'generando'.
  try {
    const taskData: GenerarCuadranteTaskData = {
      cuadranteId,
      tenantId: cuadrante.tenantId,
      centroId: cuadrante.centroId,
      año: cuadrante.año,
      mes: cuadrante.mes,
      generadoPor: invocadorUid,
    };
    const uri = await getWorkerUrl();
    // La región va en el RESOURCE PATH (el 2º arg de taskQueue es extensionId, no
    // región): `locations/{region}/functions/{name}`.
    const queueResource = `locations/${REGION}/functions/${WORKER_NAME}`;
    await getFunctions()
      .taskQueue<GenerarCuadranteTaskData>(queueResource)
      .enqueue(taskData, { dispatchDeadlineSeconds: DISPATCH_DEADLINE_SECONDS, uri });
  } catch (err) {
    logger.error("Error al encolar la generación", { cuadranteId, err });
    await marcarEstadoGeneracion(db, {
      cuadranteId,
      estadoGeneracion: "error",
      errorGeneracion: "No se pudo encolar la generación. Inténtalo de nuevo.",
      actorId: invocadorUid,
    });
    throw new HttpsError("internal", "No se pudo lanzar la generación del cuadrante.");
  }

  logger.info("Generación de cuadrante encolada", {
    cuadranteId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  return { ok: true as const, cuadranteId };
});
