// Firebase SDK is vendored locally (see public/vendor/) so the app works
// even without access to the gstatic CDN.
import { initializeApp } from "../vendor/firebase-app.js";
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
} from "../vendor/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// For local development/testing: run `firebase emulators:start --only firestore`
// and set localStorage.bp_emulator = "1" in the browser console.
const useEmulator = localStorage.getItem("bp_emulator") === "1";

if (firebaseConfig.apiKey === "PASTE_YOUR_API_KEY" && !useEmulator) {
  alert(
    "Firebase isn't configured yet!\n\nOpen public/js/firebase-config.js and paste in your Firebase project's config. See the README for step-by-step instructions."
  );
}

const app = initializeApp(
  useEmulator ? { ...firebaseConfig, projectId: "demo-bradpardy" } : firebaseConfig
);
export const db = getFirestore(app);
if (useEmulator) {
  connectFirestoreEmulator(db, location.hostname, 8089);
}

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  query,
  orderBy,
};

// ---- shared helpers ----

export const CLUE_VALUES = [200, 400, 600, 800, 1000];

export function makeJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O (look like 1 / 0)
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Image docs live in boards/{boardId}/images/{imgId} so one big board of
// photo clues never overflows Firestore's 1 MB per-document limit.
const imageCache = new Map();

export async function fetchImage(boardId, imgId) {
  const key = `${boardId}/${imgId}`;
  if (imageCache.has(key)) return imageCache.get(key);
  const snap = await getDoc(doc(db, "boards", boardId, "images", imgId));
  const data = snap.exists() ? snap.data().data : null;
  imageCache.set(key, data);
  return data;
}

// Downscale + compress an uploaded photo so it fits comfortably in its
// own Firestore doc.
export function compressImage(file, maxDim = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't an image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        let q = quality;
        let dataUrl = canvas.toDataURL("image/jpeg", q);
        // keep well under the 1 MB doc limit
        while (dataUrl.length > 700_000 && q > 0.3) {
          q -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", q);
        }
        if (dataUrl.length > 900_000) {
          reject(new Error("Image is too large even after compression"));
        } else {
          resolve(dataUrl);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
