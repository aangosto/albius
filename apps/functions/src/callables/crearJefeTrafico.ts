import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "@albius/shared";
import { assertSuperAdmin } from "../auth-guards";
import { validateCrearJefeTraficoPayload } from "../validation";
import { assertTenantExists, assertCentroExistsInTenant } from "../refs";

/**
 * Callable crearJefeTrafico.
 *
 * Crea un usuario con rol jefe_trafico en el sistema:
 *   - Firebase Auth user (con displayName = nombreCompleto).
 *   - Custom claims: rol, tenantId, centroId.
 *   - Documento /usuarios/{uid} con auditoría (D7).
 *   - Password reset link para configuración inicial de contraseña (D3).
 *
 * Solo invocable por super_admin. Rollback completo si cualquier paso tras
 * la creación del Auth user falla (filosofía operativa común al Bloque 3.2,
 * aunque D2 se redactó para crearConductor).
 */
export const crearJefeTrafico = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones (sin estado mutado, sin rollback necesario)
  // ==========================================================================
  const { uid: invocadorUid } = assertSuperAdmin(request);
  const payload = validateCrearJefeTraficoPayload(request.data);

  const db = getFirestore();
  const auth = getAuth();

  await assertTenantExists(db, payload.tenantId);
  await assertCentroExistsInTenant(db, payload.centroId, payload.tenantId);

  logger.info("Creando jefe_trafico", {
    email: payload.email,
    tenantId: payload.tenantId,
    centroId: payload.centroId,
    invocadorUid,
  });

  // ==========================================================================
  //  FASE 2 — Operación con rollback
  // ==========================================================================
  let authUserCreated = false;
  let firestoreDocCreated = false;
  let newUid: string | undefined;

  try {
    const userRecord = await auth.createUser({
      email: payload.email,
      displayName: payload.nombreCompleto,
    });
    newUid = userRecord.uid;
    authUserCreated = true;

    await auth.setCustomUserClaims(newUid, {
      rol: "jefe_trafico",
      tenantId: payload.tenantId,
      centroId: payload.centroId,
    });

    const usuarioDoc = {
      id: newUid,
      email: payload.email,
      nombreCompleto: payload.nombreCompleto,
      ...(payload.telefono !== undefined && { telefono: payload.telefono }),
      rol: "jefe_trafico" as const,
      tenantId: payload.tenantId,
      centroId: payload.centroId,
      estado: "activo" as const,
      passwordChangeRequired: true,
      fechaCreacion: FieldValue.serverTimestamp(),
      creadoPor: invocadorUid,
      creadoEn: FieldValue.serverTimestamp(),
    };
    await db.collection(COLLECTIONS.USUARIOS).doc(newUid).set(usuarioDoc);
    firestoreDocCreated = true;

    const linkPasswordReset = await auth.generatePasswordResetLink(
      payload.email,
    );

    logger.info("jefe_trafico creado", {
      usuarioId: newUid,
      email: payload.email,
      tenantId: payload.tenantId,
      centroId: payload.centroId,
    });

    return {
      ok: true as const,
      usuarioId: newUid,
      linkPasswordReset,
    };
  } catch (err) {
    // Rollback en orden inverso, con .catch independiente por paso para que
    // un fallo de rollback no impida el siguiente ni el re-throw del original.
    if (firestoreDocCreated && newUid !== undefined) {
      await db
        .collection(COLLECTIONS.USUARIOS)
        .doc(newUid)
        .delete()
        .catch((rollbackErr: unknown) => {
          logger.error("Rollback Firestore /usuarios falló", {
            uid: newUid,
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
    logger.error("Error inesperado en crearJefeTrafico", {
      err,
      email: payload.email,
      tenantId: payload.tenantId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al crear el jefe de tráfico.",
    );
  }
});
