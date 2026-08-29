/**
 * Верифікація Firebase ID-токена на сервері (Фаза G1, docs/migration-plan.md
 * маркетплейсу). Той самий Firebase-проєкт, що й у маркетплейсі — це і є
 * механізм SSO з Фази G2: один Firebase-акаунт, дві системи.
 *
 * Ліниво ініціалізується, і — на відміну від маркетплейсу — відсутність
 * ключів не валить процес при старті: NOVA STUDIO обслуговує купу не
 * повʼязаних із авторизацією функцій (генерація зображень, чат, публікація),
 * і сервер має піднятись навіть якщо адмін ще не додав Firebase-ключі. Замість
 * цього кожен запит на вхід поверне зрозумілу 503 — той самий патерн, що вже
 * є для LiqPay/PayPal/Etsy: без ключа фіча каже чому вона недоступна, а не
 * валить сервер.
 */

import type { App } from 'firebase-admin/app';

let app: App | null = null;
let initTried = false;
let initError: string | null = null;

function loadCredentials(): { projectId: string; clientEmail: string; privateKey: string } | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Base64 у пріоритеті: голий PEM у .env легко ламається на хостингах, що
  // не зберігають \n і лапки точно (той самий компроміс, що й у маркетплейсі).
  const privateKey = process.env.FIREBASE_PRIVATE_KEY_B64
    ? Buffer.from(process.env.FIREBASE_PRIVATE_KEY_B64, 'base64').toString('utf8')
    : process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function firebaseAuthConfigured(): boolean {
  return loadCredentials() !== null;
}

async function getApp(): Promise<App> {
  if (app) return app;
  if (initTried && initError) throw new Error(initError);
  initTried = true;

  const creds = loadCredentials();
  if (!creds) {
    initError =
      'Вхід не налаштований: задайте FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL ' +
      'і FIREBASE_PRIVATE_KEY (або FIREBASE_PRIVATE_KEY_B64) — той самий сервісний ' +
      'акаунт fusionlab-acc2d, що й у маркетплейсі.';
    throw new Error(initError);
  }

  const { getApps, initializeApp, cert } = await import('firebase-admin/app');
  app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(creds) });
  return app;
}

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Кидає з понятним повідомленням при непіднятому Firebase або невалідному
 * токені — виклики самі перетворюють це на 503/401, тут лише факти.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseToken> {
  const instance = await getApp();
  const { getAuth } = await import('firebase-admin/auth');
  const decoded = await getAuth(instance).verifyIdToken(idToken);

  if (!decoded.email) {
    throw new Error('Firebase-токен не містить пошти');
  }

  return {
    uid: decoded.uid,
    email: decoded.email,
    emailVerified: decoded.email_verified === true,
    name: typeof decoded.name === 'string' ? decoded.name : undefined,
  };
}
