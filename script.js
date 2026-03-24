// Global state
let secretWords = [];
let commonLetter = '';
let revealedLetters = Array(7).fill(null).map(() => Array(7).fill('')); // 7 words, 7 letters
let wrongPositionLetters = Array(7).fill(''); // For each word
let columnRedLetters = Array(7).fill(''); // For each column
let guesses = [];
let gameOver = false;

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
        currentWordList = WORDS.slice(0, 10000);
    } else if (difficulty === 'advanced') {
        currentWordList = WORDS.slice(0, 30000); // Caps at 25472
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
}

// Event listeners setup (only called once)
function setupEventListeners() {
    document.getElementById('guess-btn').addEventListener('click', handleGuess);
    document.getElementById('new-game-btn').addEventListener('click', initGame);
    document.getElementById('difficulty').addEventListener('change', initGame);
    
    // Physical Keyboard Event Listener
    document.addEventListener('keydown', function(e) {
        if (gameOver) return;
        
        // Ignore if user is typing in some other input field (though we only have one)
        if (e.target.tagName === 'INPUT' && !e.target.readOnly) return;

        const input = document.getElementById('guess-input');
        
        if (e.key === 'Enter') {
            e.preventDefault();
            handleGuess();
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            input.value = input.value.slice(0, -1);
        } else if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            if (input.value.length < 7) {
                input.value += e.key.toLowerCase();
            }
        }
    });

    // Virtual Keyboard Event Listeners
    document.querySelectorAll('.key').forEach(key => {
        key.addEventListener('click', function() {
            if (gameOver) return;
            const char = this.getAttribute('data-key');
            const input = document.getElementById('guess-input');
            
            if (char === 'Enter') {
                handleGuess();
            } else if (char === 'Backspace') {
                input.value = input.value.slice(0, -1);
            } else {
                if (input.value.length < 7) {
                    input.value += char;
                }
            }
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
    if (definitionsCache[word]) {
        tooltipElement.innerHTML = definitionsCache[word];
        return;
    }
    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!response.ok) throw new Error('Not found');
        const data = await response.json();
        
        let definitionsHtml = `<strong>${word.toUpperCase()}</strong>`;
        data[0].meanings.forEach(meaning => {
            definitionsHtml += `<br><em>${meaning.partOfSpeech}</em><ul>`;
            meaning.definitions.slice(0, 2).forEach(def => {
                definitionsHtml += `<li>${def.definition}</li>`;
            });
            definitionsHtml += `</ul>`;
        });
        
        definitionsCache[word] = definitionsHtml;
        tooltipElement.innerHTML = definitionsHtml;
    } catch (e) {
        definitionsCache[word] = `<strong>${word.toUpperCase()}</strong><br><em>Definition not found in dictionary.</em>`;
        tooltipElement.innerHTML = definitionsCache[word];
    }
}

function handleGuess() {
    if (gameOver) return;
    const input = document.getElementById('guess-input');
    const guess = input.value.toLowerCase().trim();

    if (guess.length !== 7) {
        showMessage('Guess must be exactly 7 letters.');
        return;
    }

    if (!WORDS.includes(guess)) {
        showMessage('Not a valid word in the list.');
        return;
    }

    if (!guess.includes(commonLetter)) {
        showMessage(`Word must contain the common letter: ${commonLetter.toUpperCase()}`);
        return;
    }

    if (guesses.includes(guess)) {
        showMessage('You already guessed that word.');
        return;
    }

    guesses.push(guess);
    processGuess(guess);
    updateKeyboardColors();
    
    // Update history
    const historyList = document.getElementById('guess-history');
    const li = document.createElement('li');
    li.textContent = guess;
    historyList.prepend(li);

    input.value = '';
    renderBoard();
    checkWinCondition();
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
            // Count how many times it is revealed
            let countRevealed = revealedLetters[i].filter(c => c === char).length;
            
            if (countRevealed < countInSecret) {
                filteredWrongPos += char;
            }
        }
        wrongPositionLetters[i] = filteredWrongPos;

        // Sort alphabetically
        wrongPositionLetters[i] = wrongPositionLetters[i].split('').sort().join('');
    }

    // 3. Check column reds
    for (let j = 0; j < 7; j++) {
        const guessedLetter = guess[j];
        
        // If a letter occurs in no word (blacked out on keyboard), it should not be shown in red
        let existsInAnyWord = false;
        for (let i = 0; i < 7; i++) {
            if (secretWords[i].includes(guessedLetter)) {
                existsInAnyWord = true;
                break;
            }
        }
        
        if (!existsInAnyWord) {
            continue; // Skip adding to column reds
        }

        let isCorrectInAnyWord = false;
        
        for (let i = 0; i < 7; i++) {
            if (secretWords[i][j] === guessedLetter) {
                isCorrectInAnyWord = true;
                break;
            }
        }

        if (!isCorrectInAnyWord) {
            if (!columnRedLetters[j].includes(guessedLetter)) {
                columnRedLetters[j] += guessedLetter;
                columnRedLetters[j] = columnRedLetters[j].split('').sort().join('');
            }
        }
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
        showMessage('Congratulations! You found all 7 words!');
        document.getElementById('guess-btn').disabled = true;
    }
}

function updateKeyboardColors() {
    const keys = document.querySelectorAll('.key');
    
    keys.forEach(key => {
        const char = key.getAttribute('data-key');
        if (!char || char.length > 1) return; // Skip Enter/Backspace
        
        let isBlack = true;
        let isGreen = false;
        let isYellow = false;
        let hasBeenGuessed = false;

        for (let guess of guesses) {
            if (guess.includes(char)) {
                hasBeenGuessed = true;
                for (let j = 0; j < 7; j++) {
                    if (guess[j] === char) {
                        for (let i = 0; i < 7; i++) {
                            if (secretWords[i].includes(char)) {
                                isBlack = false;
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
        }

        if (hasBeenGuessed) {
            key.classList.remove('black', 'green', 'yellow');
            if (isBlack) {
                key.classList.add('black');
            } else if (isYellow) {
                key.classList.add('yellow');
            } else if (isGreen) {
                key.classList.add('green');
            }
        }
    });
}

// Start the game when the page loads
window.onload = () => {
    setupEventListeners();
    initGame();
};
