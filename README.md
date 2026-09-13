# 💬 PingChat

A tiny real-time texting app that runs in the browser. People sign in with
**just their email** — a passwordless sign-in link, no passwords or sign-up
forms — and their identity follows them across devices. Messages live in
**Cloud Firestore** and are delivered instantly to everyone signed in.

**Live URL: https://arjunarayan.github.io/pingchat/**
(hosted free on GitHub Pages from the
[arjunarayan/pingchat](https://github.com/arjunarayan/pingchat) repo)

---

## Firebase setup (reference — already done for this deployment)

### 1. Create a Firebase project (free)

1. Go to the [Firebase Console](https://console.firebase.google.com/) and sign
   in with a Google account.
2. Click **Add project** → give it a name → you can disable Google Analytics →
   **Create project**.

### 2. Create the Firestore database

1. **Build → Firestore Database** → **Create database**.
2. Pick a location, then **Start in production mode**.

### 3. Security rules

In **Firestore Database → Rules**, paste this and click **Publish**.
Only signed-in users can read or post, and nobody can edit, delete, or
impersonate another user's messages:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /messages/{message} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.keys().hasOnly(['uid', 'name', 'text', 'createdAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.text is string
        && request.resource.data.text.size() > 0
        && request.resource.data.text.size() <= 1000
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 40;
      allow update, delete: if false;
    }
    match /typing/{uid} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null
        && uid == request.auth.uid
        && request.resource.data.keys().hasOnly(['name', 'updatedAt'])
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 40;
      allow delete: if request.auth != null && uid == request.auth.uid;
    }
  }
}
```

### 4. Enable email-link sign-in

1. **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → **Email/Password** → enable
   **Email link (passwordless sign-in)** → **Save**.
3. **Authentication → Settings → Authorized domains** → **Add domain** →
   `arjunarayan.github.io` (so the sign-in links can return to the live site).

### 5. Web app config

**Project settings → Your apps → `</>`** → register a web app and copy the
`firebaseConfig` object into `app.js`. (Already done for this deployment.)

### 6. Run locally

Browsers block JavaScript modules on `file://` pages, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. (`localhost` is an authorized domain by
default, so sign-in works locally too.)

### 7. Share it / update it

The app is deployed to **GitHub Pages** (free):

👉 **https://arjunarayan.github.io/pingchat/**

To update the live site, edit files, then:

```bash
git add -A
git commit -m "describe your change"
git push
```

GitHub Pages redeploys automatically within a minute or two of every push.

---

## 🤖 Bot accounts (optional)

The dummy test accounts can come alive as chat bots — no API key needed:

```bash
npm install
npm run bots
```

While the script runs, the bots post in-character one-liners every ~5 seconds
and reply when humans send messages (they show typing indicators, answer when
@mentioned by name, and never reply to each other). Useful flags:

```bash
node scripts/bots.mjs --interval=3000   # chatter every ~3s
node scripts/bots.mjs --no-chatter      # only reply to humans
node scripts/bots.mjs --dry-run         # sign in and listen, never post
```

Press `Ctrl+C` to silence them; nothing runs in the cloud, so nothing costs
money while the script is off. Personalities and lines live in `PERSONAS` and
`LINES` in `scripts/bots.mjs` — edit them however you like.

**Optional upgrade — AI-written replies:** set a free
[Gemini](https://aistudio.google.com/apikey) key (env var `GEMINI_API_KEY`,
or a `GEMINI_API_KEY=...` line in the git-ignored `scripts/.env`) and replies
to human messages will be written by AI instead of canned lines.

Remove the bot accounts entirely with:

```bash
node scripts/create-test-users.mjs cleanup
```

(or delete them in Firebase Console → Authentication → Users).

---

## How it works

- `index.html` — sign-in screen, first-time display-name screen, chat UI
- `style.css` — dark chat styling
- `app.js` — Firebase Authentication (passwordless email links) + Firestore:
  - `sendSignInLinkToEmail` / `signInWithEmailLink` handle passwordless auth;
    `onAuthStateChanged` keeps the user signed in across visits and devices.
  - The display name is stored on the Firebase Auth profile
    (`updateProfile`), so it syncs to every device.
  - Messages and typing indicators sync in real time with `onSnapshot`.

Sign-in emails are sent by Firebase from
`noreply@pingchat-c5cd7.firebaseapp.com`. Email addresses are stored in
Firebase Authentication (visible only to you, in the console); the database
itself only stores display names and message text.
