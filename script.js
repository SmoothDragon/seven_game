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

// --- Timer ---

function updateTimer() {
    if (!startTime || gameOver) return;
    const now = Date.now();
    const diff = Math.floor((now - startTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    document.getElementById('timer').textContent = `${m}:${s}`;
}

function startTimerIfNeeded() {
    if (!startTime && !gameOver) {
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
    }
}

function getElapsedSeconds() {
    if (!startTime) return 0;
    return Math.floor((Date.now() - startTime) / 1000);
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
}

// --- Game Initialization ---

function resetGameState() {
    gameOver = false;
    guesses = [];
    revealedLetters = Array(7).fill(null).map(() => Array(7).fill(''));
    wrongPositionLetters = Array(7).fill('');
    columnRedLetters = Array(7).fill('');
    dailySubmitted = false;
    document.getElementById('guess-input').value = '';
    document.getElementById('guess-history').innerHTML = '';
    document.getElementById('daily-guess-history').innerHTML = '';
    document.getElementById('guess-btn').disabled = false;
    
    document.querySelectorAll('.key').forEach(key => {
        key.classList.remove('black', 'green', 'yellow');
    });

    greenHintCount = 0;
    yellowHintCount = 0;
    document.getElementById('green-hint-count').textContent = '0';
    document.getElementById('yellow-hint-count').textContent = '0';
    document.getElementById('green-hint-btn').disabled = false;
    document.getElementById('yellow-hint-btn').disabled = false;

    clearInterval(timerInterval);
    startTime = null;
    document.getElementById('timer').textContent = '00:00';
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
    for (let i = 0; i < 7; i++) {
        const randomIndex = Math.floor(rng() * tempCandidates.length);
        secretWords.push(tempCandidates[randomIndex]);
        tempCandidates.splice(randomIndex, 1);
    }
}

function initDailyGame() {
    resetGameState();
    
    const todayStr = getTodayString();
    dailySubmitted = localStorage.getItem(`daily_submitted_${todayStr}`) === 'true';
    
    const seed = getDailySeed();
    const rng = mulberry32(seed);
    const beginnerList = WORDS.slice(0, 5000);
    
    pickWordsWithRng(rng, beginnerList);

    console.log("Daily words:", secretWords);

    document.getElementById('common-letter').textContent = commonLetter.toUpperCase();
    renderBoard();
    fetchLeaderboard();
    
    setTimeout(() => {
        document.getElementById('guess-input').focus();
    }, 100);
}

function initGame() {
    resetGameState();

    const difficulty = document.getElementById('difficulty').value;
    let currentWordList = [];
    if (difficulty === 'beginner') {
        currentWordList = WORDS.slice(0, 5000);
    } else if (difficulty === 'advanced') {
        currentWordList = WORDS.slice(0, 13000);
    } else {
        currentWordList = WORDS;
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
    for (let i = 0; i < 7; i++) {
        const randomIndex = Math.floor(Math.random() * tempCandidates.length);
        secretWords.push(tempCandidates[randomIndex]);
        tempCandidates.splice(randomIndex, 1);
    }

    console.log("Secret words:", secretWords);

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

    document.getElementById('green-hint-btn').addEventListener('click', useGreenHint);
    document.getElementById('yellow-hint-btn').addEventListener('click', useYellowHint);

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
                if (input.value.length < 7) {
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
    board.innerHTML = '';

    for (let i = 0; i < 7; i++) {
        const row = document.createElement('div');
        row.className = 'word-row';
        
        let isCompleted = true;

        for (let j = 0; j < 7; j++) {
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

    for (let j = 0; j < 7; j++) {
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
    const wordIndex = WORDS.indexOf(word);
    const usageRank = wordIndex + 1;
    const scrabbleRank = SCRABBLE_RANKS[wordIndex];
    const total = WORDS.length.toLocaleString();

    const rankHtml = `<div style="font-size:0.85em; color:#666; margin:4px 0;">` +
        `Usage: #${usageRank.toLocaleString()} / ${total}<br>` +
        `Probability: #${scrabbleRank.toLocaleString()} / ${total}</div>`;

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
    for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
            if (!revealedLetters[i][j]) {
                unrevealed.push({ i, j });
            }
        }
    }

    if (unrevealed.length === 0) return;

    const pick = unrevealed[Math.floor(Math.random() * unrevealed.length)];
    const letter = secretWords[pick.i][pick.j];

    for (let i = 0; i < 7; i++) {
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

        for (let i = 0; i < 7; i++) {
            if (wrongPositionLetters[i].includes(letter)) {
                isKnown = true;
                break;
            }
        }

        if (!isKnown) {
            for (let i = 0; i < 7; i++) {
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

    for (let i = 0; i < 7; i++) {
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
    for (let i = 0; i < 7; i++) {
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

    for (let i = 0; i < 7; i++) {
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            let isFullyRevealedGlobally = true;
            for (let w = 0; w < 7; w++) {
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

    if (guess.length !== 7) {
        return handleError('Guess must be exactly 7 letters.');
    }

    if (!WORDS.includes(guess)) {
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
    for (let i = 0; i < 7; i++) {
        const secretWord = secretWords[i];
        for (let j = 0; j < 7; j++) {
            if (guess[j] === secretWord[j]) {
                revealedLetters[i][j] = guess[j];
            }
        }
    }

    for (let i = 0; i < 7; i++) {
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

    for (let i = 0; i < 7; i++) {
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            let isFullyRevealedGlobally = true;
            for (let w = 0; w < 7; w++) {
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
    columnRedLetters = Array(7).fill('');
    
    for (let j = 0; j < 7; j++) {
        let columnComplete = true;
        for (let i = 0; i < 7; i++) {
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
            for (let i = 0; i < 7; i++) {
                if (wrongPositionLetters[i].includes(letter)) {
                    isYellowSomewhere = true;
                    break;
                }
            }
            if (!isYellowSomewhere) continue;

            let isCorrectInColumn = false;
            for (let i = 0; i < 7; i++) {
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

function checkWinCondition() {
    let allRevealed = true;
    for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
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

        if (gameMode === 'daily' && !dailySubmitted) {
            showNicknameModal();
        } else {
            showMessage('Congratulations! You found all 7 words!');
        }
    }
}

// --- Keyboard Colors ---

function updateKeyboardColors() {
    const keys = document.querySelectorAll('.key');
    
    keys.forEach(key => {
        const char = key.getAttribute('data-key');
        if (!char || char.length > 1) return;
        
        let hasBeenGuessed = guesses.some(g => g.includes(char));
        if (!hasBeenGuessed) return;

        let existsInAnyWord = secretWords.some(w => w.includes(char));
        
        if (!existsInAnyWord) {
            key.classList.remove('black', 'green', 'yellow');
            key.classList.add('black');
            return;
        }

        let allRevealed = true;
        for (let i = 0; i < 7; i++) {
            for (let j = 0; j < 7; j++) {
                if (secretWords[i][j] === char && revealedLetters[i][j] !== char) {
                    allRevealed = false;
                    break;
                }
            }
            if (!allRevealed) break;
        }

        if (allRevealed) {
            key.classList.remove('black', 'green', 'yellow');
            key.classList.add('black');
            return;
        }

        let isGreen = false;
        let isYellow = false;

        for (let guess of guesses) {
            for (let j = 0; j < 7; j++) {
                if (guess[j] === char) {
                    for (let i = 0; i < 7; i++) {
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

        key.classList.remove('black', 'green', 'yellow');
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
            const hA = (a.total_hints ?? (a.green_hints + a.yellow_hints));
            const hB = (b.total_hints ?? (b.green_hints + b.yellow_hints));
            if (hA !== hB) return hA - hB;
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

        let html = '<table class="scoreboard-table">';
        html += '<thead><tr><th>#</th><th>Name</th><th>Time</th><th>Guesses</th><th>Hints</th></tr></thead>';
        html += '<tbody>';
        
        const top10 = scores.slice(0, 10);
        top10.forEach((score, idx) => {
            const rank = idx + 1;
            const isMe = score.nickname === myNickname;
            const m = String(Math.floor(score.time_seconds / 60)).padStart(2, '0');
            const s = String(score.time_seconds % 60).padStart(2, '0');
            const hints = score.green_hints + score.yellow_hints;
            html += `<tr class="${isMe ? 'my-score' : ''}">`;
            html += `<td>${rank}</td>`;
            html += `<td>${escapeHtml(score.nickname)}</td>`;
            html += `<td>${m}:${s}</td>`;
            html += `<td>${score.guesses}</td>`;
            html += `<td>${hints}</td>`;
            html += `</tr>`;
        });
        
        html += '</tbody></table>';

        if (myRank > 10) {
            html += `<p class="my-rank">Your rank: #${myRank}</p>`;
        }
        
        container.innerHTML = html;
    } catch (e) {
        console.error("Error fetching leaderboard:", e);
        container.innerHTML = '<p style="text-align:center; color:#888;">Could not load scoreboard.</p>';
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
