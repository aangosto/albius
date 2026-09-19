import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { Timestamp } from 'firebase/firestore';
import { useNotificaciones } from '@/hooks/useNotificaciones';
import { marcarNotificacionesLeidas } from '@/lib/services/notificaciones';
import { cn } from '@/lib/utils';

/**
 * CAMPANA DE NOTIFICACIONES del Topbar (B38.5). Vale para los TRES roles: el
 * jefe ya recibía las del optimizador (B29) sin poder verlas en ningún sitio,
 * y el conductor empieza a recibir las de publicación en este mismo bloque.
 *
 * Construida sobre los primitivos de Radix Popover que ya trae `radix-ui`
 * (mismo criterio que `MobileNavDrawer` con Dialog en B34.3: no añadimos la
 * dependencia del Popover de shadcn). De serie: cierre con Escape y con clic
 * fuera, `aria-expanded`, gestión de foco y anclaje con colisión.
 *
 * MARCAR LEÍDAS AL ABRIR: al desplegar se marcan las no leídas que se están
 * mostrando, en UNA llamada en lote. Dos cuidados:
 *   - `enviadasRef` evita re-enviar ids ya marcados si el usuario abre y
 *     cierra varias veces (el onSnapshot tarda un instante en reflejarlo).
 *   - `resaltadasRef` congela cuáles estaban SIN LEER al abrir, para que el
 *     resalte no se desvanezca delante del usuario en cuanto el backend
 *     confirma la escritura. El contador del badge sí baja al momento.
 *
 * Un fallo al marcar NO se le enseña al usuario: la notificación ya la ha
 * leído en pantalla; que el flag no cuajara es un problema nuestro, y al
 * volver a abrir se reintenta.
 *
 * Móvil (375px): el botón es un cuadrado de 36px como el hamburguesa y el
 * panel se limita a `calc(100vw-1.5rem)`, así que no desborda ni empuja el
 * título (que ya trunca) ni el botón de cerrar sesión.
 */

const MAX_BADGE = 9;

function formatearFecha(ts: Timestamp | undefined): string {
  // `fechaCreacion` es serverTimestamp: en el instante entre la escritura y
  // la confirmación puede llegar nulo en un snapshot. No es nuestro caso
  // (nunca escribimos notificaciones desde el cliente), pero no merece la
  // pena reventar el render por ello.
  const fecha = ts?.toDate?.();
  if (!fecha) return '';
  const minutos = Math.floor((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return 'ahora mismo';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;
  return fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function NotificacionesBell() {
  const { notificaciones, noLeidas, cargando, error } = useNotificaciones();
  const [abierto, setAbierto] = useState(false);
  const enviadasRef = useRef<Set<string>>(new Set());
  const resaltadasRef = useRef<Set<string>>(new Set());

  function handleOpenChange(open: boolean) {
    setAbierto(open);
    if (!open) return;

    resaltadasRef.current = new Set(noLeidas.map((n) => n.id));

    const pendientes = noLeidas
      .map((n) => n.id)
      .filter((id) => !enviadasRef.current.has(id));
    if (pendientes.length === 0) return;

    for (const id of pendientes) enviadasRef.current.add(id);
    marcarNotificacionesLeidas({ notificacionIds: pendientes }).catch((err) => {
      console.error('[notificaciones] marcar leídas:', err);
      // Se reintenta al volver a abrir.
      for (const id of pendientes) enviadasRef.current.delete(id);
    });
  }

  const sinLeer = noLeidas.length;
  const etiqueta =
    sinLeer > 0
      ? `Notificaciones (${sinLeer} sin leer)`
      : 'Notificaciones (ninguna sin leer)';

  return (
    <PopoverPrimitive.Root open={abierto} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger
        aria-label={etiqueta}
        data-testid="campana"
        className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Bell className="size-5" />
        {sinLeer > 0 && (
          <span
            data-testid="campana-contador"
            className="absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {sinLeer > MAX_BADGE ? `${MAX_BADGE}+` : sinLeer}
          </span>
        )}
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          data-testid="campana-panel"
          className="z-50 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-border bg-white shadow-lg outline-none"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-semibold">Notificaciones</p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {error && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No se pudieron cargar las notificaciones. Vuelve a intentarlo
                en unos segundos.
              </p>
            )}

            {!error && cargando && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Cargando…
              </p>
            )}

            {!error && !cargando && notificaciones.length === 0 && (
              <p
                data-testid="campana-vacia"
                className="px-4 py-6 text-sm text-muted-foreground"
              >
                No tienes notificaciones.
              </p>
            )}

            {!error &&
              !cargando &&
              notificaciones.map((n) => (
                <article
                  key={n.id}
                  data-testid="campana-item"
                  className={cn(
                    'border-b border-border px-4 py-3 last:border-b-0',
                    resaltadasRef.current.has(n.id) && 'bg-accent/50',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {resaltadasRef.current.has(n.id) && (
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-[#2E75B6]"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{n.titulo}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {n.mensaje}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatearFecha(n.fechaCreacion)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
