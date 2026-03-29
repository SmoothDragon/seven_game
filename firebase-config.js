// Firebase web config — these keys are safe to expose publicly.
// They only identify the project; security is enforced by Firestore rules.
// See: https://firebase.google.com/docs/projects/api-keys#api-keys-for-firebase-are-different
const firebaseConfig = {
    apiKey: "AIzaSyCqtwEg0iTPPze8b2-HxN9gF-GUoMzCLOs",
    authDomain: "seven-sevens-16893.firebaseapp.com",
    projectId: "seven-sevens-16893",
    storageBucket: "seven-sevens-16893.firebasestorage.app",
    messagingSenderId: "684733731198",
    appId: "1:684733731198:web:0a72e143154ae1e138e32f",
    measurementId: "G-501XVRGE2T"
};

let db = null;

function initFirebase() {
    try {
        if (typeof firebase === 'undefined') {
            console.warn("Firebase SDK not loaded. Scoreboard features disabled.");
            return;
        }
        // Avoid "Firebase App named '[DEFAULT]' already exists" on back/forward cache or double init.
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        console.log("Firebase initialized successfully.");
    } catch (e) {
        console.warn("Firebase initialization failed:", e.message);
        try {
            if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
                db = firebase.firestore();
            }
        } catch (e2) {
            console.warn("Could not attach Firestore after init error:", e2.message);
        }
    }
}
