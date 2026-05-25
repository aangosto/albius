import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Navigate } from 'react-router-dom';
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
import { homeForRol } from '@/lib/navigation';

/**
 * Página de login.
 *
 * Cuatro caminos según el estado de auth global:
 *   - loading                              → splash mínimo.
 *   - authenticated + user.rol válido      → redirige al home del rol
 *                                            (cubre login exitoso y redirect
 *                                             inverso si ya estaba logueado).
 *   - authenticated + user sin claims rol  → ClaimsIncompletosView.
 *   - unauthenticated                      → formulario.
 */
export default function LoginPage() {
  const { status, user, signIn, signOut } = useAuth();

  if (status === 'loading') {
    return <LoadingShell />;
  }

  if (status === 'authenticated' && user?.rol) {
    return <Navigate to={homeForRol(user.rol)} replace />;
  }

  if (status === 'authenticated' && user && !user.rol) {
    return <ClaimsIncompletosView user={user} onSignOut={signOut} />;
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

function ClaimsIncompletosView({
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
      // onAuthStateChanged actualiza el estado y este componente se desmonta.
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
          <CardDescription>Cuenta sin rol asignado</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Tu cuenta ({user.email ?? 'sin email'}) no tiene un rol asignado.
            Contacta con administración para completar el alta.
          </p>
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <Button onClick={handleSignOut} disabled={signingOut} variant="outline">
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
      // Si éxito, onAuthStateChanged actualiza status y LoginPage devuelve
      // el <Navigate> al home del rol. NO reseteamos submitting: el
      // componente se desmonta al cambiar de vista.
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
