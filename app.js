// ============================================================
// PingChat — real-time chat backed by Firebase
// Auth: passwordless email link (Firebase Authentication)
// Data: Cloud Firestore (messages + typing indicators)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  updateProfile,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
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

const authScreen = document.getElementById("auth-screen");
const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email-input");
const authSubmit = document.getElementById("auth-submit");
const authStatus = document.getElementById("auth-status");
const authError = document.getElementById("auth-error");
const nameScreen = document.getElementById("name-screen");
const nameForm = document.getElementById("name-form");
const nameInput = document.getElementById("name-input");
const chatScreen = document.getElementById("chat-screen");
const myNameEl = document.getElementById("my-name");
const changeNameBtn = document.getElementById("change-name");
const signOutBtn = document.getElementById("sign-out");
const errorBanner = document.getElementById("error-banner");
const messagesEl = document.getElementById("messages");
const typingIndicator = document.getElementById("typing-indicator");
const composer = document.getElementById("composer");
const messageInput = document.getElementById("message-input");

// ---------- Firebase ----------

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let chatStarted = false;

// ---------- Sign-in with email link ----------

// If this page load came from the user clicking the link in their email,
// complete the sign-in.
if (isSignInWithEmailLink(auth, window.location.href)) {
  const email =
    localStorage.getItem("pingchat-email") ||
    window.prompt("Confirm your email to finish signing in:") ||
    "";
  signInWithEmailLink(auth, email, window.location.href)
    .then(() => {
      localStorage.removeItem("pingchat-email");
      // Strip the sign-in params from the URL.
      window.history.replaceState(null, "", window.location.pathname);
    })
    .catch((err) => {
      showAuthScreen();
      showAuthError(friendlyAuthError(err) + " Request a new link below.");
    });
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    if (user.displayName) {
      enterChat();
    } else {
      showNameScreen();
    }
  } else {
    showAuthScreen();
  }
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  if (!email) return;

  authSubmit.disabled = true;
  hideAuthError();
  try {
    await sendSignInLinkToEmail(auth, email, {
      // The link in the email brings the user back to this same page.
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    });
    // Remember the email so sign-in can complete when they return.
    localStorage.setItem("pingchat-email", email);
    authStatus.textContent =
      "✉️ Check your inbox! We sent a sign-in link to " +
      email +
      " (check spam too).";
    authStatus.hidden = false;
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  } finally {
    authSubmit.disabled = false;
  }
});

nameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name || !currentUser) return;
  try {
    // Stored on the auth profile, so the name follows the user across devices.
    await updateProfile(currentUser, { displayName: name });
    enterChat();
  } catch (err) {
    showError("Couldn't save your name: " + err.message);
  }
});

changeNameBtn.addEventListener("click", async () => {
  if (!currentUser) return;
  const name = window.prompt("New display name:", currentUser.displayName || "");
  if (!name || !name.trim()) return;
  await updateProfile(currentUser, { displayName: name.trim() });
  myNameEl.textContent = name.trim();
});

signOutBtn.addEventListener("click", () => signOut(auth));

// ---------- Screen switching ----------

function showAuthScreen() {
  authScreen.hidden = false;
  nameScreen.hidden = true;
  chatScreen.hidden = true;
  emailInput.focus();
}

function showNameScreen() {
  authScreen.hidden = true;
  nameScreen.hidden = false;
  chatScreen.hidden = true;
  nameInput.focus();
}

function enterChat() {
  authScreen.hidden = true;
  nameScreen.hidden = true;
  chatScreen.hidden = false;
  myNameEl.textContent = currentUser.displayName;
  if (!chatStarted) {
    chatStarted = true;
    startChat();
  }
  messageInput.focus();
}

// ---------- Chat (starts once signed in) ----------

function startChat() {
  const messagesRef = collection(db, "messages");
  // One doc per user in the "typing" collection; presence = currently typing.
  const typingDocRef = doc(db, "typing", currentUser.uid);

  // ----- Sending -----

  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = "";
    messageInput.focus();

    try {
      await addDoc(messagesRef, {
        uid: currentUser.uid,
        name: currentUser.displayName,
        text,
        createdAt: serverTimestamp(),
      });
      deleteDoc(typingDocRef).catch(() => {});
    } catch (err) {
      showError("Message failed to send: " + err.message);
    }
  });

  // ----- Typing indicator -----

  let lastTypingWrite = 0;

  messageInput.addEventListener("input", () => {
    const hasText = messageInput.value.trim().length > 0;
    const now = Date.now();
    if (hasText) {
      // Throttle writes to once every 2 seconds while typing.
      if (now - lastTypingWrite > 2000) {
        lastTypingWrite = now;
        setDoc(typingDocRef, {
          name: currentUser.displayName,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    } else {
      deleteDoc(typingDocRef).catch(() => {});
    }
  });

  // Best-effort cleanup when leaving the page; the staleness check below
  // covers the cases where this doesn't get to run.
  window.addEventListener("pagehide", () => {
    deleteDoc(typingDocRef).catch(() => {});
  });

  // ----- Receiving messages (real-time) -----

  const q = query(messagesRef, orderBy("createdAt", "asc"), limit(500));

  onSnapshot(
    q,
    (snapshot) => {
      hideError();
      renderMessages(snapshot.docs.map((d) => d.data()));
    },
    (err) => {
      showError("Couldn't load messages: " + err.message);
    }
  );

  // ----- Typing status from other users -----

  let typers = [];

  onSnapshot(
    collection(db, "typing"),
    (snapshot) => {
      typers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTyping();
    },
    () => {} // Typing indicators are non-critical; ignore read errors.
  );

  // Re-check periodically so stale typing entries expire on their own.
  setInterval(renderTyping, 2000);

  function renderTyping() {
    const now = Date.now();
    const names = typers
      .filter((t) => t.id !== currentUser.uid)
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
      const mine = msg.uid === currentUser.uid;

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
}

// ---------- Helpers ----------

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
    date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time
  );
}

function friendlyAuthError(err) {
  switch (err.code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/operation-not-allowed":
      return "Email-link sign-in isn't enabled yet — turn it on in Firebase Console → Authentication → Sign-in method.";
    case "auth/unauthorized-continue-uri":
      return "This site's domain isn't authorized yet — add it in Firebase Console → Authentication → Settings → Authorized domains.";
    case "auth/invalid-action-code":
      return "That sign-in link is expired or was already used.";
    case "auth/quota-exceeded":
      return "Too many sign-in emails sent today — try again tomorrow.";
    default:
      return err.message;
  }
}

function showAuthError(msg) {
  authError.textContent = msg;
  authError.hidden = false;
}

function hideAuthError() {
  authError.hidden = true;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
}

function hideError() {
  errorBanner.hidden = true;
}
