import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { COLLECTIONS } from "../collections";
import { assertAuth } from "../auth-guards";
import { validateMarcarNotificacionesLeidasPayload } from "../validation";

/**
 * Callable marcarNotificacionesLeidas (B38.5).
 *
 * La ÚNICA vía para marcar una notificación como leída: la regla de
 * `/notificaciones` es `allow write: if false` (las escribe el backend con
 * Admin SDK), así que el cliente no puede tocar el doc ni siquiera para marcar
 * su propia lectura. Mismo razonamiento que `marcarPasswordCambiada` (B7): el
 * campo está vetado al cliente y el callable es el portillo controlado.
 *
 * Auth: CUALQUIER usuario autenticado, para SUS PROPIAS notificaciones. No hay
 * gate de rol porque una notificación es personal (igual que la regla de
 * lectura, que no distingue rol): la autorización es `destinatarioId === uid`,
 * verificada doc a doc. Un id de otro destinatario aborta la operación ENTERA
 * con 'permission-denied' — no se marca "lo que sí era suyo" en silencio,
 * porque eso enmascararía un cliente con un bug o un intento de sondeo.
 *
 * LOTE (plural): la campana marca de una vez las no leídas que acaba de
 * mostrar. Un callable por notificación serían hasta 20 round-trips para un
 * gesto (abrir el desplegable). El validator acota a 50 ids sin duplicados y
 * la escritura va en un único writeBatch (atómica: o todas o ninguna).
 *
 * Idempotencia (D7.4, patrón de marcarPasswordCambiada): los ids que YA están
 * en 'leida' se omiten del batch en vez de re-escribirse, para no contaminar
 * `fechaLectura` con un timestamp posterior a la lectura real. Se informan
 * aparte en el resultado (`yaLeidas`).
 *
 * Auditoría: `Notificacion` no tiene `actualizadoPor`/`actualizadoEn` (D4.1) y
 * NO se los inventamos — `fechaLectura` ES el sello de esta operación y el
 * actor es necesariamente el destinatario, que ya está en el doc.
 */
export const marcarNotificacionesLeidas = onCall(async (request) => {
  assertAuth(request);
  const uid = request.auth.uid;
  const { notificacionIds } = validateMarcarNotificacionesLeidasPayload(
    request.data,
  );

  const db = getFirestore();
  const refs = notificacionIds.map((id) =>
    db.collection(COLLECTIONS.NOTIFICACIONES).doc(id),
  );
  const snaps = await db.getAll(...refs);

  const aMarcar: FirebaseFirestore.DocumentReference[] = [];
  let yaLeidas = 0;

  for (const snap of snaps) {
    if (!snap.exists) {
      throw new HttpsError(
        "invalid-argument",
        `La notificación '${snap.id}' no existe.`,
      );
    }
    const data = snap.data() ?? {};
    if (data["destinatarioId"] !== uid) {
      // No revelamos de quién es: solo que no es tuya.
      logger.warn("marcarNotificacionesLeidas sobre notificación ajena", {
        uid,
        notificacionId: snap.id,
      });
      throw new HttpsError(
        "permission-denied",
        "Solo puedes marcar como leídas tus propias notificaciones.",
      );
    }
    if (data["estado"] === "leida") {
      yaLeidas += 1;
      continue;
    }
    aMarcar.push(snap.ref);
  }

  if (aMarcar.length > 0) {
    const batch = db.batch();
    for (const ref of aMarcar) {
      batch.update(ref, {
        estado: "leida",
        fechaLectura: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  logger.info("marcarNotificacionesLeidas OK", {
    uid,
    marcadas: aMarcar.length,
    yaLeidas,
  });

  return { ok: true as const, marcadas: aMarcar.length, yaLeidas };
});
