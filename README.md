# BANDHU MELA — Connect • Share • Chat • Make Friends

Production full-stack **Web** (React 19 + Vite + Tailwind CSS + Express) and **Native Android** (`/mobile/` — React Native + Expo) social media platform sharing one Firebase backend (`Auth`, `Firestore`, `Storage`).

---

## Core Features

1. **Authentication & Security**
   - Email/Password signup & login with **mandatory email verification**, password recovery, and Google Sign-In on Web.
   - PII isolation: public profiles live in `users/{uid}`, while email, phone number, and role metadata live privately in `users/{uid}/private/info`.
   - Verified badges, privacy visibility toggles (`public` / `friends`, message privacy, online/last-seen status), block/unblock, moderation reports, JSON personal data export, and permanent account deletion.

2. **Social Network & Content**
   - Home news feed (`text`, `image`, `video`, `#hashtags`) with Recent & Trending ranking, friend suggestions, pagination, and offline caching.
   - Like, Comment, Share, Save, and Delete own posts.
   - **24-Hour Stories** (photo/video with expiry queries) and vertical **Reels** feed.
   - **Live Video Streaming** (WebRTC + real-time live comments/reactions & viewer/reaction counters).
   - **1-to-1 & Group Messaging**, online/last-seen presence, and **1-to-1 Voice & Video Calling**.
   - **Communities & Events** with member counts and RSVP tracking.
   - **EN / BN (English & Bengali)** localization and **Light / Dark** themes.

3. **BANDHU MELA Audio Party & Virtual Gifts**
   - Public & Private (SHA-256 salted `${roomId}:${passcode}`) rooms, **5 Speaker Seats (`seatNumber` 1–5)**, and unlimited listeners.
   - Host & Moderator controls: invite listeners with raised hands, move speakers to listener, mute/unmute, appoint moderators, and remove/ban disruptive users.
   - Animated Virtual Gifts (`Bengal Rose`, `Kulhad Chai`, `Warm Heart`, `Teddy Hug`, `Festive Diya`, `Royal Crown`, `Star Diamond`), user Wallet (`100` starter coins + `earnedBeans`), transaction history, host reward dashboard, and coin store checkout (`/api/coins/*` + owner approvals).

4. **Monthly Level & VIP System (Anti-Cheat Verified Speaking Time)**
   - Tracks **genuine active speaking time ONLY** when:
     - The room is live (`status === 'live'`),
     - The user occupies an active speaker seat (`seatNumber >= 1`),
     - Microphone is unmuted (`!isMuted`),
     - App/tab is foregrounded (`visibilityState === 'visible'` / `AppState === 'active'`),
     - Real microphone acoustic energy is detected (`AnalyserNode` RMS on Web, `expo-av` dB metering `> -48` dB on Android).
   - 5 Monthly Tiers (admin-configurable):
     - **Level 1 Beginner**: 1 hour
     - **Level 2 Silver**: 5 hours
     - **Level 3 Gold**: 15 hours
     - **Level 4 Diamond**: 30 hours
     - **Level 5 VIP**: 100 hours
   - Resets automatically on the **1st of each UTC month** (`YYYY-MM`), archiving completed months to `speakingStats/{uid}/history/{monthKey}`.
   - VIP perks (admin-toggleable): golden avatar frame ring, VIP name color, exclusive VIP emojis, VIP-only audio rooms, and VIP grand entry animations.

5. **Super Admin Owner Control Panel**
   - Protected original owner role (`OWNER_ADMIN_EMAIL`) plus owner-managed admins and moderators.
   - User suspension/verification, audio room inspection/closing, Level & VIP threshold/perk editor, virtual gifts & coin packages CRUD, coin top-up approvals, wallet adjustments, content/report/ticket moderation, platform feature toggles, announcements, immutable audit log, and full JSON database backup.

---

## Firebase Free-Tier Architecture Setup

1. **Firebase Project Config**
   - Web reads `/firebase-applet-config.json` and uses Firestore database ID `ai-studio-45dfd30b-fd92-449c-b911-40d2ba23653f`.
   - Android (`/mobile/src/config/firebase.ts`) reads `EXPO_PUBLIC_FIREBASE_*` and `EXPO_PUBLIC_FIRESTORE_DATABASE_ID` environment variables (with project defaults pre-wired).
2. **Firebase Authentication**
   - Enable **Email/Password** and **Google** sign-in providers in Firebase Console -> Authentication -> Sign-in method.
3. **Firestore Security Rules**
   - Hardened Zero-Trust rules in `/firestore.rules` enforce verified email, strict field shapes/sizes, PII separation, bounded speaker arrays, and RBAC owner/admin checks.
4. **Media Uploads (Firebase Storage + Secure Free-Tier Server Fallback)**
   - Both Web (`/src/lib/mediaUpload.ts`) and Android (`/mobile/src/services/api.ts`) support `avatars/`, `covers/`, `posts/`, `stories/`, `reels/`, and `chats/` with real upload progress (`0–100%`) and post-upload HTTP accessibility verification.
   - If the Firebase Storage bucket (`gen-lang-client-0600358623.firebasestorage.app`) is not yet activated in Firebase Console, uploads automatically use the authenticated Express media server (`POST /api/upload-binary` and `POST /api/upload`, secured by Firebase ID token verification & scoped to `/uploads/<folder>/<uid>/`) with zero paid billing required.
   - To enable native Firebase Storage later:
     1. Open **Firebase Console -> Storage -> Get Started** (accepting/linking a billing plan only when you explicitly choose to activate Firebase Storage).
     2. Deploy the hardened rules: `firebase deploy --only storage` (covers `avatars`, `covers`, `posts`, `stories`, `reels`, and `chats`).
5. **External Optional API Keys (Paid billing is NEVER enabled automatically)**
   - Configure via `.env` (see `.env.example`):
     - `STRIPE_SECRET_KEY` (optional — enables live Stripe Checkout for `/api/coins/create-checkout`; without it, checkout stays in safe **Free-Tier Owner Approval** mode).
     - `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET` (optional — enables Razorpay INR order creation).
     - `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` (optional TURN relay for strict NAT mobile carriers; free Google STUN servers are enabled by default).
     - `EXPO_PUBLIC_API_URL` (required on physical Android phones/tablets when pointing to your deployed Express server URL, e.g. your Cloud Run URL; defaults to `http://10.0.2.2:3000` in Android Emulator).

---

## Running & Deploying the Responsive Website

```bash
# Install dependencies
npm install

# Run full-stack Express + Vite dev server on port 3000
npm run dev

# Build production bundle & verify lint
npm run build
npm run lint

# Run production server (serves dist/ + /api/* routes on port 3000)
npm start
```

---

## Running & Releasing the Native Android App (`/mobile`)

```bash
cd mobile
npm install

# Run on Android emulator / Expo Go
npx expo start --android

# Verify TypeScript types
npm run typecheck
```

### Building APK (Testing) & Google Play Store `.aab` (Production)

1. Install EAS CLI and log in:
   ```bash
   npm install -g eas-cli
   eas login
   ```
2. Configure `mobile/app.json` (`android.package`, version, icons/permissions already configured for Camera, Microphone, Media Library).
3. Build a sideloadable **APK**:
   ```bash
   cd mobile
   eas build -p android --profile preview
   ```
4. Build a **Google Play Store `.aab`**:
   ```bash
   cd mobile
   eas build -p android --profile production
   ```
5. Download the `.aab` artifact from EAS and upload it to Google Play Console -> Closed/Production track.
