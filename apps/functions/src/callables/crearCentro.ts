import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, GeoPoint } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdmin } from "../auth-guards";
import { validateCrearCentroPayload } from "../validation";
import { assertTenantActivo } from "../refs";

/**
 * Callable crearCentro.
 *
 * Crea un nuevo centro operativo dentro de un tenant existente y activo con:
 *   - Documento /centros/{auto-id} (ID generado por Firestore).
 *   - Auditoría D3.7 (creadoPor = uid invocador, creadoEn = serverTimestamp).
 *   - NO escribe actualizadoPor/actualizadoEn — esos son de D4.1 (UPDATE).
 *   - Validación jerárquica D5.1: assertTenantActivo verifica que el tenant
 *     padre existe Y está en estado 'activo' antes de aceptar la creación.
 *     Códigos de error según D5.2: invalid-argument si el tenant no existe,
 *     failed-precondition si existe pero no está activo.
 *   - Defaults backend D4.2: solo estado='activo' hardcoded. Centro no tiene
 *     `configuracion` ni `plan` que defaultar — defaults trivializados.
 *   - Sin validador de dominio (no hay CIF ni equivalente para Centro).
 *
 * Coordenadas: el wire usa `{latitude, longitude}` como objeto plano JSON
 * (validado en `assertOptionalCoordenadas`). La conversión a `GeoPoint` de
 * firebase-admin/firestore se hace AQUÍ, en el momento de la escritura,
 * para mantener validation.ts libre de dependencias de firebase-admin.
 *
 * Solo invocable por super_admin (decisión multi-tenant MVP, ver §13 D5.x:
 * jefes operan dentro de UN centro fijo; multi-centro/tenant es uso interno
 * del super_admin).
 *
 * Sin rollback: una sola escritura Firestore. Si falla, falla y ya.
 * Simétrico a crearTenant.
 */
export const crearCentro = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones (sin estado mutado)
  // ==========================================================================
  const { uid: invocadorUid } = assertSuperAdmin(request);
  const payload = validateCrearCentroPayload(request.data);

  const db = getFirestore();

  // Gate D5.1: tenant padre existe Y está activo.
  await assertTenantActivo(db, payload.tenantId);

  logger.info("Creando centro", {
    tenantId: payload.tenantId,
    nombre: payload.nombre,
    invocadorUid,
  });

  // ==========================================================================
  //  FASE 2 — Escritura única
  // ==========================================================================
  const docRef = db.collection(COLLECTIONS.CENTROS).doc();

  const centroDoc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    nombre: payload.nombre,
    ciudad: payload.ciudad,
    provincia: payload.provincia,
    estado: "activo" as const,
    fechaCreacion: FieldValue.serverTimestamp(),
    ...(payload.direccion !== undefined && { direccion: payload.direccion }),
    ...(payload.coordenadas !== undefined && {
      coordenadas: new GeoPoint(
        payload.coordenadas.latitude,
        payload.coordenadas.longitude,
      ),
    }),
    creadoPor: invocadorUid,
    creadoEn: FieldValue.serverTimestamp(),
  };

  try {
    await docRef.set(centroDoc);
  } catch (err) {
    logger.error("Error inesperado al crear centro", {
      err,
      tenantId: payload.tenantId,
      nombre: payload.nombre,
    });
    throw new HttpsError("internal", "Error inesperado al crear el centro.");
  }

  logger.info("Centro creado", {
    centroId: docRef.id,
    tenantId: payload.tenantId,
  });

  return {
    ok: true as const,
    centroId: docRef.id,
  };
});
