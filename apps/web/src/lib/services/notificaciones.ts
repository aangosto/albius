/**
 * Servicio de NOTIFICACIONES — única superficie de I/O Firebase de la campana
 * y del banner de Mi horario (D4.9, B38.5).
 *
 *   - suscribirNotificaciones: onSnapshot a las últimas N del usuario. Patrón
 *     reactivo justificado igual que `suscribirCuadrante` (B29 C.4): el dato
 *     nace en el BACKEND sin acción del cliente (el worker del optimizador al
 *     terminar, `publicarCuadrante` al publicar), así que un fetch one-shot
 *     solo acertaría por casualidad. D4.8 (listas administrativas sin
 *     onSnapshot) no aplica: esto no es una lista administrativa.
 *   - marcarNotificacionesLeidas: callable (la colección es `write:false` para
 *     el cliente; ver el callable homónimo en apps/functions).
 *
 * D6.5 — la query CONSTRIÑE `destinatarioId` al uid propio. No es cosmética:
 * la regla de /notificaciones es `resource.data.destinatarioId == uid`, y en
 * un LIST Firestore rechaza la query entera si no está acotada por ese campo.
 *
 * Sin manejo de errores aquí (D4.10): el caller decide y `mapCallableError`
 * traduce al usuario.
 */
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type Notificacion } from '@albius/shared';
import { db, functions } from '@/lib/firebase';

/** Cuántas notificaciones trae la campana. Las más recientes primero. */
export const LIMITE_NOTIFICACIONES = 20;

/**
 * "No leída" es `estado !== 'leida'`: las notificaciones nacen en 'pendiente'
 * (aún no hay transporte real — `TODO[email-transport]`) y 'enviada' se
 * reserva para cuando lo haya. Mirar solo `=== 'pendiente'` dejaría de contar
 * las no leídas en cuanto exista email/push.
 */
export function esNoLeida(n: Notificacion): boolean {
  return n.estado !== 'leida';
}

/**
 * Últimas `LIMITE_NOTIFICACIONES` del usuario, más recientes primero, en
 * tiempo real. Devuelve el `Unsubscribe` — el caller DEBE llamarlo al
 * desmontar o al cambiar de uid.
 *
 * Requiere el índice compuesto (destinatarioId ASC, fechaCreacion DESC).
 */
export function suscribirNotificaciones(
  destinatarioId: string,
  onChange: (notificaciones: Notificacion[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, COLLECTIONS.NOTIFICACIONES),
    where('destinatarioId', '==', destinatarioId),
    orderBy('fechaCreacion', 'desc'),
    limit(LIMITE_NOTIFICACIONES),
  );
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => d.data() as Notificacion)),
    (err) => {
      console.error('[notificaciones] onSnapshot error:', err);
      onError?.(err);
    },
  );
}

export interface MarcarLeidasInput {
  notificacionIds: string[];
}
export interface MarcarLeidasResult {
  ok: true;
  marcadas: number;
  yaLeidas: number;
}

/**
 * Marca como leídas (en lote) las notificaciones indicadas. El backend exige
 * que TODAS sean del invocador y acota a 50 ids. El onSnapshot refleja el
 * cambio sin recarga, así que no hay que refrescar nada a mano.
 */
export async function marcarNotificacionesLeidas(
  input: MarcarLeidasInput,
): Promise<MarcarLeidasResult> {
  const fn = httpsCallable<MarcarLeidasInput, MarcarLeidasResult>(
    functions,
    'marcarNotificacionesLeidas',
  );
  const res = await fn(input);
  return res.data;
}
