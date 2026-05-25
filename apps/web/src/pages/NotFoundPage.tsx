import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { homeForRol } from '@/lib/navigation';

/**
 * Catch-all 404. Vive fuera de ProtectedRoute, así que también responde a
 * usuarios no autenticados.
 *
 * El botón "Ir al inicio" redirige al home del rol si hay sesión válida;
 * en caso contrario, a /login.
 */
export default function NotFoundPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  function handleGoHome() {
    const target = user?.rol ? homeForRol(user.rol) : '/login';
    navigate(target, { replace: true });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center max-w-md flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Página no encontrada</h1>
        <p className="text-muted-foreground">
          La dirección que intentas abrir no existe en Albius.
        </p>
        <div className="flex justify-center">
          <Button onClick={handleGoHome}>Ir al inicio</Button>
        </div>
      </div>
    </main>
  );
}
