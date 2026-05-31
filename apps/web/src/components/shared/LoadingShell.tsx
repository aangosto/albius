import { Card, CardContent } from '@/components/ui/card';

/**
 * Loader compartido para estados de carga.
 *
 *   - fullscreen=true (default): ocupa toda la pantalla y centra el Card. Usado
 *     por ProtectedRoute mientras `status==='loading'` (aún no hay shell).
 *   - fullscreen=false: se centra dentro del contenedor actual (sin min-h-screen).
 *     Usado como fallback de <Suspense> dentro de AppLayout, de modo que Sidebar
 *     y Topbar permanezcan visibles mientras carga el chunk de la ruta lazy.
 *
 * Extraído de ProtectedRoute.tsx en el Bloque 15 (bundle splitting). El default
 * `fullscreen=true` preserva el comportamiento original de ProtectedRoute.
 */
export default function LoadingShell({
  fullscreen = true,
}: {
  fullscreen?: boolean;
}) {
  return (
    <main
      className={
        fullscreen
          ? 'min-h-screen flex items-center justify-center bg-background p-6'
          : 'flex items-center justify-center py-16'
      }
    >
      <Card className="w-full max-w-sm">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Cargando…
        </CardContent>
      </Card>
    </main>
  );
}
