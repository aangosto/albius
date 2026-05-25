import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { COLLECTIONS, type Rol } from '@albius/shared';

/**
 * Modelo del usuario autenticado expuesto al frontend.
 *
 * Combina:
 *   - User de Firebase Auth (uid, email, displayName)
 *   - Custom claims del token (rol, tenantId, centroId)
 *   - Doc /usuarios/{uid} de Firestore (passwordChangeRequired)
 *
 * Hidratación del doc (D7.9 canónica): el frontend lee /usuarios/{uid}
 * directamente con Firebase Web SDK apoyándose en la regla `ownerOfDoc(uid)`
 * de firestore.rules. Patrón reutilizable para futuras hidrataciones
 * (tenant/centro en Topbar, mi-horario, CRUDs en Sesiones 4+).
 *
 * Campos null:
 *   - super_admin → tenantId/centroId siempre null por diseño (D3.6 + ampl. 3.2.d).
 *   - Usuarios creados fuera del flujo normal pueden tener rol=null.
 *   - passwordChangeRequired=null cuando no hay doc /usuarios (caso sinclaims)
 *     o cuando la lectura falla por red (defensa: preferimos false-negative
 *     en el gate del flag a romper la app entera; el próximo refresh corrige).
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  rol: Rol | null;
  tenantId: string | null;
  centroId: string | null;
  passwordChangeRequired: boolean | null;
}

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Re-lee /usuarios/{uid} y actualiza el `user` state. Llamado tras
   * cambios server-side que el frontend necesita reflejar inmediatamente
   * (típicamente: tras callable `marcarPasswordCambiada` en Bloque 7).
   * No-op si no hay user autenticado.
   */
  refreshAuthUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchUsuarioDoc(
  uid: string,
): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.USUARIOS, uid));
    if (!snap.exists()) return null;
    return snap.data();
  } catch (err) {
    // Defensa: preferimos false-negative en el gate del flag (user con flag
    // true no entra a /cambiar-password) que romper la app entera. El próximo
    // refresh corrige.
    console.error('[auth] Error leyendo /usuarios:', err);
    return null;
  }
}

function buildAuthUser(
  firebaseUser: FirebaseUser,
  claims: Record<string, unknown>,
  usuarioDoc: Record<string, unknown> | null,
): AuthUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    rol: typeof claims.rol === 'string' ? (claims.rol as Rol) : null,
    tenantId: typeof claims.tenantId === 'string' ? claims.tenantId : null,
    centroId: typeof claims.centroId === 'string' ? claims.centroId : null,
    passwordChangeRequired:
      usuarioDoc === null ? null : usuarioDoc.passwordChangeRequired === true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!isMounted) return;
      if (!firebaseUser) {
        setStatus('unauthenticated');
        setUser(null);
        return;
      }
      try {
        const tokenResult = await firebaseUser.getIdTokenResult();
        const usuarioDoc = await fetchUsuarioDoc(firebaseUser.uid);
        if (!isMounted) return;
        setUser(buildAuthUser(firebaseUser, tokenResult.claims, usuarioDoc));
        setStatus('authenticated');
      } catch (err) {
        if (!isMounted) return;
        console.error('[auth] Error obteniendo token o doc:', err);
        setStatus('unauthenticated');
        setUser(null);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const refreshAuthUser = useCallback(async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    try {
      const tokenResult = await firebaseUser.getIdTokenResult();
      const usuarioDoc = await fetchUsuarioDoc(firebaseUser.uid);
      setUser(buildAuthUser(firebaseUser, tokenResult.claims, usuarioDoc));
    } catch (err) {
      console.error('[auth] refreshAuthUser error:', err);
    }
  }, []);

  async function signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged actualizará el estado automáticamente.
  }

  async function signOutUser(): Promise<void> {
    await firebaseSignOut(auth);
    // onAuthStateChanged actualizará el estado automáticamente.
  }

  const value: AuthContextValue = {
    status,
    user,
    signIn,
    signOut: signOutUser,
    refreshAuthUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth debe usarse dentro de un <AuthProvider>.');
  }
  return ctx;
}
