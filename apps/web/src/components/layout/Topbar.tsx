import { useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { findNavItem, ROL_LABEL } from '@/lib/navigation';

// TODO[topbar-tenant-centro-hidratado] — Topbar muestra solo ROL_LABEL del
// usuario. Cuando exista hidratación de tenant/centro en AuthContext
// (Sesiones 4-7), refinar para mostrar "ALSA Murcia · Centro Espinardo" en
// vez de solo "Jefe de tráfico". Origen: Bloque 6.

function computeIniciales(
  displayName: string | null,
  email: string | null,
): string {
  if (displayName && displayName.trim()) {
    return displayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  }
  return (email ?? '?').slice(0, 2).toUpperCase();
}

export default function Topbar() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titulo = findNavItem(pathname)?.label ?? 'Albius';
  const nombre = user?.displayName ?? user?.email ?? '';
  const rolLabel = user?.rol ? ROL_LABEL[user.rol] : '';
  const iniciales = computeIniciales(
    user?.displayName ?? null,
    user?.email ?? null,
  );

  async function handleSignOut() {
    setError(null);
    setSigningOut(true);
    try {
      await signOut();
      // ProtectedRoute redirige automáticamente cuando status → 'unauthenticated'.
    } catch (err) {
      console.error('[auth] signOut error:', err);
      setError('Error cerrando sesión.');
      setSigningOut(false);
    }
  }

  return (
    <header className="bg-white border-b border-border h-16 flex items-center px-4 md:px-6 gap-4">
      {/* TODO[mobile-drawer]: cablear a un drawer mobile (shadcn Sheet). */}
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
          {nombre}
          {rolLabel && ` · ${rolLabel}`}
        </div>
        {error && (
          <div role="alert" className="text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border">
          <div className="size-7 rounded-full bg-[#2E75B6] text-white text-xs font-semibold flex items-center justify-center">
            {iniciales}
          </div>
          <span className="text-sm">{nombre}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Cerrar sesión"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <LogOut className="size-4" />
          <span className="hidden sm:inline">
            {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </span>
        </Button>
      </div>
    </header>
  );
}
