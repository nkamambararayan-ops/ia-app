import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Primary Firebase App (Firestore + User Authentication)
const existingPrimary = getApps().find((a) => a.name === '[DEFAULT]');
export const app = existingPrimary ?? initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Secondary named Firebase App for Google Calendar Workspace OAuth
const calendarOAuthConfig = {
  projectId: 'gen-lang-client-0102649576',
  appId: '1:782520703917:web:b8d6250ecab712d690df24',
  apiKey: firebaseConfig.apiKey,
  authDomain: 'gen-lang-client-0102649576.firebaseapp.com',
  storageBucket: 'gen-lang-client-0102649576.firebasestorage.app',
  messagingSenderId: '782520703917',
};

const existingCalendarApp = getApps().find((a) => a.name === 'workspace-calendar');
const calendarApp = existingCalendarApp ?? initializeApp(calendarOAuthConfig, 'workspace-calendar');
const calendarAuth = getAuth(calendarApp);

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// Strictly in-memory OAuth access token cache (never localStorage/sessionStorage)
let cachedCalendarAccessToken: string | null = null;

onAuthStateChanged(calendarAuth, (user) => {
  if (!user) {
    cachedCalendarAccessToken = null;
  }
});

export function getCalendarAccessToken(): string | null {
  return cachedCalendarAccessToken;
}

export async function signInPrimaryWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function signOutPrimary(): Promise<void> {
  await signOut(auth);
}

export async function connectGoogleCalendar(): Promise<{
  user: User;
  accessToken: string;
}> {
  const provider = new GoogleAuthProvider();
  for (const scope of CALENDAR_SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({ prompt: 'consent' });
  const result = await signInWithPopup(calendarAuth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error("Impossible d'obtenir le jeton d'accès Google Calendar.");
  }
  cachedCalendarAccessToken = credential.accessToken;
  return { user: result.user, accessToken: cachedCalendarAccessToken };
}

export async function disconnectGoogleCalendar(): Promise<void> {
  cachedCalendarAccessToken = null;
  await signOut(calendarAuth);
}

// Startup Firestore connection check per Firebase integration skill
export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore offline — check Firebase configuration.');
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
