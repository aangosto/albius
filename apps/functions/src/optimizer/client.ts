/**
 * Cliente HTTP AUTENTICADO al motor optimizador en Cloud Run (B29 Fase C).
 *
 * El motor está desplegado PRIVADO (--no-allow-unauthenticated): para invocarlo,
 * la Function mintea un ID token de Google con `audience = OPTIMIZER_URL` (la URL
 * base del servicio Cloud Run) y lo manda en el header Authorization: Bearer. La
 * SA de runtime de la Function necesita `roles/run.invoker` sobre el servicio
 * (concedido por el usuario en el setup de la Fase C).
 *
 * La URL se inyecta vía `defineString("OPTIMIZER_URL")` (firebase-functions/params),
 * fijada en `apps/functions/.env` al desplegar (NO se hardcodea; .env está en
 * .gitignore). No es un secreto (es una URL), por eso defineString y no defineSecret.
 */
import { defineString } from "firebase-functions/params";
import { GoogleAuth, type IdTokenClient } from "google-auth-library";

import type { OptimizarRequest, OptimizarResponse } from "./contract";

export const OPTIMIZER_URL = defineString("OPTIMIZER_URL");

// GoogleAuth + IdTokenClient cacheados entre invocaciones (warm). El audience del
// ID token es la URL base del Cloud Run; el token se renueva solo dentro del client.
let auth: GoogleAuth | undefined;
let idTokenClient: IdTokenClient | undefined;

async function getClient(): Promise<IdTokenClient> {
  const baseUrl = OPTIMIZER_URL.value();
  if (!baseUrl) {
    throw new Error(
      "OPTIMIZER_URL no está configurada (apps/functions/.env). No se puede invocar al motor.",
    );
  }
  auth ??= new GoogleAuth();
  // audience = URL BASE (sin path); debe coincidir con la URL del servicio Cloud Run.
  idTokenClient ??= await auth.getIdTokenClient(baseUrl);
  return idTokenClient;
}

/**
 * Llama al motor: POST {OPTIMIZER_URL}/optimizar con el OptimizarRequest, devuelve
 * el OptimizarResponse. SIN timeout del cliente HTTP (`timeout: 0`): el motor tarda
 * ~5 min y el límite real lo gobierna el worker `onTaskDispatched` (timeoutSeconds),
 * no este cliente. Los errores HTTP del motor (4xx/5xx) se relanzan con contexto
 * (status + cuerpo) para que el worker los capture y marque estadoGeneracion='error'.
 */
export async function llamarOptimizador(
  req: OptimizarRequest,
): Promise<OptimizarResponse> {
  const client = await getClient();
  const url = `${OPTIMIZER_URL.value()}/optimizar`;
  try {
    const res = await client.request<OptimizarResponse>({
      url,
      method: "POST",
      data: req,
      timeout: 0, // sin timeout del cliente — lo gobierna el worker
    });
    return res.data;
  } catch (err: unknown) {
    // gaxios lanza con `.response` en errores HTTP. Extraemos status + cuerpo.
    const e = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    if (e.response) {
      const body =
        typeof e.response.data === "string"
          ? e.response.data
          : JSON.stringify(e.response.data);
      throw new Error(
        `El motor optimizador respondió ${e.response.status}: ${body}`,
      );
    }
    throw new Error(
      `No se pudo contactar con el motor optimizador: ${e.message ?? String(err)}`,
    );
  }
}
