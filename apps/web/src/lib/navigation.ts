import {
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  Bus,
  Calendar,
  CalendarClock,
  CalendarRange,
  Clock,
  LayoutDashboard,
  MapPin,
  Star,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Rol } from '@albius/shared';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  /** Si está presente, el Sidebar lo renderiza como encabezado de la sección.
   *  Sidebar solo muestra títulos cuando el rol tiene >1 sección (super_admin). */
  title?: string;
  items: NavItem[];
}

/**
 * Items de navegación del Sidebar, indexados por rol del dominio.
 *
 * super_admin ve dos secciones (Gobierno + Operativa). Los otros dos roles
 * tienen una sección sin título.
 */
export const NAV_BY_ROL: Record<Rol, NavSection[]> = {
  super_admin: [
    {
      title: 'Gobierno',
      items: [
        { path: '/tenants', label: 'Tenants', icon: Building2 },
        { path: '/centros', label: 'Centros', icon: MapPin },
        { path: '/usuarios', label: 'Usuarios', icon: UserCog },
      ],
    },
    {
      title: 'Operativa',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/cuadrante', label: 'Cuadrante', icon: Calendar },
        // Conductores NO está en la nav del super_admin (B22): la página es
        // jefe-céntrica (centro por claims). El super_admin gestiona conductores
        // desde el flujo de Usuarios (alta) — ver gate D4.13 en ConductoresPage.
      ],
    },
  ],
  jefe_trafico: [
    {
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { path: '/cuadrante', label: 'Cuadrante', icon: Calendar },
        { path: '/calendario', label: 'Calendario', icon: CalendarRange },
        { path: '/conductores', label: 'Conductores', icon: Users },
        { path: '/incidencias', label: 'Incidencias', icon: AlertTriangle },
        { path: '/intercambios', label: 'Intercambios', icon: ArrowLeftRight },
        { path: '/lineas', label: 'Líneas', icon: Bus },
        { path: '/tipos-turno', label: 'Tipos de turno', icon: Clock },
      ],
    },
  ],
  conductor: [
    {
      items: [
        { path: '/mi-horario', label: 'Mi horario', icon: CalendarClock },
        { path: '/mis-preferencias', label: 'Mis preferencias', icon: Star },
      ],
    },
  ],
};

/**
 * Lookup plano de NavItem por pathname (usado por Topbar para mostrar el
 * título de la página actual, agnóstico al rol).
 */
const ALL_ITEMS: NavItem[] = Object.values(NAV_BY_ROL).flatMap((sections) =>
  sections.flatMap((s) => s.items),
);

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_ITEMS.find((item) => item.path === pathname);
}

/**
 * Etiqueta legible del rol, para mostrar en UI (Topbar, vistas administrativas).
 */
export const ROL_LABEL: Record<Rol, string> = {
  super_admin: 'Super admin',
  jefe_trafico: 'Jefe de tráfico',
  conductor: 'Conductor',
};

/**
 * Ruta destino tras login exitoso para cada rol.
 *
 * super_admin y jefe_trafico comparten /dashboard. Conductor va a /mi-horario.
 */
export const ROL_HOME: Record<Rol, string> = {
  super_admin: '/dashboard',
  jefe_trafico: '/dashboard',
  conductor: '/mi-horario',
};

export function homeForRol(rol: Rol): string {
  return ROL_HOME[rol];
}
