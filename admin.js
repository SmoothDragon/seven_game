// Seven 7s — Admin dashboard logic
//
// Loads in admin.html only. Reuses style.css selectors (.word-row, .letter-box,
// .col-feedback, .past7-replay-*) so the replay UI matches the in-game look.
//
// Scope:
//   - Sign-in via Firebase Auth (Google provider). Only the UID equal to
//     ADMIN_UID below is allowed past the gate (matched by Firestore rules too).
//   - For a given date + variant, lists every player session (group of
//     live_guesses entries sharing a session_id), and lets you step through
//     each session's full guess sequence including invalid attempts.
//   - Exports a CSV of all "not in lexicon" attempts across both variants and
//     all dates — the corpus the user wants for evaluating new candidate words.
//
// Bump this in lockstep with index.html / script.js / admin.html.
const ASSET_VERSION = '9';

// =====================================================================
//   ADMIN_UID — REPLACE THE PLACEHOLDER BELOW
// ---------------------------------------------------------------------
// 1. Open admin.html in a browser. Click "Sign in with Google" and finish
//    the popup. The page will detect that ADMIN_UID is unset and show your
//    Firebase Auth UID under "Setup needed".
// 2. Copy that UID and replace '__SET_ME__' below with it.
// 3. Update Firestore rules (see firestore.rules in this repo) so that only
//    that UID can read live_guesses / live_guesses_wgpo, then redeploy them
//    in the Firebase console.
// 4. Hard-refresh admin.html and verify the dashboard appears.
// =====================================================================
const ADMIN_UID = '__SET_ME__';

// --- DOM helpers ---
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// --- State ---
let auth = null;
let currentUser = null;

// Dashboard view state
let selectedDate = '';            // 'YYYY-MM-DD'
let selectedVariant = 'common';   // 'common' | 'wgpo'
let puzzleSecrets = [];           // 7 secret words for selectedDate+variant
let puzzleLetter = '';            // common letter for that puzzle
let sessions = [];                // [{ session_id, nickname, entries: [...], stats: {} }]
let activeSessionIdx = -1;

// Replay state — mirrors past7's pattern but extended so invalid entries are
// shown in the log without being applied to the board.
let replayBoard = null;           // { revealed, wrongPos, columnReds, validApplied[] }
let replayStep = 0;               // # of entries (valid+invalid) consumed
let replayDiff = null;            // { newGreens, newYellows, newReds, guessWord, valid }

// =====================================================================
// Auth flow
// =====================================================================

function bootstrap() {
    initFirebase();
    if (typeof firebase === 'undefined' || !firebase.auth) {
        $('admin-signin-msg').textContent =
            'Firebase Auth SDK failed to load. Check the network tab and reload.';
        return;
    }
    auth = firebase.auth();
    auth.onAuthStateChanged(handleAuthChange);

    $('admin-signin-btn').addEventListener('click', signInWithGoogle);
    $('admin-signout-btn').addEventListener('click', () => auth.signOut());
}

function signInWithGoogle() {
    $('admin-signin-msg').textContent = '';
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((e) => {
        console.error(e);
        $('admin-signin-msg').textContent = 'Sign-in failed: ' + (e && e.message ? e.message : 'unknown error');
    });
}

function handleAuthChange(user) {
    currentUser = user;
    hide('admin-signin-gate');
    hide('admin-setup-gate');
    hide('admin-denied-gate');
    hide('admin-dashboard');
    hide('admin-signout-btn');
    $('admin-user-info').textContent = '';

    if (!user) {
        show('admin-signin-gate');
        return;
    }

    $('admin-user-info').textContent = user.email || user.displayName || user.uid;
    show('admin-signout-btn');

    if (ADMIN_UID === '__SET_ME__') {
        $('admin-setup-uid').textContent = user.uid;
        show('admin-setup-gate');
        return;
    }
    if (user.uid !== ADMIN_UID) {
        $('admin-denied-uid').textContent = user.uid;
        show('admin-denied-gate');
        return;
    }

    show('admin-dashboard');
    initDashboard();
}

// =====================================================================
// Puzzle reconstruction — DUPLICATED from script.js to keep this page
// independent of the live-game module. Must stay in sync if seedForDateStr,
// pickPuzzle or the wgpo seed-salt ever change in script.js, or daily-mode
// puzzle replay will silently mismatch.
// =====================================================================

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function seedForDateStr(dateStr) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function pickPuzzle(rng, wordList, wordCount, excludeLetter) {
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
        letter = excludeLetter === 'e' ? 'a' : 'e';
        candidates = wordList.filter(w => w.includes(letter));
    }

    const secrets = [];
    const temp = [...candidates];
    const n = Math.min(wordCount, temp.length);
    for (let i = 0; i < n; i++) {
        const ri = Math.floor(rng() * temp.length);
        secrets.push(temp[ri]);
        temp.splice(ri, 1);
    }
    return { letter, secrets };
}

function puzzleForDateVariant(dateStr, variant) {
    if (variant === 'wgpo') {
        const classic = pickPuzzle(mulberry32(seedForDateStr(dateStr)), WORDS.slice(0, 5000), 7, null);
        return pickPuzzle(mulberry32(seedForDateStr(dateStr + ':wgpo')), WORDS, 7, classic.letter);
    }
    return pickPuzzle(mulberry32(seedForDateStr(dateStr)), WORDS.slice(0, 5000), 7, null);
}

function liveGuessesCollection(variant) {
    return variant === 'wgpo' ? 'live_guesses_wgpo' : 'live_guesses';
}

// =====================================================================
// Date helpers
// =====================================================================

function todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLong(dateStr) {
    try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });
    } catch (e) { return dateStr; }
}

function formatMMSS(secs) {
    const s = Math.max(0, Math.round(secs || 0));
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${m}:${ss}`;
}

// =====================================================================
// Dashboard init / controls
// =====================================================================

function initDashboard() {
    const dateInput = $('admin-date');
    dateInput.value = todayString();
    dateInput.max = todayString();
    selectedDate = dateInput.value;
    dateInput.addEventListener('change', () => {
        selectedDate = dateInput.value || todayString();
        loadDashboardData();
    });

    $('admin-variant-common').addEventListener('click', () => switchVariant('common'));
    $('admin-variant-wgpo').addEventListener('click', () => switchVariant('wgpo'));

    $('admin-export-lexicon').addEventListener('click', exportNotInLexiconCsv);

    $('admin-replay-prev').addEventListener('click', () => jumpReplayTo(replayStep - 1));
    $('admin-replay-next').addEventListener('click', () => jumpReplayTo(replayStep + 1));

    document.addEventListener('keydown', (e) => {
        if (!isReplayVisible()) return;
        if (e.key === 'ArrowUp') { e.preventDefault(); jumpReplayTo(replayStep - 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); jumpReplayTo(replayStep + 1); }
    });

    loadDashboardData();
}

function switchVariant(v) {
    if (selectedVariant === v) return;
    selectedVariant = v;
    $('admin-variant-common').classList.toggle('active', v === 'common');
    $('admin-variant-wgpo').classList.toggle('active', v === 'wgpo');
    loadDashboardData();
}

function isReplayVisible() {
    return !$('admin-replay-content').classList.contains('hidden');
}

// =====================================================================
// Data loading
// =====================================================================

async function loadDashboardData() {
    activeSessionIdx = -1;
    sessions = [];
    closeReplay();

    const puzzle = puzzleForDateVariant(selectedDate, selectedVariant);
    puzzleSecrets = puzzle.secrets;
    puzzleLetter = puzzle.letter;

    $('admin-puzzle-info').innerHTML =
        `<div><strong>${formatDateLong(selectedDate)}</strong> · ` +
        `<span class="admin-variant-badge ${selectedVariant}">${selectedVariant === 'wgpo' ? 'Daily Hard' : 'Daily'}</span> · ` +
        `Common letter: <strong class="past7-letter-inline">${puzzleLetter.toUpperCase()}</strong> · ` +
        `Secrets: <code>${puzzleSecrets.map(escapeHtml).join(', ')}</code></div>`;

    const list = $('admin-sessions-list');
    list.innerHTML = '<p class="admin-muted">Loading…</p>';

    if (typeof db === 'undefined' || !db) {
        list.innerHTML = '<p class="admin-error">Firestore not initialized.</p>';
        return;
    }

    try {
        const snap = await db.collection(liveGuessesCollection(selectedVariant))
            .where('date', '==', selectedDate)
            .get();
        const docs = [];
        snap.forEach(d => docs.push(d.data()));
        sessions = groupAndStat(docs);
        renderSessionsList();
    } catch (e) {
        console.error(e);
        list.innerHTML =
            '<p class="admin-error">Could not load live guesses: ' + escapeHtml(e.message || 'unknown') + '</p>';
    }
}

function entrySortKey(e) {
    // Prefer client_timestamp (ms-resolution, set per-write client-side).
    // Fall back to t*1000, then 0. Server `timestamp` is stripped to a
    // number where it's a Firestore Timestamp.
    if (typeof e.client_timestamp === 'number') return e.client_timestamp;
    if (e.timestamp && typeof e.timestamp.toMillis === 'function') return e.timestamp.toMillis();
    if (typeof e.t === 'number') return e.t * 1000;
    return 0;
}

function groupAndStat(docs) {
    const by = new Map();
    for (const d of docs) {
        const sid = d.session_id || '(unknown)';
        if (!by.has(sid)) by.set(sid, []);
        by.get(sid).push(d);
    }

    const out = [];
    for (const [sid, entries] of by) {
        entries.sort((a, b) => entrySortKey(a) - entrySortKey(b));
        const stats = computeSessionStats(entries);
        // Pick the most recent non-null nickname seen in this session.
        let nickname = null;
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].nickname) { nickname = entries[i].nickname; break; }
        }
        out.push({ session_id: sid, nickname, entries, stats });
    }

    // Sort sessions: finished first (most-impressive first), then by guess count desc, then by first activity asc.
    out.sort((a, b) => {
        if (a.stats.finished !== b.stats.finished) return a.stats.finished ? -1 : 1;
        if (a.stats.validCount !== b.stats.validCount) return b.stats.validCount - a.stats.validCount;
        return entrySortKey(a.entries[0] || {}) - entrySortKey(b.entries[0] || {});
    });
    return out;
}

function computeSessionStats(entries) {
    let validCount = 0;
    const rejectCounts = { wrong_length: 0, not_in_lexicon: 0, missing_common_letter: 0, duplicate: 0 };
    for (const e of entries) {
        if (e.valid) validCount++;
        else if (e.reject_reason && rejectCounts[e.reject_reason] !== undefined) {
            rejectCounts[e.reject_reason]++;
        }
    }
    // Determine "finished" by simulating valid guesses on a fresh board.
    const board = newEmptyBoard();
    for (const e of entries) {
        if (e.valid && typeof e.word === 'string') applyValidGuessToBoard(board, e.word);
    }
    const finished = isFullyRevealed(board);
    const lastT = entries.length ? Math.max(...entries.map(e => Number(e.t) || 0)) : 0;
    return {
        validCount,
        invalidCount: entries.length - validCount,
        rejectCounts,
        finished,
        elapsed: lastT,
    };
}

// =====================================================================
// Sessions list rendering
// =====================================================================

function renderSessionsList() {
    const list = $('admin-sessions-list');
    if (sessions.length === 0) {
        list.innerHTML = '<p class="admin-muted">No sessions for this date.</p>';
        return;
    }

    list.innerHTML = '';
    sessions.forEach((s, idx) => {
        const card = document.createElement('div');
        card.className = 'admin-session-card';
        if (idx === activeSessionIdx) card.classList.add('active');
        card.addEventListener('click', () => openSession(idx));

        const name = s.nickname ? escapeHtml(s.nickname) : '<em>(anonymous)</em>';
        const finishedBadge = s.stats.finished
            ? '<span class="admin-badge admin-badge-finished">Finished</span>'
            : '<span class="admin-badge admin-badge-unfinished">In progress</span>';

        const totalRejects = s.stats.rejectCounts.wrong_length
            + s.stats.rejectCounts.not_in_lexicon
            + s.stats.rejectCounts.missing_common_letter
            + s.stats.rejectCounts.duplicate;

        card.innerHTML = `
            <div class="admin-session-name">${name} ${finishedBadge}</div>
            <div class="admin-session-stats">
                <span title="Valid guesses">${s.stats.validCount} valid</span> ·
                <span title="Invalid attempts">${totalRejects} invalid</span>
                ${s.stats.rejectCounts.not_in_lexicon ? `· <span class="admin-mini" title="Not in lexicon">${s.stats.rejectCounts.not_in_lexicon} miss</span>` : ''}
                · <span title="Final elapsed seconds at last attempt">${formatMMSS(s.stats.elapsed)}</span>
            </div>
            <div class="admin-session-sid"><code>${escapeHtml(s.session_id.slice(0, 12))}…</code></div>
        `;
        list.appendChild(card);
    });
}

// =====================================================================
// Replay viewer
// =====================================================================

function openSession(idx) {
    activeSessionIdx = idx;
    renderSessionsList();

    const s = sessions[idx];
    if (!s) return;
    replayBoard = newEmptyBoard();
    replayStep = 0;
    replayDiff = null;

    hide('admin-replay-empty');
    show('admin-replay-content');

    const headerName = s.nickname ? escapeHtml(s.nickname) : '<em>anonymous</em>';
    $('admin-replay-header').innerHTML =
        `<h3>Session: ${headerName}</h3>` +
        `<p>session id: <code>${escapeHtml(s.session_id)}</code> · ` +
        `${s.entries.length} total entries (${s.stats.validCount} valid, ${s.entries.length - s.stats.validCount} invalid)` +
        (s.stats.finished ? ' · <strong>finished</strong>' : '') + '</p>';

    renderReplayBoard();
    renderReplayLog();
    updateReplayControls();
}

function closeReplay() {
    activeSessionIdx = -1;
    show('admin-replay-empty');
    hide('admin-replay-content');
}

function getActiveSession() { return sessions[activeSessionIdx] || null; }

function newEmptyBoard() {
    return {
        revealed: Array(7).fill(null).map(() => Array(7).fill('')),
        wrongPos: Array(7).fill(''),
        columnReds: Array(7).fill(''),
        validApplied: [],
    };
}

function cloneBoard(b) {
    return {
        revealed: b.revealed.map(r => r.slice()),
        wrongPos: [...b.wrongPos],
        columnReds: [...b.columnReds],
        validApplied: [...b.validApplied],
    };
}

function isFullyRevealed(b) {
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if (!b.revealed[i][j]) return false;
    return true;
}

/**
 * Apply a single VALID guess to a board. Mirrors processGuess in script.js
 * (greens, yellow add, row-local prune, global prune, recompute reds).
 */
function applyValidGuessToBoard(board, guess) {
    board.validApplied.push(guess);

    for (let i = 0; i < 7; i++) {
        const sw = puzzleSecrets[i];
        if (!sw) continue;
        for (let j = 0; j < 7; j++) {
            if (guess[j] === sw[j]) board.revealed[i][j] = guess[j];
        }
    }

    for (let i = 0; i < 7; i++) {
        const sw = puzzleSecrets[i];
        if (!sw) continue;
        const uniq = [...new Set(guess.split(''))];
        for (const ch of uniq) {
            if (sw.includes(ch) && !board.wrongPos[i].includes(ch)) board.wrongPos[i] += ch;
        }
        let filtered = '';
        for (const ch of board.wrongPos[i]) {
            const c1 = sw.split('').filter(c => c === ch).length;
            const c2 = board.revealed[i].filter(c => c === ch).length;
            if (c2 < c1) filtered += ch;
        }
        board.wrongPos[i] = filtered.split('').sort().join('');
    }

    for (let i = 0; i < 7; i++) {
        let filtered = '';
        for (const ch of board.wrongPos[i]) {
            let globally = true;
            for (let w = 0; w < 7; w++) {
                const sw = puzzleSecrets[w];
                if (!sw) continue;
                const c1 = sw.split('').filter(c => c === ch).length;
                const c2 = board.revealed[w].filter(c => c === ch).length;
                if (c2 < c1) { globally = false; break; }
            }
            if (!globally) filtered += ch;
        }
        board.wrongPos[i] = filtered;
    }

    board.columnReds = Array(7).fill('');
    for (let j = 0; j < 7; j++) {
        let allRev = true;
        for (let i = 0; i < 7; i++) if (!board.revealed[i][j]) { allRev = false; break; }
        if (allRev) continue;
        const inCol = new Set();
        for (const g of board.validApplied) inCol.add(g[j]);
        for (const letter of inCol) {
            let yellowSomewhere = false;
            for (let i = 0; i < 7; i++) if (board.wrongPos[i].includes(letter)) { yellowSomewhere = true; break; }
            if (!yellowSomewhere) continue;
            let correctInCol = false;
            for (let i = 0; i < 7; i++) if (puzzleSecrets[i] && puzzleSecrets[i][j] === letter) { correctInCol = true; break; }
            if (!correctInCol && !board.columnReds[j].includes(letter)) board.columnReds[j] += letter;
        }
        board.columnReds[j] = board.columnReds[j].split('').sort().join('');
    }
    return board;
}

function snapshot(board) {
    return {
        revealed: board.revealed.map(r => r.slice()),
        wrongPos: [...board.wrongPos],
        columnReds: [...board.columnReds],
    };
}

function diffBoards(before, after, guessWord, valid) {
    const newGreens = new Set();
    const newYellows = new Set();
    const newReds = new Set();
    if (valid) {
        for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
            if (!before.revealed[r][c] && after.revealed[r][c]) newGreens.add(`${r},${c}`);
        }
        for (let r = 0; r < 7; r++) {
            const prev = new Set(before.wrongPos[r].split(''));
            for (const ch of after.wrongPos[r]) if (!prev.has(ch)) newYellows.add(`${r},${ch}`);
        }
        for (let c = 0; c < 7; c++) {
            const prev = new Set(before.columnReds[c].split(''));
            for (const ch of after.columnReds[c]) if (!prev.has(ch)) newReds.add(`${c},${ch}`);
        }
    }
    return { newGreens, newYellows, newReds, guessWord, valid };
}

/**
 * Recompute the board state after applying the first `step` entries (valid
 * ones only modify state; invalid ones are skipped). For step > 0, capture the
 * diff produced by the *most recent* entry so the renderer can highlight it
 * — invalid entries get an empty diff but their `guessWord` still drives the
 * ghost-letter preview in unrevealed rows.
 */
function jumpReplayTo(step) {
    const s = getActiveSession();
    if (!s) return;
    const target = Math.max(0, Math.min(step, s.entries.length));
    replayBoard = newEmptyBoard();

    for (let i = 0; i < target - 1; i++) {
        const e = s.entries[i];
        if (e.valid && typeof e.word === 'string' && e.word.length === 7) {
            applyValidGuessToBoard(replayBoard, e.word);
        }
    }

    if (target > 0) {
        const before = snapshot(replayBoard);
        const e = s.entries[target - 1];
        let after;
        const word = String(e.word || '');
        if (e.valid && word.length === 7) {
            applyValidGuessToBoard(replayBoard, word);
            after = snapshot(replayBoard);
            replayDiff = diffBoards(before, after, word, true);
        } else {
            // Invalid: don't mutate the board, but stash the attempted word so
            // the renderer can still show ghost letters in unfinished rows.
            replayDiff = diffBoards(before, before, word, false);
        }
    } else {
        replayDiff = null;
    }

    replayStep = target;
    renderReplayBoard();
    renderReplayLog();
    updateReplayControls();
}

function updateReplayControls() {
    const s = getActiveSession();
    const total = s ? s.entries.length : 0;
    $('admin-replay-prev').disabled = replayStep <= 0;
    $('admin-replay-next').disabled = replayStep >= total;
    $('admin-replay-step').textContent = `${replayStep} / ${total}`;
}

function renderReplayBoard() {
    const board = $('admin-replay-board');
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
            if (replayBoard.revealed[i][j]) {
                box.textContent = replayBoard.revealed[i][j];
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

        const feedback = document.createElement('div');
        feedback.className = 'wrong-position-feedback';
        feedback.innerHTML = replayBoard.wrongPos[i].split('').map(c => {
            const isNew = diff && diff.newYellows.has(`${i},${c}`);
            return `<span class="${isNew ? 'diff-new' : ''}">${escapeHtml(c)}</span>`;
        }).join('');
        row.appendChild(feedback);

        if (isCompleted) row.classList.add('completed');
        board.appendChild(row);
    }

    const colHost = $('admin-replay-colfeedback');
    if (colHost) {
        colHost.innerHTML = '';
        const colRow = document.createElement('div');
        colRow.className = 'column-feedback-row';
        colRow.dataset.wordLen = '7';

        const colFeedback = document.createElement('div');
        colFeedback.className = 'past7-col-feedback';
        for (let j = 0; j < 7; j++) {
            const cf = document.createElement('div');
            cf.className = 'col-feedback';
            cf.innerHTML = replayBoard.columnReds[j].split('').map(c => {
                const isNew = diff && diff.newReds.has(`${j},${c}`);
                return `<span class="${isNew ? 'diff-new' : ''}">${escapeHtml(c)}</span>`;
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
}

const REJECT_LABELS = {
    wrong_length: 'wrong length',
    not_in_lexicon: 'not in lexicon',
    missing_common_letter: 'missing common letter',
    duplicate: 'duplicate',
};

function renderReplayLog() {
    const logEl = $('admin-replay-log');
    logEl.innerHTML = '';
    const s = getActiveSession();
    if (!s) return;

    s.entries.forEach((e, i) => {
        const li = document.createElement('li');
        li.className = 'replay-log-entry';
        if (i < replayStep) li.classList.add('played');
        if (i === replayStep - 1) li.classList.add('current');
        if (!e.valid) li.classList.add('admin-invalid');

        const tSec = Number(e.t) || 0;
        const word = String(e.word || '').toUpperCase() || '<em>(empty)</em>';
        const reasonLabel = e.valid ? '' :
            `<span class="admin-reject-reason">${escapeHtml(REJECT_LABELS[e.reject_reason] || e.reject_reason || 'invalid')}</span>`;

        li.innerHTML =
            `<span class="replay-log-time">${formatMMSS(tSec)}</span>` +
            `<span class="replay-log-word">${word}</span>` +
            reasonLabel;
        li.title = e.valid
            ? 'Click to jump board to after this guess'
            : `Invalid (${REJECT_LABELS[e.reject_reason] || e.reject_reason || 'rejected'}) — board state unchanged`;
        li.addEventListener('click', () => jumpReplayTo(i + 1));
        logEl.appendChild(li);
    });
}

// =====================================================================
// CSV export — all "not in lexicon" attempts, both variants, all dates
// =====================================================================

async function exportNotInLexiconCsv() {
    const btn = $('admin-export-lexicon');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Exporting…';
    try {
        const [classicSnap, hardSnap] = await Promise.all([
            db.collection('live_guesses').where('reject_reason', '==', 'not_in_lexicon').get(),
            db.collection('live_guesses_wgpo').where('reject_reason', '==', 'not_in_lexicon').get(),
        ]);
        const rows = [];
        classicSnap.forEach(d => rows.push({ ...d.data(), _variant: 'common' }));
        hardSnap.forEach(d => rows.push({ ...d.data(), _variant: 'wgpo' }));

        rows.sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? -1 : 1;
            return entrySortKey(a) - entrySortKey(b);
        });

        const headers = ['date', 'variant', 'word', 'session_id', 'nickname', 't_seconds', 'client_timestamp_iso'];
        const lines = [headers.join(',')];
        for (const r of rows) {
            const isoTs = r.client_timestamp ? new Date(r.client_timestamp).toISOString() : '';
            lines.push([
                csvCell(r.date),
                csvCell(r._variant),
                csvCell(r.word),
                csvCell(r.session_id),
                csvCell(r.nickname || ''),
                csvCell(r.t),
                csvCell(isoTs),
            ].join(','));
        }
        const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `seven7s-not-in-lexicon-${todayString()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error(e);
        alert('Export failed: ' + (e && e.message ? e.message : 'unknown error'));
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

// =====================================================================
// Bootstrap
// =====================================================================

window.addEventListener('DOMContentLoaded', bootstrap);
