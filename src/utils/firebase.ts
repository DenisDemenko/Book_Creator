import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

/**
 * Той самий Firebase-проєкт, що й у маркетплейсі (Фаза G1/G2,
 * docs/migration-plan.md) — спільний Firebase-акаунт є тим самим
 * механізмом SSO між двома системами. Дані про роль/контент лишаються
 * в базі Nova (server/store.ts); Firebase відповідає лише за особу.
 */
// The isolated preview intentionally has no Firebase credentials. Firebase Auth
// still constructs eagerly, so a missing key would crash the entire React app
// before the guest-mode screen can render. This inert preview-only configuration
// permits SDK initialization, but authenticating remains disabled by the server.
// Never use production Firebase credentials just to make a preview boot.
const isolatedPreview = typeof window !== 'undefined' &&
  window.location.hostname === 'writer-studio-preview-production.up.railway.app';
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ||
    (isolatedPreview ? 'preview-only-no-real-firebase-auth' : ''),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    (isolatedPreview ? 'preview.invalid' : ''),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ||
    (isolatedPreview ? 'studio-preview-disabled' : ''),
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
