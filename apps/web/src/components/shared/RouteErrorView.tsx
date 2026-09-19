import { useRouteError } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * `errorElement` de las rutas hijas de AppLayout (B36.5).
 *
 * Sin él, cualquier error de render/commit de una página sustituye TODA la app
 * por el overlay de desarrollador de React Router, con su stack trace: delante
 * de un cliente la app se ve "rota" aunque por debajo siga funcionando. Al
 * colgar el errorElement de las rutas hijas (y no del layout), Sidebar y Topbar
 * sobreviven: solo se reemplaza el contenido del <main>, y la navegación sigue
 * viva para salir de la página que ha fallado.
 *
 * Causa conocida de estos errores: manipulación externa del DOM (traducción
 * automática de Chrome, extensiones) que reescribe nodos de texto bajo React y
 * hace fallar el `removeChild` del commit con NotFoundError. Ver también el
 * `<meta name="google" content="notranslate">` de index.html.
 *
 * En producción no se muestra nunca el detalle técnico; en dev sí, para no
 * perder diagnóstico durante el desarrollo.
 */
export default function RouteErrorView() {
  const error = useRouteError();

  const detalle =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : null;

  return (
    <Card className="py-12 px-6">
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          Ha ocurrido un error al mostrar esta página.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.location.reload();
          }}
        >
          Recargar
        </Button>
        {import.meta.env.DEV && detalle && (
          <pre className="max-w-full overflow-auto whitespace-pre-wrap text-left text-xs text-muted-foreground">
            {detalle}
          </pre>
        )}
      </div>
    </Card>
  );
}
