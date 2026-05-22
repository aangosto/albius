import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdminOrJefeTrafico } from "../auth-guards";
import { validateCrearConductorPayload } from "../validation";
import {
  assertTenantExists,
  assertCentroExistsInTenant,
  assertConductorIdDisponible,
} from "../refs";

/**
 * Callable crearConductor.
 *
 * Crea un conductor con cuenta completa en el sistema:
 *   - Firebase Auth user (displayName = "nombre apellidos").
 *   - Custom claims: rol="conductor", tenantId, centroId.
 *   - Documento /usuarios/{uid} con auditoría (D7) y conductorId (D1).
 *   - Documento /conductores/{tenantId}_{numeroEmpleado} con
 *     usuarioId, auditoría (D7) y campos operativos.
 *   - Password reset link para configuración inicial (D3).
 *
 * Invocable por super_admin o jefe_trafico (D5). Si invoca jefe,
 * anti cross-tenant Y anti cross-centro (D6 ampliado en 3.2.d): la
 * identidad operativa del jefe es la combinación (tenantId, centroId).
 *
 * Atomicidad (D2 + DUDA-12 de 3.2.d): los dos documentos Firestore se
 * escriben en un batch atómico. Si cualquier paso tras la creación del
 * Auth user falla, rollback completo en orden inverso (Firestore primero,
 * Auth después).
 */
export const crearConductor = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones (sin estado mutado, sin rollback necesario)
  // ==========================================================================
  const { uid: invocadorUid, claims } = assertSuperAdminOrJefeTrafico(request);
  const payload = validateCrearConductorPayload(request.data);

  // Anti cross-tenant + anti cross-centro para jefe_trafico (D6 ampliado).
  // super_admin no tiene claims tenantId/centroId, por eso solo aplica al jefe.
  if (claims.rol === "jefe_trafico") {
    if (claims.tenantId !== payload.tenantId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear conductores en otro tenant.",
      );
    }
    if (claims.centroId !== payload.centroId) {
      throw new HttpsError(
        "permission-denied",
        "Un jefe de tráfico no puede crear conductores en otro centro.",
      );
    }
  }

  const db = getFirestore();
  const auth = getAuth();

  await assertTenantExists(db, payload.tenantId);
  await assertCentroExistsInTenant(db, payload.centroId, payload.tenantId);

  // ID compuesto (D1): el identificador del conductor es información de
  // negocio (numeroEmpleado dentro del tenant), no el uid de Auth.
  const conductorId = `${payload.tenantId}_${payload.numeroEmpleado}`;
  await assertConductorIdDisponible(db, conductorId);

  const nombreCompleto = `${payload.nombre} ${payload.apellidos}`;

  logger.info("Creando conductor", {
    email: payload.email,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    conductorId,
    invocadorUid,
    rolInvocador: claims.rol,
  });

  // ==========================================================================
  //  FASE 2 — Operación con rollback
  // ==========================================================================
  let authUserCreated = false;
  let firestoreBatchCommitted = false;
  let newUid: string | undefined;

  try {
    const userRecord = await auth.createUser({
      email: payload.email,
      displayName: nombreCompleto,
    });
    newUid = userRecord.uid;
    authUserCreated = true;

    await auth.setCustomUserClaims(newUid, {
      rol: "conductor",
      tenantId: payload.tenantId,
      centroId: payload.centroId,
    });

    const usuarioDoc = {
      id: newUid,
      email: payload.email,
      nombreCompleto,
      ...(payload.telefono !== undefined && { telefono: payload.telefono }),
      rol: "conductor" as const,
      tenantId: payload.tenantId,
      centroId: payload.centroId,
      conductorId, // D1: enlace usuario→conductor
      estado: "activo" as const,
      passwordChangeRequired: true,
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: invocadorUid, // D7
      creadoEn: FieldValue.serverTimestamp(), // D7
    };

    const conductorDoc = {
      id: conductorId,
      tenantId: payload.tenantId,
      centroId: payload.centroId,
      usuarioId: newUid, // enlace inverso conductor→usuario
      numeroEmpleado: payload.numeroEmpleado,
      nombre: payload.nombre,
      apellidos: payload.apellidos,
      dni: payload.dni,
      email: payload.email,
      ...(payload.telefono !== undefined && { telefono: payload.telefono }),
      categoria: payload.categoria,
      fechaAntiguedad: Timestamp.fromDate(payload.fechaAntiguedad),
      fechaIncorporacion: Timestamp.fromDate(payload.fechaIncorporacion),
      estado: "activo" as const,
      // DUDA-8 de 3.2.d: required en el modelo, default a [] si no vienen.
      lineasPreferentes: payload.lineasPreferentes ?? [],
      lineasSecundarias: payload.lineasSecundarias ?? [],
      tiposTurnoPermitidos: payload.tiposTurnoPermitidos ?? [],
      // DUDA-9 de 3.2.d: opcional en el modelo, spread condicional (no escribir si ausente).
      ...(payload.tiposTurnoExcluidos !== undefined && {
        tiposTurnoExcluidos: payload.tiposTurnoExcluidos,
      }),
      ...(payload.maxHorasSemanales !== undefined && {
        maxHorasSemanales: payload.maxHorasSemanales,
      }),
      puedeSerReserva: payload.puedeSerReserva,
      ...(payload.observaciones !== undefined && {
        observaciones: payload.observaciones,
      }),
      creadoPor: invocadorUid, // D7
      creadoEn: FieldValue.serverTimestamp(), // D7
    };

    // Atomicidad real (D2 + DUDA-12 de 3.2.d): los dos docs se escriben o ninguno.
    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.USUARIOS).doc(newUid), usuarioDoc);
    batch.set(
      db.collection(COLLECTIONS.CONDUCTORES).doc(conductorId),
      conductorDoc,
    );
    await batch.commit();
    firestoreBatchCommitted = true;

    const linkPasswordReset = await auth.generatePasswordResetLink(
      payload.email,
    );

    logger.info("conductor creado", {
      usuarioId: newUid,
      conductorId,
      tenantId: payload.tenantId,
      centroId: payload.centroId,
    });

    return {
      ok: true as const,
      usuarioId: newUid,
      conductorId,
      linkPasswordReset,
    };
  } catch (err) {
    // Rollback en orden inverso (Firestore primero, Auth después).
    // Cada paso con .catch independiente para que un fallo de rollback no
    // impida el siguiente ni el re-throw del error original.
    if (firestoreBatchCommitted && newUid !== undefined) {
      const rollbackBatch = db.batch();
      rollbackBatch.delete(db.collection(COLLECTIONS.USUARIOS).doc(newUid));
      rollbackBatch.delete(
        db.collection(COLLECTIONS.CONDUCTORES).doc(conductorId),
      );
      await rollbackBatch.commit().catch((rollbackErr: unknown) => {
        logger.error("Rollback Firestore batch falló", {
          uid: newUid,
          conductorId,
          err: rollbackErr,
        });
      });
    }
    if (authUserCreated && newUid !== undefined) {
      await auth.deleteUser(newUid).catch((rollbackErr: unknown) => {
        logger.error("Rollback Auth user falló", {
          uid: newUid,
          err: rollbackErr,
        });
      });
    }

    // Mapeo del error original a HttpsError formal.
    if (err instanceof HttpsError) {
      throw err;
    }
    const code =
      err !== null && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === "auth/email-already-exists") {
      throw new HttpsError(
        "already-exists",
        "Ya existe un usuario con ese email.",
      );
    }
    if (code === "auth/invalid-email") {
      throw new HttpsError(
        "invalid-argument",
        "El email no es válido para Firebase Auth.",
      );
    }
    logger.error("Error inesperado en crearConductor", {
      err,
      email: payload.email,
      conductorId,
      tenantId: payload.tenantId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al crear el conductor.",
    );
  }
});
