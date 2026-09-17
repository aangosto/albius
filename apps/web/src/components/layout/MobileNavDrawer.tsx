import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SidebarNav } from '@/components/layout/Sidebar';

/**
 * Drawer de navegación MÓVIL (B34.3, cierra TODO[mobile-drawer]).
 *
 * Construido sobre los primitivos de Radix Dialog que ya trae `radix-ui` (es
 * lo mismo que envuelve el Sheet de shadcn, sin añadir la dependencia — §10):
 * foco atrapado, cierre con Escape y con clic en el overlay, `role="dialog"`,
 * `aria-modal` y scroll del body bloqueado vienen de serie. El panel se ancla
 * a la izquierda con la misma piel que el Sidebar de escritorio y reutiliza
 * `SidebarNav` (una sola lista de items, NAV_BY_ROL). Pulsar un item navega y
 * cierra (`onNavigate`).
 *
 * Solo se monta en móvil (el botón que lo abre es `md:hidden`); en md+ el
 * Sidebar fijo sigue igual.
 */
export default function MobileNavDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[#0E2A47] text-white shadow-xl outline-none animate-drawer-in md:hidden"
        >
          <DialogPrimitive.Title className="sr-only">
            Menú de navegación
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Cerrar menú"
            className="absolute top-4 right-3 inline-flex size-9 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white/60"
          >
            <XIcon className="size-5" />
          </DialogPrimitive.Close>
          <SidebarNav onNavigate={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
