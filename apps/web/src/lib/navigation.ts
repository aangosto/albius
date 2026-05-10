import {
  AlertTriangle,
  ArrowLeftRight,
  Bus,
  Calendar,
  CalendarClock,
  Clock,
  LayoutDashboard,
  Star,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type RolNavegacion = 'jefe' | 'conductor';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  rol: RolNavegacion;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, rol: 'jefe' },
  { path: '/cuadrante', label: 'Cuadrante', icon: Calendar, rol: 'jefe' },
  { path: '/conductores', label: 'Conductores', icon: Users, rol: 'jefe' },
  { path: '/incidencias', label: 'Incidencias', icon: AlertTriangle, rol: 'jefe' },
  { path: '/intercambios', label: 'Intercambios', icon: ArrowLeftRight, rol: 'jefe' },
  { path: '/lineas', label: 'Líneas', icon: Bus, rol: 'jefe' },
  { path: '/tipos-turno', label: 'Tipos de turno', icon: Clock, rol: 'jefe' },
  { path: '/mi-horario', label: 'Mi horario', icon: CalendarClock, rol: 'conductor' },
  { path: '/mis-preferencias', label: 'Mis preferencias', icon: Star, rol: 'conductor' },
];

/**
 * Placeholders de usuario para la topbar mientras no hay autenticación real.
 *
 * TODO[auth]: sustituir por el usuario autenticado obtenido del store/contexto
 * cuando integremos Firebase Auth. Eliminar estas constantes.
 */
export const USUARIO_PLACEHOLDER = {
  jefe: {
    nombre: 'Juan Martínez',
    contexto: 'ALSA Murcia',
    iniciales: 'JM',
  },
  conductor: {
    nombre: 'Pedro Martínez',
    contexto: 'M-0245',
    iniciales: 'PM',
  },
} as const;

export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === pathname);
}
