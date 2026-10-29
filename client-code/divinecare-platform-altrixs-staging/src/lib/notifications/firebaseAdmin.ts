import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';

export interface FirebaseAdminContext {
  app: App | null;
  isMock: boolean;
}

let cachedContext: FirebaseAdminContext | null = null;

/**
 * Initializes and returns the Firebase Admin SDK singleton.
 * Operates in safe simulation/mock mode when service account credentials
 * are not provided in environment variables, preventing dev/CI crashes.
 */
export function getFirebaseAdmin(): FirebaseAdminContext {
  if (cachedContext) {
    return cachedContext;
  }

  // Already initialized elsewhere
  const existingApps = getApps();
  if (existingApps.length > 0) {
    cachedContext = { app: existingApps[0]!, isMock: false };
    return cachedContext;
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY?.trim();

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const app = initializeApp({
        credential: cert(parsed),
      });
      cachedContext = { app, isMock: false };
      return cachedContext;
    } catch (err) {
      console.warn('[FCM] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', err);
    }
  }

  if (projectId && clientEmail && privateKeyRaw) {
    try {
      const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
      const app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      cachedContext = { app, isMock: false };
      return cachedContext;
    } catch (err) {
      console.warn('[FCM] Failed to initialize Firebase Admin cert:', err);
    }
  }

  // Fallback to safe simulation mode for local development and test runners
  cachedContext = { app: null, isMock: true };
  return cachedContext;
}
