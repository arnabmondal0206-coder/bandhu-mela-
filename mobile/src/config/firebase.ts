import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyC479vdcK1ED-vdMDT1IqG--7JqPe6OXMc',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'gen-lang-client-0600358623.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'gen-lang-client-0600358623',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || 'gen-lang-client-0600358623.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '213671725941',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:213671725941:web:6252bd14aa80b0373f213c',
};

const DATABASE_ID =
  process.env.EXPO_PUBLIC_FIRESTORE_DATABASE_ID || 'ai-studio-45dfd30b-fd92-449c-b911-40d2ba23653f';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let authInstance: Auth;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = initializeFirestore(app, {}, DATABASE_ID);
export const storage = getStorage(app);

export const OWNER_ADMIN_EMAIL = 'arnabmondal0206@gmail.com';
export const ORIGINAL_OWNER_UID = '7eDEh2lWmhORezODM5kisxXX3mz2';
export const SERVER_API_BASE =
  process.env.EXPO_PUBLIC_API_URL ||
  'https://ais-pre-efxh6dp6beysynro5ox2cv-633625741621.asia-east1.run.app';
