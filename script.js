// Global state
let secretWords = [];
let commonLetter = '';
let revealedLetters = Array(7).fill(null).map(() => Array(7).fill(''));
let wrongPositionLetters = Array(7).fill('');
let columnRedLetters = Array(7).fill('');
let guesses = [];
let gameOver = false;
let startTime;
let timerInterval;
let greenHintCount = 0;
let yellowHintCount = 0;
let gameMode = 'daily'; // 'daily' or 'practice'
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
            await appendLexiconScript('words8.js');
            await appendLexiconScript('scrabble_ranks8.js');
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
    sel.options[2].textContent = `All valid WGPO ${n}-letter`;
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
    
    document.getElementById('mode-daily').classList.toggle('active', mode === 'daily');
    document.getElementById('mode-practice').classList.toggle('active', mode === 'practice');
    
    // Show/hide controls based on mode
    document.getElementById('controls').style.display = mode === 'practice' ? 'flex' : 'none';
    
    // Show/hide sidebars
    document.getElementById('sidebar-history').style.display = mode === 'practice' ? 'flex' : 'none';
    document.getElementById('sidebar-scoreboard').style.display = mode === 'daily' ? 'flex' : 'none';

    if (mode === 'daily') {
        initDailyGame();
    } else {
        initGame();
    }
    updateGameTaglineText();
}

// --- Game Initialization ---

function resetGameState() {
    gameOver = false;
    guesses = [];
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

function pickWordsWithRng(rng, wordList) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let candidateWords = [];
    
    let indices = Array.from({length: 26}, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    for (let idx of indices) {
        const letter = alphabet[idx];
        candidateWords = wordList.filter(w => w.includes(letter));
        if (candidateWords.length >= 50) {
            commonLetter = letter;
            break;
        }
    }

    secretWords = [];
    let tempCandidates = [...candidateWords];
    for (let i = 0; i < wordLen; i++) {
        const randomIndex = Math.floor(rng() * tempCandidates.length);
        secretWords.push(tempCandidates[randomIndex]);
        tempCandidates.splice(randomIndex, 1);
    }
}

function initDailyGame() {
    wordLen = 7;
    resetGameState();
    
    const todayStr = getTodayString();
    dailySubmitted = localStorage.getItem(`daily_submitted_${todayStr}`) === 'true';
    
    const seed = getDailySeed();
    const rng = mulberry32(seed);
    const beginnerList = WORDS.slice(0, 5000);
    
    pickWordsWithRng(rng, beginnerList);

    document.getElementById('common-letter').textContent = commonLetter.toUpperCase();
    renderBoard();
    fetchLeaderboard();
    
    setTimeout(() => {
        document.getElementById('guess-input').focus();
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

function setupEventListeners() {
    const input = document.getElementById('guess-input');
    
    document.getElementById('guess-btn').addEventListener('click', handleGuess);
    document.getElementById('new-game-btn').addEventListener('click', initGame);
    document.getElementById('difficulty').addEventListener('change', initGame);
    document.getElementById('practice-word-length').addEventListener('change', initGame);

    document.getElementById('green-hint-btn').addEventListener('click', useGreenHint);
    document.getElementById('yellow-hint-btn').addEventListener('click', useYellowHint);

    // Pause button
    document.getElementById('pause-btn').addEventListener('click', togglePause);

    // Mode toggle
    document.getElementById('mode-daily').addEventListener('click', () => switchMode('daily'));
    document.getElementById('mode-practice').addEventListener('click', () => switchMode('practice'));

    // Splash / Rules
    const splash = document.getElementById('splash-overlay');
    splash.addEventListener('click', function() {
        splash.classList.add('hidden');
        input.focus();
    });
    document.getElementById('rules-link').addEventListener('click', function(e) {
        e.preventDefault();
        splash.classList.remove('hidden');
    });

    // Nickname modal
    document.getElementById('nickname-save-btn').addEventListener('click', saveNickname);
    document.getElementById('nickname-input').addEventListener('keydown', function(e) {
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
    
    guesses.push(guess);
    updateGuessCountDisplay();
    processGuess(guess);
    updateKeyboardColors();
    
    const historyId = gameMode === 'daily' ? 'daily-guess-history' : 'guess-history';
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

        if (gameMode === 'daily' && !dailySubmitted) {
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
    
    const todayStr = getTodayString();
    
    if (localStorage.getItem(`daily_submitted_${todayStr}`) === 'true') {
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
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection('daily_scores').add(scoreData);
        
        dailySubmitted = true;
        localStorage.setItem(`daily_submitted_${todayStr}`, 'true');
        
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
    
    const todayStr = getTodayString();
    const myNickname = localStorage.getItem('seven_sevens_nickname') || '';
    
    try {
        const snapshot = await db.collection('daily_scores')
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

// --- Startup ---

window.onload = () => {
    initFirebase();
    setupEventListeners();
    switchMode('daily');
};
