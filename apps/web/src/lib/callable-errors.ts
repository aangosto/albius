/**
 * Mapea errores de callables HttpsCallable v2 a mensajes en español
 * user-friendly. Patrón análogo a `auth-errors.ts` (Bloque 5) para Firebase
 * Auth (D4.10 canónica nueva del Bloque 10).
 *
 * Convención: para `invalid-argument` y `failed-precondition` se PRESERVA el
 * `err.message` del backend porque los callables del proyecto ya envían
 * mensajes específicos en español user-friendly:
 *   - D4.4 CIF inválido: "El CIF 'X' no es válido (motivo: control-mismatch)..."
 *   - D4.6 centros activos: "No puede cancelarse un tenant con centros activos..."
 *   - assertNonEmptyString / assertEnum: "El campo 'X' es requerido y debe ser..."
 *
 * Para el resto de códigos del wire HTTPS Callable v2 (`unauthenticated`,
 * `permission-denied`, `internal`, `unavailable`, `resource-exhausted`,
 * `deadline-exceeded`, `already-exists`) se usan mensajes hardcoded en
 * español porque el `err.message` del SDK suele ser genérico en inglés
 * ("INTERNAL", "UNAUTHENTICATED", etc.) o no pensado para usuario final.
 *
 * NO llama a `console.error`. El caller decide qué loggear y a qué nivel
 * (típicamente `console.error('[contexto] callable error:', err)` en el catch
 * del componente, igual que hacen LoginPage y Topbar con auth errors).
 *
 * El SDK Firebase Web devuelve errores con shape:
 *   { code: 'functions/<categoria>', message: '<msg>', name: 'FirebaseError' }
 * Algunos errores de red llegan con shape distinto. Se detecta por duck
 * typing (`code` string + `message` string) para no acoplar a la clase
 * `FirebaseError` concreta del SDK.
 */

const GENERIC_MESSAGE = 'Error inesperado. Inténtalo de nuevo.';

interface ErrorLikeShape {
  code?: unknown;
  message?: unknown;
}

function getCodeAndMessage(err: unknown): { code: string; message: string } {
  if (typeof err !== 'object' || err === null) {
    return { code: '', message: '' };
  }
  const e = err as ErrorLikeShape;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  return { code, message };
}

export function mapCallableError(err: unknown): string {
  const { code, message } = getCodeAndMessage(err);

  switch (code) {
    case 'functions/invalid-argument':
    case 'functions/failed-precondition':
      // Backend envía mensajes específicos y en español (D4.4, D4.6, ...).
      // Fallback al genérico si por alguna razón llega vacío.
      return message || GENERIC_MESSAGE;

    case 'functions/already-exists':
      // No usado hoy por crearTenant (B9 lanza `invalid-argument` desde
      // `assertCIFUnico`). Reservado para futuros callables que usen este
      // código semánticamente.
      return 'Ya existe un recurso con esos datos.';

    case 'functions/unauthenticated':
      // TODO[token-refresh-strategy] (Sesión 18): interceptar antes de
      // mostrar este mensaje y forzar refresh del token con getIdToken(true);
      // solo mostrar si el refresh también falla.
      return 'Sesión expirada. Recarga la página y vuelve a entrar.';

    case 'functions/permission-denied':
      return 'No tienes permiso para esta operación.';

    case 'functions/unavailable':
    case 'functions/resource-exhausted':
      return 'Servicio temporalmente no disponible. Reintenta en unos segundos.';

    case 'functions/deadline-exceeded':
      return 'La operación tardó demasiado. Inténtalo de nuevo.';

    case 'functions/internal':
      return GENERIC_MESSAGE;

    default:
      return GENERIC_MESSAGE;
  }
}
