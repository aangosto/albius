import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearCuadrantePayload } from "../validation";
import { assertCentroActivo } from "../refs";

/**
 * Callable crearCuadrante (B26). Crea el cuadrante mensual de un centro en estado
 * 'borrador' (la "mesa" donde el optimizador volcará asignaciones en B27 y donde
 * el jefe las edita a mano).
 *
 *   - id DETERMINISTA `cua_{centroId}_{año}_{mes}` (singleton por centro+mes,
 *     patrón D6.9-like). Si ya existe → 'already-exists' (un cuadrante del mes no
 *     se recrea; se regenera/edita). doc id EXPLÍCITO (no autogenerado).
 *   - Auth: super_admin libre; jefe_trafico scoped a SU tenant+centro.
 *   - D5.1: assertCentroActivo (D5.2: invalid-argument si no existe,
 *     failed-precondition si existe pero no activo).
 *   - Auditoría D3.7 (creadoPor/creadoEn). Campos de dominio de la generación:
 *     generadoPor=invocador, fechaGeneracion=now, modoGeneracion=payload??'manual'
 *     (alta manual en B26; el optimizador pasará 'optimizador_*' en B27).
 *   - versionActual=1 (contador de dominio forward-compat; los snapshots de
 *     versión —versiones_cuadrante— se difieren al bloque de Intercambios).
 */
export const crearCuadrante = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearCuadrantePayload(request.data);

  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear cuadrantes en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear cuadrantes en otro centro.",
      );
    }
  }

  const db = getFirestore();
  await assertCentroActivo(db, payload.centroId); // D5.1

  const cuadranteId = `cua_${payload.centroId}_${payload.año}_${payload.mes}`;
  const docRef = db.collection(COLLECTIONS.CUADRANTES).doc(cuadranteId);
  const snap = await docRef.get();
  if (snap.exists) {
    throw new HttpsError(
      "already-exists",
      `Ya existe un cuadrante para el centro '${payload.centroId}' en ${payload.año}-${String(payload.mes).padStart(2, "0")}.`,
    );
  }

  const cuadranteDoc = {
    id: cuadranteId,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    año: payload.año,
    mes: payload.mes,
    estado: "borrador" as const,
    versionActual: 1,
    fechaGeneracion: FieldValue.serverTimestamp(), // dominio
    generadoPor: invocadorUid, // dominio
    modoGeneracion: payload.modoGeneracion ?? "manual", // D4.2
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  logger.info("Creando cuadrante", {
    cuadranteId,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.set(cuadranteDoc);
  } catch (err) {
    logger.error("Error inesperado al crear cuadrante", { err, cuadranteId });
    throw new HttpsError("internal", "Error inesperado al crear el cuadrante.");
  }

  logger.info("Cuadrante creado", { cuadranteId });
  return { ok: true as const, cuadranteId };
});
