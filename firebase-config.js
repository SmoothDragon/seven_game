// Firebase initialization — credentials are loaded from firebase-credentials.js
// (which is gitignored and not committed to the repository).
//
// To set up your own Firebase:
// 1. Copy firebase-credentials.example.js to firebase-credentials.js
// 2. Replace the placeholder values with your Firebase project config
// 3. See https://console.firebase.google.com -> Project Settings -> General

let db = null;

function initFirebase() {
    try {
        if (typeof firebaseConfig === 'undefined') {
            console.warn("firebase-credentials.js not found. Scoreboard features disabled.");
            return;
        }
        if (typeof firebase !== 'undefined') {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            console.log("Firebase initialized successfully.");
        } else {
            console.warn("Firebase SDK not loaded. Scoreboard features disabled.");
        }
    } catch (e) {
        console.warn("Firebase initialization failed:", e.message);
    }
}
