import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};

export const firebaseReady = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
export const firebaseApp = firebaseReady
  ? getApps().find(app => app.name === '[DEFAULT]') || initializeApp(config)
  : null;

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const judgeAuth = firebaseReady
  ? getAuth(getApps().find(app => app.name === 'judge-provisioning') || initializeApp(config, 'judge-provisioning'))
  : null;

export const ADMIN_USERNAME = 'AUjudgemate';
export const ADMIN_EMAIL = `${ADMIN_USERNAME.toLowerCase()}@judgemate.invalid`;
export const accountEmail = (username: string) => `${username.trim().toLowerCase()}@judgemate.invalid`;
