# JUDGEMATE | Alliance University

JUDGEMATE lets an administrator create events, add teams and judges, set scoring categories, and assign teams. Judges sign in from their phones and see only their assigned teams. Scores and reports are shared through Firebase Authentication and Cloud Firestore.

## Project structure

- `frontend/` contains the React/Vite app, its Firebase client configuration, and the frontend environment files.
- `backend/` contains Firebase Functions and Firestore security rules.
- `firebase.json` at the repository root configures Firebase Hosting, Functions, and Firestore deployment.

## Local development

1. Install Node.js 20 or newer.
2. Copy `frontend/.env.example` to `frontend/.env` and add the Firebase web app configuration.
3. From the repository root, run `npm --prefix frontend install` and `npm --prefix frontend run dev`.
4. Open the development URL with `/in/` at the end.

## Firebase setup

The Firebase project is `judgemate-au-2026`. The current deployment uses Firebase Hosting and Firestore. Backend Functions are organized under `backend/functions` for future use.

In the Firebase Console, finish these one-time steps before deploying:

1. In **Authentication → Sign-in method**, enable **Email/Password**.
2. In **Firestore Database**, enable the Firestore API and create the default database in `asia-south1` (Mumbai).
3. The administrator Firebase Auth account is provisioned as part of setup; sign in using the admin username configured for the app.
4. Deploy the Firestore rules and site:

   ```sh
   npm --prefix frontend run build
   firebase deploy --only firestore:rules,hosting
   ```

Firebase Hosting serves the app at `https://judgemate-au-2026.web.app/in/`. A custom domain can be connected later from Firebase Hosting after a domain is purchased and its DNS can be edited.

Judge temporary passwords are generated when a judge is added and kept in an admin-only Firestore subcollection so administrators can retrieve them from the event’s Judges panel. Firestore rules restrict judge views to assigned teams and validate scores against each category’s maximum marks.
