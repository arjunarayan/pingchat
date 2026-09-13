#!/usr/bin/env node
// ============================================================
// Creates dummy test users in Firebase Auth and seeds a short
// conversation in Firestore, so the chat has some activity.
//
//   node scripts/create-test-users.mjs          create users + seed messages
//   node scripts/create-test-users.mjs cleanup  delete the dummy users
//
// Prerequisite: enable the Email/Password provider in
// Firebase Console → Authentication → Sign-in method.
//
// You can also delete the dummy accounts by hand in
// Authentication → Users (select them → Delete), and the seeded
// messages in Firestore Database → Data (delete the docs).
// ============================================================

import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const API_KEY = "AIzaSyBnebqg30St8qBF31UEyhHnzdNn7qT6uT4";
const PROJECT_ID = "pingchat-c5cd7";

const STATE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  ".test-users.json"
);

// Fake people. Emails use the reserved example.com domain, so nothing
// is ever delivered and no real person's address is involved.
const USERS = [
  { key: "alice", name: "Alice" },
  { key: "bob", name: "Bob" },
  { key: "priya", name: "Priya" },
  { key: "marco", name: "Marco" },
  { key: "zoe", name: "Zoe" },
  { key: "kenji", name: "Kenji" },
  { key: "sofia", name: "Sofia" },
  { key: "leo", name: "Leo" },
].map((u) => ({ ...u, email: `${u.key}.test@example.com` }));

const CONVERSATION = [
  { from: "alice", text: "hey everyone! 👋 is this thing working?", minutesAgo: 32 },
  { from: "bob", text: "yep, I can see you!", minutesAgo: 31 },
  { from: "priya", text: "ooo nice, messages are instant ⚡", minutesAgo: 29 },
  { from: "marco", text: "testing from my phone 📱", minutesAgo: 25 },
  { from: "zoe", text: "the typing indicator is so fancy", minutesAgo: 21 },
  { from: "kenji", text: "hello hello", minutesAgo: 17 },
  { from: "sofia", text: "ok this is actually pretty slick", minutesAgo: 12 },
  { from: "leo", text: "first! ...wait, I'm last 😅", minutesAgo: 6 },
  { from: "alice", text: "welcome all 🎉", minutesAgo: 2 },
];

const IDENTITY = "https://identitytoolkit.googleapis.com/v1";
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function api(url, body, idToken) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || res.statusText);
  }
  return data;
}

const randomPassword = () => "Dummy!" + randomBytes(12).toString("base64url");

function loadState() {
  if (!existsSync(STATE_FILE)) return { users: [], seeded: false };
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function signIn(email, password) {
  return api(`${IDENTITY}/accounts:signInWithPassword?key=${API_KEY}`, {
    email,
    password,
    returnSecureToken: true,
  });
}

async function createUsers() {
  const state = loadState();
  const known = new Map(state.users.map((u) => [u.key, u]));

  for (const user of USERS) {
    if (known.has(user.key)) {
      console.log(`• ${user.name} already exists, skipping`);
      continue;
    }
    const password = randomPassword();
    try {
      const account = await api(`${IDENTITY}/accounts:signUp?key=${API_KEY}`, {
        email: user.email,
        password,
        returnSecureToken: true,
      });
      await api(`${IDENTITY}/accounts:update?key=${API_KEY}`, {
        idToken: account.idToken,
        displayName: user.name,
      });
      state.users.push({ ...user, password, uid: account.localId });
      saveState(state); // save as we go, so a failure doesn't lose users
      console.log(`✓ created ${user.name} <${user.email}>`);
    } catch (err) {
      if (err.message === "OPERATION_NOT_ALLOWED") {
        console.error(
          "\n✗ The Email/Password sign-in provider is not enabled.\n" +
            "  Enable it in Firebase Console → Authentication → Sign-in method\n" +
            "  → Email/Password → turn on the first toggle → Save, then re-run.\n"
        );
        process.exit(1);
      }
      console.error(`✗ failed to create ${user.name}: ${err.message}`);
    }
  }

  return state;
}

async function seedConversation(state) {
  if (state.seeded) {
    console.log("• conversation already seeded, skipping");
    return;
  }
  console.log("\nSeeding conversation…");
  for (const msg of CONVERSATION) {
    const user = state.users.find((u) => u.key === msg.from);
    if (!user) continue;
    const { idToken } = await signIn(user.email, user.password);
    await api(
      `${FIRESTORE}/messages`,
      {
        fields: {
          uid: { stringValue: user.uid },
          name: { stringValue: user.name },
          text: { stringValue: msg.text },
          createdAt: {
            timestampValue: new Date(
              Date.now() - msg.minutesAgo * 60000
            ).toISOString(),
          },
        },
      },
      idToken
    );
    console.log(`  ✓ ${user.name}: "${msg.text}"`);
  }
  state.seeded = true;
  saveState(state);
}

async function cleanup() {
  const state = loadState();
  if (state.users.length === 0) {
    console.log("No dummy users found (nothing to do).");
    return;
  }
  for (const user of state.users) {
    try {
      const { idToken } = await signIn(user.email, user.password);
      await api(`${IDENTITY}/accounts:delete?key=${API_KEY}`, { idToken });
      console.log(`✓ deleted ${user.name} <${user.email}>`);
    } catch (err) {
      console.error(
        `✗ couldn't delete ${user.name}: ${err.message} — delete it in ` +
          "Firebase Console → Authentication → Users"
      );
    }
  }
  rmSync(STATE_FILE, { force: true });
  console.log(
    "\nDone. Note: messages they posted are still in Firestore — delete them in\n" +
      "Firestore Database → Data → messages (security rules block client deletes)."
  );
}

// ---------- main ----------

const mode = process.argv[2];

if (mode === "cleanup") {
  await cleanup();
} else {
  const state = await createUsers();
  await seedConversation(state);
  console.log(
    `\nDone! ${state.users.length} dummy users exist. Open the app and you'll\n` +
      "see the seeded conversation. To remove the dummy accounts later:\n" +
      "  node scripts/create-test-users.mjs cleanup\n" +
      "or delete them in Firebase Console → Authentication → Users."
  );
}
