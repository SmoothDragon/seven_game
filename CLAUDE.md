# CLAUDE.md — Seven 7s

This document is a complete specification of the **Seven 7s** web game. It is written so that an AI coding agent (or a human developer) can rebuild the project from scratch without needing any additional context.

---

## 1. Project Overview

**Seven 7s** is a browser word puzzle inspired by Wordle. The player must guess seven hidden 7-letter words that all share one "common letter", using feedback from each guess to narrow down the answers. The whole game is static HTML/CSS/JS — no build step is required to play — and a small Firebase Firestore backend stores the daily leaderboard.

### Core concept

- A hidden "common letter" (e.g. `e`) is shown to the player.
- Seven (or eight) secret words all contain that letter. In **Daily** mode, it is always seven 7-letter words; in **Practice** mode, the player can choose seven 7-letter words or eight 8-letter words.
- The player types guesses. Every guess must be a valid dictionary word of the current length and must contain the common letter.
- Feedback is shown per row (one row per secret word):
  - Letters in the correct position turn **green** inside the row.
  - Letters that belong to that row's secret word but in the wrong position are listed **yellow** to the right of the row, in a compact grid (no positional info given).
  - Below each column, **red** letters show letters that have been guessed somewhere as yellow but which are not correct in that particular column.
  - The on-screen keyboard colors tell the player which letters are still useful.

### Modes

There are **four** top-level modes, exposed as buttons in `.mode-toggle`:

- **Daily** — the classic daily puzzle. Same for everyone on a given date. Uses the *Common 5k* word list (`WORDS.slice(0, 5000)`). Seed is a hash of the local date string. Scores submit to the `daily_scores` Firestore collection. A scoreboard sidebar shows today's finishers.
- **Daily WGPO** — a **second, independent** daily puzzle that uses the **full** 7-letter WGPO list (`WORDS`). Has its own leaderboard in a separate Firestore collection `daily_scores_wgpo`. Uses a different seed (`date + ':wgpo'`) and **is guaranteed to have a different common letter from the classic Daily on the same date** — the WGPO picker explicitly excludes the classic daily's letter from its alphabet search.
- **Practice** — infinite random puzzles. The player chooses word length (7 or 8) and a difficulty:
  - *Common* — 5k most frequent words by usage.
  - *Probable* — 5k "most probable" words by Scrabble-tile likelihood.
  - *All* — full WGPO word list.
- **Past 7** — read-only gallery of the seven preceding daily puzzles (yesterday back through seven days ago). A sub-toggle at the top of the section switches between the classic **Daily** and the **Daily WGPO** history — the two can be reviewed independently and are backed by the two separate Firestore collections. Each day is shown as a card with its common letter (unique per variant) and the best solve's stats. Clicking a card opens a replay of that player's guesses: the board animates guess-by-guess, and a log on the side lists `mm:ss  WORD` for each guess in order. Each guess is also clickable to scrub the board to that exact point, plus Prev / Play / Next / Speed controls.

---

## 2. File layout

```
seven_game/
├── index.html              # single-page UI
├── style.css               # all styling
├── script.js               # all game logic (vanilla JS, globals, no modules)
├── firebase-config.js      # Firebase init + config (public keys only)
├── words.js                # const WORDS = [...]   7-letter lexicon, ordered by usage freq
├── words8.js               # const WORDS8 = [...]  8-letter lexicon, ordered by usage freq
├── scrabble_ranks.js       # const SCRABBLE_RANKS = [...]  parallel array of "probability" ranks
├── scrabble_ranks8.js      # const SCRABBLE_RANKS8 = [...] parallel array for WORDS8
├── en_full.txt             # (gitignored) English frequency list; one "word count" per line
├── scripts/
│   └── build-words8.mjs    # regenerates words8.js + scrabble_ranks8.js from a WOW lexicon + en_full.txt
├── README.md
├── LICENSE
└── .gitignore              # ignores en_full.txt and node_modules/
```

There is no `package.json` — the game ships as plain static files. The only Node script (`build-words8.mjs`) uses ES-module syntax and Node's built-in `fs` / `path` / `url`; no dependencies are needed.

### Word list format

- `WORDS` and `WORDS8` are JavaScript arrays of lowercase strings of length 7 and 8 respectively, **sorted by descending usage frequency** (most common first). Tied frequencies break alphabetically. The first 5,000 entries are considered "Common".
- `SCRABBLE_RANKS[i]` / `SCRABBLE_RANKS8[i]` is the "probability rank" (1 = most probable) of the word at the same index of `WORDS` / `WORDS8`. Probability is computed as the sum of `log(tileCount[letter])` across the word, using standard English Scrabble tile counts (98-tile distribution, blanks omitted). See `scripts/build-words8.mjs` for the exact algorithm.
- `en_full.txt` is a large whitespace-separated `word<space>count` file used only for ordering by usage frequency at build time.

---

## 3. HTML structure (`index.html`)

One page, one `<body>`. Major elements, in order:

1. **Mode toggle** (`.mode-toggle`) with four buttons in order: `#mode-daily` ("Daily"), `#mode-daily-wgpo` ("Daily WGPO"), `#mode-practice` ("Practice"), `#mode-past7` ("Past 7"). The active one has the `.active` class. Only the first and last buttons have rounded outer corners; all non-first buttons share a left border with their neighbour (`border-left:none`). `.mode-toggle` uses `flex-wrap: wrap` so the row still fits on narrow phones, with reduced button padding under a `@media (max-width: 500px)` breakpoint.
2. **`.main-wrapper`** containing:
   - **`.container`** — the playfield. Inside:
     - `<h1>Seven 7s</h1>`
     - Tagline paragraph with `#game-tagline-text` span and a `#rules-link` (`<a href="#">Rules</a>`).
     - **`#controls`** (hidden unless in practice mode) — `#practice-word-length` select (7/8), `#difficulty` select (common/probable/all), `#new-game-btn`.
     - **`#game-play-area`** — wrapper around all live-game UI (hidden in Past 7 mode via `display:none`). Contains, in order:
       - **`.game-header`**:
         - `#common-letter-display` → "Common Letter: `<span id="common-letter">`".
         - `.game-header-right` containing `#guess-count-display` (`Guesses: <span id="guess-count">0</span>`), and `#timer-display` with `<span id="timer">00:00</span>` plus a `#pause-btn` (`⏸` / `▶`).
       - **`.board-wrap` (#board-wrap)** containing `#game-board` and a `.fireworks-overlay` `#fireworks-overlay`.
       - **`.column-feedback-row` (#column-feedback-row)** with `#column-feedback` + a `.column-feedback-spacer` so columns align with letter-boxes above them (there's a trailing spacer matching the yellow-feedback grid's width).
       - **`.input-area`** with `#guess-input` (text input, maxlength initially 7, `inputmode="none"` so the on-screen keyboard appears instead of the OS one, `autocomplete="off"`, `spellcheck="false"`) and a `#guess-btn`.
       - **`.hint-area`** with `#green-hint-btn` (showing `Green Hint (<span id="green-hint-count">0</span>)`) and `#yellow-hint-btn` (showing yellow count).
       - `#message` — transient error/info line.
       - **`#keyboard`** — three `.keyboard-row`s containing `.key` buttons with `data-key` attributes: Q-W-E-R-T-Y-U-I-O-P, A-S-D-F-G-H-J-K-L, ENTER (`.key.wide data-key="Enter"`) + Z-X-C-V-B-N-M + Backspace (`.key.wide data-key="Backspace"` rendered as `⌫`).
     - **`#past7-section`** (hidden except in Past 7 mode) — contains:
       - `<h2 class="past7-title">Past 7 Days</h2>` and `.past7-subtitle` paragraph.
       - `.past7-variant-toggle` — a two-button sub-toggle (`#past7-variant-common`, `#past7-variant-wgpo`) that flips the grid between the classic Daily history and the Daily WGPO history. The active button has `.active`.
       - `#past7-grid.past7-grid` — a CSS-grid of `.past7-card` tiles, one per past day.
       - `#past7-replay.past7-replay.hidden` — the replay panel, shown when a card is clicked. Contains `#past7-back-btn`, `#past7-replay-header`, and a `.past7-replay-body` with `#past7-replay-board`, `#past7-replay-controls` (`#past7-replay-play`, `#past7-replay-speed`), and `ul#past7-replay-log.past7-replay-log`.
   - **Sidebars** (outside `.container` but inside `.main-wrapper`):
     - `#sidebar-history` (`.sidebar.history`, only visible in practice mode, `display:none` by default) containing `<h3>Guess History</h3>` and `<ul id="guess-history">`.
     - `#sidebar-scoreboard` (`.sidebar`, only visible in daily mode) with `<h3>Today's Scoreboard</h3>`, `#scoreboard-list`, and a `.daily-history-section` with `<h4>Your Guesses</h4>` + `<ul id="daily-guess-history">`.
3. **Nickname Modal** `#nickname-modal` (`.modal-overlay.hidden` by default): `.modal-content` containing `<h2>Puzzle Complete!</h2>`, a prompt, `#nickname-input` (maxlength 20), and `#nickname-save-btn`.
4. **Splash/Rules Overlay** `#splash-overlay` (visible initially; click-anywhere dismisses) containing an `#splash-content` block with the rules (see section 7) and a link to the WGPO official word list.
5. **Script tags**, in this order:
   ```html
   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
   <script src="words.js?v=2"></script>
   <script src="scrabble_ranks.js?v=2"></script>
   <script src="firebase-config.js?v=2"></script>
   <script src="script.js?v=2"></script>
   ```
   `words8.js` and `scrabble_ranks8.js` are **not** preloaded — they are fetched on demand by `script.js` the first time the user switches to 8-letter practice mode (see §5). The dynamic loader also appends `?v=${ASSET_VERSION}` to those filenames.

**Cache-busting.** GitHub Pages serves static assets with a multi-minute `Cache-Control`, so without query-string versioning browsers will happily run a new `index.html` against a stale cached `script.js` — which presents as "button X exists but does nothing" (its click listener lives in the newer JS that never downloaded). To prevent this, every local asset URL carries `?v=N`, and `script.js` defines a matching `const ASSET_VERSION = 'N'`. **On every release, bump both**: the suffix on all `<link>` / `<script>` tags in `index.html` and the `ASSET_VERSION` constant at the top of `script.js`.

---

## 4. Styling rules (`style.css`)

Palette and key metrics (match exactly for a faithful rebuild):

- Background: `#f0f0f0`; card background `white` with `border-radius:8px`, box-shadow `0 4px 6px rgba(0,0,0,0.1)`.
- Primary blue: `#007bff` / hover `#0056b3`. Accent greens and yellows match Wordle:
  - Correct / green: `#6aaa64`
  - Yellow (wrong position): `#c9b458`
  - Red column feedback: `#d9534f` on light red `#fde8e8` background with `border-radius:4px`.
  - Cyan (keyboard "finished but still in unresolved rows"): `#06b6d4` / hover `#0891b2`.
  - Black (keyboard "letter no longer useful"): `#3a3a3c`.
- Letter boxes are `40px × 40px`, `border:2px solid #ccc`, `font-size:22px`, uppercase. In 8-letter mode (`#game-board[data-word-len="8"] .letter-box`) they shrink to `34×34` with `font-size:18px`.
- `.word-row` is flex, `gap:5px`. Each row has a `.wrong-position-feedback` block to the right: a `40px`-wide CSS grid (`grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr)`), yellow text, uppercase. In 8-letter mode it widens to 48px and uses a 4-column grid.
- `.col-feedback` matches letter-box width (40 / 34 px), red uppercase letters in a 2-column grid with tight line-height and negative letter spacing so up to ~6 letters can fit.
- On-screen keyboard: three rows of `.key` buttons. Normal key `max-width:45px`, `padding:15px 5px`, `font-size:1.2em`, `background-color:#d3d6da`, `color:black`; `.key.wide` (Enter / Backspace) `max-width:65px`. States add classes `black`, `green`, `yellow`, `cyan`. Below 400px viewport, key padding/font shrinks.
- `.fireworks-overlay` is absolutely positioned over the board, with particles animated via `@keyframes firework-particle` (translate + scale to 0 over 0.42s). Honors `prefers-reduced-motion`.
- **Responsive**: at `max-width:900px`, `.main-wrapper` becomes `flex-direction: column` so sidebars stack below the playfield.
- **Definition tooltip** (`.def-tooltip`) floats above completed rows on hover (max 250px wide, `z-index:100`, fade in/out). The guess-history items use an analogous `.guess-tooltip` that appears to the left (`right:100%`).
- **Splash overlay** is `position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:2000`, scrollable, dismissed by click.
- **Nickname modal** uses `.modal-overlay` (fixed, z-index 3000) and `.modal-content` centered card.
- Always reserve horizontal space with `body { padding: env(safe-area-inset-*) }` and use `-webkit-text-size-adjust:100%` so mobile Safari does not rescale.

---

## 5. Game logic (`script.js`)

Single vanilla JS file, no modules, all globals on `window`. Firebase-compat SDK is used through the global `firebase` object.

### 5.1 Global state

```js
let secretWords = [];        // length = wordLen; the hidden words
let commonLetter = '';       // single char shared by all secret words
let revealedLetters;         // wordLen × wordLen array of '' or the letter (green cells)
let wrongPositionLetters;    // wordLen strings; each is the sorted unique yellow letters for row i
let columnRedLetters;        // wordLen strings; each is the red-in-this-column letters
let guesses = [];            // array of lowercase guessed strings
let guessLog = [];           // [{word, t}] — elapsed seconds when each guess was made
let gameOver = false;
let startTime, timerInterval;
let pausedElapsed = 0, paused = false;
let greenHintCount = 0, yellowHintCount = 0;
let gameMode = 'daily';      // 'daily' | 'daily_wgpo' | 'practice' | 'past7'
let currentDailyVariant = 'common'; // 'common' | 'wgpo' — which daily leaderboard/collection to use
let dailySubmitted = false;  // whether the user already submitted a score today (for the current variant)
let finalElapsedSeconds = 0;
let secondarySortKey = 'guesses';  // 'guesses' | 'time' — leaderboard sort toggle
let wordLen = 7;             // 7 or 8
let fireworksTimerId = null, fireworksEpoch = 0;
let words8LexiconLoadPromise = null;
let probableWordListCache = null, probableWordListCache8 = null;
let definitionsCache = {};

// Past 7 mode + replay state (see §5.14)
let past7Variant = 'common'; // 'common' | 'wgpo' — which daily flavor the grid is showing
let past7Days = [];          // [{date, letter, secrets, bestScore, loaded, variant}]
let replaySecrets = [];
let replayCommon = '';
let replayRevealed, replayWrongPos, replayColumnReds;
let replayGuesses = [];
let replayLog = [];          // [{word, t}] sorted by t ascending
let replayStep = 0;          // index of next guess to apply
let replaySpeed = 1;         // 1, 2, or 4
let replayPlaying = false;
let replayTimeoutId = null;
let currentReplayDayIdx = -1;
```

### 5.2 Lazy 8-letter lexicon loading

- `appendLexiconScript(src)` dynamically inserts a `<script src>` tag, returning a Promise that resolves on `onload` / rejects on `onerror`. It caches by an id derived from `src` so calling twice is a no-op after load.
- `ensureWords8LexiconLoaded()` returns a cached Promise that sequentially loads `words8.js` then `scrabble_ranks8.js`. If `WORDS8` and `SCRABBLE_RANKS8` are already defined it resolves immediately.
- `getActiveLexicon()` returns `WORDS8` if `wordLen === 8` else `WORDS`. `getActiveRanks()` similarly. The helper functions `getProbableWordList()` / `getProbableWordList8()` return the 5,000 words with the lowest Scrabble rank (most probable), cached on first call.

### 5.3 Seeded RNG for daily puzzles

- `mulberry32(seed)` — standard 32-bit PRNG returning `() => float in [0,1)`.
- `getDailySeed()` — uses local date `YYYY-MM-DD`, runs it through the classic `hash = ((hash<<5) - hash) + charCode` reducer, returns an int.
- `getTodayString()` returns the same `YYYY-MM-DD` string used above and as the Firestore `date` field.

### 5.4 Word picking

The pure primitive is `pickPuzzle(rng, wordList, wordCount, excludeLetter) → {letter, secrets}`:

1. Build an array of 26 indices 0–25 and Fisher–Yates shuffle it with `rng`.
2. For each letter in that shuffled alphabet (skipping `excludeLetter` if given), filter `wordList` for words containing it. The first letter for which `candidateWords.length >= 50` becomes the puzzle's common letter; its filtered list becomes the candidate pool.
3. Pick `wordCount` words from the pool without replacement by repeatedly `splice`-ing a random index using `rng`.
4. Returns `{letter, secrets}`. Never mutates globals.

`pickWordsWithRng(rng, wordList)` is a thin back-compat wrapper that calls `pickPuzzle` and writes the results into the `commonLetter` / `secretWords` globals. It's used by Practice mode only.

**Daily variants.** The two daily puzzles are derived by:
- `puzzleForDate(dateStr)` → `pickPuzzle(mulberry32(seedForDateStr(dateStr)), WORDS.slice(0,5000), 7, null)` — the **classic Daily**. The seed algorithm is the unchanged `seedForDateStr(dateStr)` so that `Past 7 → Daily` can still reconstruct every historical `daily_scores` puzzle exactly.
- `puzzleWgpoForDate(dateStr)` → first computes the classic daily's letter for the same date, then returns `pickPuzzle(mulberry32(seedForDateStr(dateStr + ':wgpo')), WORDS, 7, classic.letter)` — the **Daily WGPO**. Using the `':wgpo'` suffix gives a completely different alphabet shuffle; passing `classic.letter` as `excludeLetter` guarantees the WGPO daily's common letter is **never** the same as classic Daily's on the same day.
- `puzzleForDateVariant(dateStr, variant)` is the single dispatcher used by both the live game init and Past 7.

**Daily init.** `initDailyGame()` and `initDailyWgpoGame()` are thin aliases for `initDailyVariant('common'|'wgpo')`, which:

1. Sets `currentDailyVariant = variant` and `wordLen = 7`.
2. `resetGameState()` (clears arrays, timer, history, keyboard).
3. Reads `localStorage.getItem(dailySubmittedKey(variant, todayStr))` into `dailySubmitted` — that key is `"daily_submitted_"+YYYY-MM-DD` for classic and `"daily_submitted_wgpo_"+YYYY-MM-DD` for WGPO, so submissions for the two variants are tracked independently.
4. Calls `puzzleForDateVariant(todayStr, variant)`, copies the result into `commonLetter` + `secretWords`.
5. Calls `updateScoreboardHeading(variant)` which rewrites the sidebar title between `"Today's Scoreboard"` and `"Today's WGPO Scoreboard"`.
6. Renders the board, calls `fetchLeaderboard()` (which picks the right collection via `currentDailyVariant`), and focuses the input.

`initGame()` (practice) is async. It reads `#practice-word-length` and, if 8, awaits `ensureWords8LexiconLoaded()` while showing a loading message. Then it picks the active word list based on `#difficulty` (common = first 5k, probable = 5k lowest Scrabble rank, all = full list), and picks the common letter + secrets the same way but with `Math.random()` (not seeded). If no letter has ≥50 candidates it falls back to `e`.

### 5.5 Guess handling

`handleGuess()` validates the input in this exact order, with `showMessage` for errors:

1. `guess.length !== wordLen` → "Guess must be exactly N letters."
2. `!getActiveLexicon().includes(guess)` → "Not a valid word in the list."
3. `!guess.includes(commonLetter)` → "Word must contain the common letter: X"
4. `guesses.includes(guess)` → "You already guessed that word."

On success: start the timer if not running, capture `elapsedAtGuess = getElapsedSeconds()`, push the guess onto `guesses`, append `{word: guess, t: elapsedAtGuess}` onto `guessLog`, increment the display, call `processGuess(guess)`, update keyboard colors, prepend an `<li>` to the appropriate history list (`#daily-guess-history` in daily, `#guess-history` in practice) that includes a hover tooltip `.guess-tooltip` whose content is fetched by `fetchDefinition(guess, tooltip)`. Re-render the board and check win condition.

`processGuess(guess)` does four passes across all `wordLen` rows:

1. **Greens**: for each row `i` and column `j`, if `guess[j] === secretWords[i][j]`, set `revealedLetters[i][j] = guess[j]`.
2. **Yellows (add)**: for each row, for each unique letter in `guess`, if the secret contains that letter and it's not already in `wrongPositionLetters[i]`, append it.
3. **Yellows (prune row-local duplicates)**: for each char in that row's yellow list, count its occurrences in the secret word vs. in the revealed row; keep it only while `countRevealed < countInSecret`. Re-sort the string alphabetically.
4. **Yellows (prune globally fully-revealed)**: a letter should no longer appear as yellow in any row if every secret word's copies of that letter are already revealed as green across all rows.

Then call `computeColumnRedLetters()`:

- For each column `j`, skip if all seven rows already have `revealedLetters[i][j]` (column is complete → no red letters).
- Collect the set of letters guessed in column `j` (by `guess[j]` across all `guesses`).
- For each such letter, require that it is currently yellow in *some* row (otherwise it's either useless or all-green); if so, and if no secret word has that letter at column `j`, add it to `columnRedLetters[j]`.
- Sort each column's red letters alphabetically.

### 5.6 Hints

- **Green hint** (`useGreenHint`): collect every `(i,j)` pair where `revealedLetters[i][j]` is empty. Pick one uniformly at random. The chosen letter is `secretWords[pick.i][pick.j]`. Reveal that letter in column `pick.j` for every row whose secret has the same letter in that column. Then `recomputeYellowLetters()`, `computeColumnRedLetters()`, `updateKeyboardColors()`, `renderBoard()`, `checkWinCondition()`. Increment `greenHintCount` and update display.
- **Yellow hint** (`useYellowHint`): build the set of all letters present in any secret word. Drop any letter that is already "known" — defined as appearing in any row's `wrongPositionLetters` or `revealedLetters`. If the remaining set is empty, `showMessage('No new letters to reveal!')`. Otherwise pick one uniformly at random and, for each row whose secret contains it (and doesn't already show it as yellow), append it to that row's yellow string and re-sort. Recompute column reds, keyboard colors, render; increment `yellowHintCount`.

`recomputeYellowLetters()` is the same two-pass prune used by `processGuess` (row-local, then global) — factored out so green hints can reuse it.

### 5.7 Keyboard colors

`updateKeyboardColors()` loops over every `.key` button with a single-char `data-key`. Logic, in this order:

1. If the letter has never been included in any guess → do nothing (keep default grey).
2. If no secret word contains the letter → `.black`.
3. If every occurrence of the letter in every secret is already revealed → `.cyan` if there is still any incomplete row whose secret contains this letter (so the player still needs it for spelling), else `.black`.
4. Otherwise look at where the letter has been guessed. For each position `j` the letter has appeared in `guesses`, check each secret word: if the secret has the letter and it's at column `j`, mark `isGreen = true`; otherwise `isYellow = true`.
5. Prefer `yellow` over `green` when both are true (`if (isYellow) yellow else if (isGreen) green`).

Helper `incompleteWordRowContainsChar(char)` returns true when some row whose secret contains `char` still has at least one unrevealed cell.

### 5.8 Board rendering

`renderBoard()` empties `#game-board` and rebuilds it from the state arrays:

- Sets `board.dataset.wordLen = String(wordLen)` and likewise on `#column-feedback-row`, so CSS can size cells accordingly.
- For each row, creates a `.word-row` with `wordLen` `.letter-box` children (green if revealed). Tracks `isCompleted` (all cells filled). If the row is completed, adds `.completed` class and appends a `.def-tooltip` ("Loading definition...") then calls `fetchDefinition(secretWords[i], tooltip)`.
- Appends a `.wrong-position-feedback` block whose innerHTML is `wrongPositionLetters[i].split('').map(c => '<span>'+c+'</span>').join('')`.
- Then fills each `#col-j` feedback div (created once by `buildColumnFeedbackDom()`).

`buildColumnFeedbackDom()` creates the `#col-0`..`#col-N-1` children inside `#column-feedback` every time a new game starts.

### 5.9 Timer & pause

- Timer starts lazily: `startTimerIfNeeded()` on the first guess or hint. Updates every 1s via `setInterval(updateTimer, 1000)`.
- `getElapsedSeconds()` = `(now - startTime)/1000 + pausedElapsed`.
- `togglePause()`: while paused, the board and column-feedback rows are visually hidden (`.hidden` → `visibility:hidden`), all input controls are disabled, and the button swaps between `⏸`/`▶` with matching `title`. Elapsed time is preserved in `pausedElapsed`.

### 5.10 Win / fireworks

`checkWinCondition()`: if every cell in `revealedLetters` is truthy, set `gameOver`, stop the timer, disable the guess button, call `launchFireworks()`, and — in daily mode — show the nickname modal (unless already submitted today); in practice mode show a congratulations message.

`launchFireworks()`: skip entirely if `prefers-reduced-motion` is set. Otherwise increments `fireworksEpoch` (so any in-flight timers become no-ops), reveals the overlay, and schedules 6 "bursts" 80ms apart. Each burst is positioned at a random `(12..88%, 12..88%)` inside the overlay and spawns 28 particles at equally-spaced angles (`angle = i/28 * 2π + random*0.35`) with distance `28 + random*40`px, using `--tx` / `--ty` CSS vars and one of eight colors: `#ff6b6b #ffd93d #6bcb77 #4d96ff #ff922b #e599f7 #ffffff #22d3ee`. Each burst cleans itself up after 450ms. A master timer hides and clears the overlay after `FIREWORKS_TOTAL_MS = 1000`. `clearFireworksOverlay()` bumps the epoch, clears the timer, hides and empties the overlay.

### 5.11 Definitions

`fetchDefinition(word, tooltipElement)`:

1. For 8-letter mode, ensure `WORDS8`/`SCRABBLE_RANKS8` are loaded.
2. Compute a small "ranks" HTML block:
   - "Usage: #<index+1> / <total>" and "Probability: #<SCRABBLE_RANKS[index]> / <total>", formatted with `toLocaleString`. If the word is not in the active lexicon, show em dashes.
3. Use `definitionsCache[word]` if already present.
4. Otherwise `fetch('https://api.dictionaryapi.dev/api/v2/entries/en/<word>')`. On success, render `<strong>WORD</strong>` + ranks + for each meaning `<em>partOfSpeech</em><ul>` with up to 2 `<li>` per meaning. On failure, cache + render "Definition not found in dictionary."
5. Cache the HTML in `definitionsCache` and write it into the tooltip element.

### 5.12 Event wiring

`setupEventListeners()` binds:

- Click on `#guess-btn` → `handleGuess`. Click on `#new-game-btn` → `initGame`. Change on `#difficulty` and `#practice-word-length` → `initGame`. Click on `#green-hint-btn` / `#yellow-hint-btn` → `useGreenHint` / `useYellowHint`. Click on `#pause-btn` → `togglePause`.
- Click on `#mode-daily` / `#mode-practice` → `switchMode('daily'|'practice')`.
- Click on `#splash-overlay` → add `.hidden`, focus input. Click on `#rules-link` → prevent default + remove `.hidden` to show the rules.
- Click on `#nickname-save-btn` → `saveNickname`. Enter key on `#nickname-input` → `saveNickname`.
- Enter key on `#guess-input` → `handleGuess`.
- Document-level keydown: if `gameOver` is false, any plain letter key pressed while the input is not focused refocuses the input (so desktop users can just start typing).
- Each `.key` on the on-screen keyboard: Enter → `handleGuess`; Backspace → slice last char off input value; letter → append to input value if under `wordLen`. Always refocuses the input. `e.preventDefault()` so mobile keyboards don't pop up.

`window.onload`: `initFirebase()`, `setupEventListeners()`, `switchMode('daily')`.

### 5.13 Mode switching

`switchMode(mode)` first stops any in-flight replay if we're leaving Past 7 mode (`stopReplayTimer(); replayPlaying = false`). Then it toggles the `.active` class on all three mode buttons, shows `#controls` only in practice, shows `#sidebar-history` only in practice, shows `#sidebar-scoreboard` only in daily, and swaps `#game-play-area` with `#past7-section` via `style.display` for Past 7 vs. the other two modes. Finally it calls `initPast7()`, `initDailyGame()`, or `initGame()` as appropriate, then `updateGameTaglineText()` — which reads `'past7'` and emits "Relive the best solves from the past seven daily puzzles."

`resetGameState()` clears all state arrays including `guessLog` (sized by current `wordLen`), rebuilds column feedback DOM, clears input/history/board/keyboard classes, resets hint counts, stops timer, shows board, re-syncs `#guess-input.maxLength` and placeholder, and clears the fireworks overlay.

### 5.14 Past 7 mode & replay

**Date selection.** `past7Dates()` returns 7 local-date strings going back from yesterday (not today) to 7 days ago, most recent first, in `YYYY-MM-DD` form.

**Deterministic puzzle re-creation.** `seedForDateStr(dateStr)` re-implements the same date → seed hash used by `getDailySeed()` but parameterized by an arbitrary date string. `puzzleForDate(dateStr)` is a **pure** reimplementation of the daily picker that returns `{letter, secrets}` without touching any globals: seed `mulberry32`, shuffle the alphabet, pick the first letter whose 5k-Common filter has ≥50 candidates, then pick 7 words without replacement. This works because daily puzzles are always deterministic from the date.

**Initialization** (`initPast7()`): stops any prior replay, hides `#past7-replay`, shows `#past7-grid`, builds `past7Days` by calling `puzzleForDate` for each date (marking `loaded:false`), renders the grid with a "Loading…" state, and — if `db` is available — kicks off one `fetchBestScoreForDay(day)` per day in parallel. Each fetch runs the same query as `fetchLeaderboard` but filtered to `day.date`, sorts the results by **fewest hints → fewest guesses → fastest time** (a fixed canonical "best" ordering, not tied to the scoreboard's toggle), and prefers the best-ranked score that has a non-empty `guess_log` (so replayable solves always win over equally-ranked ones without replay data). Each completion flips `day.loaded = true` and re-renders the grid.

**Grid rendering** (`renderPast7Grid`). Each `.past7-card` shows the formatted short date, the common letter in large type, and either:
- "Loading…" (muted) while `!day.loaded`;
- the best player's nickname + `N guesses · mm:ss · K hint(s)` + the `.has-replay` class making the card clickable, if a replayable solve exists;
- the best player's nickname + "No replay data" (muted) if there's a score but no `guess_log` (older data);
- "No solves" (muted) if no one played that day.

Only `.has-replay` cards are wired to `openReplay(idx)`.

**Opening a replay** (`openReplay(dayIdx)`): stops any prior timer, copies `day.secrets` into `replaySecrets`, sets `replayCommon`, builds `replayLog` from the best score's `guess_log` (normalized to lowercase + sorted ascending by `t`), resets all replay board arrays, `replayStep = 0`, `replaySpeed = 1`, hides the grid, shows `#past7-replay`, renders the header with the player's nickname and stats, and renders an empty board + the full guess log (all rows start faded).

**Replay rendering** (`renderReplayBoard`). Identical visuals to the live board but drawn into `#past7-replay-board`: seven `.word-row` rows each with seven `.letter-box` cells (green when revealed), a trailing `.wrong-position-feedback` grid for yellows, and a trailing `.column-feedback-row` with seven `.col-feedback` cells for reds. Completed rows also get a `.def-tooltip` fetched via `fetchDefinition(secret, tooltip)` (temporarily pinning `wordLen = 7` around the call so the tooltip's rank math uses the 7-letter lexicon even if the user was last in 8-letter practice mode). `renderReplayLog` rebuilds the `<ul>` of `.replay-log-entry` rows — those with index `< replayStep` get the `.played` class (full opacity + pale-blue background), the rest are faded.

**Applying a guess** (`applyReplayGuess(guess)`). Mirrors `processGuess` exactly — greens, yellow add, row-local yellow prune (by letter count vs. revealed), global yellow prune (by fully-revealed-globally), and column-red recompute — but operates on the replay state arrays. This is a standalone duplicate rather than a refactor of `processGuess`, so the live-game code path is untouched and guaranteed stable.

**Playback & scrubbing controls**:
- `stepReplay()` advances `replayStep` by one, applies `replayLog[step-1]` incrementally to the board, and re-renders board + log.
- `resetReplayBoardState()` — zeroes `replayRevealed` / `replayWrongPos` / `replayColumnReds` / `replayGuesses` and sets `replayStep = 0`. Used by `jumpReplayTo` and when `playReplay` restarts from the end.
- `jumpReplayTo(step)` — the scrubber primitive. Pauses any active playback, resets the replay board state, then **replays guesses 0..step-1 in order** by calling `applyReplayGuess` on each (rather than trying to "un-apply"), sets `replayStep = step`, and re-renders. This is the correct way to step backward given that column-red / yellow-prune logic depends on the full history, not just the current revealed grid.
- `replayStepForward()` / `replayStepBackward()` — thin wrappers that call `jumpReplayTo(replayStep ± 1)`.
- Clicking any `.replay-log-entry` calls `jumpReplayTo(i + 1)` so the clicked guess becomes the `.current` entry (highlighted blue, with a 3px left bar) and the board reflects the state immediately after that guess.
- `scheduleNextReplay()` sets a `setTimeout` whose delay is `clamp(0.35s, t_i - t_{i-1}, 4s) / replaySpeed` — so guesses made seconds apart play out at roughly their real cadence, but huge think-time gaps are capped at 4 seconds so the animation never stalls, and tiny gaps still get a minimum 0.35s so the user can see each step.
- `playReplay()` — if already at end, calls `resetReplayBoardState()` + renders to start over; then sets `replayPlaying = true` and schedules the next step.
- `pauseReplay()` — clears the timer and sets `replayPlaying = false`.
- `toggleReplayPlayPause()` — bound to `#past7-replay-play`.
- `cycleReplaySpeed()` — bound to `#past7-replay-speed`; cycles 1× → 2× → 4× → 1×. If the replay is currently playing, re-schedules the next step at the new speed.
- `updateReplayControls()` — renders the play button as `▶ Play` when stopped mid-way, `⏸ Pause` while playing, or `↻ Replay` when at the end; renders the speed button as `Speed: N×`; and toggles `disabled` on `#past7-replay-prev` / `#past7-replay-next` when at the start / end of the log.

**Controls layout** (`#past7-replay-controls` row, left to right): `⏮ Prev` · `▶ Play/⏸ Pause/↻ Replay` · `Next ⏭` · `Speed: 1×/2×/4×`. Below the control row sits a muted hint line ("Click any guess below to see the board at that point.") and then the guess log.

**Back button** (`backToPast7Grid`): stops the timer, unsets `replayPlaying`, hides the replay panel and re-shows the grid. Always a clean return — no state is left over that would leak into the next day the user picks.

---

## 6. Firebase / scoreboard

### 6.1 `firebase-config.js`

Exports (as globals) a `firebaseConfig` object — a normal Firebase Web config (publishable API key, authDomain, projectId, storageBucket, messagingSenderId, appId, measurementId). A comment notes that these keys are safe to expose; security is enforced by Firestore rules.

A module-level `let db = null` is created, and `initFirebase()`:
- Warns if `firebase` is undefined (SDK failed to load).
- Calls `firebase.initializeApp(firebaseConfig)` only if `firebase.apps.length === 0` (avoids "app already exists" after bfcache).
- Assigns `db = firebase.firestore()`. On errors, tries to attach to an existing app silently.

### 6.2 Firestore schema

**Two parallel collections**, one per daily variant:

- `daily_scores` — classic Daily leaderboard (unchanged historically).
- `daily_scores_wgpo` — Daily WGPO leaderboard.

Both have **identical** document shapes. The active collection is chosen at call sites via `dailyScoresCollection(currentDailyVariant)` (live game) or `dailyScoresCollection(day.variant)` (Past 7). Using separate collections — rather than a shared collection with a `variant` field — keeps Firestore queries trivial and avoids any migration of existing classic documents.

Each document:

```js
{
  date: 'YYYY-MM-DD',         // from getTodayString()
  nickname: string,            // user-entered, max 20 chars, stored in localStorage('seven_sevens_nickname')
  time_seconds: number,
  guesses: number,
  green_hints: number,
  yellow_hints: number,
  total_hints: number,         // convenience: green + yellow
  guess_log: [                 // sequence of guesses with timestamps (used by Past 7 replay)
    { word: 'preview', t: 12 },      // t = elapsed seconds when the guess was submitted
    { word: 'present', t: 45 },
    ...
  ],
  timestamp: serverTimestamp()
}
```

`guess_log` is built client-side by `handleGuess` and flushed at submit time. Older documents written before this field existed are tolerated: the Past 7 grid will show the solver's stats but mark the card "No replay data" (non-clickable).

Recommended Firestore rule tweak if you previously restricted the writable field set — apply the **same** rule to both collections:

```
match /daily_scores/{docId} {
  allow create: if request.resource.data.keys().hasOnly(
    ['date', 'nickname', 'time_seconds', 'guesses',
     'green_hints', 'yellow_hints', 'total_hints',
     'guess_log', 'timestamp']);
}

match /daily_scores_wgpo/{docId} {
  allow create: if request.resource.data.keys().hasOnly(
    ['date', 'nickname', 'time_seconds', 'guesses',
     'green_hints', 'yellow_hints', 'total_hints',
     'guess_log', 'timestamp']);
}
```

### 6.3 Submit flow

`showNicknameModal()` → `saveNickname()` trims the value, stores it in localStorage, hides the modal, then `submitScore(nickname)`. The whole flow is variant-aware via `currentDailyVariant`:

- Aborts with a warning if `db` is null.
- Aborts if `localStorage(dailySubmittedKey(currentDailyVariant, todayStr))` is already `'true'` — that key is `daily_submitted_<date>` for classic and `daily_submitted_wgpo_<date>` for WGPO, so the two variants have **independent** once-per-day locks.
- Writes to `db.collection(dailyScoresCollection(currentDailyVariant))`; on success, set `dailySubmitted = true`, set the variant's localStorage flag, and re-fetch the leaderboard. On failure, log + `showMessage('Error submitting score: ' + e.message)`.

### 6.4 Leaderboard & Past 7 queries

`fetchLeaderboard()` reads `currentDailyVariant`, queries `db.collection(dailyScoresCollection(variant)).where('date','==',todayStr).get()`, and also calls `updateScoreboardHeading(variant)` so the sidebar title matches. On empty result it shows "No scores yet today. Be the first!". Otherwise, it sorts the scores client-side:

- Primary ascending: `green_hints + yellow_hints` (fewer hints is better).
- Secondary: when `secondarySortKey === 'time'`, by `time_seconds` then `guesses`; when `'guesses'` (default), by `guesses` then `time_seconds`.

Renders a `<table class="scoreboard-table">` with columns `# | Name | Guesses | Time | Hints`. The Guesses/Time headers are clickable `.sort-header-btn` buttons (they set `secondarySortKey` and re-render); the active header gets a " ▼" appended. Only the top 10 are shown. Rows whose `nickname` matches the user's stored nickname get the `.my-score` class. If the user's rank is > 10, append `<p class="my-rank">Your rank: #N</p>` below the table.

`escapeHtml(str)` uses the textContent/innerHTML trick for safety when rendering nicknames.

**Past 7** reads from the collection that matches the currently selected `past7Variant` (`daily_scores` for Common, `daily_scores_wgpo` for WGPO). Each `day` built by `initPast7` is tagged with `day.variant` at construction time, and `fetchBestScoreForDay(day)` issues `db.collection(dailyScoresCollection(day.variant)).where('date','==',day.date).get()` — tagging per-day keeps late-arriving results from a prior variant harmless: if the user flips the toggle while fetches are in flight, `past7Days` is rebuilt and the orphaned `day` objects are no longer in the array, so their `day.loaded = true` update silently no-ops against the new grid. Results are sorted **hints → guesses → time**, preferring the first entry with a non-empty `guess_log`. Queries are independent — one failure doesn't block the others; each `fetch` updates only its own card.

Flipping the sub-toggle inside `#past7-section` is handled by `switchPast7Variant(variant)`, which stops any running replay, updates the two buttons' `.active` classes via `updatePast7VariantButtons()`, and calls `initPast7()` again to rebuild the grid for the new variant.

---

## 7. Rules shown in the splash

These are user-facing; reuse the wording verbatim for consistency:

1. All guesses must include the common letter and be a valid WGPO word. The daily puzzle is always seven 7-letter words; in Practice you can play seven 7-letter or eight 8-letter words per game.
2. Guessed letters in the correct position will turn **green**.
3. Guessed letters in incorrect positions will show in **yellow** to the right of the word.
4. **Red** letters below a column indicate that letter is not present in that column.
5. The keyboard blackens out letters that are known to be unnecessary to finish.
6. It is sometimes helpful to guess words to gather letter information.
7. **Green Hint**: Reveals a random unknown letter in its correct position across all words.
8. **Yellow Hint**: Reveals an unguessed letter in yellow for all the words that contain it, without showing its position.

The splash also links to `https://wordgameplayers.org/wgpo-official-words/` as the source of words.

---

## 8. Build script

`scripts/build-words8.mjs` is the only tool script. Run with `node scripts/build-words8.mjs [path/to/WOW24.txt]` (default path `/tmp/WOW24.txt`).

Algorithm:

1. Read the WOW lexicon file; keep only lowercase alphabetic words of length 8 into a `Set` (de-duplicated), then sort alphabetically.
2. Read `en_full.txt` and build a `Map<string, number>` of word → frequency (words are lowercased, frequencies parsed with `parseInt`; lines without 2+ whitespace-separated tokens are skipped).
3. For each word compute:
   - `freq` = frequency map lookup (default 0).
   - `play` = Scrabble "playability" = `sum(log(TILES[ch] || 1))` over its letters, with `TILES` = standard English scrabble distribution: `a:9 b:2 c:2 d:4 e:12 f:2 g:3 h:2 i:9 j:1 k:1 l:4 m:2 n:6 o:8 p:2 q:1 r:6 s:4 t:6 u:4 v:2 w:2 x:1 y:2 z:1` (total 98).
4. Sort the words by `freq` descending, ties alphabetical. Emit `words8.js` as `const WORDS8 = ["...","..."];\n`.
5. Sort the *same* words by `play` descending, ties alphabetical; assign rank 1..N in that order. Emit `scrabble_ranks8.js` as `const SCRABBLE_RANKS8 = [n,n,...];\n` where position i corresponds to `WORDS8[i]`.

Use `fs.writeFileSync` (UTF-8). No external dependencies. `words.js`/`scrabble_ranks.js` for 7-letter words were built by an analogous process (not included in the repo).

---

## 9. Rebuild checklist

To recreate this project from scratch:

1. Create the file layout in §2. No package.json is needed for runtime; add one only if you intend to use the build script under `npm run`.
2. Obtain a WGPO official-words list (7-letter and 8-letter). Obtain an English usage-frequency list (any `word count` text file; the current project uses `en_full.txt` gitignored).
3. Port `scripts/build-words8.mjs` and run it for both lengths (duplicate the file for 7-letter and change `WORDS8` → `WORDS`, length filter from 8 → 7, and output filenames).
4. Write `index.html` exactly as in §3; include the five script tags in the given order.
5. Implement `style.css` following §4's palette and metrics.
6. Implement `script.js` following §5. Pay particular attention to:
   - Lazy loading of the 8-letter lexicon (§5.2) — do **not** preload.
   - Seeded daily RNG (§5.3) using the local date.
   - The two-pass yellow-letter prune (row-local, then global) in `processGuess` and `recomputeYellowLetters`.
   - Keyboard-color priority: **black > cyan (finished but still needed) > yellow > green** — yellow wins ties with green.
   - The timer starts only on the first guess or hint.
   - Fireworks honor `prefers-reduced-motion`.
   - Every valid guess must be appended to both `guesses` and `guessLog` (with elapsed seconds at that moment), and `guess_log` must be included in the Firestore submission payload — otherwise Past 7 replays will appear empty.
   - `pickPuzzle`, `puzzleForDate`, and `puzzleWgpoForDate` must all be pure (no global writes) so Past 7 can derive any past day's letter/secrets for either variant without clobbering the current game. Classic Daily's seed must remain exactly `seedForDateStr(dateStr)` to preserve replay-compatibility with existing `daily_scores` documents.
   - `puzzleWgpoForDate` must pass the classic day's common letter as `excludeLetter` to `pickPuzzle`, guaranteeing the two daily variants never share a letter on the same date.
7. Create a Firebase project, copy the web config into `firebase-config.js`, and add **two** Firestore collections: `daily_scores` (classic Daily) and `daily_scores_wgpo` (Daily WGPO). Apply the same security rules to both. Recommended: allow `read` to anyone, allow `create` when the document schema validates (see §6.2); the client already enforces one submission per user per variant per day via separate `localStorage` flags.
8. Open `index.html` in a browser. No server is required for local play; to persist scores you need to host it somewhere that Firebase allows as an auth domain.

---

## 10. Conventions & style

- Vanilla JS, no build step for runtime. No modules; everything is on `window` globals. Firebase uses the compat SDK (`firebase.*`), not modular.
- Use `document.getElementById` / `document.querySelectorAll` — no framework.
- All data (secret words, board state) is held in module-level `let` variables, not on DOM elements.
- Rendering is *full re-render* after every state change (`renderBoard()` rewrites `#game-board.innerHTML`). This is cheap since the board is ≤64 cells and fine for the UX.
- The on-screen keyboard is the primary input; the hidden `input[inputmode="none"]` is used so mobile Safari doesn't show its own keyboard but we still get focus/selection/caret behavior.
- Error messages use the transient `#message` div with a 3-second clear timer in `showMessage(msg)`.
- `escapeHtml` is used around any user-supplied string (`nickname`) before putting it into `innerHTML`.
- Never block on Firestore: wrap every Firebase call in `try/catch`, degrade gracefully if `db` is null (e.g. "Firebase not configured" message in the scoreboard).
- All event-listener setup in `setupEventListeners` goes through the small `on(id, event, handler)` helper, which null-checks the element and logs a warning instead of throwing. This means a stale cached `index.html` that's missing a newly-added button won't abort the rest of the listener setup — older controls keep working. `switchMode` uses the same null-safe pattern for its `classList.toggle` and `style.display` writes.
