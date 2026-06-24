import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateActualizarCuadrantePayload } from "../validation";
import { assertCuadranteEditable } from "../refs";
import { assertJefePuedeTocarCuadrante } from "./crearAsignacion";
import { actualizarCuadranteDoc } from "../logic/cuadrante";

/**
 * Callable actualizarCuadrante (B28). Escribe los KPIs (`estadisticas`) y/o el
 * bloque de generación (`generadoPor`/`fechaGeneracion`/`modoGeneracion`) de un
 * cuadrante en borrador. Lo usa el jefe y, vía la función `actualizarCuadranteDoc`,
 * el orquestador del optimizador (B29) tras volcar el plan.
 *
 *   - Solo si el cuadrante está en 'borrador' (assertCuadranteEditable).
 *   - Auth: super_admin libre; jefe scoped anti-cross contra el cuadrante.
 *   - Veto de inmutables (id, tenantId, centroId, año, mes, estado, publicadoPor,
 *     fechaPublicacion, versionActual, creadoPor, creadoEn) en el validator.
 *   - Auditoría D4.1 (actualizadoPor=invocador).
 */
export const actualizarCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarCuadrantePayload(request.data);
  const db = getFirestore();

  // Anti-cross del jefe (necesita tenant/centro del cuadrante antes de escribir).
  const cuadrante = await assertCuadranteEditable(db, payload.cuadranteId);
  assertJefePuedeTocarCuadrante(claims, cuadrante);

  logger.info("Actualizando cuadrante", {
    cuadranteId: payload.cuadranteId,
    campos: [
      ...(payload.estadisticas !== undefined ? ["estadisticas"] : []),
      ...(payload.regeneracion !== undefined ? ["regeneracion"] : []),
    ],
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await actualizarCuadranteDoc(db, {
      cuadranteId: payload.cuadranteId,
      ...(payload.estadisticas !== undefined && {
        estadisticas: payload.estadisticas,
      }),
      ...(payload.regeneracion !== undefined && {
        regeneracion: payload.regeneracion,
      }),
      actorId: invocadorUid,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("Error inesperado al actualizar cuadrante", {
      err,
      cuadranteId: payload.cuadranteId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el cuadrante.",
    );
  }

  return { ok: true as const, cuadranteId: payload.cuadranteId };
});
