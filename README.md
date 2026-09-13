# 💬 PingChat

A tiny real-time texting app that runs in the browser. Messages are stored in
**Firebase Firestore** and delivered instantly to everyone who has the page
open — no server code required.

**Live URL: https://arjunarayan.github.io/pingchat/**
(hosted free on GitHub Pages from the
[arjunarayan/pingchat](https://github.com/arjunarayan/pingchat) repo)

---

## 1. Create a Firebase project (free)

1. Go to the [Firebase Console](https://console.firebase.google.com/) and sign
   in with a Google account.
2. Click **Add project** → give it a name (e.g. `pingchat`) → you can disable
   Google Analytics → **Create project**.

## 2. Create the Firestore database

1. In the left sidebar, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Pick a location close to you, then choose **Start in production mode**
   (we'll add rules in the next step).

## 3. Set the security rules

In **Firestore Database → Rules**, paste this and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /messages/{message} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasOnly(['uid', 'name', 'text', 'createdAt'])
        && request.resource.data.text is string
        && request.resource.data.text.size() > 0
        && request.resource.data.text.size() <= 1000
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 40;
      allow update, delete: if false;
    }
    match /typing/{uid} {
      allow read: if true;
      allow create, update: if request.resource.data.keys().hasOnly(['name', 'updatedAt'])
        && request.resource.data.name is string
        && request.resource.data.name.size() <= 40;
      allow delete: if true;
    }
  }
}
```

This lets anyone read messages and post new ones (up to 1000 chars), but
nobody can edit or delete messages. For a private app you'd add
[Firebase Authentication](https://firebase.google.com/docs/auth) instead.

## 4. Get your web app config

1. In the Firebase Console, click the **gear icon → Project settings**.
2. Scroll to **Your apps** and click the **`</>`** (Web) icon.
3. Register the app (any nickname), skip Firebase Hosting for now.
4. Copy the `firebaseConfig` object it shows you.

## 5. Paste the config into the app

Open **`app.js`** and replace the placeholder values in `firebaseConfig` with
the ones you just copied. Save the file.

## 6. Run it

Browsers block JavaScript modules on `file://` pages, so serve the folder over
HTTP. From this directory:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

## 7. Share it with other people

The app is already deployed to **GitHub Pages** (free):

👉 **https://arjunarayan.github.io/pingchat/**

Anyone with that URL can open it, pick a name, and chat in real time. 🎉

### Updating the live site

Edit any files, then:

```bash
git add -A
git commit -m "describe your change"
git push
```

GitHub Pages redeploys automatically within a minute or two of every push.

---

## How it works

- `index.html` — name-entry screen + chat UI
- `style.css` — dark chat styling
- `app.js` — connects to Firestore, sends messages with `addDoc`, and listens
  for new ones in real time with `onSnapshot` (no polling, no refresh needed).
  Typing indicators work the same way: each client throttles writes to a
  `typing` collection, and everyone else sees "… is typing" for a few seconds.

Messages appear for everyone within a fraction of a second.
