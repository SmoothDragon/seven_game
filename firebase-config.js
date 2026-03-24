// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyCqtwEg0iTPPze8b2-HxN9gF-GUoMzCLOs",
    authDomain: "seven-sevens-16893.firebaseapp.com",
    projectId: "seven-sevens-16893",
    storageBucket: "seven-sevens-16893.firebasestorage.app",
    messagingSenderId: "684733731198",
    appId: "1:684733731198:web:0a72e143154ae1e138e32f",
    measurementId: "G-501XVRGE2T"
};

// Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);
// Firebase Configuration
// Replace the values below with your own Firebase project config.
// Go to https://console.firebase.google.com -> Your Project -> Project Settings -> General
// Scroll to "Your apps" -> Web app -> Config
// const firebaseConfig = {
//     apiKey: "YOUR_API_KEY",
//     authDomain: "YOUR_PROJECT.firebaseapp.com",
//     projectId: "YOUR_PROJECT_ID",
//     storageBucket: "YOUR_PROJECT.appspot.com",
//     messagingSenderId: "YOUR_SENDER_ID",
//     appId: "YOUR_APP_ID"
// };

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
