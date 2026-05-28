import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertSuperAdmin } from "../auth-guards";
import { validateActualizarUsuarioPayload } from "../validation";
import { assertUsuarioExists } from "../refs";

/**
 * Callable actualizarUsuario (B13).
 *
 * Actualiza campos no-críticos de un usuario:
 *   - `nombreCompleto` y `email`: DUAL-HOMED (viven en el doc /usuarios Y en
 *     el Auth user record — displayName / email). Se escriben en AMBOS
 *     sistemas (D5.4). Solo-Firestore: `telefono`, `estado`.
 *   - Soft-delete D4.3 vía `estado` (activo↔suspendido). Estado binario
 *     (D5.3): transición trivial, sin Select en el form (frontend B14).
 *     DECISIÓN 4 (B13): suspender SOLO cambia el doc, NO toca auth.disabled
 *     ni revokeRefreshTokens en MVP. Ver TODO[suspension-efectos-auth].
 *   - Auditoría D4.1 (actualizadoPor, actualizadoEn) en TODA modificación,
 *     incluyendo no-ops (Opción A: si payload.estado === doc.estado se
 *     escribe audit pero no se toca estado).
 *
 * NO edita rol/tenantId/centroId (claims) ni conductorId (identidad del
 * conductor, D3.1): el validator los rechaza con `invalid-argument` (D5.5).
 * Por eso este callable NUNCA llama a setCustomUserClaims.
 *
 * Escritura dual (D5.4): orden Auth PRIMERO, Firestore DESPUÉS. El orden
 * Auth-primero permite que colisiones (email-already-exists) aborten antes
 * de tocar Firestore, sin rollback. Si la escritura Firestore falla tras un
 * Auth ya escrito, se revierte Auth al valor previo (rollback inverso,
 * simétrico a crear*). Si ESE rollback también falla, se loggea el estado
 * inconsistente y se re-lanza el error ORIGINAL (ver TODO[dual-write-rollback-failed]).
 *
 * `email` cambiado deja `emailVerified=false` en Auth (auth.updateUser lo
 * resetea). Decisión MVP: se deja así (ver TODO[email-verification-on-change]).
 *
 * Solo invocable por super_admin (coherente con actualizarTenant/Centro y
 * con DECISIÓN 3 de B13).
 */
export const actualizarUsuario = onCall(async (request) => {
  // ==========================================================================
  //  FASE 1 — Validaciones + lectura previa
  // ==========================================================================
  const { uid: invocadorUid } = assertSuperAdmin(request);
  const payload = validateActualizarUsuarioPayload(request.data);
  const db = getFirestore();
  const auth = getAuth();

  const doc = await assertUsuarioExists(db, payload.usuarioId);

  // ==========================================================================
  //  FASE 1.5 — Determinar si toca Auth (solo si email o nombreCompleto
  //  cambian de valor REAL respecto al Auth user record; evita reset
  //  gratuito de emailVerified y writes vacíos a Auth).
  // ==========================================================================
  const authUpdate: { email?: string; displayName?: string } = {};
  let prevEmail: string | undefined;
  let prevDisplayName: string | null | undefined;
  const tocaAuthPotencial =
    payload.email !== undefined || payload.nombreCompleto !== undefined;

  if (tocaAuthPotencial) {
    let authUser;
    try {
      authUser = await auth.getUser(payload.usuarioId);
    } catch (err) {
      const code =
        err !== null && typeof err === "object" && "code" in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === "auth/user-not-found") {
        throw new HttpsError(
          "failed-precondition",
          "El usuario no tiene cuenta de Firebase Auth asociada. Doc huérfano: contacta con administración.",
        );
      }
      throw err;
    }
    prevEmail = authUser.email;
    prevDisplayName = authUser.displayName ?? null;
    if (payload.email !== undefined && payload.email !== authUser.email) {
      authUpdate.email = payload.email;
    }
    if (
      payload.nombreCompleto !== undefined &&
      payload.nombreCompleto !== authUser.displayName
    ) {
      authUpdate.displayName = payload.nombreCompleto;
    }
  }

  // ==========================================================================
  //  FASE 2 — Construcción del diff Firestore
  // ==========================================================================
  const cambios: Record<string, unknown> = {};

  if (payload.nombreCompleto !== undefined)
    cambios["nombreCompleto"] = payload.nombreCompleto;
  if (payload.telefono !== undefined) cambios["telefono"] = payload.telefono;
  if (payload.email !== undefined) cambios["email"] = payload.email;

  // Transición de estado (Opción A: si payload.estado === doc.estado, no-op
  // silencioso — no entramos al if; el audit se escribirá igual). Estado
  // binario (activo|suspendido): sin fechaCancelacion que tocar (a diferencia
  // de Tenant) y sin cascada en MVP (DECISIÓN 4).
  if (payload.estado !== undefined && payload.estado !== doc.estado) {
    cambios["estado"] = payload.estado;
  }

  // Auditoría D4.1 — SIEMPRE, sin excepción.
  cambios["actualizadoPor"] = invocadorUid;
  cambios["actualizadoEn"] = FieldValue.serverTimestamp();

  logger.info("Actualizando usuario", {
    usuarioId: payload.usuarioId,
    campos: Object.keys(cambios).filter(
      (k) => k !== "actualizadoPor" && k !== "actualizadoEn",
    ),
    tocaAuth: Object.keys(authUpdate),
    invocadorUid,
  });

  // ==========================================================================
  //  FASE 3 — Escritura dual con rollback inverso
  // ==========================================================================
  const tocaAuth = Object.keys(authUpdate).length > 0;
  let authUpdated = false;

  try {
    // ORDEN: Auth PRIMERO (captura email-already-exists ANTES de tocar
    // Firestore, sin necesidad de rollback), Firestore DESPUÉS.
    if (tocaAuth) {
      await auth.updateUser(payload.usuarioId, authUpdate);
      authUpdated = true;
    }
    await db
      .collection(COLLECTIONS.USUARIOS)
      .doc(payload.usuarioId)
      .update(cambios);
  } catch (err) {
    // Rollback inverso: revertir Auth al estado previo si Firestore falló
    // tras un Auth ya escrito.
    if (authUpdated) {
      try {
        await auth.updateUser(payload.usuarioId, {
          email: prevEmail,
          displayName: prevDisplayName,
        });
      } catch (rbErr) {
        logger.error(
          "Rollback Auth updateUser falló — estado inconsistente Auth/Firestore",
          { usuarioId: payload.usuarioId, originalErr: err, rbErr },
        );
        // No re-lanzamos rbErr: el cliente debe ver el error ORIGINAL.
      }
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
    logger.error("Error inesperado en actualizarUsuario", {
      err,
      usuarioId: payload.usuarioId,
    });
    throw new HttpsError(
      "internal",
      "Error inesperado al actualizar el usuario.",
    );
  }

  // ==========================================================================
  //  FASE 4 — Respuesta
  // ==========================================================================
  logger.info("Usuario actualizado", { usuarioId: payload.usuarioId });

  return {
    ok: true as const,
    usuarioId: payload.usuarioId,
  };
});
