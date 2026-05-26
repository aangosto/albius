import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdmin } from "../auth-guards";
import { validateCrearTenantPayload } from "../validation";
import { assertCIFUnico } from "../refs";
import { validateCIF } from "../cif-validator";

/**
 * Defaults backend (D4.2) para el sub-objeto `configuracion` del Tenant.
 * Se mergean con el `configuracion` parcial del payload si llega (D4.5
 * modo CREATE).
 */
const DEFAULTS_CONFIGURACION = {
  zonaHoraria: "Europe/Madrid",
  idioma: "es",
} as const;

/**
 * Callable crearTenant.
 *
 * Crea un nuevo tenant (empresa cliente del SaaS) con:
 *   - Documento /tenants/{auto-id} (ID generado por Firestore).
 *   - Auditoría D3.7 (creadoPor = uid invocador, creadoEn = serverTimestamp).
 *   - NO escribe actualizadoPor/actualizadoEn — esos son de D4.1 (UPDATE).
 *   - Validación de CIF español (BOE RD 1065/2007 anexo VI) con escape
 *     hatch D4.4: `forzarCIF: true` permite alta con CIF no estándar
 *     persistiendo `cifValidacionForzada: true` para auditoría.
 *   - Defaults backend D4.2: estado='activo' hardcoded, plan='basico' si
 *     se omite, configuracion mergea con DEFAULTS_CONFIGURACION (D4.5
 *     modo CREATE).
 *   - Unicidad de CIF entre tenants (assertCIFUnico sobre cif normalizado).
 *
 * Solo invocable por super_admin.
 *
 * Sin rollback: una sola escritura Firestore. Si falla, falla y ya.
 */
export const crearTenant = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones (sin estado mutado)
  // ==========================================================================
  const { uid: invocadorUid } = assertSuperAdmin(request);
  const payload = validateCrearTenantPayload(request.data);

  const db = getFirestore();

  // CIF: validación + escape hatch (D4.4).
  const cifResult = validateCIF(payload.cif);
  let cifForzado = false;
  if (!cifResult.valid) {
    if (payload.forzarCIF !== true) {
      throw new HttpsError(
        "invalid-argument",
        `El CIF '${payload.cif}' no es válido (motivo: ${cifResult.reason ?? "desconocido"}). ` +
          `Para forzar el alta con un CIF no estándar (empresa extranjera, autónomo con DNI, ` +
          `sociedad civil, etc.), envía forzarCIF: true.`,
      );
    }
    cifForzado = true;
  }
  // Si cifResult.valid === true Y payload.forzarCIF === true: Opción C3
  // silenciosa. NO marcamos cifValidacionForzada (no se forzó nada en la
  // práctica). El flag refleja la realidad, no la intención. El return
  // value sí lleva cifValidacionForzada: false explícito para que el
  // frontend pueda informar al operador de que su forzar no se aplicó.

  // cifResult.normalized siempre presente salvo reason='empty', y ese caso
  // ya falló antes en assertNonEmptyString del validator de payload. Guard
  // defensivo por narrowing de TS.
  const cifNormalizado = cifResult.normalized;
  if (cifNormalizado === undefined) {
    throw new HttpsError("invalid-argument", "El campo 'cif' es requerido.");
  }

  await assertCIFUnico(db, cifNormalizado);

  logger.info("Creando tenant", {
    nombre: payload.nombre,
    cif: cifNormalizado,
    cifForzado,
    invocadorUid,
  });

  // ==========================================================================
  //  FASE 2 — Escritura única
  // ==========================================================================
  const docRef = db.collection(COLLECTIONS.TENANTS).doc();

  const configuracion = {
    ...DEFAULTS_CONFIGURACION,
    ...(payload.configuracion ?? {}),
  };

  const tenantDoc = {
    id: docRef.id,
    nombre: payload.nombre,
    ...(payload.nombreComercial !== undefined && {
      nombreComercial: payload.nombreComercial,
    }),
    cif: cifNormalizado,
    comunidadAutonoma: payload.comunidadAutonoma,
    provincia: payload.provincia,
    plan: payload.plan ?? ("basico" as const),
    estado: "activo" as const,
    fechaAlta: FieldValue.serverTimestamp(),
    configuracion,
    ...(cifForzado && { cifValidacionForzada: true as const }),
    creadoPor: invocadorUid,
    creadoEn: FieldValue.serverTimestamp(),
  };

  try {
    await docRef.set(tenantDoc);
  } catch (err) {
    logger.error("Error inesperado al crear tenant", {
      err,
      nombre: payload.nombre,
      cif: cifNormalizado,
    });
    throw new HttpsError("internal", "Error inesperado al crear el tenant.");
  }

  logger.info("Tenant creado", {
    tenantId: docRef.id,
    cif: cifNormalizado,
    cifForzado,
  });

  return {
    ok: true as const,
    tenantId: docRef.id,
    cifNormalizado,
    cifValidacionForzada: cifForzado,
  };
});
