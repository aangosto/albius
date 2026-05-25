import { Navigate, Outlet } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Gate de rutas privadas.
 *
 *   - status='loading'                          → splash mínimo.
 *   - status='unauthenticated'                  → Navigate a /login.
 *   - status='authenticated' sin user.rol       → Navigate a /login (LoginPage
 *                                                 detecta el caso y muestra
 *                                                 ClaimsIncompletosView).
 *   - status='authenticated' con user.rol       → Outlet (renderiza la ruta hija).
 *
 * No gatea por rol específico de la ruta: la sidebar oculta lo que cada rol no
 * debe ver, y las reglas Firestore impedirán lecturas reales en sesiones 4+.
 * Si surge la necesidad explícita de RoleGate, se añade en sub-bloque aparte
 * (decisión D1 del Bloque 6).
 */
export default function ProtectedRoute() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <LoadingShell />;
  }

  if (status === 'unauthenticated' || !user?.rol) {
    return <Navigate to="/login" replace />;
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
