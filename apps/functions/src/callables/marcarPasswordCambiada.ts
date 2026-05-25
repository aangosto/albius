import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertAuth } from "../auth-guards";

/**
 * Callable marcarPasswordCambiada.
 *
 * Cierra el flujo de Bloque 7: pone `passwordChangeRequired` a false y
 * registra `passwordCambiadaEn` en /usuarios/{request.auth.uid}. Pareja
 * backend de CambiarPasswordPage: tras un `updatePassword` exitoso del Web
 * SDK, el frontend invoca este callable para que el backend reconozca el
 * cambio.
 *
 * Sin payload: el uid sale de `request.auth.uid`. Cualquier user autenticado
 * puede invocarlo PARA SU PROPIO uid — no es escalada de privilegios porque
 * solo escribe sobre /usuarios/{request.auth.uid}. Además, firestore.rules
 * impide al propio user modificar el campo `passwordChangeRequired` desde el
 * cliente (fieldsChanged en /usuarios), por lo que este callable es la
 * ÚNICA vía válida para flipear el flag a false.
 *
 * Idempotencia (D7.4): si el flag ya está en false, devuelve {ok:true}
 * SIN escribir nada. Permite retry seguro tras failures parciales del
 * frontend (updatePassword OK pero callable falló) sin contaminar
 * `passwordCambiadaEn` con un timestamp posterior al cambio real.
 */
export const marcarPasswordCambiada = onCall(async (request) => {
  assertAuth(request);
  const uid = request.auth.uid;

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.USUARIOS).doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    // Caso anómalo: user autenticado sin doc /usuarios (alta incompleta,
    // sinclaims). El frontend filtra esto antes (ClaimsIncompletosView), pero
    // defendemos en backend por simetría con D3.7 y consistencia de errores.
    logger.warn("marcarPasswordCambiada sin doc /usuarios", { uid });
    throw new HttpsError(
      "failed-precondition",
      "Usuario no encontrado en /usuarios. Contacta con administración.",
    );
  }

  const data = snap.data() ?? {};
  if (data["passwordChangeRequired"] !== true) {
    // Idempotente: ya cambió la contraseña (o nunca tuvo la obligación).
    // Devolvemos OK sin escribir para no contaminar passwordCambiadaEn.
    logger.info("marcarPasswordCambiada idempotente: flag ya no es true", {
      uid,
    });
    return { ok: true as const };
  }

  await ref.update({
    passwordChangeRequired: false,
    passwordCambiadaEn: FieldValue.serverTimestamp(),
  });

  logger.info("marcarPasswordCambiada OK", { uid });
  return { ok: true as const };
});
