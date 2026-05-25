import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { updatePassword } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth, type AuthUser } from '@/contexts/AuthContext';
import { auth, functions } from '@/lib/firebase';
import { homeForRol } from '@/lib/navigation';

const PASSWORD_MIN_LENGTH = 10;

/**
 * Pantalla de cambio forzado de contraseña (Bloque 7).
 *
 * Solo accesible cuando `user.passwordChangeRequired === true` (ProtectedRoute
 * filtra el resto con gate inverso). Full-screen sin AppLayout: D7.1.
 *
 * Flujo:
 *   1. Validar password client-side (mínimo 10 chars, confirmación coincide).
 *   2. `updatePassword(auth.currentUser, newPassword)` (Firebase Auth Web SDK).
 *   3. callable `marcarPasswordCambiada` flipea flag en /usuarios/{uid}.
 *   4. `refreshAuthUser()` re-lee el doc → flag pasa a false en state.
 *   5. <Navigate> al home del rol.
 */
export default function CambiarPasswordPage() {
  const { user, refreshAuthUser, signOut } = useAuth();

  // ProtectedRoute garantiza authenticated+rol+flag=true cuando se renderiza
  // esta página. Defensa por si llega como null tras race.
  if (!user?.rol) {
    return <Navigate to="/login" replace />;
  }

  return (
    <CambiarPasswordForm
      user={user}
      refreshAuthUser={refreshAuthUser}
      onSignOut={signOut}
    />
  );
}

// ============================================================================
//  Sub-vistas
// ============================================================================

function CambiarPasswordForm({
  user,
  refreshAuthUser,
  onSignOut,
}: {
  user: AuthUser;
  refreshAuthUser: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requiresRelogin, setRequiresRelogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigateToHome, setNavigateToHome] = useState(false);

  if (navigateToHome && user.rol) {
    return <Navigate to={homeForRol(user.rol)} replace />;
  }

  if (requiresRelogin) {
    return <ReautenticacionRequeridaView onSignOut={onSignOut} />;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(
        `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
      return;
    }
    if (password !== confirmacion) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('No hay user autenticado al intentar updatePassword.');
      }
      await updatePassword(currentUser, password);
      const marcar = httpsCallable<Record<string, never>, { ok: true }>(
        functions,
        'marcarPasswordCambiada',
      );
      await marcar({});
      await refreshAuthUser();
      setNavigateToHome(true);
      // NO reseteamos submitting: navigate desmonta el form.
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      console.error('[auth] cambiarPassword error:', code, err);
      if (code === 'auth/weak-password') {
        setError(
          'La contraseña no cumple los requisitos de Firebase. Usa más caracteres o combinaciones.',
        );
      } else if (code === 'auth/requires-recent-login') {
        setRequiresRelogin(true);
      } else if (code === 'auth/network-request-failed') {
        setError('Sin conexión. Comprueba tu red e inténtalo de nuevo.');
      } else if (code.startsWith('functions/')) {
        // Caso parcial: updatePassword OK pero callable falló. El flag sigue
        // true en backend → próximo render manda otra vez aquí. El callable
        // es idempotente (D7.4), así que el retry funciona.
        setError(
          'Contraseña cambiada pero falló la confirmación. Vuelve a intentarlo.',
        );
      } else {
        setError('Error inesperado. Inténtalo de nuevo.');
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">
            albius<span className="text-[#2E75B6]">.</span>
          </CardTitle>
          <CardDescription>Configura tu contraseña</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Es tu primer acceso. Define la contraseña que usarás a partir de
              ahora. Mínimo {PASSWORD_MIN_LENGTH} caracteres.
            </p>
            <PasswordInput
              label="Nueva contraseña"
              value={password}
              onChange={setPassword}
              show={showPassword}
              toggleShow={() => setShowPassword((s) => !s)}
              disabled={submitting}
              autoFocus
            />
            <PasswordInput
              label="Confirmar contraseña"
              value={confirmacion}
              onChange={setConfirmacion}
              show={showPassword}
              toggleShow={() => setShowPassword((s) => !s)}
              disabled={submitting}
            />
            {error && (
              <p role="alert" className="text-destructive text-sm pt-1">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Cambiando…' : 'Cambiar contraseña'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  show,
  toggleShow,
  disabled,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  toggleShow: () => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          required
          autoComplete="new-password"
          autoFocus={autoFocus}
          placeholder="••••••••••"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          onClick={toggleShow}
          disabled={disabled}
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

function ReautenticacionRequeridaView({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
      // onAuthStateChanged actualiza el estado y este componente se desmonta.
    } catch (err) {
      console.error('[auth] signOut error:', err);
      setSigningOut(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">
            albius<span className="text-[#2E75B6]">.</span>
          </CardTitle>
          <CardDescription>Sesión demasiado antigua</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Tu sesión es demasiado antigua para cambiar la contraseña de forma
            segura. Cierra sesión y vuelve a entrar para reintentar.
          </p>
          <Button
            onClick={handleSignOut}
            disabled={signingOut}
            variant="outline"
          >
            {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
