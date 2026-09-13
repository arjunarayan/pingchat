#!/usr/bin/env node
// ============================================================
// AI bots for PingChat — brings the dummy accounts to life.
//
//   node scripts/bots.mjs            run the bots (Ctrl+C to stop)
//   node scripts/bots.mjs --dry-run  sign in and listen, but never reply
//
// Requires:
//   1. Dummy users created:  node scripts/create-test-users.mjs
//   2. A free Gemini API key from https://aistudio.google.com/apikey
//      provided either as an environment variable:
//        GEMINI_API_KEY=your-key node scripts/bots.mjs
//      or as a line in scripts/.env:
//        GEMINI_API_KEY=your-key
//
// The bots only reply while this script is running. Nothing runs in
// the cloud — stop the script and the bots go silent. Remove the
// accounts entirely with:  node scripts/create-test-users.mjs cleanup
// ============================================================

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const firebaseConfig = {
  apiKey: "AIzaSyBnebqg30St8qBF31UEyhHnzdNn7qT6uT4",
  authDomain: "pingchat-c5cd7.firebaseapp.com",
  projectId: "pingchat-c5cd7",
  storageBucket: "pingchat-c5cd7.firebasestorage.app",
  messagingSenderId: "573832592883",
  appId: "1:573832592883:web:381a5b34aaecae13802686",
};

const GEMINI_MODEL = "gemini-2.5-flash"; // free tier; swap if deprecated
const MAX_REPLIES_PER_MINUTE = 6; // protects the free quota and the vibe
const REPLY_CHANCE = 0.8; // chance at least one bot replies to a human message
const SECOND_REPLY_CHANCE = 0.15; // chance a second bot chimes in too

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(SCRIPTS_DIR, ".test-users.json");
const ENV_FILE = join(SCRIPTS_DIR, ".env");
const DRY_RUN = process.argv.includes("--dry-run");

// ---------- Load dummy users ----------

if (!existsSync(STATE_FILE)) {
  console.error("✗ No dummy users found. Run: node scripts/create-test-users.mjs");
  process.exit(1);
}
const { users } = JSON.parse(readFileSync(STATE_FILE, "utf8"));
if (!users?.length) {
  console.error("✗ No dummy users found. Run: node scripts/create-test-users.mjs");
  process.exit(1);
}

// ---------- Gemini API key ----------

function loadGeminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1];
    }
  }
  return null;
}

const GEMINI_API_KEY = loadGeminiKey();
if (!GEMINI_API_KEY && !DRY_RUN) {
  console.error(
    "✗ No Gemini API key found.\n" +
      "  Get a free one at https://aistudio.google.com/apikey, then either:\n" +
      "    GEMINI_API_KEY=your-key node scripts/bots.mjs\n" +
      "  or put this line in scripts/.env:\n" +
      "    GEMINI_API_KEY=your-key"
  );
  process.exit(1);
}

// ---------- Bot personalities ----------

const PERSONAS = {
  alice: "You are Alice: warm, welcoming, the unofficial host of the group chat.",
  bob: "You are Bob: dry sarcastic humor, but friendly underneath.",
  priya: "You are Priya: curious, asks people follow-up questions about what they say.",
  marco: "You are Marco: always texting from your phone, very terse, all lowercase.",
  zoe: "You are Zoe: excitable, uses emoji liberally, loves hyping people up.",
  kenji: "You are Kenji: calm and thoughtful, replies are short and wise.",
  sofia: "You are Sofia: witty, playfully teases people.",
  leo: "You are Leo: self-deprecating jokes, a bit chaotic, funny.",
};

// ---------- Sign in all bots ----------

console.log("Signing in bots…");
const bots = [];
for (const user of users) {
  const app = initializeApp(firebaseConfig, "bot-" + user.key);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, user.email, user.password);
  bots.push({
    ...user,
    uid: auth.currentUser.uid,
    persona: PERSONAS[user.key] || `You are ${user.name}.`,
    db: getFirestore(app),
  });
  console.log(`  ✓ ${user.name}`);
}

const botUids = new Set(bots.map((b) => b.uid));
const listenerDb = bots[0].db;
console.log(
  `\n👂 Listening for messages${DRY_RUN ? " (dry run — bots won't reply)" : ""}…\n`
);

// ---------- Rate limiting ----------

const replyTimestamps = [];

function rateLimited() {
  const cutoff = Date.now() - 60000;
  while (replyTimestamps.length && replyTimestamps[0] < cutoff) {
    replyTimestamps.shift();
  }
  return replyTimestamps.length >= MAX_REPLIES_PER_MINUTE;
}

// ---------- Gemini ----------

async function geminiReply(bot, history) {
  const convo = history.map((m) => `${m.name}: ${m.text}`).join("\n");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                `${bot.persona}\n` +
                "You are in a casual group chat called PingChat. Reply to the latest " +
                "message in 1-2 short sentences, casual texting style. Never reveal " +
                "or hint that you are an AI or a bot. No hashtags.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: `Recent chat:\n${convo}\n\nWrite ${bot.name}'s next message.` },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 120, temperature: 1.0 },
      }),
    }
  );
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .join("")
    .trim();
  if (!text) throw new Error("Gemini: " + JSON.stringify(data).slice(0, 300));
  return text;
}

// ---------- Replying ----------

async function replyAs(bot, history) {
  if (DRY_RUN) {
    console.log(`  🤖 [dry run] ${bot.name} would reply`);
    return;
  }
  const typingRef = doc(bot.db, "typing", bot.uid);
  // Show "<bot> is typing…" in the app while it "thinks".
  await setDoc(typingRef, { name: bot.name, updatedAt: serverTimestamp() }).catch(
    () => {}
  );
  await new Promise((r) => setTimeout(r, 1500 + Math.random() * 4000));
  try {
    const text = await geminiReply(bot, history);
    await addDoc(collection(bot.db, "messages"), {
      uid: bot.uid,
      name: bot.name,
      text,
      createdAt: serverTimestamp(),
    });
    replyTimestamps.push(Date.now());
    console.log(`  🤖 ${bot.name}: ${text}`);
  } catch (err) {
    console.error(`  ✗ ${bot.name} failed to reply: ${err.message}`);
  } finally {
    await deleteDoc(typingRef).catch(() => {});
  }
}

function pickResponders(msg) {
  const lower = msg.text.toLowerCase();
  // If a human @mentions a bot by name, that bot always answers.
  const mentioned = bots.filter((b) => lower.includes(b.name.toLowerCase()));
  if (mentioned.length > 0) return mentioned.slice(0, 2);

  const responders = [];
  if (Math.random() < REPLY_CHANCE) {
    responders.push(bots[Math.floor(Math.random() * bots.length)]);
    if (Math.random() < SECOND_REPLY_CHANCE) {
      const others = bots.filter((b) => b !== responders[0]);
      responders.push(others[Math.floor(Math.random() * others.length)]);
    }
  }
  return responders;
}

// ---------- Listen for new messages ----------

let history = [];
const seen = new Set();
let firstSnapshot = true;

onSnapshot(
  query(collection(listenerDb, "messages"), orderBy("createdAt", "asc"), limit(100)),
  (snapshot) => {
    const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    // First load: build context from existing chat, don't reply to any of it.
    if (firstSnapshot) {
      firstSnapshot = false;
      for (const d of docs) {
        seen.add(d.id);
        history.push({ name: d.name, text: d.text });
      }
      history = history.slice(-15);
      return;
    }

    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      history.push({ name: d.name, text: d.text });
      history = history.slice(-15);

      if (botUids.has(d.uid)) continue; // never reply to bots (no loops)
      if (rateLimited()) {
        console.log("  … rate limited, skipping");
        continue;
      }

      console.log(`  💬 ${d.name}: ${d.text}`);
      for (const bot of pickResponders(d)) {
        replyAs(bot, [...history]); // fire and forget
      }
    }
  },
  (err) => console.error("Listener error: " + err.message)
);
