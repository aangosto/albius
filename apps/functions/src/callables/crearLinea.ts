import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearLineaPayload } from "../validation";
import { assertCentroActivo, assertCodigoLineaUnico } from "../refs";

/**
 * Callable crearLinea (B16, primer modelo operativo).
 *
 * Crea una línea de transporte dentro de un centro existente y activo con:
 *   - Documento /lineas/{auto-id} (ID generado por Firestore).
 *   - Auditoría D3.7 (creadoPor = uid invocador, creadoEn = serverTimestamp).
 *     NO escribe actualizadoPor/actualizadoEn — esos son de D4.1 (UPDATE).
 *   - Validación jerárquica D5.1: assertCentroActivo verifica que el centro
 *     padre existe Y está activo. Códigos D5.2: invalid-argument si no existe,
 *     failed-precondition si existe pero no está activo.
 *   - Unicidad de código por centro (D6.3): assertCodigoLineaUnico. Dos centros
 *     pueden tener cada uno una línea '42A'; el mismo centro no dos veces.
 *   - Defaults backend D4.2: paradasIda/paradasVuelta → [] si se omiten. El
 *     `estado` NO se defaultea (es required en el payload): Línea es enum-3 y
 *     puede crearse directamente 'suspendida' (estacional fuera de temporada).
 *
 * Invocable por super_admin o jefe_trafico (paralelo a crearConductor). Si
 * invoca jefe, anti cross-tenant Y anti cross-centro (D3.6 ampliado): la
 * identidad operativa del jefe es la combinación (tenantId, centroId).
 *
 * Fechas de vigencia: el wire usa ISO string (validado como Date en
 * validation.ts); la conversión a Timestamp se hace AQUÍ en la escritura,
 * para mantener validation.ts libre de dependencias de firebase-admin (mismo
 * principio que el GeoPoint de crearCentro).
 *
 * Sin rollback: una sola escritura Firestore. Simétrico a crearCentro.
 */
export const crearLinea = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones (sin estado mutado)
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearLineaPayload(request.data);

  // Anti cross-tenant + anti cross-centro para jefe_trafico (D3.6 ampliado).
  // super_admin no tiene claims tenantId/centroId, por eso solo aplica al jefe.
  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear líneas en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear líneas en otro centro.",
      );
    }
  }

  const db = getFirestore();

  // Gate D5.1: centro padre existe Y está activo (códigos D5.2 en el helper).
  await assertCentroActivo(db, payload.centroId);

  // Gate D6.3: código único dentro del centro (sin exclude en create).
  await assertCodigoLineaUnico(db, payload.centroId, payload.codigo);

  logger.info("Creando línea", {
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    codigo: payload.codigo,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  // ==========================================================================
  //  FASE 2 — Escritura única
  // ==========================================================================
  const docRef = db.collection(COLLECTIONS.LINEAS).doc();

  const lineaDoc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    codigo: payload.codigo,
    nombre: payload.nombre,
    tipo: payload.tipo,
    esNocturna: payload.esNocturna,
    estado: payload.estado,
    // D4.2: arrays de paradas vacíos por defecto (relación línea↔parada
    // PROVISIONAL, se redecide en B17 — TODO[modelo-linea-paradas]).
    paradasIda: payload.paradasIda ?? [],
    paradasVuelta: payload.paradasVuelta ?? [],
    ...(payload.color !== undefined && { color: payload.color }),
    ...(payload.vigenciaDesde !== undefined && {
      vigenciaDesde: Timestamp.fromDate(payload.vigenciaDesde),
    }),
    ...(payload.vigenciaHasta !== undefined && {
      vigenciaHasta: Timestamp.fromDate(payload.vigenciaHasta),
    }),
    ...(payload.observaciones !== undefined && {
      observaciones: payload.observaciones,
    }),
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  try {
    await docRef.set(lineaDoc);
  } catch (err) {
    logger.error("Error inesperado al crear línea", {
      err,
      centroId: payload.centroId,
      codigo: payload.codigo,
    });
    throw new HttpsError("internal", "Error inesperado al crear la línea.");
  }

  logger.info("Línea creada", {
    lineaId: docRef.id,
    centroId: payload.centroId,
    codigo: payload.codigo,
  });

  return {
    ok: true as const,
    lineaId: docRef.id,
  };
});
