// Bump this (and the matching ?v= suffixes in index.html) on every release so
// GitHub Pages / browser caches serve the fresh bundle instead of stale JS.
const ASSET_VERSION = '6';

// Global state
let secretWords = [];
let commonLetter = '';
let revealedLetters = Array(7).fill(null).map(() => Array(7).fill(''));
let wrongPositionLetters = Array(7).fill('');
let columnRedLetters = Array(7).fill('');
let guesses = [];
let guessLog = []; // Array of { word, t } where t = elapsed seconds at time of guess
let gameOver = false;
let startTime;
let timerInterval;
let greenHintCount = 0;
let yellowHintCount = 0;
let gameMode = 'daily'; // 'daily' | 'daily_wgpo' | 'practice' | 'past7'
let currentDailyVariant = 'common'; // 'common' (classic Daily) | 'wgpo' (Daily Hard — id kept 'wgpo' for backward compatibility with existing daily_scores_wgpo documents)
let dailySubmitted = false;
let finalElapsedSeconds = 0;
let paused = false;
let pausedElapsed = 0;
let secondarySortKey = 'guesses'; // 'guesses' or 'time'
let wordLen = 7;
let fireworksTimerId = null;
let fireworksEpoch = 0;

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
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
        hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function getTodayString() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
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

/**
 * Pure puzzle derivation. Returns { letter, secrets } for a given seeded RNG and word list,
 * without touching globals. `excludeLetter` optionally forces a specific letter to be skipped
 * (used so Daily Hard never picks the same common letter as classic Daily on the same date).
 */
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
        // Ultra-defensive fallback — should never trigger for 7-letter lists that contain 'e'
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
    dailySubmitted = localStorage.getItem(dailySubmittedKey(variant, todayStr)) === 'true';

    const puzzle = puzzleForDateVariant(todayStr, variant);
    commonLetter = puzzle.letter;
    secretWords = [...puzzle.secrets];

    document.getElementById('common-letter').textContent = commonLetter.toUpperCase();
    updateScoreboardHeading(variant);
    renderBoard();
    fetchLeaderboard();

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

    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let validLetterFound = false;
    let candidateWords = [];
    let shuffledAlphabet = alphabet.split('').sort(() => 0.5 - Math.random());
    
    for (let letter of shuffledAlphabet) {
        candidateWords = currentWordList.filter(w => w.includes(letter));
        if (candidateWords.length >= 50) {
            commonLetter = letter;
            validLetterFound = true;
            break;
        }
    }

    if (!validLetterFound) {
        commonLetter = 'e';
        candidateWords = currentWordList.filter(w => w.includes('e'));
    }

    secretWords = [];
    let tempCandidates = [...candidateWords];
    for (let i = 0; i < wordLen; i++) {
        const randomIndex = Math.floor(Math.random() * tempCandidates.length);
        secretWords.push(tempCandidates[randomIndex]);
        tempCandidates.splice(randomIndex, 1);
    }

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

    recomputeYellowLetters();
    computeColumnRedLetters();
    updateKeyboardColors();
    renderBoard();
    checkWinCondition();
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

    computeColumnRedLetters();
    updateKeyboardColors();
    renderBoard();
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

// --- Guess Handling ---

function handleGuess() {
    if (gameOver) return;
    const input = document.getElementById('guess-input');
    const guess = input.value.toLowerCase().trim();

    const handleError = (msg) => {
        showMessage(msg);
        input.value = '';
        input.focus();
    };

    if (guess.length !== wordLen) {
        return handleError(`Guess must be exactly ${wordLen} letters.`);
    }

    if (!getActiveLexicon().includes(guess)) {
        return handleError('Not a valid word in the list.');
    }

    if (!guess.includes(commonLetter)) {
        return handleError(`Word must contain the common letter: ${commonLetter.toUpperCase()}`);
    }

    if (guesses.includes(guess)) {
        return handleError('You already guessed that word.');
    }

    startTimerIfNeeded();

    const elapsedAtGuess = getElapsedSeconds();
    guesses.push(guess);
    guessLog.push({ word: guess, t: elapsedAtGuess });
    updateGuessCountDisplay();
    processGuess(guess);
    updateKeyboardColors();
    
    const isDailyMode = gameMode === 'daily' || gameMode === 'daily_wgpo';
    const historyId = isDailyMode ? 'daily-guess-history' : 'guess-history';
    const historyList = document.getElementById(historyId);
    const li = document.createElement('li');
    li.textContent = guess;
    
    const tooltip = document.createElement('div');
    tooltip.className = 'guess-tooltip';
    tooltip.innerHTML = '<em>Loading...</em>';
    li.appendChild(tooltip);
    fetchDefinition(guess, tooltip);
    
    historyList.prepend(li);

    input.value = '';
    renderBoard();
    checkWinCondition();
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
    const todayStr = getTodayString();
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

async function fetchLeaderboard() {
    const container = document.getElementById('scoreboard-list');
    if (!container) return;

    if (!db) {
        container.innerHTML = '<p style="text-align:center; color:#888; font-size:0.9em;">Firebase not configured.<br>Set up firebase-config.js to enable the scoreboard.</p>';
        return;
    }
    
    container.innerHTML = '<p style="text-align:center; color:#888;">Loading...</p>';

    const variant = currentDailyVariant;
    const todayStr = getTodayString();
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

        scores.sort((a, b) => {
            const hintsA = (a.green_hints || 0) + (a.yellow_hints || 0);
            const hintsB = (b.green_hints || 0) + (b.yellow_hints || 0);
            if (hintsA !== hintsB) return hintsA - hintsB;

            if (secondarySortKey === 'time') {
                if (a.time_seconds !== b.time_seconds) return a.time_seconds - b.time_seconds;
                return a.guesses - b.guesses;
            }

            if (a.guesses !== b.guesses) return a.guesses - b.guesses;
            return a.time_seconds - b.time_seconds;
        });

        let myRank = -1;
        for (let i = 0; i < scores.length; i++) {
            if (scores[i].nickname === myNickname) {
                myRank = i + 1;
                break;
            }
        }

        const guessArrow = secondarySortKey === 'guesses' ? ' ▼' : '';
        const timeArrow = secondarySortKey === 'time' ? ' ▼' : '';
        let html = '<table class="scoreboard-table">';
        html += '<thead><tr><th>#</th><th>Name</th>' +
            `<th><button class="sort-header-btn" data-sort="guesses">Guesses${guessArrow}</button></th>` +
            `<th><button class="sort-header-btn" data-sort="time">Time${timeArrow}</button></th>` +
            '<th>Hints</th></tr></thead>';
        html += '<tbody>';

        const top10 = scores.slice(0, 10);
        top10.forEach((score, idx) => {
            const rank = idx + 1;
            const isMe = score.nickname === myNickname;
            const m = String(Math.floor(score.time_seconds / 60)).padStart(2, '0');
            const s = String(score.time_seconds % 60).padStart(2, '0');
            html += `<tr class="${isMe ? 'my-score' : ''}">`;
            html += `<td>${rank}</td>`;
            html += `<td>${escapeHtml(score.nickname)}</td>`;
            html += `<td>${score.guesses}</td>`;
            html += `<td>${m}:${s}</td>`;
            html += `<td>${(score.green_hints || 0) + (score.yellow_hints || 0)}</td>`;
            html += `</tr>`;
        });
        
        html += '</tbody></table>';

        if (myRank > 10) {
            html += `<p class="my-rank">Your rank: #${myRank}</p>`;
        }
        
        container.innerHTML = html;
        container.querySelectorAll('.sort-header-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                secondarySortKey = btn.dataset.sort;
                fetchLeaderboard();
            });
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

// --- Past 7 Mode ---

let past7Variant = 'common'; // 'common' | 'wgpo' — which daily flavor the Past 7 grid is showing
let past7Days = []; // [{ date, letter, secrets, bestScore }]
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
    const arr = [];
    const today = new Date();
    for (let i = 1; i <= 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        arr.push(s);
    }
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
    return pickPuzzle(rng, WORDS.slice(0, 5000), 7, null);
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
    return pickPuzzle(rng, WORDS, 7, classic.letter);
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
        past7Days.forEach(day => { day.loaded = true; });
        renderPast7Grid();
        return;
    }
    past7Days.forEach((day) => fetchBestScoreForDay(day));
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

    past7Days.forEach((day, idx) => {
        const card = document.createElement('div');
        card.className = 'past7-card';
        card.dataset.idx = String(idx);

        const best = day.bestScore;
        const hasReplay = best && Array.isArray(best.guess_log) && best.guess_log.length > 0;

        let statusHtml;
        if (!day.loaded) {
            statusHtml = '<div class="past7-card-best muted">Loading…</div>';
        } else if (hasReplay) {
            // Best score is the best-ranked zero-hint solve that has a replayable guess log.
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
            card.addEventListener('click', () => openReplay(idx));
        }
        grid.appendChild(card);
    });
}

function openReplay(dayIdx) {
    const day = past7Days[dayIdx];
    if (!day || !day.bestScore || !Array.isArray(day.bestScore.guess_log)) return;

    currentReplayDayIdx = dayIdx;
    replaySecrets = [...day.secrets];
    replayCommon = day.letter;
    replayLog = [...day.bestScore.guess_log]
        .filter(g => g && typeof g.word === 'string')
        .map(g => ({ word: g.word.toLowerCase(), t: Number(g.t) || 0 }))
        .sort((a, b) => a.t - b.t);
    resetReplayBoardState();
    replayDiff = null;

    document.getElementById('past7-grid').classList.add('hidden');
    document.getElementById('past7-replay').classList.remove('hidden');

    const best = day.bestScore;
    const m = String(Math.floor(best.time_seconds / 60)).padStart(2, '0');
    const s = String(best.time_seconds % 60).padStart(2, '0');
    document.getElementById('past7-replay-header').innerHTML =
        `<h3>${formatDateLong(day.date)}</h3>` +
        `<p>Common letter: <strong class="past7-letter-inline">${day.letter.toUpperCase()}</strong> · ` +
        `Best: <strong>${escapeHtml(best.nickname)}</strong> ` +
        `(${best.guesses} guesses · ${m}:${s}, hint-free)</p>`;

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

window.onload = () => {
    initFirebase();
    setupEventListeners();
    switchMode('daily');
};
