import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useAuth, type AuthUser } from '@/contexts/AuthContext';
import { mapAuthError } from '@/lib/auth-errors';

/**
 * Página de login.
 *
 * Tres sub-vistas según el estado de auth global:
 *   - loading        → shell mínimo "Cargando…" mientras se resuelve la
 *                      sesión persistida.
 *   - authenticated  → tarjeta "Logueado correctamente" con email/rol/uid
 *                      + botón "Cerrar sesión". Vista TEMPORAL del Bloque 5;
 *                      Bloque 6 reemplazará por redirección por rol.
 *   - unauthenticated→ formulario email/password.
 */
export default function LoginPage() {
  const { status, user, signIn, signOut } = useAuth();

  if (status === 'loading') {
    return <LoadingShell />;
  }

  if (status === 'authenticated' && user) {
    return <AuthenticatedView user={user} onSignOut={signOut} />;
  }

  return <LoginForm onSignIn={signIn} />;
}

// ============================================================================
//  Sub-vistas
// ============================================================================

function LoadingShell() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Cargando…
        </CardContent>
      </Card>
    </main>
  );
}

function AuthenticatedView({
  user,
  onSignOut,
}: {
  user: AuthUser;
  onSignOut: () => Promise<void>;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setError(null);
    setSigningOut(true);
    try {
      await onSignOut();
      // Si éxito, onAuthStateChanged cambia el render automáticamente.
      // NO reseteamos signingOut: el componente se desmonta al cambiar de sub-vista.
    } catch (err) {
      console.error('[auth] signOut error:', err);
      setError('Error cerrando sesión. Inténtalo de nuevo.');
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
          <CardDescription>Logueado correctamente</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Email:</span>{' '}
            <span>{user.email ?? '(sin email)'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Rol:</span>{' '}
            <span>{user.rol ?? '(sin rol)'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">UID:</span>{' '}
            <span className="font-mono text-xs break-all">{user.uid}</span>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-xs pt-1">
              {error}
            </p>
          )}
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

function LoginForm({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSignIn(email, password);
      // Si éxito, onAuthStateChanged cambia el render automáticamente.
      // NO reseteamos submitting: el componente se desmonta al cambiar de sub-vista.
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      console.error('[auth] signIn error:', code, err);
      setError(mapAuthError(code));
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
          <CardDescription>Plataforma de gestión de turnos</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="conductor@empresa.es"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Contraseña</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 pr-9 text-sm disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  disabled={submitting}
                  aria-label={
                    showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>
            {error && (
              <p role="alert" className="text-destructive text-sm pt-1">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
