import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { homeForRol } from '@/lib/navigation';

const CAMBIAR_PASSWORD_PATH = '/cambiar-password';

/**
 * Gate de rutas privadas.
 *
 *   - status='loading'                          → splash mínimo.
 *   - status='unauthenticated'                  → Navigate a /login.
 *   - status='authenticated' sin user.rol       → Navigate a /login (LoginPage
 *                                                 detecta el caso y muestra
 *                                                 ClaimsIncompletosView).
 *   - passwordChangeRequired=true + ruta no es
 *     /cambiar-password                         → Navigate a /cambiar-password
 *                                                 (gate de Bloque 7).
 *   - passwordChangeRequired!==true + ruta es
 *     /cambiar-password                         → Navigate al home del rol
 *                                                 (gate inverso: filtra cambio
 *                                                 voluntario, out of scope).
 *   - resto                                     → Outlet (renderiza la ruta hija).
 *
 * No gatea por rol específico de la ruta (D6.1): la sidebar oculta lo que cada
 * rol no debe ver, y las reglas Firestore impedirán lecturas reales en
 * sesiones 4+.
 */
export default function ProtectedRoute() {
  const { status, user } = useAuth();
  const { pathname } = useLocation();

  if (status === 'loading') {
    return <LoadingShell />;
  }

  if (status === 'unauthenticated' || !user?.rol) {
    return <Navigate to="/login" replace />;
  }

  if (
    user.passwordChangeRequired === true &&
    pathname !== CAMBIAR_PASSWORD_PATH
  ) {
    return <Navigate to={CAMBIAR_PASSWORD_PATH} replace />;
  }

  if (
    user.passwordChangeRequired !== true &&
    pathname === CAMBIAR_PASSWORD_PATH
  ) {
    return <Navigate to={homeForRol(user.rol)} replace />;
  }

  return <Outlet />;
}

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
