/**
 * Mapea códigos de error de Firebase Auth a mensajes en español user-friendly.
 *
 * Decisión de seguridad: los códigos `auth/user-not-found`, `auth/wrong-password`
 * y `auth/invalid-credential` devuelven el MISMO mensaje genérico para no
 * revelar si un email está registrado en el sistema.
 *
 * Códigos no mapeados devuelven mensaje genérico; se espera que el caller
 * loguee el código original a console.error para debugging.
 */

export function mapAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'El email no tiene un formato válido.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email o contraseña incorrectos.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Inténtalo de nuevo en unos minutos.';
    case 'auth/network-request-failed':
      return 'Sin conexión. Comprueba tu red e inténtalo de nuevo.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada. Contacta con administración.';
    default:
      return 'Error inesperado. Inténtalo de nuevo.';
  }
}
