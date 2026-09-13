// ============================================================
// PingChat — a tiny real-time chat app backed by Firebase
// ============================================================
//
// SETUP: paste your Firebase web app config below.
// Firebase Console → Project settings → Your apps → Web app → SDK setup.
// See README.md for full instructions.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBnebqg30St8qBF31UEyhHnzdNn7qT6uT4",
  authDomain: "pingchat-c5cd7.firebaseapp.com",
  projectId: "pingchat-c5cd7",
  storageBucket: "pingchat-c5cd7.firebasestorage.app",
  messagingSenderId: "573832592883",
  appId: "1:573832592883:web:381a5b34aaecae13802686",
};

// ---------- DOM refs ----------

const configWarning = document.getElementById("config-warning");
const nameScreen = document.getElementById("name-screen");
const nameForm = document.getElementById("name-form");
const nameInput = document.getElementById("name-input");
const chatScreen = document.getElementById("chat-screen");
const myNameEl = document.getElementById("my-name");
const changeNameBtn = document.getElementById("change-name");
const errorBanner = document.getElementById("error-banner");
const messagesEl = document.getElementById("messages");
const typingIndicator = document.getElementById("typing-indicator");
const composer = document.getElementById("composer");
const messageInput = document.getElementById("message-input");

// ---------- Config check ----------

const configIsPlaceholder = Object.values(firebaseConfig).some(
  (v) => typeof v === "string" && v.startsWith("PASTE_")
);

if (configIsPlaceholder) {
  configWarning.hidden = false;
} else {
  boot();
}

// ---------- App ----------

function boot() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const messagesRef = collection(db, "messages");

  // A stable per-browser id so we can tell "my" messages from others.
  let uid = localStorage.getItem("pingchat-uid");
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem("pingchat-uid", uid);
  }

  // One doc per user in the "typing" collection; presence = currently typing.
  const typingDocRef = doc(db, "typing", uid);

  let displayName = localStorage.getItem("pingchat-name") || "";

  // Show the name screen unless we already know who this is.
  if (displayName) {
    enterChat();
  } else {
    nameScreen.hidden = false;
    nameInput.focus();
  }

  nameForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    displayName = name;
    localStorage.setItem("pingchat-name", displayName);
    nameScreen.hidden = true;
    enterChat();
  });

  changeNameBtn.addEventListener("click", () => {
    localStorage.removeItem("pingchat-name");
    location.reload();
  });

  function enterChat() {
    chatScreen.hidden = false;
    myNameEl.textContent = displayName;
    messageInput.focus();
  }

  // ---------- Sending ----------

  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = "";
    messageInput.focus();

    try {
      await addDoc(messagesRef, {
        uid,
        name: displayName,
        text,
        createdAt: serverTimestamp(),
      });
      deleteDoc(typingDocRef).catch(() => {});
    } catch (err) {
      showError(
        "Message failed to send: " +
          err.message +
          " (check your Firestore security rules — see README.md)"
      );
    }
  });

  // ---------- Typing indicator ----------

  let lastTypingWrite = 0;

  messageInput.addEventListener("input", () => {
    const hasText = messageInput.value.trim().length > 0;
    const now = Date.now();
    if (hasText) {
      // Throttle writes to once every 2 seconds while typing.
      if (now - lastTypingWrite > 2000) {
        lastTypingWrite = now;
        setDoc(typingDocRef, {
          name: displayName,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    } else {
      deleteDoc(typingDocRef).catch(() => {});
    }
  });

  // Best-effort cleanup when leaving the page; staleness check below
  // covers the cases where this doesn't get to run.
  window.addEventListener("pagehide", () => {
    deleteDoc(typingDocRef).catch(() => {});
  });

  // ---------- Receiving (real-time) ----------

  const q = query(messagesRef, orderBy("createdAt", "asc"), limit(500));

  onSnapshot(
    q,
    (snapshot) => {
      hideError();
      renderMessages(snapshot.docs.map((doc) => doc.data()));
    },
    (err) => {
      showError(
        "Couldn't load messages: " +
          err.message +
          " (check your Firestore security rules — see README.md)"
      );
    }
  );

  // Typing status from other users.
  let typers = [];

  onSnapshot(collection(db, "typing"), (snapshot) => {
    typers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTyping();
  });

  // Re-check periodically so stale typing entries expire on their own.
  setInterval(renderTyping, 2000);

  function renderTyping() {
    const now = Date.now();
    const names = typers
      .filter((t) => t.id !== uid)
      // serverTimestamp() is null until the server acks it — treat as fresh.
      .filter((t) => !t.updatedAt || now - t.updatedAt.toMillis() < 4000)
      .map((t) => t.name || "Someone");

    if (names.length === 0) {
      typingIndicator.hidden = true;
      return;
    }

    let text;
    if (names.length === 1) {
      text = `${names[0]} is typing`;
    } else if (names.length === 2) {
      text = `${names[0]} and ${names[1]} are typing`;
    } else {
      text = `${names.length} people are typing`;
    }

    typingIndicator.innerHTML = "";
    typingIndicator.appendChild(document.createTextNode(text + " "));
    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.innerHTML = "<span>.</span><span>.</span><span>.</span>";
    typingIndicator.appendChild(dots);
    typingIndicator.hidden = false;
  }

  function renderMessages(messages) {
    // Stick to the bottom only if the user is already near it.
    const nearBottom =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <
      120;

    messagesEl.innerHTML = "";

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No messages yet.\nSay hi! 👋";
      messagesEl.appendChild(empty);
      return;
    }

    for (const msg of messages) {
      const mine = msg.uid === uid;

      const wrapper = document.createElement("div");
      wrapper.className = "msg " + (mine ? "mine" : "theirs");

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = mine
        ? formatTime(msg.createdAt)
        : `${msg.name || "Anonymous"} · ${formatTime(msg.createdAt)}`;

      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = msg.text; // textContent = safe from HTML injection

      wrapper.appendChild(meta);
      wrapper.appendChild(bubble);
      messagesEl.appendChild(wrapper);
    }

    if (nearBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function formatTime(ts) {
    if (!ts) return "sending…";
    const date = ts.toDate();
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    if (sameDay) return time;
    return (
      date.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      time
    );
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.hidden = false;
  }

  function hideError() {
    errorBanner.hidden = true;
  }
}
