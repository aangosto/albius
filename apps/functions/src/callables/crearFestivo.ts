import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearFestivoPayload } from "../validation";
import { assertCentroActivo, assertTenantActivo } from "../refs";

/**
 * Callable crearFestivo (B27). Habilita el calendario de festivos (insumo del
 * cálculo de tipoDia → demanda del optimizador).
 *
 *   - SCOPE: si el payload trae `centroId` → festivo DE ESE CENTRO (jefe scoped a
 *     su centro, o super_admin); si NO trae `centroId` → festivo TENANT-WIDE
 *     (super_admin only, afecta a todos los centros del tenant).
 *   - D5.1: centro-scoped → assertCentroActivo; tenant-wide → assertTenantActivo.
 *   - esEditable: default true (el jefe crea festivos editables); super_admin
 *     puede crear festivos oficiales protegidos pasando esEditable=false.
 *   - Auditoría D3.7. id autogenerado.
 */
export const crearFestivo = onCall(async (request) => {
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearFestivoPayload(request.data);

  if (payload.centroId === undefined) {
    // Tenant-wide → super_admin only.
    if (claims.rol !== "super_admin") {
      throw new HttpsError(
        "permission-denied",
        "Solo un super_admin puede crear festivos de todo el tenant (sin centro). Un jefe debe indicar su centro.",
      );
    }
  } else if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear festivos en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear festivos en otro centro.",
      );
    }
  }

  const db = getFirestore();
  if (payload.centroId !== undefined) {
    await assertCentroActivo(db, payload.centroId); // D5.1
  } else {
    await assertTenantActivo(db, payload.tenantId); // D5.1 (tenant-wide)
  }

  const docRef = db.collection(COLLECTIONS.FESTIVOS).doc();
  const festivoDoc = {
    id: docRef.id,
    tenantId: payload.tenantId,
    ...(payload.centroId !== undefined && { centroId: payload.centroId }),
    fecha: Timestamp.fromDate(payload.fecha),
    nombre: payload.nombre,
    ambito: payload.ambito,
    tipoTraficoAplicable: payload.tipoTraficoAplicable,
    esEditable: payload.esEditable ?? true, // D4.2
    creadoPor: invocadorUid, // D3.7
    creadoEn: FieldValue.serverTimestamp(), // D3.7
  };

  logger.info("Creando festivo", {
    tenantId: payload.tenantId,
    centroId: payload.centroId ?? "(tenant-wide)",
    fecha: payload.fecha.toISOString().slice(0, 10),
    invocadorUid,
    rolInvocador: claims.rol,
  });

  try {
    await docRef.set(festivoDoc);
  } catch (err) {
    logger.error("Error inesperado al crear festivo", { err });
    throw new HttpsError("internal", "Error inesperado al crear el festivo.");
  }

  return { ok: true as const, festivoId: docRef.id };
});
