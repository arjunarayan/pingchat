#!/usr/bin/env node
// ============================================================
// Bots for PingChat — brings the dummy accounts to life.
//
//   node scripts/bots.mjs                    run the bots (Ctrl+C to stop)
//   node scripts/bots.mjs --interval=3000    chatter every ~3s (default ~5s)
//   node scripts/bots.mjs --no-chatter       only reply to humans, no ambient chatter
//   node scripts/bots.mjs --dry-run          sign in and listen, but never post
//
// Requires the dummy users to exist:  node scripts/create-test-users.mjs
//
// No API key needed: by default the bots post prewritten in-character
// lines. If you set GEMINI_API_KEY (env var or scripts/.env), replies
// to humans are written by Gemini instead (free key:
// https://aistudio.google.com/apikey). Ambient chatter stays canned
// either way unless you pass --chatter=ai.
//
// The bots only run while this script is running. Nothing runs in the
// cloud — Ctrl+C and they go silent. Remove the accounts entirely with:
//   node scripts/create-test-users.mjs cleanup
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

const GEMINI_MODEL = "gemini-2.5-flash"; // only used if a key is set
const MAX_REPLIES_PER_MINUTE = 6; // cap on replies to human messages
const REPLY_CHANCE = 0.8; // chance at least one bot replies to a human message
const SECOND_REPLY_CHANCE = 0.15; // chance a second bot chimes in too

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(SCRIPTS_DIR, ".test-users.json");
const ENV_FILE = join(SCRIPTS_DIR, ".env");

// ---------- CLI flags ----------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const CHATTER_INTERVAL_MS = intervalArg
  ? Math.max(1000, parseInt(intervalArg.split("=")[1], 10) || 5000)
  : 5000;
const NO_CHATTER = args.includes("--no-chatter");

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

// ---------- Optional Gemini key ----------

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

// ---------- Bot personalities & canned lines ----------

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

const LINES = {
  alice: [
    "welcome to the chat! 👋",
    "how's everyone's day going?",
    "love the energy in here",
    "anyone up to anything fun this weekend?",
    "this chat is my happy place",
    "good to see everyone!",
    "what did I miss?",
    "hi hi hi 👋",
  ],
  bob: [
    "wow. thrilling.",
    "I give this chat a solid 6/10",
    "fascinating. tell me less.",
    "I was going to say something nice, but I won't",
    "this is why we can't have nice things",
    "noted.",
    "bold strategy, let's see if it pays off",
    "I've seen worse chats. not many, but some",
  ],
  priya: [
    "wait, tell me more about that",
    "ok but why though?",
    "genuine question: pancakes or waffles?",
    "what's everyone having for dinner?",
    "how long have you all been using this?",
    "what's the vibe today?",
    "anyone have weekend plans?",
    "oooh interesting, go on",
  ],
  marco: [
    "lol",
    "omw",
    "same",
    "fr",
    "brb phone dying",
    "haha nice",
    "word",
    "typing with one thumb rn",
  ],
  zoe: [
    "YESSS 🔥🔥",
    "this is AMAZING ✨",
    "obsessed with this chat 😍",
    "LET'S GOOO 🎉",
    "you're all the best 💕",
    "ok but this app tho 🤩",
    "living for this ✨",
    "!!!",
  ],
  kenji: [
    "patience.",
    "the chat flows like a river.",
    "well said.",
    "silence is also a message.",
    "one message at a time.",
    "breathe. type. send.",
    "stillness speaks.",
    "hmm. interesting.",
  ],
  sofia: [
    "ok who left the caps lock on",
    "I've seen better typing from my cat",
    "someone's in a good mood today 👀",
    "bold of you to say that here",
    "I screenshotted that for later",
    "the audacity 😌",
    "interesting take. wrong, but interesting",
    "who invited the chaos? oh right, leo",
  ],
  leo: [
    "I peaked in this chat yesterday",
    "sorry, my keyboard is broken. and my sleep schedule",
    "I have nothing to add, as usual",
    "typing this from my floor",
    "my contributions? none. my vibes? immaculate",
    "I read every message and understand none",
    "day 47 of pretending I know what's going on",
    "brb overthinking my last message",
  ],
};

function randomLine(bot) {
  const lines = LINES[bot.key] || ["hi!"];
  return lines[Math.floor(Math.random() * lines.length)];
}

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
  `\nMode: ${GEMINI_API_KEY ? `AI replies (${GEMINI_MODEL})` : "canned lines (no API key)"}` +
    `\nAmbient chatter: ${NO_CHATTER ? "off" : `every ~${CHATTER_INTERVAL_MS / 1000}s`}` +
    `${DRY_RUN ? "\nDRY RUN — bots won't post" : ""}\n`
);

// ---------- Rate limiting (for human replies) ----------

const replyTimestamps = [];

function rateLimited() {
  const cutoff = Date.now() - 60000;
  while (replyTimestamps.length && replyTimestamps[0] < cutoff) {
    replyTimestamps.shift();
  }
  return replyTimestamps.length >= MAX_REPLIES_PER_MINUTE;
}

// ---------- Gemini (optional) ----------

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

// ---------- Posting ----------

async function postAs(bot, text) {
  const typingRef = doc(bot.db, "typing", bot.uid);
  // Show "<bot> is typing…" in the app first, like a human would.
  await setDoc(typingRef, { name: bot.name, updatedAt: serverTimestamp() }).catch(
    () => {}
  );
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
  try {
    await addDoc(collection(bot.db, "messages"), {
      uid: bot.uid,
      name: bot.name,
      text,
      createdAt: serverTimestamp(),
    });
    console.log(`  🤖 ${bot.name}: ${text}`);
  } catch (err) {
    console.error(`  ✗ ${bot.name} failed to post: ${err.message}`);
  } finally {
    await deleteDoc(typingRef).catch(() => {});
  }
}

async function replyAs(bot, history) {
  if (DRY_RUN) {
    console.log(`  🤖 [dry run] ${bot.name} would reply`);
    return;
  }
  try {
    const text = GEMINI_API_KEY ? await geminiReply(bot, history) : randomLine(bot);
    replyTimestamps.push(Date.now());
    await postAs(bot, text);
  } catch (err) {
    console.error(`  ✗ ${bot.name} failed to reply: ${err.message}`);
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

// ---------- Ambient chatter ----------

if (!NO_CHATTER && !DRY_RUN) {
  const chatter = () => {
    const bot = bots[Math.floor(Math.random() * bots.length)];
    postAs(bot, randomLine(bot)); // fire and forget
    // Jitter the interval (50%–150%) so it doesn't feel like a metronome.
    setTimeout(chatter, CHATTER_INTERVAL_MS * (0.5 + Math.random()));
  };
  setTimeout(chatter, CHATTER_INTERVAL_MS);
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
