// Viewer role: a read-only big screen for a TV. Shows the board while the
// host is picking, the full-screen question while it's being read, and hides
// the question while someone is actively answering. Not needed to play —
// purely for making the game feel like the real show.
import {
  db,
  doc,
  getDoc,
  onSnapshot,
  collection,
  CLUE_VALUES,
  fetchImage,
  escapeHtml,
} from "./db.js";

const mainEl = document.getElementById("viewer-main");
const scoresEl = document.getElementById("viewer-scores");
const bannerEl = document.getElementById("viewer-banner");

const params = new URLSearchParams(location.search);
const code = (params.get("code") || "").toUpperCase();

let game = null;
let players = [];
let lastShownResultAt = 0;
let bannerTimer = null;

if (!code) {
  renderJoinForm();
} else {
  start();
}

function renderJoinForm(err = "") {
  mainEl.innerHTML = `
    <div class="center-page" style="min-height:auto;">
      <div>
        <h1 class="title">Bradpardy!</h1>
        <p class="subtitle">📺 TV viewer screen</p>
      </div>
      <form class="card" id="viewer-join-form">
        <input id="viewer-code" class="code-input" maxlength="4" placeholder="CODE" autocomplete="off" required />
        <button type="submit">Show the board</button>
        <div class="error">${escapeHtml(err)}</div>
      </form>
    </div>
  `;
  document.getElementById("viewer-join-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = document.getElementById("viewer-code").value.trim().toUpperCase();
    const snap = await getDoc(doc(db, "games", c)).catch(() => null);
    if (!snap || !snap.exists()) {
      renderJoinForm("No game found with that code.");
      return;
    }
    location.href = `viewer.html?code=${c}`;
  });
}

async function start() {
  const gameRef = doc(db, "games", code);
  const snap = await getDoc(gameRef);
  if (!snap.exists()) {
    renderJoinForm("No game found with that code.");
    return;
  }

  const showErr = (err) => {
    mainEl.innerHTML = `<div class="status-msg" style="text-align:center;color:#ff8a80">Lost connection: ${escapeHtml(err.message)}</div>`;
  };

  onSnapshot(
    gameRef,
    (s) => {
      if (!s.exists()) {
        game = null;
        mainEl.innerHTML = `<div class="status-msg" style="text-align:center;">The host ended the game.</div>`;
        return;
      }
      game = s.data();
      render();
    },
    showErr
  );
  onSnapshot(
    collection(db, "games", code, "players"),
    (s) => {
      players = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderScores();
      render();
    },
    showErr
  );
}

function formatMoney(n) {
  return n < 0 ? `-$${Math.abs(n)}` : `$${n}`;
}

function renderScores() {
  if (!game || game.status === "lobby") {
    scoresEl.innerHTML = "";
    return;
  }
  const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  scoresEl.innerHTML = sorted
    .map(
      (p) =>
        `<span class="p">${escapeHtml(p.name)} <span class="s">${formatMoney(p.score ?? 0)}</span></span>`
    )
    .join("");
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

function boardHtml() {
  const cats = game.board?.categories || [];
  const used = new Set(game.used || []);
  let html = `<div class="jeopardy-board static viewer-board" style="grid-template-columns:repeat(${cats.length},1fr);">`;
  cats.forEach((c) => (html += `<div class="jb-cell jb-cat">${escapeHtml(c.name)}</div>`));
  for (let row = 0; row < CLUE_VALUES.length; row++) {
    cats.forEach((c, ci) => {
      const isUsed = used.has(`${ci}-${row}`);
      html += `<div class="jb-cell jb-clue ${isUsed ? "used" : ""}">$${CLUE_VALUES[row]}</div>`;
    });
  }
  return html + `</div>`;
}

async function render() {
  if (!game) return;
  showResultBanner();

  if (game.status === "lobby") {
    mainEl.innerHTML = `
      <div class="join-code-display">
        <h1 class="title">Bradpardy!</h1>
        <div style="opacity:.7;text-transform:uppercase;letter-spacing:.2em;margin-top:1.5rem;">Join code</div>
        <div class="code">${escapeHtml(code)}</div>
      </div>
      <div class="player-lobby-list">
        ${players.length ? players.map((p) => `<span class="p">${escapeHtml(p.name)}</span>`).join("") : "<em>Waiting for players…</em>"}
      </div>
    `;
    return;
  }

  if (game.status === "ended") {
    const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = sorted[0];
    mainEl.innerHTML = `
      <div class="viewer-center">
        <div class="viewer-question">🏆 Game over!</div>
        ${winner ? `<div class="viewer-answering">${escapeHtml(winner.name)} wins with ${formatMoney(winner.score ?? 0)}!</div>` : ""}
      </div>
    `;
    return;
  }

  const ac = game.activeClue;
  const clue = ac ? game.board?.categories?.[ac.catIndex]?.clues?.[ac.clueIndex] : null;

  if (!clue) {
    mainEl.innerHTML = boardHtml();
    return;
  }

  // someone is actively answering: hide the question
  if (game.buzz) {
    mainEl.innerHTML = `
      <div class="viewer-center">
        <div class="viewer-answering">🔔 ${escapeHtml(game.buzz.name)} is answering…</div>
      </div>
    `;
    return;
  }

  const catName = game.board.categories[ac.catIndex].name;
  let imgHtml = "";
  if (clue.img) {
    const data = await fetchImage(game.boardId, clue.img);
    const nowAc = game.activeClue;
    if (!nowAc || nowAc.catIndex !== ac.catIndex || nowAc.clueIndex !== ac.clueIndex || game.buzz) return;
    if (data) imgHtml = `<img class="viewer-clue-img" src="${data}" alt="clue image" />`;
  }

  mainEl.innerHTML = `
    <div class="viewer-center">
      <div class="viewer-cat">${escapeHtml(catName)} — $${clue.value}</div>
      <div class="viewer-question">${escapeHtml(clue.question)}</div>
      ${imgHtml}
      ${
        ac.showAnswer
          ? `<div class="viewer-answer">${escapeHtml(clue.answer)}</div>`
          : ""
      }
    </div>
  `;
}
