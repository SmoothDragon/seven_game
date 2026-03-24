// Firebase Configuration
// Replace the values below with your own Firebase project config.
// Go to https://console.firebase.google.com -> Your Project -> Project Settings -> General
// Scroll to "Your apps" -> Web app -> Config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

let db = null;

function initFirebase() {
    try {
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
