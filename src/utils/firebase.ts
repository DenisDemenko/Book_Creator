import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

/**
 * Той самий Firebase-проєкт, що й у маркетплейсі (Фаза G1/G2,
 * docs/migration-plan.md) — спільний Firebase-акаунт є тим самим
 * механізмом SSO між двома системами. Дані про роль/контент лишаються
 * в базі Nova (server/store.ts); Firebase відповідає лише за особу.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
