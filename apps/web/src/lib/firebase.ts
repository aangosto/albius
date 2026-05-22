import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';

type FirebaseEnvVar =
  | 'VITE_FIREBASE_API_KEY'
  | 'VITE_FIREBASE_AUTH_DOMAIN'
  | 'VITE_FIREBASE_PROJECT_ID'
  | 'VITE_FIREBASE_STORAGE_BUCKET'
  | 'VITE_FIREBASE_MESSAGING_SENDER_ID'
  | 'VITE_FIREBASE_APP_ID';

function readEnv(key: FirebaseEnvVar): string {
  const value = import.meta.env[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `[albius] Falta la variable de entorno ${key}. ` +
        `Copia apps/web/.env.example a apps/web/.env.local y rellena los valores ` +
        `del proyecto Firebase albius-cbdb1.`,
    );
  }
  return value;
}

const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID'),
};

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);
export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);

// Conexión a emulators locales si VITE_USE_EMULATORS=true (solo desarrollo).
// En producción (Vercel) la variable está vacía o "false" y se conecta a
// Firebase real con la config de arriba.
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  console.info('[albius] Conectado a Firebase Emulators (Auth + Firestore)');
}
