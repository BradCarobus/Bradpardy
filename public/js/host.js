import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  CLUE_VALUES,
  makeJoinCode,
  randomId,
  compressImage,
  fetchImage,
  escapeHtml,
} from "./db.js";

const main = document.getElementById("main");
const topbarGame = document.getElementById("topbar-game");

// ---------------------------------------------------------------
// simple view router: boards | editor | game
// ---------------------------------------------------------------

let unsubBoards = null;
let unsubGame = null;
let unsubPlayers = null;

function cleanupListeners() {
  unsubBoards?.();
  unsubGame?.();
  unsubPlayers?.();
  unsubBoards = unsubGame = unsubPlayers = null;
}

// Resume a game if the host refreshed mid-game
const resumeCode = sessionStorage.getItem("bp_host_game");
if (resumeCode) {
  getDoc(doc(db, "games", resumeCode)).then((snap) => {
    if (snap.exists() && snap.data().status !== "ended") {
      showGame(resumeCode);
    } else {
      sessionStorage.removeItem("bp_host_game");
      showBoards();
    }
  });
} else {
  showBoards();
}

// ===============================================================
// BOARD LIST
// ===============================================================

function showBoards() {
  cleanupListeners();
  topbarGame.classList.add("hidden");
  main.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
      <h2>Your Jeopardy Boards</h2>
      <button id="new-board-btn">+ New Board</button>
    </div>
    <p style="opacity:.7;margin-top:.4rem;">Everyone's saved boards live here — pick one to host, or make your own.</p>
    <div class="board-list" id="board-list"><em>Loading boards…</em></div>
  `;
  document.getElementById("new-board-btn").addEventListener("click", () => showEditor(null));

  unsubBoards = onSnapshot(query(collection(db, "boards"), orderBy("createdAt", "desc")), (snap) => {
    const listEl = document.getElementById("board-list");
    if (!listEl) return;
    if (snap.empty) {
      listEl.innerHTML = `<em>No boards yet. Make the first one!</em>`;
      return;
    }
    listEl.innerHTML = "";
    snap.docs.forEach((d) => {
      const b = d.data();
      const tile = document.createElement("div");
      tile.className = "board-tile";
      tile.innerHTML = `
        <h3>${escapeHtml(b.name)}</h3>
        <div class="meta">${(b.categories || []).length} categories · ${(b.categories || []).map((c) => escapeHtml(c.name)).join(", ")}</div>
        <div class="actions">
          <button class="success" data-act="host">Host this board</button>
          <button class="secondary" data-act="edit">Edit</button>
          <button class="danger small" data-act="delete">Delete</button>
        </div>
      `;
      tile.querySelector('[data-act="host"]').addEventListener("click", () => startGame(d.id));
      tile.querySelector('[data-act="edit"]').addEventListener("click", () => showEditor(d.id));
      tile.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`Delete board "${b.name}"? This can't be undone.`)) return;
        const imgs = await getDocs(collection(db, "boards", d.id, "images"));
        await Promise.all(imgs.docs.map((i) => deleteDoc(i.ref)));
        await deleteDoc(d.ref);
      });
      listEl.appendChild(tile);
    });
  });
}

// ===============================================================
// BOARD EDITOR
// ===============================================================

function blankCategory() {
  return {
    name: "",
    clues: CLUE_VALUES.map((v) => ({ value: v, question: "", answer: "", img: null })),
  };
}

async function showEditor(boardId) {
  cleanupListeners();
  topbarGame.classList.add("hidden");

  let board = { name: "", categories: [blankCategory(), blankCategory(), blankCategory()] };
  const removedImgIds = [];
  // clue.img       = id of an image doc already saved in Firestore
  // clue._newImg   = freshly uploaded data URL not saved yet
  if (boardId) {
    const snap = await getDoc(doc(db, "boards", boardId));
    if (snap.exists()) board = structuredClone(snap.data());
  }

  main.innerHTML = `
    <button class="secondary small" id="back-btn">← All boards</button>
    <h2 style="margin-top:.8rem;">${boardId ? "Edit board" : "New board"}</h2>
    <div class="card" style="max-width:520px;margin-top:.8rem;">
      <label>Board name</label>
      <input id="board-name" maxlength="60" placeholder="e.g. Friday Game Night" />
    </div>
    <div class="editor-categories" id="cats"></div>
    <div class="editor-toolbar">
      <button class="secondary" id="add-cat-btn">+ Add category</button>
      <button id="save-btn">💾 Save board</button>
      <span class="error" id="editor-error"></span>
    </div>
  `;

  const nameInput = document.getElementById("board-name");
  nameInput.value = board.name || "";
  document.getElementById("back-btn").addEventListener("click", () => {
    if (confirm("Leave the editor? Unsaved changes will be lost.")) showBoards();
  });
  document.getElementById("add-cat-btn").addEventListener("click", () => {
    board.categories.push(blankCategory());
    renderCats();
  });
  document.getElementById("save-btn").addEventListener("click", saveBoard);

  renderCats();

  function renderCats() {
    const catsEl = document.getElementById("cats");
    catsEl.innerHTML = "";
    board.categories.forEach((cat, ci) => {
      const card = document.createElement("div");
      card.className = "category-card";
      card.innerHTML = `
        <div class="cat-head">
          <input data-f="catname" maxlength="40" placeholder="Category ${ci + 1} name (e.g. 90s Movies)" value="${escapeHtml(cat.name)}" />
          <button class="danger small" data-f="delcat" ${board.categories.length <= 1 ? "disabled" : ""}>✕</button>
        </div>
      `;
      card.querySelector('[data-f="catname"]').addEventListener("input", (e) => {
        cat.name = e.target.value;
      });
      card.querySelector('[data-f="delcat"]').addEventListener("click", () => {
        if (!confirm(`Remove category "${cat.name || ci + 1}"?`)) return;
        cat.clues.forEach((cl) => cl.img && removedImgIds.push(cl.img));
        board.categories.splice(ci, 1);
        renderCats();
      });

      cat.clues.forEach((clue) => {
        const row = document.createElement("div");
        row.className = "clue-row";
        row.innerHTML = `
          <div class="value">$${clue.value}</div>
          <textarea data-f="q" placeholder="Question / clue text (optional if using a photo)">${escapeHtml(clue.question)}</textarea>
          <textarea data-f="a" placeholder="Correct answer (only the host sees this)">${escapeHtml(clue.answer)}</textarea>
          <div class="clue-img-cell">
            <img data-f="preview" class="${clue.img || clue._newImg ? "" : "hidden"}" />
            <label>photo (optional)</label>
            <input data-f="file" type="file" accept="image/*" style="font-size:.7rem;padding:.2rem;" />
            <button class="danger small ${clue.img || clue._newImg ? "" : "hidden"}" data-f="rmimg">remove photo</button>
          </div>
        `;
        const preview = row.querySelector('[data-f="preview"]');
        const rmBtn = row.querySelector('[data-f="rmimg"]');

        if (clue._newImg) preview.src = clue._newImg;
        else if (clue.img && boardId) {
          fetchImage(boardId, clue.img).then((d) => d && (preview.src = d));
        }

        row.querySelector('[data-f="q"]').addEventListener("input", (e) => (clue.question = e.target.value));
        row.querySelector('[data-f="a"]').addEventListener("input", (e) => (clue.answer = e.target.value));
        row.querySelector('[data-f="file"]').addEventListener("change", async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            const dataUrl = await compressImage(file);
            if (clue.img) removedImgIds.push(clue.img);
            clue.img = null;
            clue._newImg = dataUrl;
            preview.src = dataUrl;
            preview.classList.remove("hidden");
            rmBtn.classList.remove("hidden");
          } catch (err) {
            alert(err.message);
          }
        });
        rmBtn.addEventListener("click", () => {
          if (clue.img) removedImgIds.push(clue.img);
          clue.img = null;
          clue._newImg = null;
          preview.classList.add("hidden");
          rmBtn.classList.add("hidden");
          row.querySelector('[data-f="file"]').value = "";
        });

        card.appendChild(row);
      });

      catsEl.appendChild(card);
    });
  }

  async function saveBoard() {
    const errEl = document.getElementById("editor-error");
    errEl.textContent = "";
    board.name = nameInput.value.trim();

    if (!board.name) return (errEl.textContent = "Give the board a name.");
    for (const [ci, cat] of board.categories.entries()) {
      if (!cat.name.trim()) return (errEl.textContent = `Category ${ci + 1} needs a topic name.`);
      for (const clue of cat.clues) {
        if (!clue.question.trim() && !clue.img && !clue._newImg)
          return (errEl.textContent = `"${cat.name}" $${clue.value} needs question text or a photo.`);
        if (!clue.answer.trim())
          return (errEl.textContent = `"${cat.name}" $${clue.value} needs an answer.`);
      }
    }

    const saveBtn = document.getElementById("save-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const id = boardId || randomId();
      const ref = doc(db, "boards", id);

      // upload new images as their own docs (keeps the board doc small)
      for (const cat of board.categories) {
        for (const clue of cat.clues) {
          if (clue._newImg) {
            const imgId = randomId();
            await setDoc(doc(db, "boards", id, "images", imgId), { data: clue._newImg });
            clue.img = imgId;
            delete clue._newImg;
          }
        }
      }
      for (const imgId of removedImgIds) {
        await deleteDoc(doc(db, "boards", id, "images", imgId)).catch(() => {});
      }
      removedImgIds.length = 0;

      const clean = {
        name: board.name,
        categories: board.categories.map((c) => ({
          name: c.name.trim(),
          clues: c.clues.map((cl) => ({
            value: cl.value,
            question: cl.question.trim(),
            answer: cl.answer.trim(),
            img: cl.img || null,
          })),
        })),
        updatedAt: serverTimestamp(),
        ...(boardId ? {} : { createdAt: serverTimestamp() }),
      };
      if (boardId) {
        await updateDoc(ref, clean);
      } else {
        await setDoc(ref, clean);
      }
      showBoards();
    } catch (err) {
      console.error(err);
      errEl.textContent = "Save failed: " + err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 Save board";
    }
  }
}

// ===============================================================
// GAME
// ===============================================================

async function startGame(boardId) {
  const snap = await getDoc(doc(db, "boards", boardId));
  if (!snap.exists()) return alert("Board not found");
  const board = snap.data();

  // find an unused join code
  let code;
  for (let i = 0; i < 10; i++) {
    code = makeJoinCode();
    const existing = await getDoc(doc(db, "games", code));
    if (!existing.exists() || existing.data().status === "ended") break;
  }

  await setDoc(doc(db, "games", code), {
    boardId,
    // snapshot the board so mid-game edits to the saved board don't break play
    board: { name: board.name, categories: board.categories },
    status: "lobby",
    activeClue: null,
    buzz: null,
    lockedOut: [],
    used: [],
    lastResult: null,
    createdAt: serverTimestamp(),
  });

  sessionStorage.setItem("bp_host_game", code);
  showGame(code);
}

function showGame(code) {
  cleanupListeners();
  const gameRef = doc(db, "games", code);
  let game = null;
  let players = [];
  let renderedImgFor = null;

  topbarGame.textContent = `game: ${code}`;
  topbarGame.classList.remove("hidden");

  main.innerHTML = `<div id="game-view"><em>Loading game…</em></div>`;

  unsubGame = onSnapshot(gameRef, (snap) => {
    if (!snap.exists()) return;
    game = snap.data();
    render();
  });
  unsubPlayers = onSnapshot(collection(db, "games", code, "players"), (snap) => {
    players = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });

  const el = () => document.getElementById("game-view");

  function render() {
    if (!game || !el()) return;
    if (game.status === "lobby") renderLobby();
    else renderPlaying();
  }

  // ---------------- lobby ----------------

  function renderLobby() {
    el().innerHTML = `
      <div class="join-code-display">
        <div style="opacity:.7;text-transform:uppercase;letter-spacing:.2em;">Join code</div>
        <div class="code">${code}</div>
        <div style="opacity:.7;">Players go to this site and enter the code</div>
      </div>
      <div class="player-lobby-list" id="lobby-players">
        ${players.length ? players.map((p) => `<span class="p">${escapeHtml(p.name)}</span>`).join("") : "<em>Waiting for players…</em>"}
      </div>
      <div style="text-align:center;margin-top:2rem;display:flex;gap:.8rem;justify-content:center;">
        <button class="success" id="start-btn" ${players.length ? "" : "disabled"} style="font-size:1.2rem;padding:1rem 2.5rem;">Start Game ▶</button>
        <button class="danger" id="cancel-btn">Cancel</button>
      </div>
    `;
    document.getElementById("start-btn")?.addEventListener("click", () =>
      updateDoc(gameRef, { status: "playing" })
    );
    document.getElementById("cancel-btn")?.addEventListener("click", async () => {
      if (!confirm("Cancel this game?")) return;
      await endGame(true);
    });
  }

  // ---------------- playing ----------------

  function renderPlaying() {
    const cats = game.board.categories;
    const used = new Set(game.used || []);

    let boardHtml = `<div class="jeopardy-board" style="grid-template-columns:repeat(${cats.length},1fr);">`;
    cats.forEach((c) => (boardHtml += `<div class="jb-cell jb-cat">${escapeHtml(c.name)}</div>`));
    for (let row = 0; row < CLUE_VALUES.length; row++) {
      cats.forEach((c, ci) => {
        const key = `${ci}-${row}`;
        const isUsed = used.has(key);
        boardHtml += `<div class="jb-cell jb-clue ${isUsed ? "used" : ""}" data-key="${key}">$${CLUE_VALUES[row]}</div>`;
      });
    }
    boardHtml += `</div>`;

    el().innerHTML = `
      ${game.status === "ended" ? `<h2 style="text-align:center;">🏆 Game over!</h2>` : ""}
      ${boardHtml}
      <div id="clue-panel-slot"></div>
      <h3 style="margin-top:1.5rem;">Players <span style="font-weight:400;font-size:.8rem;opacity:.6;">(click ± or type to fix scores)</span></h3>
      <div class="scoreboard" id="scoreboard"></div>
      <div style="margin-top:1.5rem;display:flex;gap:.8rem;">
        ${game.status !== "ended" ? `<button class="danger" id="end-btn">End game</button>` : `<button class="secondary" id="back-boards-btn">← Back to boards</button>`}
      </div>
    `;

    el().querySelectorAll(".jb-clue").forEach((cell) => {
      cell.addEventListener("click", () => {
        const [ci, ri] = cell.dataset.key.split("-").map(Number);
        if (used.has(cell.dataset.key)) {
          if (confirm("This clue was already played. Reveal it to everyone again?")) {
            reopenClue(ci, ri);
          }
        } else if (!game.activeClue) {
          openClue(ci, ri);
        }
      });
    });

    renderScoreboard();
    renderCluePanel();

    document.getElementById("end-btn")?.addEventListener("click", async () => {
      if (!confirm("End the game for everyone?")) return;
      await endGame(false);
    });
    document.getElementById("back-boards-btn")?.addEventListener("click", () => {
      sessionStorage.removeItem("bp_host_game");
      showBoards();
    });
  }

  function renderScoreboard() {
    const sb = document.getElementById("scoreboard");
    if (!sb) return;
    const sorted = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    sb.innerHTML = "";
    sorted.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "score-chip";
      const s = p.score ?? 0;
      chip.innerHTML = `
        <span class="name">${escapeHtml(p.name)} <button class="small secondary" data-f="kick" title="remove player" style="padding:0 .35rem;">✕</button></span>
        <span class="score ${s < 0 ? "negative" : ""}">${s < 0 ? "-$" + Math.abs(s) : "$" + s}</span>
        <div class="edit-row">
          <button class="small secondary" data-f="minus">−</button>
          <input data-f="set" type="number" step="100" value="${s}" />
          <button class="small secondary" data-f="plus">+</button>
        </div>
      `;
      const pref = doc(db, "games", code, "players", p.id);
      chip.querySelector('[data-f="minus"]').addEventListener("click", () =>
        updateDoc(pref, { score: (p.score ?? 0) - 100 })
      );
      chip.querySelector('[data-f="plus"]').addEventListener("click", () =>
        updateDoc(pref, { score: (p.score ?? 0) + 100 })
      );
      chip.querySelector('[data-f="set"]').addEventListener("change", (e) => {
        const v = parseInt(e.target.value, 10);
        if (!Number.isNaN(v)) updateDoc(pref, { score: v });
      });
      chip.querySelector('[data-f="kick"]').addEventListener("click", () => {
        if (confirm(`Remove ${p.name} from the game?`)) deleteDoc(pref);
      });
      sb.appendChild(chip);
    });
  }

  async function renderCluePanel() {
    const slot = document.getElementById("clue-panel-slot");
    if (!slot) return;
    const ac = game.activeClue;
    if (!ac) {
      slot.innerHTML = "";
      renderedImgFor = null;
      return;
    }
    const clue = game.board.categories[ac.catIndex]?.clues?.[ac.clueIndex];
    if (!clue) return;
    const catName = game.board.categories[ac.catIndex].name;
    const buzz = game.buzz;
    const lockedNames = (game.lockedOut || [])
      .map((id) => players.find((p) => p.id === id)?.name)
      .filter(Boolean);

    slot.innerHTML = `
      <div class="clue-panel">
        <div class="clue-value">${escapeHtml(catName)} — $${clue.value}</div>
        <div class="clue-question">${escapeHtml(clue.question)}</div>
        <div id="clue-img-slot"></div>
        <div class="clue-answer">
          <div class="label">Correct answer (only you see this${ac.showAnswer ? " — now revealed to players" : ""})</div>
          <div class="text">${escapeHtml(clue.answer)}</div>
        </div>
        <div class="buzz-status">
          ${
            buzz
              ? `🔔 <span class="buzzer-name">${escapeHtml(buzz.name)}</span> buzzed in!`
              : `<span style="opacity:.6">Buzzers are open…</span>`
          }
        </div>
        ${lockedNames.length ? `<div class="locked-list">Locked out: ${lockedNames.map(escapeHtml).join(", ")}</div>` : ""}
        <div class="judge-buttons">
          ${
            buzz
              ? `<button class="success" id="right-btn">✔ Right (+$${clue.value})</button>
                 <button class="danger" id="wrong-btn">✘ Wrong (−$${clue.value})</button>`
              : ""
          }
          ${!ac.showAnswer ? `<button class="secondary" id="reveal-btn">👁 Show answer to players</button>` : ""}
          <button class="secondary" id="noone-btn">Nobody got it — close</button>
          <button class="secondary" id="cancel-clue-btn">Back to board (keep clue)</button>
        </div>
      </div>
    `;

    document.getElementById("right-btn")?.addEventListener("click", () => judge(true, clue));
    document.getElementById("wrong-btn")?.addEventListener("click", () => judge(false, clue));
    document.getElementById("reveal-btn")?.addEventListener("click", () =>
      updateDoc(gameRef, { "activeClue.showAnswer": true })
    );
    document.getElementById("noone-btn")?.addEventListener("click", () => closeClue(true));
    document.getElementById("cancel-clue-btn")?.addEventListener("click", () => closeClue(false));

    if (clue.img) {
      const imgKey = `${ac.catIndex}-${ac.clueIndex}`;
      const data = await fetchImage(game.boardId, clue.img);
      const imgSlot = document.getElementById("clue-img-slot");
      if (data && imgSlot && game.activeClue && `${game.activeClue.catIndex}-${game.activeClue.clueIndex}` === imgKey) {
        imgSlot.innerHTML = `<img class="clue-photo" src="${data}" alt="clue image" />`;
        renderedImgFor = imgKey;
      }
    }
  }

  // ---------------- host actions ----------------

  function openClue(catIndex, clueIndex) {
    updateDoc(gameRef, {
      activeClue: { catIndex, clueIndex, showAnswer: false },
      buzz: null,
      lockedOut: [],
    });
  }

  function reopenClue(catIndex, clueIndex) {
    updateDoc(gameRef, {
      used: (game.used || []).filter((k) => k !== `${catIndex}-${clueIndex}`),
      activeClue: { catIndex, clueIndex, showAnswer: false },
      buzz: null,
      lockedOut: [],
    });
  }

  async function judge(correct, clue) {
    const buzz = game.buzz;
    if (!buzz) return;
    const pref = doc(db, "games", code, "players", buzz.playerId);
    const player = players.find((p) => p.id === buzz.playerId);
    const newScore = (player?.score ?? 0) + (correct ? clue.value : -clue.value);
    await updateDoc(pref, { score: newScore });

    const result = { name: buzz.name, correct, value: clue.value, at: Date.now() };
    if (correct) {
      // clue is done: mark used, clear it
      const key = `${game.activeClue.catIndex}-${game.activeClue.clueIndex}`;
      await updateDoc(gameRef, {
        used: [...new Set([...(game.used || []), key])],
        activeClue: null,
        buzz: null,
        lockedOut: [],
        lastResult: result,
      });
    } else {
      // lock this player out, reopen buzzers for the rest
      await updateDoc(gameRef, {
        buzz: null,
        lockedOut: [...new Set([...(game.lockedOut || []), buzz.playerId])],
        lastResult: result,
      });
    }
  }

  function closeClue(markUsed) {
    const update = { activeClue: null, buzz: null, lockedOut: [] };
    if (markUsed && game.activeClue) {
      const key = `${game.activeClue.catIndex}-${game.activeClue.clueIndex}`;
      update.used = [...new Set([...(game.used || []), key])];
    }
    updateDoc(gameRef, update);
  }

  async function endGame(deleteIt) {
    sessionStorage.removeItem("bp_host_game");
    if (deleteIt) {
      const ps = await getDocs(collection(db, "games", code, "players"));
      await Promise.all(ps.docs.map((p) => deleteDoc(p.ref)));
      await deleteDoc(gameRef);
    } else {
      await updateDoc(gameRef, { status: "ended", activeClue: null, buzz: null });
    }
    if (deleteIt) showBoards();
  }
}
