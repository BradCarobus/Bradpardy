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
  CLUE_VALUES,
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

  const showErr = (err) => {
    mainEl.innerHTML = `<div class="status-msg" style="color:#ff8a80">Lost connection: ${escapeHtml(err.message)}<br><a href="index.html">Rejoin</a></div>`;
  };

  onSnapshot(
    gameRef,
    (snap) => {
      if (!snap.exists()) {
        game = null;
        mainEl.innerHTML = `<div class="status-msg">The host ended the game. Thanks for playing!</div>`;
        return;
      }
      game = snap.data();
      render();
    },
    showErr
  );

  onSnapshot(
    collection(db, "games", code, "players"),
    (snap) => {
      players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderScores();
    },
    showErr
  );
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
    // between clues: show the live board so players can see what's left
    mainEl.innerHTML = `
      <div class="status-msg" style="font-size:1rem;opacity:.8">Host is picking a clue…</div>
      ${miniBoardHtml()}
    `;
    return;
  }

  const lockedOut = (game.lockedOut || []).includes(playerId);
  const buzz = game.buzz || null;

  // Host revealed the answer: full-screen takeover for everyone, no more
  // buzzing — regardless of who (if anyone) was buzzed in.
  if (game.activeClue.showAnswer) {
    mainEl.innerHTML = `
      <div class="answer-reveal">
        <div class="answer-reveal-label">Answer</div>
        <div class="answer-reveal-text">${escapeHtml(clue.answer)}</div>
      </div>
    `;
    return;
  }

  // While someone is actively answering, the question is hidden from players
  if (buzz) {
    if (buzz.playerId === playerId) {
      mainEl.innerHTML = `<div class="status-msg you-buzzed">YOU BUZZED — ANSWER!</div>`;
    } else {
      mainEl.innerHTML = `<div class="status-msg">🔔 <span style="color:var(--gold)">${escapeHtml(buzz.name)}</span> is answering…</div>`;
    }
    return;
  }

  let imgHtml = "";
  if (clue.img) {
    const data = await fetchImage(game.boardId, clue.img);
    // a newer snapshot may have arrived while the image loaded
    if (!sameClueStillActive(clue) || game.activeClue.showAnswer) return;
    if (data) imgHtml = `<img class="player-clue-img" src="${data}" alt="clue image" />`;
  }

  const questionHtml = `
    <div class="player-clue-text">${escapeHtml(clue.question)}</div>
    ${imgHtml}
  `;

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

function miniBoardHtml() {
  const cats = game.board?.categories || [];
  const used = new Set(game.used || []);
  let html = `<div class="jeopardy-board static mini" style="grid-template-columns:repeat(${cats.length},1fr);">`;
  cats.forEach((c) => (html += `<div class="jb-cell jb-cat">${escapeHtml(c.name)}</div>`));
  for (let row = 0; row < CLUE_VALUES.length; row++) {
    cats.forEach((c, ci) => {
      const isUsed = used.has(`${ci}-${row}`);
      html += `<div class="jb-cell jb-clue ${isUsed ? "used" : ""}">$${CLUE_VALUES[row]}</div>`;
    });
  }
  return html + `</div>`;
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
      if (!g || !g.activeClue || g.buzz || g.activeClue.showAnswer) throw new Error("too-late");
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
