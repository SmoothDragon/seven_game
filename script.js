// Global state
let secretWords = [];
let commonLetter = '';
let revealedLetters = Array(7).fill(null).map(() => Array(7).fill('')); // 7 words, 7 letters
let wrongPositionLetters = Array(7).fill(''); // For each word
let columnRedLetters = Array(7).fill(''); // For each column
let guesses = [];
let gameOver = false;
let startTime;
let timerInterval;

function updateTimer() {
    if (!startTime || gameOver) return;
    const now = Date.now();
    const diff = Math.floor((now - startTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    document.getElementById('timer').textContent = `${m}:${s}`;
}

// Initialize game
function initGame() {
    // Reset state
    gameOver = false;
    guesses = [];
    revealedLetters = Array(7).fill(null).map(() => Array(7).fill(''));
    wrongPositionLetters = Array(7).fill('');
    columnRedLetters = Array(7).fill('');
    document.getElementById('guess-input').value = '';
    document.getElementById('guess-history').innerHTML = '';
    document.getElementById('guess-btn').disabled = false;
    
    // Reset keyboard colors
    document.querySelectorAll('.key').forEach(key => {
        key.classList.remove('black', 'green', 'yellow');
    });

    // Determine word list based on difficulty
    const difficulty = document.getElementById('difficulty').value;
    let currentWordList = [];
    if (difficulty === 'beginner') {
        currentWordList = WORDS.slice(0, 5000);
    } else if (difficulty === 'advanced') {
        currentWordList = WORDS.slice(0, 13000);
    } else {
        currentWordList = WORDS;
    }

    // 1. Pick a random common letter that has enough words
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let validLetterFound = false;
    let candidateWords = [];
    
    // Shuffle alphabet to pick randomly
    let shuffledAlphabet = alphabet.split('').sort(() => 0.5 - Math.random());
    
    for (let letter of shuffledAlphabet) {
        candidateWords = currentWordList.filter(w => w.includes(letter));
        // If the number of available words for a given letter drops below 50, ignore that letter
        if (candidateWords.length >= 50) {
            commonLetter = letter;
            validLetterFound = true;
            break;
        }
    }

    if (!validLetterFound) {
        // Fallback just in case (shouldn't happen with these list sizes)
        commonLetter = 'e';
        candidateWords = currentWordList.filter(w => w.includes('e'));
    }

    // 2. Pick 7 random words with this common letter
    secretWords = [];
    let tempCandidates = [...candidateWords];
    for (let i = 0; i < 7; i++) {
        const randomIndex = Math.floor(Math.random() * tempCandidates.length);
        secretWords.push(tempCandidates[randomIndex]);
        tempCandidates.splice(randomIndex, 1);
    }

    console.log("Secret words:", secretWords); // For debugging

    // 3. Setup UI
    document.getElementById('common-letter').textContent = commonLetter.toUpperCase();
    renderBoard();
    
    // Reset Timer
    clearInterval(timerInterval);
    startTime = null;
    document.getElementById('timer').textContent = '00:00';
    
    // Focus input after a brief delay to ensure DOM is ready
    setTimeout(() => {
        document.getElementById('guess-input').focus();
    }, 100);
}

function startTimerIfNeeded() {
    if (!startTime && !gameOver) {
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 1000);
    }
}

// Event listeners setup (only called once)
function setupEventListeners() {
    const input = document.getElementById('guess-input');
    
    document.getElementById('guess-btn').addEventListener('click', handleGuess);
    document.getElementById('new-game-btn').addEventListener('click', initGame);
    document.getElementById('difficulty').addEventListener('change', initGame);

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

    // Let native input handle all typing (letters, backspace, delete, selection).
    // We only intercept Enter for submission and refocus when needed.
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleGuess();
        }
    });

    // If user presses a key while input isn't focused, redirect focus
    document.addEventListener('keydown', function(e) {
        if (gameOver) return;
        if (document.activeElement !== input && /^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            input.focus();
        }
    });

    // Virtual Keyboard Event Listeners
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

function renderBoard() {
    const board = document.getElementById('game-board');
    board.innerHTML = '';

    for (let i = 0; i < 7; i++) {
        const row = document.createElement('div');
        row.className = 'word-row';
        
        let isCompleted = true;

        // Letter boxes
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

        // Wrong position feedback
        const feedback = document.createElement('div');
        feedback.className = 'wrong-position-feedback';
        feedback.innerHTML = wrongPositionLetters[i].split('').map(c => `<span>${c}</span>`).join('');
        row.appendChild(feedback);

        board.appendChild(row);
    }

    // Render column red letters
    for (let j = 0; j < 7; j++) {
        const colFeedback = document.getElementById(`col-${j}`);
        colFeedback.innerHTML = columnRedLetters[j].split('').map(c => `<span>${c}</span>`).join('');
    }
}

function showMessage(msg) {
    document.getElementById('message').textContent = msg;
    setTimeout(() => {
        document.getElementById('message').textContent = '';
    }, 3000);
}

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
    
    // Update history
    const historyList = document.getElementById('guess-history');
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
    // 1. Check greens (correct position)
    for (let i = 0; i < 7; i++) {
        const secretWord = secretWords[i];
        for (let j = 0; j < 7; j++) {
            if (guess[j] === secretWord[j]) {
                revealedLetters[i][j] = guess[j];
            }
        }
    }

    // 2. Check wrong positions (yellow/right side)
    for (let i = 0; i < 7; i++) {
        const secretWord = secretWords[i];
        
        // Add any guessed letter that is in the secret word
        let uniqueGuessedLetters = [...new Set(guess.split(''))];
        for (let char of uniqueGuessedLetters) {
            if (secretWord.includes(char)) {
                if (!wrongPositionLetters[i].includes(char)) {
                    wrongPositionLetters[i] += char;
                }
            }
        }
        
        // Remove letters from wrongPositionLetters if they are fully revealed in the word
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            // Count how many times this char appears in the secret word
            let countInSecret = secretWord.split('').filter(c => c === char).length;
            // Count how many times it is revealed in this specific word
            let countRevealed = revealedLetters[i].filter(c => c === char).length;
            
            if (countRevealed < countInSecret) {
                filteredWrongPos += char;
            }
        }
        wrongPositionLetters[i] = filteredWrongPos;

        // Sort alphabetically
        wrongPositionLetters[i] = wrongPositionLetters[i].split('').sort().join('');
    }

    // 2.5 Clean up ALL wrong position letters globally across all words
    // If a letter is fully revealed across ALL words that contain it, 
    // it should not appear in ANY yellow wrong position list.
    for (let i = 0; i < 7; i++) {
        let filteredWrongPos = '';
        for (let char of wrongPositionLetters[i]) {
            // Check if this letter is fully revealed across the ENTIRE board
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

    // 3. Recompute column reds from scratch based on current state
    computeColumnRedLetters();
}

function computeColumnRedLetters() {
    columnRedLetters = Array(7).fill('');
    
    for (let j = 0; j < 7; j++) {
        // Skip column if all 7 positions are revealed
        let columnComplete = true;
        for (let i = 0; i < 7; i++) {
            if (!revealedLetters[i][j]) {
                columnComplete = false;
                break;
            }
        }
        if (columnComplete) continue;

        // Collect all letters guessed in this column position across all guesses
        let guessedInColumn = new Set();
        for (let guess of guesses) {
            guessedInColumn.add(guess[j]);
        }

        for (let letter of guessedInColumn) {
            // Letter must appear as a yellow hint on at least one word row
            let isYellowSomewhere = false;
            for (let i = 0; i < 7; i++) {
                if (wrongPositionLetters[i].includes(letter)) {
                    isYellowSomewhere = true;
                    break;
                }
            }
            if (!isYellowSomewhere) continue;

            // Letter must NOT be correct in this column for any word
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
        gameOver = true;
        clearInterval(timerInterval);
        showMessage('Congratulations! You found all 7 words!');
        document.getElementById('guess-btn').disabled = true;
    }
}

function updateKeyboardColors() {
    const keys = document.querySelectorAll('.key');
    
    keys.forEach(key => {
        const char = key.getAttribute('data-key');
        if (!char || char.length > 1) return;
        
        let hasBeenGuessed = guesses.some(g => g.includes(char));
        if (!hasBeenGuessed) return;

        // Check if this letter exists in any secret word at all
        let existsInAnyWord = secretWords.some(w => w.includes(char));
        
        if (!existsInAnyWord) {
            key.classList.remove('black', 'green', 'yellow');
            key.classList.add('black');
            return;
        }

        // Check if ALL occurrences of this letter in ALL secret words have been revealed
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

        // Letter still has unrevealed positions — determine green vs yellow
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

// Start the game when the page loads
window.onload = () => {
    setupEventListeners();
    initGame();
};
