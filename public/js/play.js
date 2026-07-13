import {
  db,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  collection,
  runTransaction,
  serverTimestamp,
  fetchImage,
  escapeHtml,
  randomId,
} from "./db.js";

const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").toUpperCase();
const myName = localStorage.getItem("bp_name") || "";

if (!code || !myName) {
  location.href = "index.html";
}

// Stable per-game player id so a refresh doesn't create a duplicate player
const playerKey = `bp_player_${code}`;
let playerId = localStorage.getItem(playerKey);
if (!playerId) {
  playerId = randomId();
  localStorage.setItem(playerKey, playerId);
}

const gameRef = doc(db, "games", code);
const playerRef = doc(db, "games", code, "players", playerId);

const mainEl = document.getElementById("player-main");
const nameEl = document.getElementById("me-name");
const scoreEl = document.getElementById("me-score");
const codeEl = document.getElementById("game-code-label");
const bannerEl = document.getElementById("result-banner");
const miniScoresEl = document.getElementById("mini-scores");

nameEl.textContent = myName;
codeEl.textContent = code;

let game = null;
let players = [];
let lastShownResultAt = 0;
let bannerTimer = null;

init();

async function init() {
  const gameSnap = await getDoc(gameRef);
  if (!gameSnap.exists()) {
    mainEl.innerHTML = `<div class="status-msg">Game not found. <a href="index.html">Go back</a></div>`;
    return;
  }

  // Register (or re-register after refresh) without wiping an existing score
  const existing = await getDoc(playerRef);
  if (!existing.exists()) {
    await setDoc(playerRef, { name: myName, score: 0, joinedAt: serverTimestamp() });
  } else if (existing.data().name !== myName) {
    await setDoc(playerRef, { name: myName }, { merge: true });
  }

  onSnapshot(gameRef, (snap) => {
    if (!snap.exists()) {
      game = null;
      mainEl.innerHTML = `<div class="status-msg">The host ended the game. Thanks for playing!</div>`;
      return;
    }
    game = snap.data();
    render();
  });

  onSnapshot(collection(db, "games", code, "players"), (snap) => {
    players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderScores();
  });
}

function renderScores() {
  const me = players.find((p) => p.id === playerId);
  const score = me?.score ?? 0;
  scoreEl.textContent = formatMoney(score);
  scoreEl.classList.toggle("negative", score < 0);

  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  miniScoresEl.innerHTML = sorted
    .map(
      (p) =>
        `<span class="p">${escapeHtml(p.name)} <span class="s">${formatMoney(p.score ?? 0)}</span></span>`
    )
    .join("");
}

function formatMoney(n) {
  return n < 0 ? `-$${Math.abs(n)}` : `$${n}`;
}

function showResultBanner() {
  const r = game.lastResult;
  if (!r || r.at === lastShownResultAt) return;
  lastShownResultAt = r.at;
  bannerEl.className = `result-banner ${r.correct ? "correct" : "wrong"}`;
  bannerEl.textContent = r.correct
    ? `✔ ${r.name} got it right! +$${r.value}`
    : `✘ ${r.name} got it wrong. -$${r.value}`;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.add("hidden"), 4000);
}

async function render() {
  if (!game) return;
  showResultBanner();

  if (game.status === "ended") {
    const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = sorted[0];
    mainEl.innerHTML = `
      <div class="status-msg">🏆 Game over!</div>
      ${winner ? `<div class="status-msg you-buzzed">${escapeHtml(winner.name)} wins with ${formatMoney(winner.score ?? 0)}!</div>` : ""}
    `;
    return;
  }

  if (game.status === "lobby") {
    mainEl.innerHTML = `
      <div class="status-msg">You're in! 🎉</div>
      <div style="opacity:.7">Waiting for the host to start the game…</div>
    `;
    return;
  }

  const clue = getActiveClue();
  if (!clue) {
    mainEl.innerHTML = `
      <div class="status-msg">Look at the board!</div>
      <div style="opacity:.7">Waiting for the host to pick a clue…</div>
    `;
    return;
  }

  const lockedOut = (game.lockedOut || []).includes(playerId);
  const buzz = game.buzz || null;

  let imgHtml = "";
  if (clue.img) {
    const data = await fetchImage(game.boardId, clue.img);
    // a newer snapshot may have arrived while the image loaded
    if (!sameClueStillActive(clue)) return;
    if (data) imgHtml = `<img class="player-clue-img" src="${data}" alt="clue image" />`;
  }

  const questionHtml = `
    <div class="player-clue-text">${escapeHtml(clue.question)}</div>
    ${imgHtml}
    ${
      game.activeClue.showAnswer
        ? `<div class="clue-answer" style="background:rgba(0,0,0,.35);border-radius:8px;padding:.6rem 1rem;">
             <span style="opacity:.7;font-size:.8rem;text-transform:uppercase;">Answer:</span>
             <strong style="color:var(--gold);"> ${escapeHtml(clue.answer)}</strong>
           </div>`
        : ""
    }
  `;

  if (buzz) {
    if (buzz.playerId === playerId) {
      mainEl.innerHTML = `
        ${questionHtml}
        <div class="status-msg you-buzzed">YOU BUZZED — ANSWER!</div>
      `;
    } else {
      mainEl.innerHTML = `
        ${questionHtml}
        <div class="status-msg"><span class="buzzer-name" style="color:var(--gold)">${escapeHtml(buzz.name)}</span> buzzed in…</div>
      `;
    }
    return;
  }

  if (lockedOut) {
    mainEl.innerHTML = `
      ${questionHtml}
      <div class="status-msg" style="opacity:.7">🔒 You're locked out of this clue</div>
    `;
    return;
  }

  mainEl.innerHTML = `
    ${questionHtml}
    <button class="big-buzzer" id="buzz-btn">BUZZ</button>
  `;
  document.getElementById("buzz-btn").addEventListener("click", buzzIn);
}

function getActiveClue() {
  const ac = game.activeClue;
  if (!ac || !game.board) return null;
  return game.board.categories?.[ac.catIndex]?.clues?.[ac.clueIndex] || null;
}

function sameClueStillActive(clue) {
  return getActiveClue() === clue || JSON.stringify(getActiveClue()) === JSON.stringify(clue);
}

async function buzzIn() {
  const btn = document.getElementById("buzz-btn");
  if (btn) btn.disabled = true;
  try {
    // Transaction guarantees only the FIRST buzz wins, even in a tie
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(gameRef);
      const g = snap.data();
      if (!g || !g.activeClue || g.buzz) throw new Error("too-late");
      if ((g.lockedOut || []).includes(playerId)) throw new Error("locked-out");
      tx.update(gameRef, {
        buzz: { playerId, name: myName, at: Date.now() },
      });
    });
    if (navigator.vibrate) navigator.vibrate(80);
  } catch (err) {
    // someone beat us to it — the snapshot listener will re-render
  }
}
