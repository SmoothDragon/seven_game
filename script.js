// Bump this (and the matching ?v= suffixes in index.html) on every release so
// GitHub Pages / browser caches serve the fresh bundle instead of stale JS.
const ASSET_VERSION = '16';

// Global state
let secretWords = [];
let commonLetter = '';
let revealedLetters = Array(7).fill(null).map(() => Array(7).fill(''));
let wrongPositionLetters = Array(7).fill('');
let columnRedLetters = Array(7).fill('');
let guesses = [];
let guessLog = []; // Array of { word, t } where t = elapsed seconds at time of guess
// Ordered timeline of every state-changing move in a daily game — guesses AND
// hints — so the post-game review can reconstruct the board after any move.
// Entries: { type:'guess', word, t } | { type:'green', col, letter, t } | { type:'yellow', letter, t }.
let dailyEvents = [];
let gameOver = false;
let startTime;
let timerInterval;
let greenHintCount = 0;
let yellowHintCount = 0;
let gameMode = 'daily'; // 'daily' | 'daily_wgpo' | 'practice' | 'past7'
let currentDailyVariant = 'common'; // 'common' (classic Daily) | 'wgpo' (Daily Hard — id kept 'wgpo' for backward compatibility with existing daily_scores_wgpo documents)
// Game day this daily session was loaded for. Saves and score submits stay on
// this date even if 1:00 AM Pacific passes while the tab is open.
let activeGameDate = null;
let dailySubmitted = false;
let finalElapsedSeconds = 0;
let paused = false;
let pausedElapsed = 0;
let secondarySortKey = 'guesses'; // 'guesses' or 'time'
let wordLen = 7;
let fireworksTimerId = null;
let fireworksEpoch = 0;

// Daily post-game review ("Review your game") state. Only meaningful once a
// daily puzzle is complete (gameOver === true) and the user has toggled into
// review mode. The review reconstructs the board after the first N timeline
// events into the main #game-board, leaving the live globals untouched.
let dailyReviewMode = false;
let dailyReviewStep = 0; // how many timeline events are currently applied (0..dailyEvents.length)

let words8LexiconLoadPromise = null;

function appendLexiconScript(src) {
    return new Promise((resolve, reject) => {
        const id = `lexicon-${src.replace(/[^a-z0-9._-]/gi, '_')}`;
        const existing = document.getElementById(id);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }
        const s = document.createElement('script');
        s.id = id;
        s.src = src;
        s.async = false;
        s.onload = () => {
            s.dataset.loaded = 'true';
            resolve();
        };
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
}

function ensureWords8LexiconLoaded() {
    if (typeof WORDS8 !== 'undefined' && typeof SCRABBLE_RANKS8 !== 'undefined') {
        return Promise.resolve();
    }
    if (!words8LexiconLoadPromise) {
        words8LexiconLoadPromise = (async () => {
            await appendLexiconScript(`words8.js?v=${ASSET_VERSION}`);
            await appendLexiconScript(`scrabble_ranks8.js?v=${ASSET_VERSION}`);
        })();
    }
    return words8LexiconLoadPromise.catch((err) => {
        words8LexiconLoadPromise = null;
        throw err;
    });
}

function getActiveLexicon() {
    return wordLen === 8 ? WORDS8 : WORDS;
}

function getActiveRanks() {
    return wordLen === 8 ? SCRABBLE_RANKS8 : SCRABBLE_RANKS;
}

function buildColumnFeedbackDom() {
    const cf = document.getElementById('column-feedback');
    cf.innerHTML = '';
    for (let j = 0; j < wordLen; j++) {
        const d = document.createElement('div');
        d.className = 'col-feedback';
        d.id = `col-${j}`;
        cf.appendChild(d);
    }
}

function updateGameTaglineText() {
    const s = document.getElementById('game-tagline-text');
    if (!s) return;
    if (gameMode === 'daily') {
        s.textContent = 'Guess 7-letter words containing the common letter. Find all 7 secret words!';
    } else if (gameMode === 'daily_wgpo') {
        // Uses innerHTML so we can embed the WOW24 hyperlink. All content is static / author-controlled.
        s.innerHTML =
            'Daily Hard — harder puzzle drawn from all ' +
            '<a href="https://wordgameplayers.org/wgpo-official-words/" target="_blank" rel="noopener">WOW24</a>' +
            ' 7-letter words. Find all 7 secret words!';
    } else if (gameMode === 'past7') {
        s.textContent = 'Relive the best solves from the past seven daily puzzles.';
    } else {
        s.textContent = `Guess ${wordLen}-letter words containing the common letter. Find all ${wordLen} secret words!`;
    }
}

function updateCategoryOptionLabels() {
    const sel = document.getElementById('difficulty');
    if (!sel || gameMode !== 'practice') return;
    const n = wordLen;
    sel.options[0].textContent = `Common (5k most common ${n}-letter)`;
    sel.options[1].textContent = `Probable (5k most probable ${n}-letter)`;
    sel.options[2].textContent = `All valid WOW24 ${n}-letter`;
}

function syncGuessInputForWordLen() {
    const input = document.getElementById('guess-input');
    input.maxLength = wordLen;
    input.placeholder = `Enter ${wordLen}-letter word`;
}

// --- Seeded RNG (mulberry32) ---

function mulberry32(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function getDailySeed() {
    return seedForDateStr(getTodayString());
}

function getTodayString() {
    return gameDayString(new Date());
}

let probableWordListCache = null;
let probableWordListCache8 = null;

function getProbableWordList() {
    if (probableWordListCache) return probableWordListCache;
    const indices = WORDS.map((_, i) => i);
    indices.sort((a, b) => SCRABBLE_RANKS[a] - SCRABBLE_RANKS[b]);
    probableWordListCache = indices.slice(0, 5000).map((i) => WORDS[i]);
    return probableWordListCache;
}

function getProbableWordList8() {
    if (probableWordListCache8) return probableWordListCache8;
    const indices = WORDS8.map((_, i) => i);
    indices.sort((a, b) => SCRABBLE_RANKS8[a] - SCRABBLE_RANKS8[b]);
    probableWordListCache8 = indices.slice(0, 5000).map((i) => WORDS8[i]);
    return probableWordListCache8;
}

// --- Timer ---

function updateTimer() {
    if (!startTime || gameOver || paused) return;
    const diff = Math.floor((Date.now() - startTime) / 1000) + pausedElapsed;
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    document.getElementById('timer').textContent = `${m}:${s}`;
}

function startTimerIfNeeded() {
    if (!startTime && !gameOver && !paused) {
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
    }
}

function getElapsedSeconds() {
    if (!startTime) return pausedElapsed;
    return Math.floor((Date.now() - startTime) / 1000) + pausedElapsed;
}

function updateGuessCountDisplay() {
    document.getElementById('guess-count').textContent = guesses.length;
}

function togglePause() {
    if (gameOver) return;
    if (!startTime && !paused) return;

    paused = !paused;
    const btn = document.getElementById('pause-btn');

    if (paused) {
        pausedElapsed += Math.floor((Date.now() - startTime) / 1000);
        startTime = null;
        clearInterval(timerInterval);
        btn.textContent = '▶';
        btn.title = 'Resume';
        document.getElementById('game-board').classList.add('hidden');
        document.getElementById('column-feedback-row').classList.add('hidden');
        document.getElementById('guess-input').disabled = true;
        document.getElementById('guess-btn').disabled = true;
        document.getElementById('green-hint-btn').disabled = true;
        document.getElementById('yellow-hint-btn').disabled = true;
    } else {
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
        btn.textContent = '⏸';
        btn.title = 'Pause';
        document.getElementById('game-board').classList.remove('hidden');
        document.getElementById('column-feedback-row').classList.remove('hidden');
        document.getElementById('guess-input').disabled = false;
        document.getElementById('guess-btn').disabled = false;
        document.getElementById('green-hint-btn').disabled = false;
        document.getElementById('yellow-hint-btn').disabled = false;
        document.getElementById('guess-input').focus();
    }
}

// --- Mode Switching ---

function switchMode(mode) {
    gameMode = mode;

    const toggleActive = (id, on) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', on);
    };
    const setDisplay = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.style.display = value;
    };

    toggleActive('mode-daily', mode === 'daily');
    toggleActive('mode-daily-wgpo', mode === 'daily_wgpo');
    toggleActive('mode-practice', mode === 'practice');
    toggleActive('mode-past7', mode === 'past7');

    const isDaily = mode === 'daily' || mode === 'daily_wgpo';
    setDisplay('controls', mode === 'practice' ? 'flex' : 'none');
    setDisplay('sidebar-history', mode === 'practice' ? 'flex' : 'none');
    setDisplay('sidebar-scoreboard', isDaily ? 'flex' : 'none');

    // Swap between the live play area and the Past 7 section
    const playArea = document.getElementById('game-play-area');
    const past7Section = document.getElementById('past7-section');
    if (mode === 'past7') {
        if (playArea) playArea.style.display = 'none';
        if (past7Section) past7Section.style.display = 'block';
        initPast7();
    } else {
        if (playArea) playArea.style.display = '';
        if (past7Section) past7Section.style.display = 'none';
        if (mode === 'daily') {
            initDailyGame();
        } else if (mode === 'daily_wgpo') {
            initDailyWgpoGame();
        } else {
            initGame();
        }
    }
    updateGameTaglineText();
}

// --- Game Initialization ---

function resetGameState() {
    gameOver = false;
    guesses = [];
    guessLog = [];
    dailyEvents = [];
    dailyReviewMode = false;
    dailyReviewStep = 0;
    revealedLetters = Array(wordLen).fill(null).map(() => Array(wordLen).fill(''));
    wrongPositionLetters = Array(wordLen).fill('');
    columnRedLetters = Array(wordLen).fill('');
    buildColumnFeedbackDom();
    dailySubmitted = false;
    document.getElementById('guess-input').value = '';
    document.getElementById('guess-history').innerHTML = '';
    document.getElementById('daily-guess-history').innerHTML = '';
    document.getElementById('guess-btn').disabled = false;
    
    document.querySelectorAll('.key').forEach(key => {
        key.classList.remove('black', 'green', 'yellow', 'cyan');
    });

    greenHintCount = 0;
    yellowHintCount = 0;
    document.getElementById('green-hint-count').textContent = '0';
    document.getElementById('yellow-hint-count').textContent = '0';
    document.getElementById('green-hint-btn').disabled = false;
    document.getElementById('yellow-hint-btn').disabled = false;

    clearInterval(timerInterval);
    startTime = null;
    paused = false;
    pausedElapsed = 0;
    document.getElementById('timer').textContent = '00:00';
    document.getElementById('pause-btn').textContent = '⏸';
    document.getElementById('pause-btn').title = 'Pause';
    document.getElementById('game-board').classList.remove('hidden');
    document.getElementById('column-feedback-row').classList.remove('hidden');
    document.getElementById('guess-input').disabled = false;
    syncGuessInputForWordLen();
    updateGuessCountDisplay();
    clearFireworksOverlay();
}

/** Positions at which two equal-length words differ (Hamming distance). */
function hammingDistance(a, b) {
    let d = 0;
    const n = a.length;
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) d++;
    }
    return d;
}

/** True iff `word` differs from every string in `others` in at least `minPositions` places. */
function differsFromAllBy(word, others, minPositions) {
    for (let i = 0; i < others.length; i++) {
        if (hammingDistance(word, others[i]) < minPositions) return false;
    }
    return true;
}

/**
 * Daily puzzles before this YYYY-MM-DD keep the original unconstrained picker so Past 7
 * and admin replay still reconstruct the exact secrets that were published that day.
 * From this date on, secret words must pairwise differ in at least two positions.
 */
const PAIRWISE_HAMMING_FROM_DATE = '2026-09-20';

function minSecretHammingForDate(dateStr) {
    return dateStr >= PAIRWISE_HAMMING_FROM_DATE ? 2 : 0;
}

/**
 * Pure puzzle derivation. Returns { letter, secrets } for a given seeded RNG and word list,
 * without touching globals. `excludeLetter` optionally forces a specific letter to be skipped
 * (used so Daily Hard never picks the same common letter as classic Daily on the same date).
 * `minHamming` (default 2) is the minimum number of positions each pair of secrets must
 * differ in — so spelling variants like analyze/analyse cannot both appear. Pass 0 to
 * restore the original unconstrained draw (used for historical daily dates).
 * `excludeWords` (a Set, or null) drops those words from secret selection without
 * removing them from the guess lexicon. Null leaves the draw unchanged.
 */
function pickPuzzle(rng, wordList, wordCount, excludeLetter, minHamming, excludeWords) {
    if (minHamming == null) minHamming = 2;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const indices = Array.from({ length: 26 }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    let letter = null;
    let candidates = [];
    for (const idx of indices) {
        const lt = alphabet[idx];
        if (excludeLetter && lt === excludeLetter) continue;
        const filtered = wordList.filter(w => w.includes(lt));
        if (filtered.length >= 50) {
            letter = lt;
            candidates = filtered;
            break;
        }
    }
    if (letter === null) {
        // Ultra-defensive fallback — should never trigger for 7-letter lists that contain 'e'
        letter = excludeLetter === 'e' ? 'a' : 'e';
        candidates = wordList.filter(w => w.includes(letter));
    }

    const secrets = [];
    const temp = [...candidates];
    const skipped = [];
    while (secrets.length < wordCount && temp.length > 0) {
        const ri = Math.floor(rng() * temp.length);
        const word = temp.splice(ri, 1)[0];
        if (excludeWords && excludeWords.has(word)) continue;
        if (minHamming > 1 && !differsFromAllBy(word, secrets, minHamming)) {
            skipped.push(word);
            continue;
        }
        secrets.push(word);
    }
    // Pathological fallback: fill remaining slots from skipped words (still unique).
    // Excluded words were never added to `skipped`, so they cannot be filled in here.
    while (secrets.length < wordCount && skipped.length > 0) {
        secrets.push(skipped.shift());
    }
    return { letter, secrets };
}

/** Back-compat wrapper that writes results into globals (used by practice mode). */
function pickWordsWithRng(rng, wordList) {
    const result = pickPuzzle(rng, wordList, wordLen, null);
    commonLetter = result.letter;
    secretWords = result.secrets;
}

function dailySubmittedKey(variant, dateStr) {
    return variant === 'wgpo'
        ? `daily_submitted_wgpo_${dateStr}`
        : `daily_submitted_${dateStr}`;
}

function dailyScoresCollection(variant) {
    return variant === 'wgpo' ? 'daily_scores_wgpo' : 'daily_scores';
}

function updateScoreboardHeading(variant) {
    const h = document.querySelector('#sidebar-scoreboard h3');
    if (h) h.textContent = variant === 'wgpo' ? "Today's Tough Top Ten" : "Today's Top Ten";
}

// --- Daily Game Persistence ---
//
// Save in-progress (and finished) daily games to localStorage so that
// closing the browser and revisiting later on the same date restores the
// player to exactly where they left off. Persists per (variant, date) tuple,
// so the two daily variants are tracked independently and old days don't
// collide. Practice mode is intentionally NOT persisted — each Practice game
// is random and disposable.
//
// We store the full computed board state (revealed / yellow / red arrays)
// rather than just the guess history because hints reveal *random* cells,
// so replaying guesses alone would re-roll the hint reveals on every restore.

function dailyStateKey(variant, dateStr) {
    return `seven_sevens_daily_state_${variant === 'wgpo' ? 'wgpo' : 'common'}_${dateStr}`;
}

function saveDailyState() {
    if (gameMode !== 'daily' && gameMode !== 'daily_wgpo') return;
    try {
        const dateStr = activeGameDate || getTodayString();
        const payload = {
            date: dateStr,
            variant: currentDailyVariant,
            commonLetter: commonLetter,
            // Defensive hash so we can detect (and discard) saved state from a
            // previous algorithm version if the same letter happens to be picked
            // but the secret-word selection differs.
            secretWordsHash: secretWords.join(','),
            guesses: [...guesses],
            guessLog: guessLog.map(g => ({ word: g.word, t: Math.max(0, Math.round(g.t)) })),
            events: dailyEvents.map(e => ({ ...e, t: Math.max(0, Math.round(e.t)) })),
            revealedLetters: revealedLetters.map(r => [...r]),
            wrongPositionLetters: [...wrongPositionLetters],
            columnRedLetters: [...columnRedLetters],
            greenHintCount,
            yellowHintCount,
            elapsedSeconds: Math.max(0, Math.round(getElapsedSeconds())),
            finished: gameOver,
            finalElapsedSeconds: gameOver ? Math.max(0, Math.round(finalElapsedSeconds)) : 0,
        };
        localStorage.setItem(dailyStateKey(currentDailyVariant, dateStr), JSON.stringify(payload));
    } catch (e) {
        // QuotaExceededError or JSON failure — non-fatal, the live game continues without saving.
        console.warn('saveDailyState failed:', e && e.message);
    }
}

function loadDailyState(variant, dateStr) {
    try {
        const raw = localStorage.getItem(dailyStateKey(variant, dateStr));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.date !== dateStr || parsed.variant !== variant) return null;
        return parsed;
    } catch (e) {
        console.warn('loadDailyState failed:', e && e.message);
        return null;
    }
}

function discardDailyState(variant, dateStr) {
    try { localStorage.removeItem(dailyStateKey(variant, dateStr)); } catch (e) { /* ignore */ }
}

/**
 * Populate game globals + DOM from a previously-saved daily state object.
 * MUST be called *after* `commonLetter` and `secretWords` are set for the
 * current puzzle (so we can validate the saved state matches the puzzle).
 * Returns true if state was applied, false if it was discarded as stale.
 */
function restoreDailyState(state) {
    const todayStr = activeGameDate || getTodayString();
    // Guard against drift: if commonLetter or the secret-word set has changed
    // since saving (algorithm bump, etc.), discard the stale state and start fresh.
    if (state.commonLetter !== commonLetter || state.secretWordsHash !== secretWords.join(',')) {
        discardDailyState(currentDailyVariant, todayStr);
        return false;
    }

    guesses = Array.isArray(state.guesses) ? [...state.guesses] : [];
    guessLog = Array.isArray(state.guessLog)
        ? state.guessLog.map(g => ({ word: String(g.word || ''), t: Number(g.t) || 0 }))
        : [];
    // Restore the move timeline used by the post-game review. Older saved states
    // (pre-review-feature) won't have `events`; fall back to deriving guess-only
    // events from guessLog, which is exact when no hints were used.
    if (Array.isArray(state.events)) {
        dailyEvents = state.events.map(e => ({ ...e, t: Number(e.t) || 0 }));
    } else {
        dailyEvents = guessLog.map(g => ({ type: 'guess', word: g.word, t: g.t }));
    }
    revealedLetters = Array.isArray(state.revealedLetters)
        ? state.revealedLetters.map(r => Array.isArray(r) ? [...r] : Array(wordLen).fill(''))
        : Array(wordLen).fill(null).map(() => Array(wordLen).fill(''));
    wrongPositionLetters = Array.isArray(state.wrongPositionLetters)
        ? [...state.wrongPositionLetters]
        : Array(wordLen).fill('');
    columnRedLetters = Array.isArray(state.columnRedLetters)
        ? [...state.columnRedLetters]
        : Array(wordLen).fill('');
    greenHintCount = Number(state.greenHintCount) || 0;
    yellowHintCount = Number(state.yellowHintCount) || 0;

    // Restore elapsed time: timer is NOT running on restore. We park the
    // previously-accumulated seconds into `pausedElapsed`; the next guess/hint
    // will call startTimerIfNeeded() which sets startTime=Date.now(), and
    // getElapsedSeconds() correctly adds (now-startTime) on top of pausedElapsed.
    pausedElapsed = Math.max(0, Math.round(Number(state.elapsedSeconds) || 0));
    startTime = null;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    renderTimerFromElapsed(pausedElapsed);

    updateGuessCountDisplay();
    document.getElementById('green-hint-count').textContent = String(greenHintCount);
    document.getElementById('yellow-hint-count').textContent = String(yellowHintCount);

    // Rebuild the daily history list (newest on top — matches live behavior),
    // pulling each guess's timestamp from guessLog.
    const historyList = document.getElementById('daily-guess-history');
    if (historyList) {
        historyList.innerHTML = '';
        guessLog.forEach(g => addGuessToDailyHistoryList(g.word, g.t));
    }

    if (state.finished) {
        gameOver = true;
        finalElapsedSeconds = Number(state.finalElapsedSeconds) || pausedElapsed;
        const btn = document.getElementById('guess-btn');
        if (btn) btn.disabled = true;
    }

    return true;
}

function renderTimerFromElapsed(elapsed) {
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const t = document.getElementById('timer');
    if (t) t.textContent = `${m}:${s}`;
}

function formatElapsedMMSS(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
}

/** Prepend a guess (newest-on-top) to the live "Your Guesses" list, with its
 *  elapsed timestamp. Used during play and when rebuilding from a restored game. */
function addGuessToDailyHistoryList(guess, t) {
    const historyList = document.getElementById('daily-guess-history');
    if (!historyList) return;
    const li = document.createElement('li');
    li.className = 'daily-guess-item';
    const ts = document.createElement('span');
    ts.className = 'guess-ts';
    ts.textContent = formatElapsedMMSS(t);
    const word = document.createElement('span');
    word.className = 'guess-word';
    word.textContent = guess;
    li.appendChild(ts);
    li.appendChild(word);
    const tooltip = document.createElement('div');
    tooltip.className = 'guess-tooltip';
    tooltip.innerHTML = '<em>Loading...</em>';
    li.appendChild(tooltip);
    fetchDefinition(guess, tooltip);
    historyList.prepend(li);
}

function initDailyGame() {
    initDailyVariant('common');
}

function initDailyWgpoGame() {
    initDailyVariant('wgpo');
}

function initDailyVariant(variant) {
    currentDailyVariant = variant;
    wordLen = 7;
    resetGameState();

    const todayStr = getTodayString();
    activeGameDate = todayStr;
    dailySubmitted = localStorage.getItem(dailySubmittedKey(variant, todayStr)) === 'true';

    const puzzle = puzzleForDateVariant(todayStr, variant);
    commonLetter = puzzle.letter;
    secretWords = [...puzzle.secrets];

    document.getElementById('common-letter').textContent = commonLetter.toUpperCase();
    updateScoreboardHeading(variant);

    // Restore any in-progress (or finished) game saved earlier today on this device.
    // Must happen AFTER commonLetter/secretWords are set so the saved state can be
    // validated against the current puzzle. We only update the keyboard colors and
    // re-render once: after the restore, when state is final.
    const saved = loadDailyState(variant, todayStr);
    if (saved) {
        restoreDailyState(saved);
        updateKeyboardColors();
    }

    renderBoard();
    fetchLeaderboard();
    // Set the sidebar to the right view: a restored finished game lands in the
    // completed default view (board + Top Ten); an in-progress game shows only
    // "Your Guesses" with the leaderboard hidden until the puzzle is solved.
    updateDailySidebarView();

    setTimeout(() => {
        const input = document.getElementById('guess-input');
        if (input) input.focus();
    }, 100);
}

async function initGame() {
    const nextLen = parseInt(document.getElementById('practice-word-length').value, 10) || 7;
    const msgEl = document.getElementById('message');

    if (nextLen === 8) {
        msgEl.textContent = 'Loading 8-letter dictionary…';
        try {
            await ensureWords8LexiconLoaded();
        } catch (e) {
            console.error(e);
            msgEl.textContent = '';
            showMessage('Could not load 8-letter dictionary. Check your connection and try again.');
            return;
        }
        msgEl.textContent = '';
    }

    wordLen = nextLen;
    resetGameState();
    updateCategoryOptionLabels();
    updateGameTaglineText();

    const difficulty = document.getElementById('difficulty').value;
    let currentWordList = [];
    if (wordLen === 8) {
        if (difficulty === 'common') {
            currentWordList = WORDS8.slice(0, 5000);
        } else if (difficulty === 'probable') {
            currentWordList = getProbableWordList8();
        } else {
            currentWordList = WORDS8;
        }
    } else {
        if (difficulty === 'common') {
            currentWordList = WORDS.slice(0, 5000);
        } else if (difficulty === 'probable') {
            currentWordList = getProbableWordList();
        } else {
            currentWordList = WORDS;
        }
    }

    pickWordsWithRng(() => Math.random(), currentWordList);

    document.getElementById('common-letter').textContent = commonLetter.toUpperCase();
    renderBoard();
    
    setTimeout(() => {
        document.getElementById('guess-input').focus();
    }, 100);
}

// --- Event Listeners ---

/** Null-safe addEventListener by id. Logs a warning and moves on if the element is missing
 *  (e.g. when users have a stale cached index.html but a fresh script.js). */
function on(id, event, handler) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, handler);
    } else {
        console.warn(`[Seven 7s] #${id} not found — skipping ${event} handler. ` +
            `Your index.html may be stale; try a hard refresh.`);
    }
}

function setupEventListeners() {
    const input = document.getElementById('guess-input');

    on('guess-btn', 'click', handleGuess);
    on('new-game-btn', 'click', initGame);
    on('difficulty', 'change', initGame);
    on('practice-word-length', 'change', initGame);

    on('green-hint-btn', 'click', useGreenHint);
    on('yellow-hint-btn', 'click', useYellowHint);

    // Pause button
    on('pause-btn', 'click', togglePause);

    // Mode toggle
    on('mode-daily', 'click', () => switchMode('daily'));
    on('mode-daily-wgpo', 'click', () => switchMode('daily_wgpo'));
    on('mode-practice', 'click', () => switchMode('practice'));
    on('mode-past7', 'click', () => switchMode('past7'));

    // Past 7 variant toggle (Common vs Hard)
    on('past7-variant-common', 'click', () => switchPast7Variant('common'));
    on('past7-variant-wgpo', 'click', () => switchPast7Variant('wgpo'));

    // Daily post-game review toggle (completed board + Top Ten  <->  move-by-move review)
    on('daily-view-toggle-btn', 'click', toggleDailyView);

    // Past 7 replay controls
    on('past7-back-btn', 'click', backToPast7Grid);
    on('past7-replay-prev', 'click', replayStepBackward);
    on('past7-replay-next', 'click', replayStepForward);

    // Keyboard shortcuts: ↑ / ↓ step through the replay when it's visible. Up goes to
    // the previous guess (earlier in the log), Down to the next (later) — matching the
    // top-to-bottom reading order of the guess list.
    document.addEventListener('keydown', (e) => {
        const replayVisible = gameMode === 'past7'
            && !document.getElementById('past7-replay')?.classList.contains('hidden');
        if (!replayVisible) return;
        if (e.key === 'ArrowUp') { e.preventDefault(); replayStepBackward(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); replayStepForward(); }
    });

    // Keyboard shortcuts for the daily post-game review: ↑ steps to an earlier
    // move (up the chronological list), ↓ to a later move. Matches Past 7's
    // ↓ = next / ↑ = previous convention.
    document.addEventListener('keydown', (e) => {
        const isDaily = gameMode === 'daily' || gameMode === 'daily_wgpo';
        if (!isDaily || !gameOver || !dailyReviewMode) return;
        if (e.key === 'ArrowUp') { e.preventDefault(); jumpDailyReviewTo(dailyReviewStep - 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); jumpDailyReviewTo(dailyReviewStep + 1); }
    });

    // Splash / Rules
    const splash = document.getElementById('splash-overlay');
    if (splash) {
        splash.addEventListener('click', function() {
            splash.classList.add('hidden');
            if (input) input.focus();
        });
    }
    on('rules-link', 'click', function(e) {
        e.preventDefault();
        if (splash) splash.classList.remove('hidden');
    });

    // Nickname modal
    on('nickname-save-btn', 'click', saveNickname);
    on('nickname-input', 'keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveNickname();
        }
    });

    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleGuess();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (gameOver) return;
        if (document.activeElement !== input && /^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            input.focus();
        }
    });

    document.querySelectorAll('.key').forEach(key => {
        key.addEventListener('click', function(e) {
            e.preventDefault();
            if (gameOver) return;
            const char = this.getAttribute('data-key');
            
            if (char === 'Enter') {
                handleGuess();
            } else if (char === 'Backspace') {
                if (input.value.length > 0) {
                    input.value = input.value.slice(0, -1);
                }
            } else {
                if (input.value.length < wordLen) {
                    input.value += char;
                }
            }
            input.focus();
        });
    });
}

// --- Board Rendering ---

function renderBoard() {
    const board = document.getElementById('game-board');
    board.dataset.wordLen = String(wordLen);
    const cfRow = document.getElementById('column-feedback-row');
    if (cfRow) cfRow.dataset.wordLen = String(wordLen);
    board.innerHTML = '';

    for (let i = 0; i < wordLen; i++) {
        const row = document.createElement('div');
        row.className = 'word-row';
        
        let isCompleted = true;

        for (let j = 0; j < wordLen; j++) {
            const box = document.createElement('div');
            box.className = 'letter-box';
            if (revealedLetters[i][j]) {
                box.textContent = revealedLetters[i][j];
                box.classList.add('correct');
            } else {
                isCompleted = false;
            }
            row.appendChild(box);
        }

        if (isCompleted) {
            row.classList.add('completed');
            const tooltip = document.createElement('div');
            tooltip.className = 'def-tooltip';
            tooltip.innerHTML = "<em>Loading definition...</em>";
            row.appendChild(tooltip);
            fetchDefinition(secretWords[i], tooltip);
        }

        const feedback = document.createElement('div');
        feedback.className = 'wrong-position-feedback';
        feedback.innerHTML = wrongPositionLetters[i].split('').map(c => `<span>${c}</span>`).join('');
        row.appendChild(feedback);

        board.appendChild(row);
    }

    for (let j = 0; j < wordLen; j++) {
        const colFeedback = document.getElementById(`col-${j}`);
        colFeedback.innerHTML = columnRedLetters[j].split('').map(c => `<span>${c}</span>`).join('');
    }
}

// --- Messages ---

function showMessage(msg) {
    document.getElementById('message').textContent = msg;
    setTimeout(() => {
        document.getElementById('message').textContent = '';
    }, 3000);
}

// --- Definitions ---

let definitionsCache = {};

async function fetchDefinition(word, tooltipElement) {
    if (wordLen === 8) {
        try {
            await ensureWords8LexiconLoaded();
        } catch (e) {
            console.error(e);
            tooltipElement.innerHTML = `<strong>${word.toUpperCase()}</strong><em> Word list not loaded.</em>`;
            return;
        }
    }
    const list = getActiveLexicon();
    const ranks = getActiveRanks();
    const wordIndex = list.indexOf(word);
    const total = list.length.toLocaleString();
    let rankHtml;
    if (wordIndex < 0) {
        rankHtml = `<div style="font-size:0.85em; color:#666; margin:4px 0;">` +
            `Usage: —<br>Probability: —</div>`;
    } else {
        const usageRank = wordIndex + 1;
        const scrabbleRank = ranks[wordIndex];
        rankHtml = `<div style="font-size:0.85em; color:#666; margin:4px 0;">` +
            `Usage: #${usageRank.toLocaleString()} / ${total}<br>` +
            `Probability: #${scrabbleRank.toLocaleString()} / ${total}</div>`;
    }

    if (definitionsCache[word]) {
        tooltipElement.innerHTML = definitionsCache[word];
        return;
    }

    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        
        let definitionsHtml = `<strong>${word.toUpperCase()}</strong>${rankHtml}`;
        data[0].meanings.forEach(meaning => {
            definitionsHtml += `<em>${meaning.partOfSpeech}</em><ul>`;
            meaning.definitions.slice(0, 2).forEach(def => {
                definitionsHtml += `<li>${def.definition}</li>`;
            });
            definitionsHtml += `</ul>`;
        });
        
        definitionsCache[word] = definitionsHtml;
        tooltipElement.innerHTML = definitionsHtml;
    } catch (e) {
        definitionsCache[word] = `<strong>${word.toUpperCase()}</strong>${rankHtml}<em>Definition not found in dictionary.</em>`;
        tooltipElement.innerHTML = definitionsCache[word];
    }
}

// --- Hints ---

function useGreenHint() {
    if (gameOver) return;
    startTimerIfNeeded();

    let unrevealed = [];
    for (let i = 0; i < wordLen; i++) {
        for (let j = 0; j < wordLen; j++) {
            if (!revealedLetters[i][j]) {
                unrevealed.push({ i, j });
            }
        }
    }

    if (unrevealed.length === 0) return;

    const pick = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    const letter = secretWords[pick.i][pick.j];

    for (let i = 0; i < wordLen; i++) {
        if (secretWords[i][pick.j] === letter) {
            revealedLetters[i][pick.j] = letter;
        }
    }

    greenHintCount++;
    document.getElementById('green-hint-count').textContent = greenHintCount;

    if (gameMode === 'daily' || gameMode === 'daily_wgpo') {
        dailyEvents.push({ type: 'green', col: pick.j, letter, t: getElapsedSeconds() });
    }

    recomputeYellowLetters();
    computeColumnRedLetters();
    updateKeyboardColors();
    renderBoard();
    checkWinCondition();
    saveDailyState();
}

function useYellowHint() {
    if (gameOver) return;
    startTimerIfNeeded();

    let allSecretLetters = new Set();
    for (let word of secretWords) {
        for (let char of word) {
            allSecretLetters.add(char);
        }
    }

    let undiscoveredLetters = [];
    for (let letter of allSecretLetters) {
        let isKnown = false;

        for (let i = 0; i < wordLen; i++) {
            if (wrongPositionLetters[i].includes(letter)) {
                isKnown = true;
                break;
            }
        }

        if (!isKnown) {
            for (let i = 0; i < wordLen; i++) {
                if (revealedLetters[i].includes(letter)) {
                    isKnown = true;
                    break;
                }
            }
        }

        if (!isKnown) {
            undiscoveredLetters.push(letter);
        }
    }

    if (undiscoveredLetters.length === 0) {
        showMessage('No new letters to reveal!');
        return;
    }

    const letter = undiscoveredLetters[Math.floor(Math.random() * undiscoveredLetters.length)];

    for (let i = 0; i < wordLen; i++) {
        if (secretWords[i].includes(letter) && !wrongPositionLetters[i].includes(letter)) {
            wrongPositionLetters[i] += letter;
            wrongPositionLetters[i] = wrongPositionLetters[i].split('').sort().join('');
        }
    }

    yellowHintCount++;
    document.getElementById('yellow-hint-count').textContent = yellowHintCount;

    if (gameMode === 'daily' || gameMode === 'daily_wgpo') {
        dailyEvents.push({ type: 'yellow', letter, t: getElapsedSeconds() });
    }

    computeColumnRedLetters();
    updateKeyboardColors();
    renderBoard();
    saveDailyState();
}

function recomputeYellowLetters() {
    for (let i = 0; i < wordLen; i++) {
        const secretWord = secretWords[i];
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            let countInSecret = secretWord.split('').filter(c => c === char).length;
            let countRevealed = revealedLetters[i].filter(c => c === char).length;
            if (countRevealed < countInSecret) {
                filteredWrongPos += char;
            }
        }
        wrongPositionLetters[i] = filteredWrongPos;
    }

    for (let i = 0; i < wordLen; i++) {
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            let isFullyRevealedGlobally = true;
            for (let w = 0; w < wordLen; w++) {
                let countInSecret = secretWords[w].split('').filter(c => c === char).length;
                let countRevealed = revealedLetters[w].filter(c => c === char).length;
                if (countRevealed < countInSecret) {
                    isFullyRevealedGlobally = false;
                    break;
                }
            }
            if (!isFullyRevealedGlobally) {
                filteredWrongPos += char;
            }
        }
        wrongPositionLetters[i] = filteredWrongPos;
    }
}

// --- Live Guess Logging ---
//
// Every guess made during a *daily* puzzle (classic Daily or Daily Hard) — both
// valid guesses and rejected attempts — is logged to a per-variant Firestore
// collection (`live_guesses` / `live_guesses_wgpo`). Two separate use cases:
//
//   1. The admin page (admin.html) replays a player's full session, including
//      all the words they tried but couldn't enter (lexicon misses, missing
//      common letter, etc.). This requires writes per-guess, not just the
//      one-shot `guess_log` snapshot at submission time.
//
//   2. Building a corpus of "words players tried but aren't in WOW24" — by
//      filtering live_guesses to `reject_reason == 'not_in_lexicon'` and
//      exporting (also via the admin page).
//
// Logging is fire-and-forget: failures are swallowed so a flaky network never
// blocks the live game. Practice mode is intentionally NOT logged (it's
// infinite + local; a single player could rack up huge write volume).

function getOrCreateSessionId() {
    let id = localStorage.getItem('seven_sevens_session_id');
    if (!id) {
        // crypto.randomUUID() exists on all modern browsers; fall back if missing.
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            id = window.crypto.randomUUID();
        } else {
            id = 'sid-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        }
        localStorage.setItem('seven_sevens_session_id', id);
    }
    return id;
}

function liveGuessesCollection(variant) {
    return variant === 'wgpo' ? 'live_guesses_wgpo' : 'live_guesses';
}

/**
 * Fire-and-forget: write one guess to the live_guesses[_wgpo] collection.
 * No-op if Firebase isn't initialized or we're not in a daily mode.
 *
 * @param {string} word  Lowercased word the player tried (may be < wordLen for
 *                        wrong_length rejects; preserved as-typed so the admin
 *                        can see what they actually entered).
 * @param {boolean} valid  True if the guess passed all four validation checks.
 * @param {string|null} rejectReason  null when valid; one of
 *                        'wrong_length' | 'not_in_lexicon' | 'missing_common_letter' | 'duplicate'
 * @param {number} elapsedSeconds  Timer elapsed at moment of guess (0 if timer
 *                        hasn't started yet — common for invalid first attempts).
 */
function logLiveGuess(word, valid, rejectReason, elapsedSeconds) {
    if (gameMode !== 'daily' && gameMode !== 'daily_wgpo') return;
    if (typeof db === 'undefined' || !db) return;

    const variant = currentDailyVariant;
    const nickname = localStorage.getItem('seven_sevens_nickname') || null;
    const payload = {
        date: activeGameDate || getTodayString(),
        variant: variant,
        session_id: getOrCreateSessionId(),
        nickname: nickname,
        word: String(word || ''),
        valid: !!valid,
        reject_reason: rejectReason || null,
        t: Math.max(0, Math.round(elapsedSeconds || 0)),
        client_timestamp: Date.now(),
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    };

    db.collection(liveGuessesCollection(variant)).add(payload).catch((e) => {
        console.warn('logLiveGuess failed:', e && e.message);
    });
}

// --- Guess Handling ---

function handleGuess() {
    if (gameOver) return;
    const input = document.getElementById('guess-input');
    const guess = input.value.toLowerCase().trim();

    const handleError = (msg, reason) => {
        logLiveGuess(guess, false, reason, getElapsedSeconds());
        showMessage(msg);
        input.value = '';
        input.focus();
    };

    if (guess.length !== wordLen) {
        return handleError(`Guess must be exactly ${wordLen} letters.`, 'wrong_length');
    }

    if (!getActiveLexicon().includes(guess)) {
        return handleError('Not a valid word in the list.', 'not_in_lexicon');
    }

    if (!guess.includes(commonLetter)) {
        return handleError(`Word must contain the common letter: ${commonLetter.toUpperCase()}`, 'missing_common_letter');
    }

    if (guesses.includes(guess)) {
        return handleError('You already guessed that word.', 'duplicate');
    }

    startTimerIfNeeded();

    const elapsedAtGuess = getElapsedSeconds();
    logLiveGuess(guess, true, null, elapsedAtGuess);
    guesses.push(guess);
    guessLog.push({ word: guess, t: elapsedAtGuess });
    updateGuessCountDisplay();
    processGuess(guess);
    updateKeyboardColors();

    const isDailyMode = gameMode === 'daily' || gameMode === 'daily_wgpo';
    if (isDailyMode) {
        dailyEvents.push({ type: 'guess', word: guess, t: elapsedAtGuess });
        addGuessToDailyHistoryList(guess, elapsedAtGuess);
    } else {
        const historyList = document.getElementById('guess-history');
        const li = document.createElement('li');
        li.textContent = guess;
        const tooltip = document.createElement('div');
        tooltip.className = 'guess-tooltip';
        tooltip.innerHTML = '<em>Loading...</em>';
        li.appendChild(tooltip);
        fetchDefinition(guess, tooltip);
        historyList.prepend(li);
    }

    input.value = '';
    renderBoard();
    checkWinCondition();
    // Persist for daily modes. Practice is not persisted. checkWinCondition has
    // already flipped gameOver if needed, so this single call covers both the
    // mid-game and end-of-game saves.
    saveDailyState();
    input.focus();
}

function processGuess(guess) {
    for (let i = 0; i < wordLen; i++) {
        const secretWord = secretWords[i];
        for (let j = 0; j < wordLen; j++) {
            if (guess[j] === secretWord[j]) {
                revealedLetters[i][j] = guess[j];
            }
        }
    }

    for (let i = 0; i < wordLen; i++) {
        const secretWord = secretWords[i];
        
        let uniqueGuessedLetters = [...new Set(guess.split(''))];
        for (let char of uniqueGuessedLetters) {
            if (secretWord.includes(char)) {
                if (!wrongPositionLetters[i].includes(char)) {
                    wrongPositionLetters[i] += char;
                }
            }
        }
        
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            let countInSecret = secretWord.split('').filter(c => c === char).length;
            let countRevealed = revealedLetters[i].filter(c => c === char).length;
            
            if (countRevealed < countInSecret) {
                filteredWrongPos += char;
            }
        }
        wrongPositionLetters[i] = filteredWrongPos;
        wrongPositionLetters[i] = wrongPositionLetters[i].split('').sort().join('');
    }

    for (let i = 0; i < wordLen; i++) {
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            let isFullyRevealedGlobally = true;
            for (let w = 0; w < wordLen; w++) {
                let countInSecret = secretWords[w].split('').filter(c => c === char).length;
                let countRevealed = revealedLetters[w].filter(c => c === char).length;
                if (countRevealed < countInSecret) {
                    isFullyRevealedGlobally = false;
                    break;
                }
            }
            
            if (!isFullyRevealedGlobally) {
                filteredWrongPos += char;
            }
        }
        wrongPositionLetters[i] = filteredWrongPos;
    }

    computeColumnRedLetters();
}

function computeColumnRedLetters() {
    columnRedLetters = Array(wordLen).fill('');
    
    for (let j = 0; j < wordLen; j++) {
        let columnComplete = true;
        for (let i = 0; i < wordLen; i++) {
            if (!revealedLetters[i][j]) {
                columnComplete = false;
                break;
            }
        }
        if (columnComplete) continue;

        let guessedInColumn = new Set();
        for (let guess of guesses) {
            guessedInColumn.add(guess[j]);
        }

        for (let letter of guessedInColumn) {
            let isYellowSomewhere = false;
            for (let i = 0; i < wordLen; i++) {
                if (wrongPositionLetters[i].includes(letter)) {
                    isYellowSomewhere = true;
                    break;
                }
            }
            if (!isYellowSomewhere) continue;

            let isCorrectInColumn = false;
            for (let i = 0; i < wordLen; i++) {
                if (secretWords[i][j] === letter) {
                    isCorrectInColumn = true;
                    break;
                }
            }
            
            if (!isCorrectInColumn) {
                if (!columnRedLetters[j].includes(letter)) {
                    columnRedLetters[j] += letter;
                }
            }
        }
        columnRedLetters[j] = columnRedLetters[j].split('').sort().join('');
    }
}

// --- Win Condition ---

const FIREWORKS_TOTAL_MS = 1000;

function clearFireworksOverlay() {
    fireworksEpoch++;
    const overlay = document.getElementById('fireworks-overlay');
    if (fireworksTimerId !== null) {
        clearTimeout(fireworksTimerId);
        fireworksTimerId = null;
    }
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
    }
}

function launchFireworks() {
    const overlay = document.getElementById('fireworks-overlay');
    if (!overlay) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    if (fireworksTimerId !== null) {
        clearTimeout(fireworksTimerId);
        fireworksTimerId = null;
    }

    fireworksEpoch++;
    const myEpoch = fireworksEpoch;

    overlay.classList.remove('hidden');
    overlay.innerHTML = '';

    const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#e599f7', '#ffffff', '#22d3ee'];
    const burstCount = 6;
    const burstInterval = 80;

    for (let b = 0; b < burstCount; b++) {
        setTimeout(() => {
            if (myEpoch !== fireworksEpoch) return;
            const x = 12 + Math.random() * 76;
            const y = 12 + Math.random() * 76;
            const particleCount = 28;
            const burst = document.createElement('div');
            burst.className = 'firework-burst';
            burst.style.left = `${x}%`;
            burst.style.top = `${y}%`;
            overlay.appendChild(burst);

            for (let i = 0; i < particleCount; i++) {
                const angle = (i / particleCount) * Math.PI * 2 + Math.random() * 0.35;
                const dist = 28 + Math.random() * 40;
                const p = document.createElement('div');
                p.className = 'firework-particle';
                p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
                p.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
                p.style.background = colors[Math.floor(Math.random() * colors.length)];
                burst.appendChild(p);
            }

            setTimeout(() => {
                if (myEpoch === fireworksEpoch && burst.parentNode) {
                    burst.remove();
                }
            }, 450);
        }, b * burstInterval);
    }

    fireworksTimerId = setTimeout(() => {
        if (myEpoch !== fireworksEpoch) {
            fireworksTimerId = null;
            return;
        }
        overlay.classList.add('hidden');
        overlay.innerHTML = '';
        fireworksTimerId = null;
    }, FIREWORKS_TOTAL_MS);
}

function checkWinCondition() {
    let allRevealed = true;
    for (let i = 0; i < wordLen; i++) {
        for (let j = 0; j < wordLen; j++) {
            if (!revealedLetters[i][j]) {
                allRevealed = false;
                break;
            }
        }
    }

    if (allRevealed) {
        finalElapsedSeconds = getElapsedSeconds();
        gameOver = true;
        clearInterval(timerInterval);
        document.getElementById('guess-btn').disabled = true;

        launchFireworks();

        const isDailyMode = gameMode === 'daily' || gameMode === 'daily_wgpo';
        if (isDailyMode) {
            // Reveal the completed-board + Top Ten view and the "Review your game" toggle.
            dailyReviewMode = false;
            updateDailySidebarView();
        }
        if (isDailyMode && !dailySubmitted) {
            showNicknameModal();
        } else {
            showMessage(`Congratulations! You found all ${wordLen} words!`);
        }
    }
}

// --- Keyboard Colors ---

/** True if some word row containing `char` still has at least one unrevealed cell (word not finished). */
function incompleteWordRowContainsChar(char) {
    for (let i = 0; i < wordLen; i++) {
        if (!secretWords[i].includes(char)) continue;
        for (let j = 0; j < wordLen; j++) {
            if (!revealedLetters[i][j]) {
                return true;
            }
        }
    }
    return false;
}

function updateKeyboardColors() {
    const keys = document.querySelectorAll('.key');
    
    keys.forEach(key => {
        const char = key.getAttribute('data-key');
        if (!char || char.length > 1) return;
        
        let hasBeenGuessed = guesses.some(g => g.includes(char));
        if (!hasBeenGuessed) return;

        let existsInAnyWord = secretWords.some(w => w.includes(char));
        
        if (!existsInAnyWord) {
            key.classList.remove('black', 'green', 'yellow', 'cyan');
            key.classList.add('black');
            return;
        }

        let allRevealed = true;
        for (let i = 0; i < wordLen; i++) {
            for (let j = 0; j < wordLen; j++) {
                if (secretWords[i][j] === char && revealedLetters[i][j] !== char) {
                    allRevealed = false;
                    break;
                }
            }
            if (!allRevealed) break;
        }

        if (allRevealed) {
            key.classList.remove('black', 'green', 'yellow', 'cyan');
            if (incompleteWordRowContainsChar(char)) {
                key.classList.add('cyan');
            } else {
                key.classList.add('black');
            }
            return;
        }

        let isGreen = false;
        let isYellow = false;

        for (let guess of guesses) {
            for (let j = 0; j < wordLen; j++) {
                if (guess[j] === char) {
                    for (let i = 0; i < wordLen; i++) {
                        if (secretWords[i].includes(char)) {
                            if (secretWords[i][j] === char) {
                                isGreen = true;
                            } else {
                                isYellow = true;
                            }
                        }
                    }
                }
            }
        }

        key.classList.remove('black', 'green', 'yellow', 'cyan');
        if (isYellow) {
            key.classList.add('yellow');
        } else if (isGreen) {
            key.classList.add('green');
        }
    });
}

// --- Nickname Modal ---

function showNicknameModal() {
    const modal = document.getElementById('nickname-modal');
    const input = document.getElementById('nickname-input');
    const saved = localStorage.getItem('seven_sevens_nickname') || '';
    input.value = saved;
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);
}

async function saveNickname() {
    const input = document.getElementById('nickname-input');
    const nickname = input.value.trim();
    
    if (!nickname) {
        input.style.borderColor = 'red';
        return;
    }
    
    localStorage.setItem('seven_sevens_nickname', nickname);
    document.getElementById('nickname-modal').classList.add('hidden');
    
    const success = await submitScore(nickname);
    if (success) {
        showMessage('Congratulations! Score submitted!');
    }
}

// --- Firebase Score Submission ---

async function submitScore(nickname) {
    if (!db) {
        console.warn("Firebase not available. Score not submitted.");
        showMessage("Scoreboard unavailable — Firebase not connected.");
        return false;
    }

    const variant = currentDailyVariant;
    const todayStr = activeGameDate || getTodayString();
    const submittedKey = dailySubmittedKey(variant, todayStr);

    if (localStorage.getItem(submittedKey) === 'true') {
        showMessage('You already submitted a score today!');
        return false;
    }

    const scoreData = {
        date: todayStr,
        nickname: nickname,
        time_seconds: finalElapsedSeconds,
        guesses: guesses.length,
        green_hints: greenHintCount,
        yellow_hints: yellowHintCount,
        total_hints: greenHintCount + yellowHintCount,
        guess_log: guessLog.map(g => ({ word: g.word, t: Math.max(0, Math.round(g.t)) })),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection(dailyScoresCollection(variant)).add(scoreData);

        dailySubmitted = true;
        localStorage.setItem(submittedKey, 'true');

        fetchLeaderboard();
        return true;
    } catch (e) {
        console.error("Error submitting score:", e);
        showMessage("Error submitting score: " + e.message);
        return false;
    }
}

// --- Leaderboard ---

/** Sort a copy of the scores: primary = fewest hints, secondary = guesses/time
 *  (per `secondaryKey`). Shared by the live scoreboard and the Past 7 panel. */
function sortLeaderboardScores(scores, secondaryKey) {
    const arr = [...scores];
    arr.sort((a, b) => {
        const hintsA = (a.green_hints || 0) + (a.yellow_hints || 0);
        const hintsB = (b.green_hints || 0) + (b.yellow_hints || 0);
        if (hintsA !== hintsB) return hintsA - hintsB;

        if (secondaryKey === 'time') {
            if ((a.time_seconds || 0) !== (b.time_seconds || 0)) return (a.time_seconds || 0) - (b.time_seconds || 0);
            return (a.guesses || 0) - (b.guesses || 0);
        }
        if ((a.guesses || 0) !== (b.guesses || 0)) return (a.guesses || 0) - (b.guesses || 0);
        return (a.time_seconds || 0) - (b.time_seconds || 0);
    });
    return arr;
}

/**
 * Render a scoreboard table (identical columns/sort to the daily puzzle page)
 * into `container`. Shared by the live daily scoreboard and the Past 7
 * "yesterday" panel so the two never drift.
 *
 * opts:
 *   secondaryKey   'guesses' | 'time' — current secondary sort
 *   myNickname     string — highlight + "your rank" line
 *   onSortChange   fn(key) — called when a Guesses/Time header is clicked
 *   getRowReplay   fn(score) -> handler|null — if it returns a fn, that row is
 *                  made clickable (a replayable solve); Past 7 only
 */
function renderScoreboardInto(container, scores, opts) {
    if (!container) return;
    const secondaryKey = opts.secondaryKey || 'guesses';
    const myNickname = opts.myNickname || '';
    const sorted = sortLeaderboardScores(scores, secondaryKey);

    let myRank = -1;
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].nickname === myNickname) { myRank = i + 1; break; }
    }

    const guessArrow = secondaryKey === 'guesses' ? ' ▼' : '';
    const timeArrow = secondaryKey === 'time' ? ' ▼' : '';
    let html = '<table class="scoreboard-table">';
    html += '<thead><tr><th>#</th><th>Name</th>' +
        `<th><button class="sort-header-btn" data-sort="guesses">Guesses${guessArrow}</button></th>` +
        `<th><button class="sort-header-btn" data-sort="time">Time${timeArrow}</button></th>` +
        '<th>Hints</th></tr></thead><tbody>';

    const top10 = sorted.slice(0, 10);
    top10.forEach((score, idx) => {
        const rank = idx + 1;
        const isMe = score.nickname === myNickname;
        const m = String(Math.floor((score.time_seconds || 0) / 60)).padStart(2, '0');
        const s = String((score.time_seconds || 0) % 60).padStart(2, '0');
        const replayable = opts.getRowReplay && opts.getRowReplay(score);
        const cls = [isMe ? 'my-score' : '', replayable ? 'lb-replayable' : ''].filter(Boolean).join(' ');
        html += `<tr class="${cls}">`;
        html += `<td>${rank}</td>`;
        html += `<td>${escapeHtml(score.nickname)}</td>`;
        html += `<td>${score.guesses}</td>`;
        html += `<td>${m}:${s}</td>`;
        html += `<td>${(score.green_hints || 0) + (score.yellow_hints || 0)}</td>`;
        html += `</tr>`;
    });
    html += '</tbody></table>';
    if (myRank > 10) html += `<p class="my-rank">Your rank: #${myRank}</p>`;

    container.innerHTML = html;

    container.querySelectorAll('.sort-header-btn').forEach((btn) => {
        btn.addEventListener('click', () => { if (opts.onSortChange) opts.onSortChange(btn.dataset.sort); });
    });

    if (opts.getRowReplay) {
        const rows = container.querySelectorAll('tbody tr');
        top10.forEach((score, idx) => {
            const handler = opts.getRowReplay(score);
            if (handler && rows[idx]) {
                rows[idx].addEventListener('click', handler);
                rows[idx].title = 'Replay this solve';
            }
        });
    }
}

async function fetchLeaderboard() {
    const container = document.getElementById('scoreboard-list');
    if (!container) return;

    if (!db) {
        container.innerHTML = '<p style="text-align:center; color:#888; font-size:0.9em;">Firebase not configured.<br>Set up firebase-config.js to enable the scoreboard.</p>';
        return;
    }
    
    container.innerHTML = '<p style="text-align:center; color:#888;">Loading...</p>';

    const variant = currentDailyVariant;
    const todayStr = activeGameDate || getTodayString();
    const myNickname = localStorage.getItem('seven_sevens_nickname') || '';

    try {
        const snapshot = await db.collection(dailyScoresCollection(variant))
            .where('date', '==', todayStr)
            .get();
        
        if (snapshot.empty) {
            container.innerHTML = '<p style="text-align:center; color:#888;">No scores yet today. Be the first!</p>';
            return;
        }

        const scores = [];
        snapshot.forEach(doc => scores.push(doc.data()));

        renderScoreboardInto(container, scores, {
            secondaryKey: secondarySortKey,
            myNickname,
            onSortChange: (k) => { secondarySortKey = k; fetchLeaderboard(); },
        });
    } catch (e) {
        console.error("Error fetching leaderboard:", e);
        const detail = e && e.message ? ` (${e.message})` : '';
        container.innerHTML =
            '<p style="text-align:center; color:#888;">Could not load scoreboard.' +
            escapeHtml(detail) +
            '</p>';
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Daily Post-Game Review ---
//
// After a daily puzzle is complete the sidebar offers two views:
//   1. Default: completed board (main area) + "Today's Top Ten" leaderboard.
//   2. Review:  step through the player's own game move-by-move, drawn into the
//               main #game-board with diff highlights + ghost letters, exactly
//               like the Past 7 viewer but for the player's own solve.
//
// The review reconstructs board state from `dailyEvents` (guesses AND hints, in
// order) so hint-revealed cells appear at the right step. It never mutates the
// live globals — exiting review simply re-renders the final board from them.

/** Build a fresh 7×7 review board accumulator. */
function newDailyReviewBoard() {
    return {
        revealed: Array(wordLen).fill(null).map(() => Array(wordLen).fill('')),
        wrongPos: Array(wordLen).fill(''),
        columnReds: Array(wordLen).fill(''),
        guessesApplied: [],
    };
}

/** Re-prune a board's yellow letters (row-local then global), mirroring recomputeYellowLetters. */
function dailyReviewRecomputeYellows(board) {
    for (let i = 0; i < wordLen; i++) {
        const sw = secretWords[i];
        let filtered = '';
        for (const ch of board.wrongPos[i]) {
            const inSecret = sw.split('').filter(c => c === ch).length;
            const revealed = board.revealed[i].filter(c => c === ch).length;
            if (revealed < inSecret) filtered += ch;
        }
        board.wrongPos[i] = filtered;
    }
    for (let i = 0; i < wordLen; i++) {
        let filtered = '';
        for (const ch of board.wrongPos[i]) {
            let globally = true;
            for (let w = 0; w < wordLen; w++) {
                const inSecret = secretWords[w].split('').filter(c => c === ch).length;
                const revealed = board.revealed[w].filter(c => c === ch).length;
                if (revealed < inSecret) { globally = false; break; }
            }
            if (!globally) filtered += ch;
        }
        board.wrongPos[i] = filtered;
    }
}

/** Recompute column reds, mirroring computeColumnRedLetters but on a review board. */
function dailyReviewRecomputeReds(board) {
    board.columnReds = Array(wordLen).fill('');
    for (let j = 0; j < wordLen; j++) {
        let allRevealed = true;
        for (let i = 0; i < wordLen; i++) {
            if (!board.revealed[i][j]) { allRevealed = false; break; }
        }
        if (allRevealed) continue;

        const guessedInCol = new Set();
        for (const g of board.guessesApplied) guessedInCol.add(g[j]);

        for (const letter of guessedInCol) {
            let isYellowSomewhere = false;
            for (let i = 0; i < wordLen; i++) {
                if (board.wrongPos[i].includes(letter)) { isYellowSomewhere = true; break; }
            }
            if (!isYellowSomewhere) continue;

            let isCorrectInCol = false;
            for (let i = 0; i < wordLen; i++) {
                if (secretWords[i][j] === letter) { isCorrectInCol = true; break; }
            }
            if (!isCorrectInCol && !board.columnReds[j].includes(letter)) {
                board.columnReds[j] += letter;
            }
        }
        board.columnReds[j] = board.columnReds[j].split('').sort().join('');
    }
}

/** Apply one timeline event to the review board, mirroring the live handlers. */
function applyDailyReviewEvent(board, ev) {
    if (ev.type === 'guess') {
        const guess = ev.word;
        board.guessesApplied.push(guess);
        for (let i = 0; i < wordLen; i++) {
            const sw = secretWords[i];
            for (let j = 0; j < wordLen; j++) {
                if (guess[j] === sw[j]) board.revealed[i][j] = guess[j];
            }
        }
        for (let i = 0; i < wordLen; i++) {
            const sw = secretWords[i];
            const uniq = [...new Set(guess.split(''))];
            for (const ch of uniq) {
                if (sw.includes(ch) && !board.wrongPos[i].includes(ch)) board.wrongPos[i] += ch;
            }
            board.wrongPos[i] = board.wrongPos[i].split('').sort().join('');
        }
        dailyReviewRecomputeYellows(board);
        dailyReviewRecomputeReds(board);
    } else if (ev.type === 'green') {
        for (let i = 0; i < wordLen; i++) {
            if (secretWords[i][ev.col] === ev.letter) board.revealed[i][ev.col] = ev.letter;
        }
        dailyReviewRecomputeYellows(board);
        dailyReviewRecomputeReds(board);
    } else if (ev.type === 'yellow') {
        for (let i = 0; i < wordLen; i++) {
            if (secretWords[i].includes(ev.letter) && !board.wrongPos[i].includes(ev.letter)) {
                board.wrongPos[i] += ev.letter;
                board.wrongPos[i] = board.wrongPos[i].split('').sort().join('');
            }
        }
        dailyReviewRecomputeReds(board);
    }
}

function dailyReviewSnapshot(board) {
    return {
        revealed: board.revealed.map(r => r.slice()),
        wrongPos: [...board.wrongPos],
        columnReds: [...board.columnReds],
    };
}

function dailyReviewDiff(before, after) {
    const newGreens = new Set();
    const newYellows = new Set();
    const newReds = new Set();
    for (let r = 0; r < wordLen; r++) for (let c = 0; c < wordLen; c++) {
        if (!before.revealed[r][c] && after.revealed[r][c]) newGreens.add(`${r},${c}`);
    }
    for (let r = 0; r < wordLen; r++) {
        const prev = new Set(before.wrongPos[r].split(''));
        for (const ch of after.wrongPos[r]) if (!prev.has(ch)) newYellows.add(`${r},${ch}`);
    }
    for (let c = 0; c < wordLen; c++) {
        const prev = new Set(before.columnReds[c].split(''));
        for (const ch of after.columnReds[c]) if (!prev.has(ch)) newReds.add(`${c},${ch}`);
    }
    return { newGreens, newYellows, newReds };
}

/** Reconstruct board state after the first `step` events. Returns
 *  { board, diff, ghostWord } where diff/ghostWord describe the last applied event. */
function buildDailyReviewState(step) {
    const board = newDailyReviewBoard();
    let diff = null;
    let ghostWord = null;
    for (let k = 0; k < step; k++) {
        const ev = dailyEvents[k];
        if (!ev) continue;
        const isLast = (k === step - 1);
        const before = isLast ? dailyReviewSnapshot(board) : null;
        applyDailyReviewEvent(board, ev);
        if (isLast) {
            const after = dailyReviewSnapshot(board);
            diff = dailyReviewDiff(before, after);
            ghostWord = ev.type === 'guess' ? ev.word : null;
        }
    }
    return { board, diff, ghostWord };
}

/** Render the review board for the current dailyReviewStep into #game-board. */
function renderDailyReviewBoard() {
    const { board, diff, ghostWord } = buildDailyReviewState(dailyReviewStep);
    const boardEl = document.getElementById('game-board');
    if (!boardEl) return;
    boardEl.dataset.wordLen = String(wordLen);
    boardEl.innerHTML = '';

    const guessChars = ghostWord ? ghostWord.split('') : null;

    for (let i = 0; i < wordLen; i++) {
        const row = document.createElement('div');
        row.className = 'word-row';
        let isCompleted = true;

        for (let j = 0; j < wordLen; j++) {
            const box = document.createElement('div');
            box.className = 'letter-box';
            if (board.revealed[i][j]) {
                box.textContent = board.revealed[i][j];
                box.classList.add('correct');
                if (diff && diff.newGreens.has(`${i},${j}`)) box.classList.add('diff-new');
            } else {
                isCompleted = false;
                if (guessChars && guessChars[j]) {
                    box.textContent = guessChars[j];
                    box.classList.add('replay-ghost');
                }
            }
            row.appendChild(box);
        }

        if (isCompleted) {
            row.classList.add('completed');
            const tooltip = document.createElement('div');
            tooltip.className = 'def-tooltip';
            tooltip.innerHTML = '<em>Loading definition...</em>';
            row.appendChild(tooltip);
            fetchDefinition(secretWords[i], tooltip);
        }

        const feedback = document.createElement('div');
        feedback.className = 'wrong-position-feedback';
        feedback.innerHTML = board.wrongPos[i].split('').map(c => {
            const isNew = diff && diff.newYellows.has(`${i},${c}`);
            return `<span class="${isNew ? 'diff-new' : ''}">${c}</span>`;
        }).join('');
        row.appendChild(feedback);

        boardEl.appendChild(row);
    }

    for (let j = 0; j < wordLen; j++) {
        const colFeedback = document.getElementById(`col-${j}`);
        if (!colFeedback) continue;
        colFeedback.innerHTML = board.columnReds[j].split('').map(c => {
            const isNew = diff && diff.newReds.has(`${j},${c}`);
            return `<span class="${isNew ? 'diff-new' : ''}">${c}</span>`;
        }).join('');
    }
}

/** Rebuild the sidebar list as the full move timeline (oldest first), for review mode. */
function renderDailyReviewList() {
    const logEl = document.getElementById('daily-guess-history');
    if (!logEl) return;
    logEl.innerHTML = '';

    dailyEvents.forEach((ev, k) => {
        const step = k + 1;
        const li = document.createElement('li');
        li.className = 'daily-guess-item reviewable';
        li.dataset.step = String(step);
        if (step === dailyReviewStep) li.classList.add('current-step');

        const ts = document.createElement('span');
        ts.className = 'guess-ts';
        ts.textContent = formatElapsedMMSS(ev.t);
        li.appendChild(ts);

        const label = document.createElement('span');
        if (ev.type === 'guess') {
            label.className = 'guess-word';
            label.textContent = ev.word;
        } else if (ev.type === 'green') {
            li.classList.add('hint-entry');
            label.className = 'guess-hint-label';
            label.textContent = `Green hint · ${ev.letter.toUpperCase()}`;
        } else if (ev.type === 'yellow') {
            li.classList.add('hint-entry');
            label.className = 'guess-hint-label';
            label.textContent = `Yellow hint · ${ev.letter.toUpperCase()}`;
        }
        li.appendChild(label);

        li.addEventListener('click', () => jumpDailyReviewTo(step));
        logEl.appendChild(li);
    });
}

/** Jump the review to the state after `step` events (clamped), re-render board + list. */
function jumpDailyReviewTo(step) {
    dailyReviewStep = Math.max(0, Math.min(step, dailyEvents.length));
    renderDailyReviewBoard();
    // Update current-step highlight without rebuilding the whole list.
    const logEl = document.getElementById('daily-guess-history');
    if (logEl) {
        logEl.querySelectorAll('.daily-guess-item').forEach(li => {
            const isCurrent = Number(li.dataset.step) === dailyReviewStep;
            li.classList.toggle('current-step', isCurrent);
            if (isCurrent) li.scrollIntoView({ block: 'nearest' });
        });
    }
}

/** Toggle between the completed-board+leaderboard view and the move-by-move review. */
function toggleDailyView() {
    if (!gameOver) return;
    dailyReviewMode = !dailyReviewMode;

    if (dailyReviewMode) {
        // Enter review at the first move so it visibly differs from the completed board.
        renderDailyReviewList();
        jumpDailyReviewTo(dailyEvents.length > 0 ? 1 : 0); // renders board + syncs highlight
    } else {
        // Exit review: restore the final board from the (untouched) live globals.
        renderBoard();
    }
    updateDailySidebarView();
}

/**
 * Single source of truth for the daily sidebar layout. Three states:
 *   - playing (not gameOver): hide leaderboard + toggle button, show Your Guesses.
 *   - complete, default view: show toggle ("Review your game") + leaderboard, hide guesses.
 *   - complete, review view:  show toggle ("Today's Top Ten") + guesses (interactive), hide leaderboard.
 * No-op outside daily modes.
 */
function updateDailySidebarView() {
    const isDaily = gameMode === 'daily' || gameMode === 'daily_wgpo';
    if (!isDaily) return;

    const toggleBtn = document.getElementById('daily-view-toggle-btn');
    const scoreboardBlock = document.getElementById('scoreboard-block');
    const historySection = document.getElementById('daily-history-section');
    const reviewHint = document.getElementById('daily-review-hint');
    const historyTitle = document.getElementById('daily-history-title');

    const setShown = (el, shown) => { if (el) el.classList.toggle('hidden', !shown); };

    if (!gameOver) {
        setShown(toggleBtn, false);
        setShown(scoreboardBlock, false);
        setShown(historySection, true);
        setShown(reviewHint, false);
        if (historyTitle) historyTitle.textContent = 'Your Guesses';
        return;
    }

    setShown(toggleBtn, true);
    if (dailyReviewMode) {
        if (toggleBtn) toggleBtn.textContent = 'Today\u2019s Top Ten';
        setShown(scoreboardBlock, false);
        setShown(historySection, true);
        setShown(reviewHint, true);
        if (historyTitle) historyTitle.textContent = 'Your Game';
    } else {
        if (toggleBtn) toggleBtn.textContent = 'Review your game';
        setShown(scoreboardBlock, true);
        setShown(historySection, false);
        setShown(reviewHint, false);
    }
}

// --- Past 7 Mode ---

let past7Variant = 'common'; // 'common' | 'wgpo' — which daily flavor the Past 7 grid is showing
let past7AnchorDate = null; // game day the current Past 7 grid was built from
let past7Days = []; // [{ date, letter, secrets, bestScore, ... }]; index 0 = yesterday
// Secondary sort for yesterday's full Top Ten panel (mirrors secondarySortKey on the live board).
let past7LeaderboardSortKey = 'guesses';
let replaySecrets = [];
let replayCommon = '';
let replayRevealed = null;
let replayWrongPos = null;
let replayColumnReds = null;
let replayGuesses = [];
let replayLog = [];
let replayStep = 0;
// Cells/letters produced by the current step (step N). Used to highlight what
// changed on the board with the most recently played guess. Null when replayStep === 0.
let replayDiff = null; // { newGreens: Set<"r,c">, newYellows: Set<"r,letter">, newReds: Set<"c,letter">, guessWord: string }
let currentReplayDayIdx = -1;

function past7Dates() {
    const today = getTodayString();
    const arr = [];
    for (let i = 1; i <= 7; i++) arr.push(shiftGameDay(today, -i));
    return arr;
}

function seedForDateStr(dateStr) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

/**
 * Pure: derive the classic "Daily" puzzle (Common 5k list) for a given YYYY-MM-DD
 * without touching globals. Seed = hash of dateStr (unchanged — do not break the
 * replay of older daily_scores documents).
 */
function puzzleForDate(dateStr) {
    const rng = mulberry32(seedForDateStr(dateStr));
    return pickPuzzle(
        rng, WORDS.slice(0, 5000), 7, null,
        minSecretHammingForDate(dateStr), offensiveSecretsForDate(dateStr)
    );
}

/**
 * Pure: derive the "Daily Hard" puzzle for a given YYYY-MM-DD. Uses the full
 * WGPO 7-letter list, a different seed (date + ':wgpo') so the alphabet shuffle
 * differs from classic, and **excludes** the classic daily's common letter so
 * the two puzzles are guaranteed to have different common letters every day.
 * (Internal identifier kept as `wgpo` for backward compatibility with the
 * existing `daily_scores_wgpo` Firestore collection; user-facing label is "Daily Hard".)
 */
function puzzleWgpoForDate(dateStr) {
    const classic = puzzleForDate(dateStr);
    const rng = mulberry32(seedForDateStr(dateStr + ':wgpo'));
    return pickPuzzle(
        rng, WORDS, 7, classic.letter,
        minSecretHammingForDate(dateStr), offensiveSecretsForDate(dateStr)
    );
}

function puzzleForDateVariant(dateStr, variant) {
    return variant === 'wgpo' ? puzzleWgpoForDate(dateStr) : puzzleForDate(dateStr);
}

function updatePast7VariantButtons() {
    const c = document.getElementById('past7-variant-common');
    const w = document.getElementById('past7-variant-wgpo');
    if (c) c.classList.toggle('active', past7Variant === 'common');
    if (w) w.classList.toggle('active', past7Variant === 'wgpo');
}

function switchPast7Variant(variant) {
    if (past7Variant === variant) return;
    past7Variant = variant;
    updatePast7VariantButtons();
    initPast7();
}

function initPast7() {
    past7AnchorDate = getTodayString();
    currentReplayDayIdx = -1;
    replayDiff = null;

    document.getElementById('past7-replay').classList.add('hidden');
    document.getElementById('past7-grid').classList.remove('hidden');
    updatePast7VariantButtons();

    const variant = past7Variant;
    const dates = past7Dates();
    past7Days = dates.map(d => {
        const { letter, secrets } = puzzleForDateVariant(d, variant);
        return { date: d, letter, secrets, bestScore: null, loaded: false, variant };
    });

    renderPast7Grid();

    if (!db) {
        past7Days.forEach(day => { day.loaded = true; day.leaderboardLoaded = true; });
        renderPast7Grid();
        return;
    }
    // Yesterday (index 0) shows the full Top Ten; the other six days show a
    // best-solve card each.
    if (past7Days[0]) fetchPast7Leaderboard(past7Days[0]);
    for (let i = 1; i < past7Days.length; i++) fetchBestScoreForDay(past7Days[i]);
}

async function fetchPast7Leaderboard(day) {
    // Fetch every score for `day` so we can render its full leaderboard, exactly
    // like the live puzzle page. Variant-tagged: if the user flips the toggle
    // mid-fetch, past7Days is rebuilt and this stale `day` is dropped, so the
    // update below harmlessly writes to an orphaned object.
    try {
        const snap = await db.collection(dailyScoresCollection(day.variant))
            .where('date', '==', day.date).get();
        const scores = [];
        snap.forEach(doc => scores.push(doc.data()));
        day.leaderboardScores = scores;
    } catch (e) {
        console.error('Error fetching leaderboard for', day.date, e);
        day.leaderboardError = (e && e.message) || 'unknown error';
    } finally {
        day.leaderboardLoaded = true;
        renderPast7Grid();
    }
}

/** A leaderboard row is replayable only if it's a clean (zero-hint) solve that
 *  saved a guess log — the Past 7 replay engine reconstructs from guesses only. */
function isCleanReplayableScore(score) {
    const hints = (score.green_hints || 0) + (score.yellow_hints || 0);
    return hints === 0 && Array.isArray(score.guess_log) && score.guess_log.length > 0;
}

async function fetchBestScoreForDay(day) {
    // Each `day` object is tagged with its variant at build time. If the user flips
    // the Past 7 variant toggle mid-fetch, past7Days is replaced wholesale and this
    // stale `day` is no longer in the array — updating it is a harmless no-op.
    try {
        const snap = await db.collection(dailyScoresCollection(day.variant))
            .where('date', '==', day.date).get();
        if (!snap.empty) {
            // Only consider solves that used **zero hints** (no green hints, no yellow hints).
            // Among those, rank by fewest guesses, with fastest time as the tiebreaker.
            const zeroHintScores = [];
            snap.forEach(doc => {
                const s = doc.data();
                const totalHints = (s.green_hints || 0) + (s.yellow_hints || 0);
                if (totalHints === 0) zeroHintScores.push(s);
            });
            zeroHintScores.sort((a, b) => {
                if (a.guesses !== b.guesses) return a.guesses - b.guesses;
                return (a.time_seconds || 0) - (b.time_seconds || 0);
            });
            // Prefer the best-ranked zero-hint score that has a replayable guess log.
            // If none of the zero-hint solves have a guess log, fall back to the top-ranked
            // one (the card will render "No replay data" and be non-clickable).
            const withLog = zeroHintScores.find(s => Array.isArray(s.guess_log) && s.guess_log.length > 0);
            day.bestScore = withLog || zeroHintScores[0] || null;
        }
    } catch (e) {
        console.error('Error fetching best score for', day.date, e);
    } finally {
        day.loaded = true;
        renderPast7Grid();
    }
}

function formatDateShort(dateStr) {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'short', month: 'short', day: 'numeric'
        });
    } catch (e) {
        return dateStr;
    }
}

function formatDateLong(dateStr) {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric'
        });
    } catch (e) {
        return dateStr;
    }
}

function renderPast7Grid() {
    const grid = document.getElementById('past7-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Left column (full height): yesterday's full Top Ten leaderboard.
    const day0 = past7Days[0];
    if (day0) {
        const panel = document.createElement('div');
        panel.className = 'past7-leaderboard';
        const title = past7Variant === 'wgpo' ? "Yesterday\u2019s Tough Top Ten" : "Yesterday\u2019s Top Ten";
        const header = document.createElement('div');
        header.className = 'past7-leaderboard-header';
        header.innerHTML =
            `<div class="past7-card-date">${formatDateShort(day0.date)}</div>` +
            `<div class="past7-card-letter">${day0.letter.toUpperCase()}</div>` +
            `<h3 class="past7-leaderboard-title">${title}</h3>`;
        panel.appendChild(header);

        const list = document.createElement('div');
        list.className = 'past7-leaderboard-list';
        panel.appendChild(list);
        grid.appendChild(panel);
        renderPast7LeaderboardList(list, day0);
    }

    // Right side: the six older days (indices 1..6) as best-solve cards.
    // With the leaderboard pinned to col 1 / rows 1-2, these auto-place into
    // cols 2-4: days 2,3,4 on the top row, 5,6,7 on the bottom.
    for (let idx = 1; idx < past7Days.length; idx++) {
        const day = past7Days[idx];
        const card = document.createElement('div');
        card.className = 'past7-card';
        card.dataset.idx = String(idx);

        const best = day.bestScore;
        const hasReplay = best && Array.isArray(best.guess_log) && best.guess_log.length > 0;

        let statusHtml;
        if (!day.loaded) {
            statusHtml = '<div class="past7-card-best muted">Loading…</div>';
        } else if (hasReplay) {
            const m = String(Math.floor(best.time_seconds / 60)).padStart(2, '0');
            const s = String(best.time_seconds % 60).padStart(2, '0');
            statusHtml =
                `<div class="past7-card-best"><strong>${escapeHtml(best.nickname)}</strong></div>` +
                `<div class="past7-card-stats">${best.guesses} guesses · ${m}:${s}</div>`;
            card.classList.add('has-replay');
        } else if (best) {
            statusHtml =
                `<div class="past7-card-best"><strong>${escapeHtml(best.nickname)}</strong></div>` +
                `<div class="past7-card-stats muted">No replay data</div>`;
        } else {
            statusHtml = '<div class="past7-card-best muted">No replay data</div>';
        }

        card.innerHTML = `
            <div class="past7-card-date">${formatDateShort(day.date)}</div>
            <div class="past7-card-letter">${day.letter.toUpperCase()}</div>
            ${statusHtml}
        `;

        if (hasReplay) {
            card.addEventListener('click', () => openReplay(day, day.bestScore));
        }
        grid.appendChild(card);
    }
}

/** Populate yesterday's Top Ten list, reusing the shared scoreboard renderer.
 *  Clean zero-hint solves with a guess log are made clickable to replay. */
function renderPast7LeaderboardList(list, day) {
    if (!db) {
        list.innerHTML = '<p class="past7-lb-note">Firebase not configured — leaderboard unavailable.</p>';
        return;
    }
    if (!day.leaderboardLoaded) {
        list.innerHTML = '<p class="past7-lb-note">Loading…</p>';
        return;
    }
    if (day.leaderboardError) {
        list.innerHTML = `<p class="past7-lb-note">Could not load leaderboard (${escapeHtml(day.leaderboardError)}).</p>`;
        return;
    }
    const scores = day.leaderboardScores || [];
    if (scores.length === 0) {
        list.innerHTML = '<p class="past7-lb-note">No scores for this day.</p>';
        return;
    }
    const myNickname = localStorage.getItem('seven_sevens_nickname') || '';
    renderScoreboardInto(list, scores, {
        secondaryKey: past7LeaderboardSortKey,
        myNickname,
        onSortChange: (k) => { past7LeaderboardSortKey = k; renderPast7Grid(); },
        getRowReplay: (score) => isCleanReplayableScore(score) ? () => openReplay(day, score) : null,
    });
}

function openReplay(day, score) {
    if (!day || !score || !Array.isArray(score.guess_log)) return;

    currentReplayDayIdx = past7Days.indexOf(day);
    replaySecrets = [...day.secrets];
    replayCommon = day.letter;
    replayLog = [...score.guess_log]
        .filter(g => g && typeof g.word === 'string')
        .map(g => ({ word: g.word.toLowerCase(), t: Number(g.t) || 0 }))
        .sort((a, b) => a.t - b.t);
    resetReplayBoardState();
    replayDiff = null;

    document.getElementById('past7-grid').classList.add('hidden');
    document.getElementById('past7-replay').classList.remove('hidden');

    const m = String(Math.floor((score.time_seconds || 0) / 60)).padStart(2, '0');
    const s = String((score.time_seconds || 0) % 60).padStart(2, '0');
    document.getElementById('past7-replay-header').innerHTML =
        `<h3>${formatDateLong(day.date)}</h3>` +
        `<p>Common letter: <strong class="past7-letter-inline">${day.letter.toUpperCase()}</strong> · ` +
        `<strong>${escapeHtml(score.nickname)}</strong> ` +
        `(${score.guesses} guesses · ${m}:${s}, hint-free)</p>`;

    renderReplayBoard();
    renderReplayLog();
    updateReplayControls();
}

function backToPast7Grid() {
    currentReplayDayIdx = -1;
    replayDiff = null;
    document.getElementById('past7-replay').classList.add('hidden');
    document.getElementById('past7-grid').classList.remove('hidden');
}

function renderReplayBoard() {
    const board = document.getElementById('past7-replay-board');
    if (!board) return;
    board.innerHTML = '';
    board.dataset.wordLen = '7';

    const diff = replayDiff;
    const guessChars = diff ? diff.guessWord.split('') : null;

    for (let i = 0; i < 7; i++) {
        const row = document.createElement('div');
        row.className = 'word-row';
        let isCompleted = true;

        for (let j = 0; j < 7; j++) {
            const box = document.createElement('div');
            box.className = 'letter-box';
            if (replayRevealed[i][j]) {
                box.textContent = replayRevealed[i][j];
                box.classList.add('correct');
                // Highlight greens produced by the currently-viewed guess
                if (diff && diff.newGreens.has(`${i},${j}`)) {
                    box.classList.add('diff-new');
                }
            } else {
                isCompleted = false;
                // Show the current guess's letters as faded "ghosts" in blank cells
                // of unfinished rows so the viewer can see *which* letters of the
                // guess would have appeared at each column.
                if (guessChars && guessChars[j]) {
                    box.textContent = guessChars[j];
                    box.classList.add('replay-ghost');
                }
            }
            row.appendChild(box);
        }

        if (isCompleted) {
            row.classList.add('completed');
            const tooltip = document.createElement('div');
            tooltip.className = 'def-tooltip';
            tooltip.innerHTML = '<em>Loading definition...</em>';
            row.appendChild(tooltip);
            const savedLen = wordLen;
            wordLen = 7;
            fetchDefinition(replaySecrets[i], tooltip);
            wordLen = savedLen;
        }

        const feedback = document.createElement('div');
        feedback.className = 'wrong-position-feedback';
        feedback.innerHTML = replayWrongPos[i].split('').map(c => {
            const isNew = diff && diff.newYellows.has(`${i},${c}`);
            return `<span class="${isNew ? 'diff-new' : ''}">${c}</span>`;
        }).join('');
        row.appendChild(feedback);

        board.appendChild(row);
    }

    // Column feedback renders into its own sibling container so the stepper on the
    // left can be vertically centered against the 7×7 grid only, not against the
    // grid + column-feedback strip below. Falls back to appending into the board
    // if the sibling is missing (e.g. stale cached HTML).
    const colHost = document.getElementById('past7-replay-colfeedback') || board;
    if (colHost !== board) colHost.innerHTML = '';

    const colRow = document.createElement('div');
    colRow.className = 'column-feedback-row';
    colRow.dataset.wordLen = '7';

    const colFeedback = document.createElement('div');
    colFeedback.className = 'past7-col-feedback';
    for (let j = 0; j < 7; j++) {
        const cf = document.createElement('div');
        cf.className = 'col-feedback';
        cf.innerHTML = replayColumnReds[j].split('').map(c => {
            const isNew = diff && diff.newReds.has(`${j},${c}`);
            return `<span class="${isNew ? 'diff-new' : ''}">${c}</span>`;
        }).join('');
        colFeedback.appendChild(cf);
    }
    colRow.appendChild(colFeedback);

    const spacer = document.createElement('div');
    spacer.className = 'column-feedback-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    colRow.appendChild(spacer);

    colHost.appendChild(colRow);
}

function renderReplayLog() {
    const logEl = document.getElementById('past7-replay-log');
    if (!logEl) return;
    logEl.innerHTML = '';

    replayLog.forEach((g, i) => {
        const li = document.createElement('li');
        const tSec = Math.max(0, Math.round(g.t || 0));
        const m = String(Math.floor(tSec / 60)).padStart(2, '0');
        const s = String(tSec % 60).padStart(2, '0');
        li.className = 'replay-log-entry';
        if (i < replayStep) li.classList.add('played');
        if (i === replayStep - 1) li.classList.add('current');
        li.title = 'Click to jump the board to this guess';
        li.innerHTML =
            `<span class="replay-log-time">${m}:${s}</span>` +
            `<span class="replay-log-word">${escapeHtml(g.word.toUpperCase())}</span>`;
        li.addEventListener('click', () => jumpReplayTo(i + 1));
        logEl.appendChild(li);
    });
}

function resetReplayBoardState() {
    replayRevealed = Array(7).fill(null).map(() => Array(7).fill(''));
    replayWrongPos = Array(7).fill('');
    replayColumnReds = Array(7).fill('');
    replayGuesses = [];
    replayStep = 0;
}

/**
 * Snapshot the portion of replay state that can change when a guess is applied.
 * Used to compute the diff for the most-recently-played step so we can highlight
 * which greens/yellows/reds were produced by *that* guess.
 */
function snapshotReplayState() {
    return {
        revealed: replayRevealed.map(row => row.slice()),
        wrongPos: [...replayWrongPos],
        columnReds: [...replayColumnReds],
    };
}

function computeReplayDiff(before, after, guessWord) {
    const newGreens = new Set();
    const newYellows = new Set();
    const newReds = new Set();

    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
            if (!before.revealed[r][c] && after.revealed[r][c]) {
                newGreens.add(`${r},${c}`);
            }
        }
    }
    for (let r = 0; r < 7; r++) {
        const prev = new Set(before.wrongPos[r].split(''));
        for (const ch of after.wrongPos[r]) {
            if (!prev.has(ch)) newYellows.add(`${r},${ch}`);
        }
    }
    for (let c = 0; c < 7; c++) {
        const prev = new Set(before.columnReds[c].split(''));
        for (const ch of after.columnReds[c]) {
            if (!prev.has(ch)) newReds.add(`${c},${ch}`);
        }
    }
    return { newGreens, newYellows, newReds, guessWord };
}

/**
 * Rebuild the board as it was after applying the first `step` guesses (0 = empty).
 * Also computes `replayDiff` — the cells/letters produced by the last applied guess
 * (step `target`) so that `renderReplayBoard` can highlight exactly what changed.
 */
function jumpReplayTo(step) {
    const target = Math.max(0, Math.min(step, replayLog.length));
    resetReplayBoardState();

    // Apply steps 1..target-1 without diff capture
    for (let i = 0; i < target - 1; i++) {
        const g = replayLog[i];
        if (g && g.word) applyReplayGuess(g.word);
    }

    // Apply the final step with a before/after snapshot to capture the diff
    if (target > 0) {
        const before = snapshotReplayState();
        const g = replayLog[target - 1];
        if (g && g.word) {
            applyReplayGuess(g.word);
            const after = snapshotReplayState();
            replayDiff = computeReplayDiff(before, after, g.word);
        } else {
            replayDiff = null;
        }
    } else {
        replayDiff = null;
    }

    replayStep = target;
    renderReplayBoard();
    renderReplayLog();
    updateReplayControls();
}

function replayStepForward() {
    if (replayStep >= replayLog.length) return;
    jumpReplayTo(replayStep + 1);
}

function replayStepBackward() {
    if (replayStep <= 0) return;
    jumpReplayTo(replayStep - 1);
}

function applyReplayGuess(guess) {
    replayGuesses.push(guess);

    for (let i = 0; i < 7; i++) {
        const sw = replaySecrets[i];
        for (let j = 0; j < 7; j++) {
            if (guess[j] === sw[j]) replayRevealed[i][j] = guess[j];
        }
    }

    for (let i = 0; i < 7; i++) {
        const sw = replaySecrets[i];
        const uniq = [...new Set(guess.split(''))];
        for (const ch of uniq) {
            if (sw.includes(ch) && !replayWrongPos[i].includes(ch)) {
                replayWrongPos[i] += ch;
            }
        }
        let filtered = '';
        for (const ch of replayWrongPos[i]) {
            const c1 = sw.split('').filter(c => c === ch).length;
            const c2 = replayRevealed[i].filter(c => c === ch).length;
            if (c2 < c1) filtered += ch;
        }
        replayWrongPos[i] = filtered.split('').sort().join('');
    }

    for (let i = 0; i < 7; i++) {
        let filtered = '';
        for (const ch of replayWrongPos[i]) {
            let globally = true;
            for (let w = 0; w < 7; w++) {
                const c1 = replaySecrets[w].split('').filter(c => c === ch).length;
                const c2 = replayRevealed[w].filter(c => c === ch).length;
                if (c2 < c1) { globally = false; break; }
            }
            if (!globally) filtered += ch;
        }
        replayWrongPos[i] = filtered;
    }

    replayColumnReds = Array(7).fill('');
    for (let j = 0; j < 7; j++) {
        let allRevealed = true;
        for (let i = 0; i < 7; i++) {
            if (!replayRevealed[i][j]) { allRevealed = false; break; }
        }
        if (allRevealed) continue;

        const guessedInCol = new Set();
        for (const g of replayGuesses) guessedInCol.add(g[j]);

        for (const letter of guessedInCol) {
            let isYellowSomewhere = false;
            for (let i = 0; i < 7; i++) {
                if (replayWrongPos[i].includes(letter)) { isYellowSomewhere = true; break; }
            }
            if (!isYellowSomewhere) continue;

            let isCorrectInCol = false;
            for (let i = 0; i < 7; i++) {
                if (replaySecrets[i][j] === letter) { isCorrectInCol = true; break; }
            }
            if (!isCorrectInCol && !replayColumnReds[j].includes(letter)) {
                replayColumnReds[j] += letter;
            }
        }
        replayColumnReds[j] = replayColumnReds[j].split('').sort().join('');
    }
}

function updateReplayControls() {
    const prevBtn = document.getElementById('past7-replay-prev');
    if (prevBtn) prevBtn.disabled = replayStep <= 0;
    const nextBtn = document.getElementById('past7-replay-next');
    if (nextBtn) nextBtn.disabled = replayStep >= replayLog.length;
    const counter = document.getElementById('past7-replay-step');
    if (counter) counter.textContent = `${replayStep} / ${replayLog.length}`;
}

// --- Startup ---

// Daily, Daily Hard, and Past 7 follow the Pacific game day. If 1:00 AM
// Pacific passes while the tab is open, save the daily in progress under the
// day it started, then load the new day. Practice is left alone.
function refreshIfGameDayRolled() {
    if (gameMode === 'practice') return;
    const modal = document.getElementById('nickname-modal');
    if (modal && !modal.classList.contains('hidden')) return;

    const today = getTodayString();
    if (gameMode === 'past7') {
        if (past7AnchorDate === today) return;
        initPast7();
        return;
    }
    if (gameMode !== 'daily' && gameMode !== 'daily_wgpo') return;
    if (activeGameDate === today) return;
    if (guesses.length || greenHintCount || yellowHintCount || gameOver || startTime) {
        saveDailyState();
    }
    if (gameMode === 'daily') initDailyGame();
    else initDailyWgpoGame();
}

function startGameDayWatch() {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshIfGameDayRolled();
    });
    setInterval(refreshIfGameDayRolled, 30000);
}

window.onload = () => {
    initFirebase();
    setupEventListeners();
    switchMode('daily');
    startGameDayWatch();
};
