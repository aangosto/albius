import { LogOut, Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { findNavItem, USUARIO_PLACEHOLDER } from '@/lib/navigation';

export default function Topbar() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const titulo = item?.label ?? 'Albius';
  const usuario =
    item?.rol === 'conductor' ? USUARIO_PLACEHOLDER.conductor : USUARIO_PLACEHOLDER.jefe;

  return (
    <header className="bg-white border-b border-border h-16 flex items-center px-4 md:px-6 gap-4">
      {/* TODO[auth]: cablear este botón a un drawer mobile (shadcn Sheet) cuando integremos Firebase Auth. */}
      <button
        type="button"
        aria-label="Abrir menú"
        className="md:hidden inline-flex items-center justify-center size-9 rounded-md hover:bg-accent"
      >
        <Menu className="size-5" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-lg leading-tight truncate">{titulo}</div>
        <div className="text-xs text-muted-foreground font-mono truncate">
          {usuario.nombre} · {usuario.contexto}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border">
          <div className="size-7 rounded-full bg-[#2E75B6] text-white text-xs font-semibold flex items-center justify-center">
            {usuario.iniciales}
          </div>
          <span className="text-sm">{usuario.nombre}</span>
        </div>
        {/* TODO[auth]: implementar logout (Firebase Auth signOut + redirección a /login). */}
        <Button variant="ghost" size="sm" aria-label="Cerrar sesión">
          <LogOut className="size-4" />
          <span className="hidden sm:inline">Cerrar sesión</span>
        </Button>
      </div>
    </header>
  );
}
