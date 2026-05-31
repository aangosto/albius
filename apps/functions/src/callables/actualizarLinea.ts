import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Linea } from "@albius/shared";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateActualizarLineaPayload } from "../validation";
import { assertCodigoLineaUnico } from "../refs";

/**
 * Callable actualizarLinea (B16).
 *
 * Actualiza una línea existente con:
 *   - Auditoría D4.1 (actualizadoPor, actualizadoEn) en TODA modificación,
 *     incluyendo no-ops (refleja el intento), como actualizarCentro/Tenant.
 *   - Soft-delete D4.3 vía cambio de `estado`: Línea es enum-3 (D6.2), las tres
 *     transiciones (activa↔inactiva↔suspendida) son UPDATEs normales del campo,
 *     NO callable separado. A diferencia de Centro, NO hay verificación D4.6 de
 *     dependencias hijas todavía: paradas/frecuencias que colgarán de Línea aún
 *     no existen como CRUD. TODO[linea-softdelete-cascada]: cuando existan,
 *     evaluar una verificación D4.6 (p.ej. impedir inactivar una línea con
 *     frecuencias o servicios activos).
 *   - Unicidad de código por centro (D6.3): si el payload cambia `codigo`, se
 *     revalida con assertCodigoLineaUnico(excludeLineaId) para que la línea no
 *     choque consigo misma. Si el código no cambia, no se revalida.
 *
 * No edita inmutables (id, tenantId, centroId, creadoPor, creadoEn): el
 * validator los rechaza con invalid-argument. Las reglas Firestore en /lineas
 * también los bloquean por defensa en profundidad.
 *
 * Invocable por super_admin o jefe_trafico. Si invoca jefe, anti cross-tenant
 * Y anti cross-centro respecto a la línea editada (se leen tenantId/centroId
 * del doc, no del payload — el payload no puede cambiarlos). Simétrico a
 * crearLinea / crearConductor.
 *
 * Fechas de vigencia: ISO string en el wire (validado como Date), conversión a
 * Timestamp AQUÍ en la construcción del diff (como crearLinea).
 */
export const actualizarLinea = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones + lectura previa
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateActualizarLineaPayload(request.data);
  const db = getFirestore();

  // Lectura previa del doc actual. Necesaria para:
  //   - Verificar existencia (invalid-argument si no existe).
  //   - Anti-cross del jefe (tenantId/centroId de la línea, no del payload).
  //   - Decidir si el código cambió (revalidación de unicidad).
  const docRef = db.collection(COLLECTIONS.LINEAS).doc(payload.lineaId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      "invalid-argument",
      `La línea '${payload.lineaId}' no existe.`,
    );
  }
  // Cast permisivo: confiamos en que el doc fue creado por crearLinea (que
  // escribe todos los campos required). Mismo criterio que actualizarCentro.
  const doc = snap.data() as Linea;

  // Anti cross-tenant + anti cross-centro para jefe_trafico (D3.6 ampliado).
  // Se evalúa contra el doc, porque el payload no puede cambiar tenantId/centroId.
  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== doc.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar líneas de otro tenant.",
      );
    }
    if (claims.centroId !== doc.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede editar líneas de otro centro.",
      );
    }
  }

  // Gate D6.3 en UPDATE: solo si el código cambia de valor real.
  if (payload.codigo !== undefined && payload.codigo !== doc.codigo) {
    await assertCodigoLineaUnico(
      db,
      doc.centroId,
      payload.codigo,
      payload.lineaId,
    );
  }

  // ==========================================================================
  //  FASE 2 — Construcción del diff
  // ==========================================================================
  const cambios: Record<string, unknown> = {};

  if (payload.codigo !== undefined) cambios["codigo"] = payload.codigo;
  if (payload.nombre !== undefined) cambios["nombre"] = payload.nombre;
  if (payload.tipo !== undefined) cambios["tipo"] = payload.tipo;
  if (payload.esNocturna !== undefined)
    cambios["esNocturna"] = payload.esNocturna;
  if (payload.estado !== undefined) cambios["estado"] = payload.estado;
  if (payload.color !== undefined) cambios["color"] = payload.color;
  if (payload.paradasIda !== undefined)
    cambios["paradasIda"] = payload.paradasIda;
  if (payload.paradasVuelta !== undefined)
    cambios["paradasVuelta"] = payload.paradasVuelta;
  if (payload.vigenciaDesde !== undefined)
    cambios["vigenciaDesde"] = Timestamp.fromDate(payload.vigenciaDesde);
  if (payload.vigenciaHasta !== undefined)
    cambios["vigenciaHasta"] = Timestamp.fromDate(payload.vigenciaHasta);
  if (payload.observaciones !== undefined)
    cambios["observaciones"] = payload.observaciones;

  // Auditoría D4.1 — SIEMPRE, sin excepción.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando línea", {
    lineaId: payload.lineaId,
    tenantId: doc.tenantId,
    centroId: doc.centroId,
    campos: Object.keys(cambios).filter(
      (k) => k !== "actualizadoPor" && k !== "actualizadoEn",
    ),
    invocadorUid,
    rolInvocador: claims.rol,
  });

  // ==========================================================================
  //  FASE 3 — Escritura
  // ==========================================================================
  try {
    await docRef.update(cambios);
  } catch (err) {
    logger.error("Error inesperado al actualizar línea", {
      err,
      lineaId: payload.lineaId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar la línea.",
    );
  }

  logger.info("Línea actualizada", { lineaId: payload.lineaId });

  return {
    ok: true as const,
    lineaId: payload.lineaId,
  };
});
