import { useEffect, useState } from 'react';
import type { Notificacion } from '@albius/shared';
import { useAuth } from '@/contexts/AuthContext';
import {
  esNoLeida,
  suscribirNotificaciones,
} from '@/lib/services/notificaciones';

/**
 * Suscripción a las notificaciones del usuario logueado (B38.5).
 *
 * Extraído a hook porque lo consumen DOS superficies con el mismo dato: la
 * campana del Topbar (todas, cualquier rol) y el banner de Mi horario (las
 * del mes que el conductor está mirando). Duplicar el onSnapshot abriría dos
 * listeners sobre la misma query.
 *
 * Tolerante a fallos por diseño: si la suscripción falla (índice sin
 * desplegar, permisos, red) deja `error=true` y la lista vacía. Quien lo usa
 * pinta la campana apagada o esconde el banner, pero NUNCA rompe el Topbar ni
 * la página — una notificación que no llega es molesto; un Topbar que no
 * renderiza deja al usuario sin cerrar sesión.
 */
export interface UseNotificaciones {
  notificaciones: Notificacion[];
  noLeidas: Notificacion[];
  cargando: boolean;
  error: boolean;
}

export function useNotificaciones(): UseNotificaciones {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!uid) {
      setNotificaciones([]);
      setCargando(false);
      setError(false);
      return;
    }
    setCargando(true);
    setError(false);
    const unsub = suscribirNotificaciones(
      uid,
      (lista) => {
        setNotificaciones(lista);
        setCargando(false);
      },
      () => {
        setNotificaciones([]);
        setCargando(false);
        setError(true);
      },
    );
    return unsub;
  }, [uid]);

  return {
    notificaciones,
    noLeidas: notificaciones.filter(esNoLeida),
    cargando,
    error,
  };
}
