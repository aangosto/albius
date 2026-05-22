import {
  createContext,
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
import { auth } from '@/lib/firebase';
import type { Rol } from '@albius/shared';

/**
 * Modelo del usuario autenticado expuesto al frontend.
 *
 * Combina campos del `User` de Firebase Auth (uid, email, displayName) con los
 * custom claims leídos de `getIdTokenResult().claims` (rol, tenantId, centroId).
 * Los claims pueden ser null si:
 *   - super_admin → tenantId/centroId siempre null por diseño (D6 + ampliación 3.2.d).
 *   - El usuario fue creado fuera del flujo normal y carece de claims.
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  rol: Rol | null;
  tenantId: string | null;
  centroId: string | null;
}

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function extractAuthUser(
  firebaseUser: FirebaseUser,
  claims: Record<string, unknown>,
): AuthUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    rol: typeof claims.rol === 'string' ? (claims.rol as Rol) : null,
    tenantId: typeof claims.tenantId === 'string' ? claims.tenantId : null,
    centroId: typeof claims.centroId === 'string' ? claims.centroId : null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    // Race condition guard: si el componente se desmonta entre el dispatch
    // del callback de onAuthStateChanged y el resolve del await de
    // getIdTokenResult, evitar setState sobre componente desmontado.
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
        if (!isMounted) return;
        setUser(extractAuthUser(firebaseUser, tokenResult.claims));
        setStatus('authenticated');
      } catch (err) {
        if (!isMounted) return;
        // Si getIdTokenResult falla (raro: token revocado, conexión rota tras
        // login), dejamos al usuario como unauthenticated para que re-loguee.
        console.error('[auth] Error obteniendo token result:', err);
        setStatus('unauthenticated');
        setUser(null);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
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
