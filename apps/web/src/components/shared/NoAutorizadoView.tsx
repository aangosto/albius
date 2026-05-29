import { Card } from '@/components/ui/card';

/**
 * Vista "sin permiso" compartida por las páginas administrativas con gate
 * suave de rol (D4.13): TenantsPage, CentrosPage, UsuariosPage.
 *
 * Extraída en el Bloque 14 al aparecer el tercer caso de uso (UsuariosPage),
 * justo el momento anticipado por el comentario que vivía en CentrosPage.
 * El gate sigue viviendo en cada página (componente exportado que solo invoca
 * useAuth); este componente es solo el render del estado "no autorizado".
 */
export default function NoAutorizadoView() {
  return (
    <Card className="py-12 px-6">
      <p className="text-center text-sm text-muted-foreground">
        No tienes permiso para acceder a esta página.
      </p>
    </Card>
  );
}
