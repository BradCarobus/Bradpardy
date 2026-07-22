# Bradpardy! 🏆

A custom Jeopardy web app for game night with friends. One person hosts from
their computer (share the screen on a TV), everyone else joins on their phone
with a 4-letter code and gets a big red buzzer.

## Features

- **Host dashboard** — create, edit, and delete Jeopardy boards. Every board
  is saved in Firebase, so anyone can pick any saved board to host.
- **Boards** — each category has a topic name and 5 clues worth $200 / $400 /
  $600 / $800 / $1000. Any clue can have a **photo** instead of (or alongside)
  text — photos are compressed in the browser and stored in Firestore.
- **Join codes** — hosting a board generates a 4-letter code; players join
  from the home page and enter their name.
- **Buzzers** — when the host opens a clue, every phone shows the clue and a
  buzz button. The first buzz wins (enforced with a Firestore transaction, so
  ties can't double-buzz). While someone is buzzed in and answering, the
  question is hidden from the other players. Between clues, players see the
  live board so they know what's left.
- **Viewer (TV) screen** — `viewer.html` is a read-only big screen for
  parties: it shows the join code in the lobby, the full board while the host
  is picking, the question full-screen while it's being read, and "so-and-so
  is answering…" while someone is buzzed in. Optional — the game plays fine
  without it.
- **Judging** — the host's clue panel keeps the correct answer hidden behind
  a "show answer" button (so the host doesn't read it by accident), plus
  ✔ Right / ✘ Wrong buttons. Wrong answers lose points and lock that player
  out of the clue while the buzzers reopen for everyone else — multiple
  players can miss the same clue.
- **Used clues lock out** — once a clue is done it grays out on the board and
  can't be seen again, unless the host clicks it and chooses to reopen it.
- **Score fixes** — the host can bump any player's score ±100 or type an
  exact value at any time, and can kick players.
- **Reveal answer** — the host can push the correct answer to every player's
  screen when nobody gets it.

## One-time Firebase setup (~5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and click **Add project** (any name, Analytics optional).
2. On the project overview page, click the **`</>` Web** icon to register a
   web app (any nickname, skip hosting for now).
3. Firebase shows you a `firebaseConfig` object. Copy those values into
   **`public/js/firebase-config.js`** in this repo.
4. In the left sidebar: **Build → Firestore Database → Create database**.
   Pick a region, and choose **Start in test mode** (or start in production
   mode and paste in the contents of `firestore.rules`).

That's it — no Auth, no Storage, no billing needed.

## Running it

Any static file server works. From the repo root:

```bash
# Python
python3 -m http.server 8080 --directory public
# or Node
npx serve public
```

Open `http://localhost:8080` — but note your friends need to reach the same
URL, so for real game night deploy it (below) or make sure everyone is on
your wifi and use your machine's LAN IP.

### Developing without a real Firebase project

You can run everything against the local Firestore emulator (no config
needed): `npx firebase-tools emulators:start --only firestore --project
demo-bradpardy` (uses port 8089 — add `"emulators": {"firestore": {"port":
8089}}` to firebase.json), then in the browser console run
`localStorage.bp_emulator = "1"` and reload.

## Deploying with Firebase Hosting (recommended)

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pick the project you created above
firebase deploy
```

You'll get a `https://<project>.web.app` URL everyone can use from anywhere.

## How to play

1. Host opens the site → **host dashboard** → makes a board (or picks a saved
   one) → **Host this board**.
2. The lobby shows the big 4-letter join code — players open the site on
   their phones, enter the code and their name.
3. Host clicks **Start Game**, then clicks dollar values on the board to open
   clues. Players buzz, host judges, repeat.
4. **End game** shows the winner on everyone's screens.

## Project layout

```
public/
  index.html          landing page + join form
  play.html + js/play.js    player buzzer screen
  host.html + js/host.js    host dashboard, board editor, game control
  viewer.html + js/viewer.js    read-only TV/big-screen view
  js/db.js            Firebase init + shared helpers
  js/firebase-config.js     ← paste your Firebase config here
  css/style.css       all styling
  vendor/             Firebase JS SDK (v10.12.2), vendored so no CDN is needed
firestore.rules       Firestore security rules
firebase.json         Firebase Hosting/Firestore config
```

## Data model (Firestore)

- `boards/{boardId}` — `{ name, categories: [{ name, clues: [{ value, question, answer, img }] }] }`
- `boards/{boardId}/images/{imgId}` — `{ data: <compressed jpeg data URL> }`
  (one doc per photo so big photo boards never hit the 1 MB doc limit)
- `games/{CODE}` — live game state: board snapshot, `status`, `activeClue`,
  `buzz`, `lockedOut`, `used`, `lastResult`
- `games/{CODE}/players/{playerId}` — `{ name, score }`
