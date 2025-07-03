// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, orderBy, limit, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Firestore Security Rules (MUST BE SET IN FIREBASE CONSOLE) ---
// To prevent "Missing or insufficient permissions" (400 Bad Request) errors from Firestore,
// you MUST add these rules to your Firebase project's Firestore database rules.
// Go to Firebase Console -> Firestore Database -> Rules tab, and REPLACE the content with this:
/*
rules_version = '2';
service cloud.firestore {\n  match /databases/{database}/documents {\n    // Rule for private user data: Allows read/write only if the user is authenticated\n    // and the 'userId' in the path matches their authenticated UID.\n    // This now only applies to explicitly signed-in users.\n    match /artifacts/{appId}/users/{userId}/{document=**} {\n      allow read, write: if request.auth.uid == userId;\n    }\n\n    // Public artifacts collection (e.g., app metadata) - allow all reads\n    // No explicit write rule here, as these are assumed to be managed by an admin SDK\n    match /artifacts/{appId}/public/{document=**} {\n      allow read: if true;\n    }\n\n    // Rules for 'solves' subcollection.\n    // Allow users to read/write their own solves.\n    // This structure assumes solves are directly under a user's document\n    // For example: /artifacts/YOUR_APP_ID/users/YOUR_UID/solves/SOLVE_ID\n    match /artifacts/{appId}/users/{userId}/solves/{solveId} {\n      allow read, write: if request.auth.uid == userId;\n    }\n  }\n}
*/
// =====================================================================================================

// --- Application Configuration (Firebase) ---
// IMPORTANT: Replace with your actual Firebase project configuration
// You can find this in your Firebase project settings -> General -> Your apps -> Web app -> Firebase SDK snippet (Config)
// Or create a new web app if you haven't already.
const firebaseConfig = {
    apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M", // Replace with your Firebase API Key
    authDomain: "ubically-timer.firebaseapp.com",
    projectId: "ubically-timer",
    storageBucket: "ubically-timer.firebaseystorage.app",
    messagingSenderId: "467118524389",
    appId: "1:467118524389:web:d3455f5be5747be2cb910c",
    measurementId: "G-6033SRP9WC" // Optional
};

// Unique identifier for this application instance within Firestore (used in security rules)
// If you change this, update your Firestore security rules accordingly.
const APP_ID = "my-production-speedcube-timer";
console.log(`[DEBUG] App ID: ${APP_ID}`);
console.log("[DEBUG] firebaseConfig received:", firebaseConfig);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let currentUser = null; // Stores the current authenticated user object
let authInitialized = false; // Flag to ensure auth state is ready before trying to load data
console.log("[DEBUG] Firebase initialized. Setting up auth state listener.");

// --- Tone.js (Audio Context Management) ---
let audioContextStarted = false; // Global flag to track AudioContext state

// Function to ensure AudioContext starts after a user gesture
async function startAudioContext() {
    if (!audioContextStarted) {
        try {
            // Attempt to resume the AudioContext, which should be created implicitly by Tone.js
            await Tone.start();
            console.log("[DEBUG] Tone.js AudioContext explicitly resumed.");
            audioContextStarted = true;
        } catch (e) {
            console.error("[ERROR] Failed to start Tone.js AudioContext:", e);
        }
    } else {
        console.log("[DEBUG] Tone.js AudioContext successfully started/resumed by user gesture.");
    }
}

// Attach startAudioContext to a common user interaction event
// This ensures that the AudioContext is resumed after a user gesture.
document.addEventListener('click', startAudioContext, { once: true }); // Only call once
document.addEventListener('keydown', startAudioContext, { once: true }); // Also for keyboard users

// --- Global Variables and DOM Elements ---
let timerInterval;
let startTime;
let running = false;
let inspectionTime = 15; // 15 seconds inspection time
let currentInspectionTime;
let inspectionInterval;
let penalty = null; // null, 2, or DNF
let solves = []; // Array to store solve objects
let scramble = ''; // Current scramble string
let recognition; // SpeechRecognition object
let isListeningForVoice = false; // Flag for continuous listening mode
let awaitingActualCommand = false; // Flag for command mode, true after wake word
let recognitionStopInitiated = false; // Flag to manage recognition stop/start cycle
let isStartingRecognition = false; // Flag to prevent multiple start calls
let domElementsReady = false; // Flag to indicate if DOM elements are ready for manipulation

// DOM elements - assigned in setupEventListeners
let timerDisplay;
let scrambleDisplay;
let scramble3DViewer; // Using cubing.net's twisty player
let ao5Display, ao12Display, bestTimeDisplay, solveCountDisplay;
let solveHistoryList;
let penaltyButtons;
let signInBtn, signUpBtn, signOutBtn;
let userEmailDisplay;
let aiInsightModal, closeAiInsightModal, aiInsightContent, insightMessageDisplay, optimalSolutionDisplay, optimalSolutionText, personalizedTipDisplay, personalizedTipText;
let settingsModal, closeSettingsModal, openSettingsModal, themeSelect, enableSoundEffectsToggle, enableInspectionToggle, cubeTypeSelect, show3DCubeViewToggle, wakeWordInput, saveSettingsBtn;
let toastContainer; // For showing toasts
let spinner; // Spinner element, will be assigned in setupEventListeners

// --- User Settings and Local Storage ---
let userSettings = {
    enableInspection: true,
    enableSoundEffects: true,
    cubeType: '3x3',
    theme: 'dark', // 'dark', 'light', 'vibrant'
    show3DCubeView: true,
    wakeWord: 'jarvis' // Default wake word
};

// Function to load settings from local storage
function loadUserSettings() {
    console.log("[DEBUG] Loading user settings from local storage.");
    const savedSettings = localStorage.getItem('userSettings');
    if (savedSettings) {
        try {
            const parsedSettings = JSON.parse(savedSettings);
            userSettings = { ...userSettings, ...parsedSettings }; // Merge with defaults
            console.log("[DEBUG] User settings loaded from local storage:", userSettings);
        } catch (e) {
            console.error("[ERROR] Failed to parse user settings from local storage:", e);
            // If corrupted, reset to default or handle gracefully
        }
    }
}

// Function to save settings to local storage
function saveUserSettingsToLocalStorage() {
    console.log("[DEBUG] Saving user settings to local storage.");
    try {
        localStorage.setItem('userSettings', JSON.stringify(userSettings));
        console.log("[DEBUG] User settings saved to local storage.");
    } catch (e) {
        console.error("[ERROR] Failed to save user settings to local storage:", e);
    }
}


// --- Firebase Authentication & Firestore Data Management ---

onAuthStateChanged(auth, async (user) => {
    console.log("[DEBUG] onAuthStateChanged callback triggered. User:", user ? user.uid : "null");
    currentUser = user;
    authInitialized = true; // Auth state is now known

    updateAuthUI(); // Update UI based on auth state

    // If DOM is ready, initialize user data now. Otherwise, initializeUserDataAndSettings
    // will be called again by window.onload after DOM is ready.
    if (domElementsReady) {
        console.log("[DEBUG] DOM ready. Calling initializeUserDataAndSettings from onAuthStateChanged.");
        await initializeUserDataAndSettings();
    } else {
        console.log("[DEBUG] DOM not yet ready. initializeUserDataAndSettings will be called by window.onload.");
    }
});

function updateAuthUI() {
    if (signInBtn && signUpBtn && signOutBtn && userEmailDisplay) { // Check if elements are assigned
        if (currentUser) {
            userEmailDisplay.textContent = `Welcome, ${currentUser.email}`;
            signInBtn.style.display = 'none';
            signUpBtn.style.display = 'none';
            signOutBtn.style.display = 'inline-block';
        } else {
            userEmailDisplay.textContent = 'Welcome, Guest';
            signInBtn.style.display = 'inline-block';
            signUpBtn.style.display = 'inline-block';
            signOutBtn.style.display = 'none';
        }
        console.log("[DEBUG] Auth UI updated for", currentUser ? "authenticated user" : "guest user");
    } else {
        console.warn("[WARN] Auth UI elements not yet available for update.");
    }
}

async function initializeUserDataAndSettings() {
    console.log("[DEBUG] initializeUserDataAndSettings called.");
    if (!domElementsReady) {
        console.log("[DEBUG] Deferred initializeUserDataAndSettings: DOM not ready. Waiting.");
        return; // Defer until DOM is fully loaded and elements assigned
    }

    // Load local settings first (always applicable)
    loadUserSettings();
    applySettingsToUI(); // Apply settings to UI immediately

    if (currentUser) {
        console.log("[DEBUG] Authenticated user. Loading data from Firestore.");
        const userDocRef = doc(db, "artifacts", APP_ID, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const userData = userDocSnap.data();
            // Merge Firestore settings with current settings (Firestore takes precedence)
            userSettings = { ...userSettings, ...(userData.settings || {}) };
            solves = userData.solves || [];
            console.log("[DEBUG] User data loaded from Firestore:", userData);
        } else {
            console.log("[DEBUG] User document not found in Firestore. Creating new one.");
            // Create a new user document with default settings and empty solves
            await setDoc(userDocRef, {
                settings: userSettings,
                solves: []
            });
            solves = [];
        }
        await applySettingsToUI(); // Re-apply settings in case Firestore updated them
        renderSolveHistory();
    } else {
        console.log("[DEBUG] Guest user. Proceeding with Local Storage data initialization.");
        // For guest users, load solves from local storage
        loadSolvesFromLocalStorage();
        renderSolveHistory();
    }
    console.log("[DEBUG] initializeUserDataAndSettings completed.");
}

async function saveUserData() {
    if (currentUser) {
        console.log("[DEBUG] Authenticated user. Saving data to Firestore.");
        const userDocRef = doc(db, "artifacts", APP_ID, "users", currentUser.uid);
        try {
            await updateDoc(userDocRef, {
                settings: userSettings,
                solves: solves
            });
            console.log("[DEBUG] User data saved to Firestore.");
            showToast("Settings and solves saved to cloud!", "success");
        } catch (e) {
            console.error("[ERROR] Failed to save user data to Firestore:", e);
            showToast("Failed to save data to cloud.", "error");
        }
    } else {
        console.log("[DEBUG] Guest user. Saving settings and solves to local storage.");
        saveUserSettingsToLocalStorage();
        saveSolvesToLocalStorage();
        showToast("Settings and solves saved locally!", "success");
    }
}

function loadSolvesFromLocalStorage() {
    console.log("[DEBUG] Loading solves from local storage.");
    const savedSolves = localStorage.getItem('solves');
    if (savedSolves) {
        try {
            solves = JSON.parse(savedSolves);
            console.log(`[DEBUG] Loaded ${solves.length} solves from local storage.`);
        } catch (e) {
            console.error("[ERROR] Failed to parse solves from local storage:", e);
        }
    }
}

function saveSolvesToLocalStorage() {
    console.log("[DEBUG] Saving solves to local storage.");
    try {
        localStorage.setItem('solves', JSON.stringify(solves));
        console.log("[DEBUG] Solves saved to local storage.");
    } catch (e) {
        console.error("[ERROR] Failed to save solves to local storage:", e);
    }
}

// --- AI Insight Integration ---

async function getAiInsight(solveId, scramble, cubeType, solveTimeMs, penalty) {
    showAiInsightModal("Generating insight...");
    insightMessageDisplay.textContent = "Generating insight...";
    optimalSolutionDisplay.style.display = 'none';
    personalizedTipDisplay.style.display = 'none';
    if (spinner) spinner.style.display = 'block'; // Show spinner

    const userLevel = determineUserLevel(cubeType, solveTimeMs);
    console.log(`[DEBUG] Determining user level for ${cubeType} solve time: ${solveTimeMs}ms`);

    const payload = {
        type: "get_insight", // This is just for internal logging/routing if needed by the Cloud Function.
        scramble: scramble,
        cubeType: cubeType,
        solveTimeMs: solveTimeMs,
        penalty: penalty,
        userLevel: userLevel
    };
    console.log("[DEBUG] Making Cloud Function call for insight with data:", payload);

    try {
        const response = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[ERROR] Cloud Function error:", response.status, errorText);
            throw new Error(`Server responded with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log("[DEBUG] Cloud Function raw response:", data);

        // Update modal content
        insightMessageDisplay.textContent = data.insight || "No general insight provided.";
        if (spinner) spinner.style.display = 'none'; // Hide spinner

        if (data.optimalSolution) {
            optimalSolutionText.textContent = data.optimalSolution;
            optimalSolutionDisplay.style.display = 'block';
        } else {
            optimalSolutionDisplay.style.display = 'none';
        }

        if (data.personalizedTip) {
            personalizedTipText.textContent = data.personalizedTip;
            personalizedTipDisplay.style.display = 'block';
        } else {
            personalizedTipDisplay.style.display = 'none';
        }

        console.log("[DEBUG] Cloud Function response received and displayed.");
        showToast("AI Insight generated!", "success");

    } catch (error) {
        console.error("[ERROR] Error fetching AI insight:", error);
        insightMessageDisplay.textContent = `Failed to generate insight: ${error.message}. Please try again later.`;
        if (spinner) spinner.style.display = 'none'; // Hide spinner
        showToast("Failed to generate AI Insight.", "error");
    } finally {
        console.log("[DEBUG] AI Insight generation process completed.");
    }
}

function determineUserLevel(cubeType, solveTimeMs) {
    if (cubeType === '3x3') {
        const solveTimeSeconds = solveTimeMs / 1000;
        if (solveTimeSeconds < 10) return 'Expert';
        if (solveTimeSeconds < 20) return 'Advanced';
        if (solveTimeSeconds < 40) return 'Intermediate';
        if (solveTimeSeconds < 90) return 'Beginner';
        return 'Novice';
    }
    // Add logic for other cube types if needed
    return 'General';
}

// --- Voice Recognition & NLU (Natural Language Understanding) ---
if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    // Event listeners for recognition
    recognition.onstart = () => {
        console.log("[DEBUG] Voice recognition ONSTART triggered.");
        // isListeningForVoice = true; // This is set by startRecognitionAfterDelay
    };

    recognition.onresult = (event) => {
        console.log("[DEBUG] Voice recognition ONRESULT triggered. Current awaitingActualCommand:", awaitingActualCommand);
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Display interim results somewhere if needed
        // console.log("Interim:", interimTranscript);
        // console.log("Final:", finalTranscript);

        if (finalTranscript) {
            console.log("[DEBUG] Final voice transcript:", finalTranscript);
            // Clear any existing command timeout if a new final transcript comes in
            clearTimeout(commandTimeout);
            commandTimeout = null; // Reset the timeout ID

            if (awaitingActualCommand) {
                console.log("[DEBUG] Awaiting command mode is TRUE: Processing final transcript as command.");
                processVoiceCommandWithGemini(finalTranscript.toLowerCase());
            } else {
                // Not in command mode, check for wake word
                const wakeWordDetected = finalTranscript.toLowerCase().includes(userSettings.wakeWord.toLowerCase());
                if (wakeWordDetected) {
                    console.log(`[DEBUG] Wake word '${userSettings.wakeWord}' detected. Entering command mode.`);
                    awaitingActualCommand = true;
                    speakAsJarvis(`At your service, Sir Sevindu. Your command?`);
                    // Set a timeout to exit command mode if no command is given
                    commandTimeout = setTimeout(() => {
                        if (awaitingActualCommand) { // Only if still in command mode
                            speakAsJarvis("Sir Sevindu, it appears no command was given. Returning to passive listening.");
                            awaitingActualCommand = false; // Exit command mode
                            attemptRestartRecognition(); // Resume continuous listening
                        }
                    }, 8000); // 8 seconds to give a command
                } else {
                    console.log("[DEBUG] No wake word detected and not in command mode. Continuing continuous listening for 'Jarvis'.");
                }
            }
        }
    };

    // MODIFIED: Centralized recognition stop/start logic
    recognition.onend = (event) => {
        console.log("[DEBUG] Voice recognition ONEND triggered.");
        isListeningForVoice = false;
        isStartingRecognition = false; // Recognition cycle completed
        if (!recognitionStopInitiated) {
            // Only restart if it stopped naturally (not by explicit stop() call)
            console.log("[DEBUG] Recognition ended naturally. Attempting restart.");
            attemptRestartRecognition(); // Auto-restart continuous listening
        } else {
            console.log("[DEBUG] Recognition ended due to explicit stop. Not auto-restarting.");
            recognitionStopInitiated = false; // Reset flag
        }
    };

    recognition.onerror = (event) => {
        console.error("[ERROR] Voice recognition ERROR:", event.error, event);
        isListeningForVoice = false;
        isStartingRecognition = false; // Recognition cycle completed
        recognitionStopInitiated = false; // Reset flag on error as well

        if (event.error === 'not-allowed') {
            speakAsJarvis("Pardon me, Sir Sevindu. Microphone access was denied. Please grant permission to enable voice commands.");
        } else if (event.error === 'no-speech') {
            if (!awaitingActualCommand) { // If in continuous listening mode
                console.log("[DEBUG] No speech detected, restarting continuous recognition.");
            } else {
                 // If awaiting a command and no speech, indicate non-comprehension
                console.log("[DEBUG] No speech detected while awaiting command. Resetting command mode.");
                speakAsJarvis("Pardon me, Sir Sevindu. I did not detect any speech. Please try again.");
                awaitingActualCommand = false; // Exit command mode
            }
        } else if (event.error === 'network') {
            speakAsJarvis("Pardon me, Sir Sevindu. A network error occurred with voice recognition.");
        } else if (event.error === 'audio-capture') {
             speakAsJarvis("Pardon me, Sir Sevindu. I am unable to access the microphone. Please ensure it is connected and enabled.");
        }
        // Always try to restart if it was meant to be continuous and not a fatal 'not-allowed' error
        if (event.error !== 'not-allowed') {
            attemptRestartRecognition();
        }
    };

} else {
    console.warn("[WARN] Web Speech API not supported, cannot enable voice commands.");
}

let commandTimeout; // To store the timeout ID for exiting command mode

// NEW HELPER FUNCTION: Centralized logic to start recognition after state checks
function startRecognitionAfterDelay() {
    // If already recognizing, or if a start cycle is in progress, skip.
    if (recognition.recognizing || isStartingRecognition) {
        console.warn("[WARN] Recognition is already recognizing or starting, skipping new start attempt.");
        // isStartingRecognition = false; // Ensure flag is reset if stuck - REMOVED, as it's reset in onend/onerror
        return;
    }

    isStartingRecognition = true; // Set flag to prevent re-entry

    // Temporarily clear onend/onerror to avoid unexpected behavior during start cycle
    // These will be re-assigned in recognition.onstart or after successful start.
    // NOTE: This pattern of clearing and re-assigning handlers can be tricky.
    // The current onend/onerror handlers are designed to manage the restart.
    // Let's rely on their logic, and only clear if absolutely necessary.
    // For now, I'll keep the existing onend/onerror logic which handles the restart.
    // The `recognitionStopInitiated` flag is key.

    setTimeout(() => {
        try {
            recognition.start();
            isListeningForVoice = true; // Indicate active listening
            // isStartingRecognition = false; // Reset start flag - handled by onstart
            awaitingActualCommand = false; // Ensure not in command mode initially
            console.log("[DEBUG] Voice recognition STARTED. recognition.readyState:", recognition.readyState);
            // onstart/onend/onerror handlers are now managed by the main recognition block
            // and should handle state transitions.
        } catch (e) {
            console.error("[ERROR] Failed to start recognition after delay:", e);
            isStartingRecognition = false; // Reset flag on failure
            recognitionStopInitiated = false; // Reset flag
            speakAsJarvis("Pardon me, Sir Sevindu. I encountered a persistent error activating voice input.");
        }
    }, 150); // Small delay to ensure previous state is cleared
}


// MODIFIED: attemptRestartRecognition function to robustly manage the lifecycle
async function attemptRestartRecognition() {
    if (!recognition) {
        console.warn("[WARN] SpeechRecognition object not initialized. Cannot attempt restart.");
        return;
    }

    if (isStartingRecognition) {
        console.log("[DEBUG] Skipping attemptRestartRecognition as a cycle is already in progress.");
        return;
    }

    isStartingRecognition = true; // Set flag to prevent re-entry

    console.log("[DEBUG] attemptRestartRecognition called. State: isStartingRecognition=" + isStartingRecognition +
                ", isListeningForVoice=" + isListeningForVoice +
                ", recognition.readyState=" + recognition.readyState +
                ", recognition.listening=" + recognition.listening +
                ", recognitionStopInitiated=" + recognitionStopInitiated);

    if (recognition.recognizing) {
        console.log("[DEBUG] Recognition is currently active. Stopping before restart.");
        recognitionStopInitiated = true; // Flag that we initiated the stop
        recognition.stop(); // This will trigger the 'onend' event, which then calls startRecognitionAfterDelay
    } else {
        console.log("[DEBUG] Recognition is not active. Attempting to start directly or after a brief pause.");
        startRecognitionAfterDelay(); // Direct start or schedule start
    }
}


// Function to process voice commands using Gemini NLU
async function processVoiceCommandWithGemini(transcript) {
    awaitingActualCommand = false; // Exit command mode immediately after receiving command

    // Send transcript to Gemini NLU Cloud Function
    const payload = { transcript: transcript };
    console.log("[DEBUG] Sending raw transcript to Gemini NLU:", payload.transcript);

    try {
        const response = await fetch('/api/gemini-nlu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[ERROR] NLU Cloud Function error:", response.status, errorText);
            throw new Error(`NLU Server responded with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log("[DEBUG] Gemini NLU response:", data);

        const { canonicalCommand, commandValue, confidence, query } = data; // Added 'query'

        if (confidence < 0.7) { // Set a confidence threshold
            speakAsJarvis("Pardon me, Sir Sevindu. I did not fully comprehend your instruction. Please try again.");
            // Re-enter command mode briefly to allow another attempt
            awaitingActualCommand = true;
            commandTimeout = setTimeout(() => {
                if (awaitingActualCommand) {
                    speakAsJarvis("Sir Sevindu, it appears no command was given. Returning to passive listening.");
                    awaitingActualCommand = false;
                    attemptRestartRecognition();
                }
            }, 5000);
            return;
        }

        console.log(`[DEBUG] Handling canonical command: "${canonicalCommand}" with value: "${commandValue}"`);

        // Handle recognized commands
        switch (canonicalCommand) {
            case 'general_query':
                if (query) { // Use 'query' from NLU response
                    speakAsJarvis("Processing your query, Sir Sevindu.");
                    const answer = await getGeneralAnswer(query); // New function to call insight endpoint
                    speakAsJarvis(answer);
                } else {
                    speakAsJarvis("Pardon me, Sir Sevindu. I received a general query but no specific question.");
                }
                break;
            case 'set_cube_type':
                if (commandValue) {
                    userSettings.cubeType = commandValue;
                    speakAsJarvis(`Cube type set to ${commandValue}, Sir Sevindu.`);
                    saveUserData(); // Save settings to local storage or Firestore
                    applySettingsToUI(); // Update UI and regenerate scramble
                } else {
                    speakAsJarvis("Pardon me, Sir Sevindu. Please specify the cube type, for example, 'set cube type to three by three'.");
                }
                break;
            case 'analyze_solve':
                // Assuming the last solve data is available to pass to getAiInsight
                if (solves.length > 0) {
                    const lastSolve = solves[solves.length - 1];
                    speakAsJarvis("Analyzing your last solve, Sir Sevindu.");
                    getAiInsight(lastSolve.id, lastSolve.scramble, lastSolve.cubeType, lastSolve.time, lastSolve.penalty);
                } else {
                    speakAsJarvis("Sir Sevindu, there are no recorded solves to analyze.");
                }
                break;
            case 'toggle_sound_effects':
                userSettings.enableSoundEffects = !userSettings.enableSoundEffects;
                speakAsJarvis(`Sound effects are now ${userSettings.enableSoundEffects ? 'enabled' : 'disabled'}, Sir Sevindu.`);
                saveUserData();
                applySettingsToUI();
                break;
            case 'toggle_inspection':
                userSettings.enableInspection = !userSettings.enableInspection;
                speakAsJarvis(`Inspection time is now ${userSettings.enableInspection ? 'enabled' : 'disabled'}, Sir Sevindu.`);
                saveUserData();
                applySettingsToUI();
                break;
            case 'set_theme':
                if (commandValue && ['dark', 'light', 'vibrant'].includes(commandValue)) {
                    userSettings.theme = commandValue;
                    speakAsJarvis(`Theme set to ${commandValue}, Sir Sevindu.`);
                    saveUserData();
                    applySettingsToUI();
                } else {
                    speakAsJarvis("Pardon me, Sir Sevindu. Please specify a valid theme: dark, light, or vibrant.");
                }
                break;
            case 'show_history':
                speakAsJarvis("Displaying solve history, Sir Sevindu.");
                // Add logic to scroll to or show history section
                const historySection = document.getElementById('solveHistoryContainer'); // Assuming such an ID exists
                if (historySection) {
                    historySection.scrollIntoView({ behavior: 'smooth' });
                }
                break;
            case 'show_stats':
                speakAsJarvis("Displaying statistics, Sir Sevindu.");
                // Add logic to scroll to or show statistics section
                const statsSection = document.getElementById('statisticsContainer'); // Assuming such an ID exists
                if (statsSection) {
                    statsSection.scrollIntoView({ behavior: 'smooth' });
                }
                break;
            case 'generate_scramble':
                speakAsJarvis("Generating a new scramble, Sir Sevindu.");
                scramble = generateScramble();
                break;
            // Add more commands as needed
            case 'unknown':
            default:
                speakAsJarvis("Pardon me, Sir Sevindu. I did not fully comprehend your instruction. Please try again.");
                // Re-enter command mode briefly
                awaitingActualCommand = true;
                 commandTimeout = setTimeout(() => {
                    if (awaitingActualCommand) {
                        speakAsJarvis("Sir Sevindu, it appears no command was given. Returning to passive listening.");
                        awaitingActualCommand = false;
                        attemptRestartRecognition();
                    }
                }, 5000);
                break;
        }
    } catch (error) {
        console.error("[ERROR] Error processing voice command with Gemini NLU:", error);
        speakAsJarvis("Pardon me, Sir Sevindu. I encountered an error processing your command. Please try again.");
    } finally {
        console.log("[DEBUG] processVoiceCommandWithGemini: Initiating controlled recognition restart after command processing.");
        // This will now be handled by the onend event after Jarvis finishes speaking,
        // or directly by startRecognitionAfterDelay if speakAsJarvis doesn't speak.
    }
}

// NEW FUNCTION: To get general answers from the insight endpoint
async function getGeneralAnswer(query) {
    console.log(`[DEBUG] Requesting general answer for query: "${query}"`);
    const payload = {
        type: "general_query", // New type for general questions
        query: query
    };

    try {
        const response = await fetch('/api/gemini-insight', { // Use the insight endpoint
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("[ERROR] General query Cloud Function error:", response.status, errorText);
            throw new Error(`Server responded with status ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log("[DEBUG] General query Cloud Function raw response:", data);

        if (data.answer) {
            return data.answer;
        } else {
            return "Pardon me, Sir Sevindu. I could not find a specific answer to that query.";
        }

    } catch (error) {
        console.error("[ERROR] Error fetching general answer:", error);
        return `Sir Sevindu, I encountered an error retrieving that information: ${error.message}.`;
    }
}


// Function for Jarvis to speak
async function speakAsJarvis(text) {
    if (!('SpeechSynthesisUtterance' in window)) {
        console.warn("[WARN] Speech Synthesis not supported. Cannot speak as Jarvis.");
        return;
    }

    // Stop continuous recognition while Jarvis is speaking
    if (recognition && recognition.recognizing) {
        recognitionStopInitiated = true; // Flag that we are intentionally stopping recognition
        recognition.stop();
        console.log("[DEBUG] Temporarily stopping SpeechRecognition while Jarvis speaks.");
    } else {
        console.log("[DEBUG] SpeechRecognition not active, Jarvis can speak without stopping it.");
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; // British English for Jarvis's accent
    utterance.pitch = 1.0;
    utterance.rate = 1.0;

    // Attempt to find a suitable male voice
    const voices = speechSynthesis.getVoices();
    const jarvisVoice = voices.find(voice => voice.name === 'Google UK English Male' && voice.lang === 'en-GB') ||
                        voices.find(voice => voice.name.includes('English') && voice.name.includes('Male')) ||
                        voices.find(voice => voice.default && voice.lang.startsWith('en'));

    if (jarvisVoice) {
        utterance.voice = jarvisVoice;
        console.log(`[DEBUG] Jarvis speaking: "${text}" (Voice: ${jarvisVoice.name})`);
    } else {
        console.warn("[WARN] Google UK English Male voice not found, using default voice.");
        console.log(`[DEBUG] Jarvis speaking: "${text}" (Voice: Default)`);
    }

    // Ensure the AudioContext is started before speaking
    await startAudioContext();

    utterance.onend = () => {
        console.log("[DEBUG] SpeechSynthesis ended.");
        // Re-enable recognition listening if it was active before Jarvis spoke
        if (recognition) {
            console.log("[DEBUG] SpeechSynthesis ended. Attempting to restart SpeechRecognition.");
            // If recognition was stopped specifically for speech, its onend will fire,
            // which should then trigger attemptRestartRecognition.
            // If it wasn't active, we still want to ensure it restarts if we're in continuous listening mode.
            attemptRestartRecognition();
        }
    };

    utterance.onerror = (event) => {
        console.error("[ERROR] Speech synthesis error:", event.error);
        if (recognition) {
            console.log("[DEBUG] SpeechSynthesis error. Attempting to restart SpeechRecognition.");
            attemptRestartRecognition();
        }
    };

    speechSynthesis.speak(utterance);
    console.log("[DEBUG] SpeechSynthesis started.");
}


// --- Timer Logic ---
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = ms % 1000;

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}

function startTimer() {
    if (userSettings.enableSoundEffects) goSound.start();
    running = true;
    startTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        timerDisplay.textContent = formatTime(elapsedTime);
    }, 10);
    scramble3DViewer.setAttribute('visualization', 'none'); // Hide 3D cube during solve
}

function stopTimer() {
    if (userSettings.enableSoundEffects) stopSound.start();
    running = false;
    clearInterval(timerInterval);
    clearInterval(inspectionInterval); // Clear inspection interval if it's running
    const solveTime = Date.now() - startTime;

    let finalTime = solveTime;
    let effectivePenalty = null;

    if (penalty === 2) {
        finalTime += 2000; // Add 2 seconds for +2 penalty
        effectivePenalty = "+2";
    } else if (penalty === 'DNF') {
        finalTime = 'DNF';
        effectivePenalty = "DNF";
    }

    const newSolve = {
        id: crypto.randomUUID(), // Generate a unique ID for the solve
        timestamp: new Date().toISOString(),
        scramble: scramble,
        time: solveTime, // Store raw time for calculation
        formattedTime: finalTime === 'DNF' ? 'DNF' : formatTime(finalTime), // Store DNF or formatted time
        penalty: effectivePenalty,
        cubeType: userSettings.cubeType // Store cube type with the solve
    };
    solves.push(newSolve);
    saveUserData(); // Save to Firestore or local storage
    renderSolveHistory();
    scramble = generateScramble(); // Generate new scramble for next solve
    resetTimer(); // Reset timer display
    penalty = null; // Reset penalty after solve
    hidePenaltyButtons(); // Hide penalty buttons after solve
    showToast("Solve recorded!", "success");

    // Automatically show AI Insight after a solve
    getAiInsight(newSolve.id, newSolve.scramble, newSolve.cubeType, newSolve.time, newSolve.penalty);
}

function startInspection() {
    if (userSettings.enableSoundEffects) inspectionBeep.start();
    currentInspectionTime = inspectionTime; // Start from 15 seconds
    timerDisplay.textContent = `+${currentInspectionTime}`;
    inspectionInterval = setInterval(() => {
        currentInspectionTime--;
        if (currentInspectionTime >= 0) {
            timerDisplay.textContent = `+${currentInspectionTime}`;
            if (currentInspectionTime <= 5 && currentInspectionTime > 0 && userSettings.enableSoundEffects) {
                // Play warning sound (e.g., a beep) for last 5 seconds
                // Tone.js.Sampler or simple oscillator could be used
                // For now, let's just make sure inspectionBeep is defined and called.
                // Assuming inspectionBeep is defined globally and plays a single beep.
                inspectionBeep.start();
            }
        } else {
            // After 0, start actual timer with +2 penalty
            clearInterval(inspectionInterval);
            penalty = 2; // Auto +2 penalty
            startTimer();
            showToast("+2 penalty applied!", "warning");
        }
    }, 1000);
}

function resetTimer() {
    clearInterval(timerInterval);
    clearInterval(inspectionInterval);
    running = false;
    startTime = null;
    timerDisplay.textContent = "00:00.000";
    penalty = null;
    hidePenaltyButtons(); // Ensure penalty buttons are hidden
    // Reset 3D viewer to show scramble
    if (userSettings.show3DCubeView) {
        scramble3DViewer.setAttribute('visualization', userSettings.cubeType);
        scramble3DViewer.setAttribute('alg', scramble);
    } else {
        scramble3DViewer.setAttribute('visualization', 'none');
    }
}

// --- Scramble Generation ---
function generateScramble() {
    let newScramble;
    const cubeType = userSettings.cubeType;
    if (cubeType === '2x2') {
        newScramble = generate2x2Scramble();
    } else if (cubeType === '3x3') {
        newScramble = generate3x3Scramble();
    } else if (cubeType === '4x4') {
        newScramble = generate4x4Scramble();
    } else {
        // Default to 3x3 if unknown type
        newScramble = generate3x3Scramble();
    }
    scrambleDisplay.textContent = newScramble;
    console.log(`[DEBUG] generateScramble: Generated for ${cubeType}: ${newScramble}`);
    update3DViewer(newScramble, cubeType);
    return newScramble;
}

function generate3x3Scramble() {
    const moves = ["R", "L", "F", "B", "U", "D"];
    const suffixes = ["", "'", "2"];
    let scramble = [];
    let lastMoveAxis = -1; // 0 for R/L, 1 for F/B, 2 for U/D

    for (let i = 0; i < 20; i++) { // 20-move scramble
        let moveIndex;
        let currentMoveAxis;

        do {
            moveIndex = Math.floor(Math.random() * moves.length);
            currentMoveAxis = Math.floor(moveIndex / 2); // 0: R/L, 1: F/B, 2: U/D
        } while (currentMoveAxis === lastMoveAxis); // Prevent moves from the same axis consecutively

        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        scramble.push(moves[moveIndex] + suffix);
        lastMoveAxis = currentMoveAxis;
    }
    return scramble.join(" ");
}

function generate2x2Scramble() {
    const moves = ["R", "U", "F"]; // Common moves for 2x2
    const suffixes = ["", "'", "2"];
    let scramble = [];
    for (let i = 0; i < 9; i++) { // Shorter scramble for 2x2
        const move = moves[Math.floor(Math.random() * moves.length)];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        scramble.push(move + suffix);
    }
    return scramble.join(" ");
}

function generate4x4Scramble() {
    const moves = ["R", "L", "F", "B", "U", "D", "r", "u", "f"]; // Wide moves for 4x4
    const suffixes = ["", "'", "2"];
    let scramble = [];
    for (let i = 0; i < 40; i++) { // Longer scramble for 4x4
        const move = moves[Math.floor(Math.random() * moves.length)];
        const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
        scramble.push(move + suffix);
    }
    return scramble.join(" ");
}


function update3DViewer(alg, puzzle) {
    if (scramble3DViewer && userSettings.show3DCubeView) {
        scramble3DViewer.setAttribute('alg', alg);
        scramble3DViewer.setAttribute('puzzle', puzzle === '3x3' ? '3x3x3' : puzzle === '2x2' ? '2x2x2' : '3x3x3'); // Default to 3x3x3
        scramble3DViewer.setAttribute('visualization', puzzle === 'none' ? 'none' : puzzle); // Ensure visualization is 'none' if needed
        console.log(`[DEBUG] 3D Viewer updated with alg: ${alg} and puzzle: ${puzzle}`);
    } else if (scramble3DViewer) {
        scramble3DViewer.setAttribute('visualization', 'none'); // Hide if setting is off
    }
}


// --- Solve History and Statistics ---
function renderSolveHistory() {
    if (!solveHistoryList) {
        console.warn("[WARN] solveHistoryList not defined. Skipping renderSolveHistory.");
        return;
    }
    console.log("[DEBUG] Entering renderSolveHistory.");
    solveHistoryList.innerHTML = ''; // Clear existing list
    const sortedSolves = [...solves].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Newest first

    console.log(`[DEBUG] renderSolveHistory: Rendering ${sortedSolves.length} sorted solves.`);

    sortedSolves.forEach(solve => {
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center bg-gray-700 p-2 rounded-lg mb-2 text-sm';
        li.innerHTML = `
            <span>${solve.formattedTime} (${solve.cubeType}${solve.penalty ? `, ${solve.penalty}` : ''})</span>
            <div class="flex space-x-2">
                <button class="text-blue-400 hover:text-blue-300" onclick="copyToClipboard('${solve.scramble}')" aria-label="Copy scramble"><i class="fas fa-copy"></i></button>
                <button class="text-purple-400 hover:text-purple-300" onclick="getAiInsight('${solve.id}', '${solve.scramble}', '${solve.cubeType}', ${solve.time}, '${solve.penalty}')" aria-label="Get AI Insight"><i class="fas fa-brain"></i></button>
                <button class="text-red-400 hover:text-red-300" onclick="deleteSolve('${solve.id}')" aria-label="Delete solve"><i class="fas fa-trash"></i></button>
            </div>
        `;
        solveHistoryList.appendChild(li);
    });
    updateStatistics();
    console.log("[DEBUG] Exiting renderSolveHistory. Statistics updated.");
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast("Scramble copied to clipboard!", "info");
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        showToast("Failed to copy scramble.", "error");
    });
}

function deleteSolve(id) {
    solves = solves.filter(solve => solve.id !== id);
    saveUserData(); // Save updated solves
    renderSolveHistory(); // Re-render history
    showToast("Solve deleted!", "info");
}

function updateStatistics() {
    if (!bestTimeDisplay || !ao5Display || !ao12Display || !solveCountDisplay) {
        console.warn("[WARN] Statistics display elements not defined. Skipping updateStatistics.");
        return;
    }
    console.log("[DEBUG] Entering updateStatistics.");
    const validSolves = solves.filter(solve => solve.formattedTime !== 'DNF');

    // Best Time
    const bestTime = validSolves.reduce((min, solve) => Math.min(min, solve.time), Infinity);
    bestTimeDisplay.textContent = bestTime === Infinity ? '--:--.--' : formatTime(bestTime);
    console.log(`[DEBUG] Statistics: Best Time: ${bestTimeDisplay.textContent}`);

    // Average of 5 (Ao5)
    ao5Display.textContent = calculateAverage(5, validSolves);
    console.log(`[DEBUG] Statistics: Ao5: ${ao5Display.textContent}`);

    // Average of 12 (Ao12)
    ao12Display.textContent = calculateAverage(12, validSolves);
    console.log(`[DEBUG] Statistics: Ao12: ${ao12Display.textContent}`);

    // Solve Count
    solveCountDisplay.textContent = solves.length;
    console.log(`[DEBUG] Statistics: Solve Count: ${solves.length}`);

    console.log("[DEBUG] Exiting updateStatistics.");
}

function calculateAverage(n, validSolves) {
    console.log(`[DEBUG] Entering calculateAverage for N=${n} with ${validSolves.length} solves.`);
    if (validSolves.length < n) {
        console.log(`[DEBUG] calculateAverage: Not enough solves ( ${validSolves.length} < ${n}). Returning '--:--.--'.`);
        return '--:--.--';
    }

    const lastNSolves = validSolves.slice(-n); // Get the last N solves
    const times = lastNSolves.map(solve => solve.time).sort((a, b) => a - b);
    console.log(`[DEBUG] calculateAverage: Last ${n} solves: (${times.length}) [${times.map(t => `${t}ms (penalty: ${lastNSolves.find(s => s.time === t).penalty})`).join(', ')}]`);

    // Remove fastest and slowest for AoN (typically for N >= 5)
    let solvesToAverage = [...times];
    if (n >= 5) {
        solvesToAverage = times.slice(1, -1); // Remove first (fastest) and last (slowest)
        console.log(`[DEBUG] calculateAverage: Dropped best/worst. Remaining times: (${solvesToAverage.length}) [${solvesToAverage.join(', ')}]`);
    }

    const sum = solvesToAverage.reduce((acc, curr) => acc + curr, 0);
    const averageMs = sum / solvesToAverage.length;
    console.log(`[DEBUG] calculateAverage: Sum: ${sum}, Count: ${solvesToAverage.length}, Avg: ${averageMs}ms, Formatted: ${formatTime(averageMs)}`);

    return formatTime(averageMs);
}


// --- UI and Event Handling ---

// Function to attach all event listeners and assign global DOM element variables
function setupEventListeners() {
    console.log("[DEBUG] setupEventListeners: Assigning event listeners.");

    // Assign DOM elements
    timerDisplay = document.getElementById('timerDisplay');
    scrambleDisplay = document.getElementById('scrambleDisplay');
    scramble3DViewer = document.getElementById('scramble3DViewer');
    ao5Display = document.getElementById('ao5Display');
    ao12Display = document.getElementById('ao12Display');
    bestTimeDisplay = document.getElementById('bestTimeDisplay');
    solveCountDisplay = document.getElementById('solveCountDisplay');
    solveHistoryList = document.getElementById('solveHistoryList');
    penaltyButtons = document.getElementById('penaltyButtons');
    signInBtn = document.getElementById('signInBtn');
    signUpBtn = document.getElementById('signUpBtn');
    signOutBtn = document.getElementById('signOutBtn');
    userEmailDisplay = document.getElementById('userEmailDisplay');
    aiInsightModal = document.getElementById('aiInsightModal');
    closeAiInsightModal = document.getElementById('closeAiInsightModal');
    aiInsightContent = document.getElementById('aiInsightContent');
    insightMessageDisplay = document.getElementById('insightMessage');
    optimalSolutionDisplay = document.getElementById('optimalSolutionDisplay');
    optimalSolutionText = document.getElementById('optimalSolutionText');
    personalizedTipDisplay = document.getElementById('personalizedTipDisplay');
    personalizedTipText = document.getElementById('personalizedTipText');
    settingsModal = document.getElementById('settingsModal');
    closeSettingsModal = document.getElementById('closeSettingsModal');
    openSettingsModal = document.getElementById('openSettingsModal');
    themeSelect = document.getElementById('themeSelect');
    enableSoundEffectsToggle = document.getElementById('enableSoundEffectsToggle');
    enableInspectionToggle = document.getElementById('enableInspectionToggle');
    cubeTypeSelect = document.getElementById('cubeTypeSelect');
    show3DCubeViewToggle = document.getElementById('show3DCubeViewToggle');
    wakeWordInput = document.getElementById('wakeWordInput');
    saveSettingsBtn = document.getElementById('saveSettingsBtn');
    toastContainer = document.getElementById('toast-container');
    spinner = document.querySelector('.spinner'); // Safely assign spinner here

    // Event Listeners for Timer and Spacebar
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault(); // Prevent scrolling
            if (!running && startTime === null) {
                // Pre-inspection or ready to start
                timerDisplay.style.color = 'lime'; // Green indicating ready
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            timerDisplay.style.color = 'var(--timer-color)'; // Reset color
            if (!running && startTime === null) {
                // Timer not started, start inspection or actual timer
                if (userSettings.enableInspection) {
                    startInspection();
                } else {
                    startTimer();
                }
            } else if (running) {
                // Timer is running, stop it
                stopTimer();
            }
        }
    });

    // Event Listeners for Penalty Buttons
    document.getElementById('plus2Btn').addEventListener('click', () => {
        penalty = 2;
        showToast("Next solve will have +2 penalty.", "info");
    });
    document.getElementById('dnfBtn').addEventListener('click', () => {
        penalty = 'DNF';
        showToast("Next solve will be DNF.", "info");
    });
    document.getElementById('resetPenaltyBtn').addEventListener('click', () => {
        penalty = null;
        showToast("Penalty reset.", "info");
        hidePenaltyButtons();
    });

    // Authentication Buttons
    if (signInBtn) signInBtn.addEventListener('click', handleSignIn);
    if (signUpBtn) signUpBtn.addEventListener('click', handleSignUp);
    if (signOutBtn) signOutBtn.addEventListener('click', handleSignOut);

    // AI Insight Modal
    if (closeAiInsightModal) closeAiInsightModal.addEventListener('click', hideAiInsightModal);

    // Settings Modal
    if (openSettingsModal) openSettingsModal.addEventListener('click', showSettingsModal);
    if (closeSettingsModal) closeSettingsModal.addEventListener('click', hideSettingsModal);

    // Settings form change listeners
    if (themeSelect) themeSelect.addEventListener('change', (e) => {
        userSettings.theme = e.target.value;
        applySettingsToUI();
    });
    if (enableSoundEffectsToggle) enableSoundEffectsToggle.addEventListener('change', (e) => {
        userSettings.enableSoundEffects = e.target.checked;
        applySettingsToUI();
    });
    if (enableInspectionToggle) enableInspectionToggle.addEventListener('change', (e) => {
        userSettings.enableInspection = e.target.checked;
        applySettingsToUI();
    });
    if (cubeTypeSelect) cubeTypeSelect.addEventListener('change', (e) => {
        userSettings.cubeType = e.target.value;
        applySettingsToUI();
    });
    if (show3DCubeViewToggle) show3DCubeViewToggle.addEventListener('change', (e) => {
        userSettings.show3DCubeView = e.target.checked;
        applySettingsToUI();
    });
    if (wakeWordInput) wakeWordInput.addEventListener('input', (e) => {
        userSettings.wakeWord = e.target.value.trim().toLowerCase();
    });
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => {
        saveUserData();
        showToast("Settings saved!", "success");
        hideSettingsModal();
    });
}

// Function to apply settings to UI
async function applySettingsToUI() {
    // Apply theme
    document.body.className = `theme-${userSettings.theme}`;

    // Update toggles and selects
    if (enableSoundEffectsToggle) enableSoundEffectsToggle.checked = userSettings.enableSoundEffects;
    if (enableInspectionToggle) enableInspectionToggle.checked = userSettings.enableInspection;
    if (cubeTypeSelect) cubeTypeSelect.value = userSettings.cubeType;
    if (show3DCubeViewToggle) show3DCubeViewToggle.checked = userSettings.show3DCubeView;
    if (wakeWordInput) wakeWordInput.value = userSettings.wakeWord;

    // Regenerate scramble if cube type changed or 3D view toggle
    scramble = generateScramble();
    console.log("[DEBUG] UI settings applied and scramble regenerated.");
    // Re-render history and update stats in case cubeType affects averages/display
    renderSolveHistory();
    console.log("[DEBUG] Exiting applySettingsToUI.");
}


// --- Modals and Toasts ---
function showAiInsightModal(message = "Generating insight...") {
    if (aiInsightModal) {
        insightMessageDisplay.textContent = message;
        aiInsightModal.style.display = 'block';
        aiInsightModal.setAttribute('aria-hidden', 'false');
    }
}

function hideAiInsightModal() {
    if (aiInsightModal) {
        aiInsightModal.style.display = 'none';
        aiInsightModal.setAttribute('aria-hidden', 'true');
        if (spinner) spinner.style.display = 'none'; // Hide spinner
        console.log("[DEBUG] AI Insight modal closed by button.");
    }
}

function showSettingsModal() {
    if (settingsModal) {
        // Populate settings in the modal from current userSettings
        if (themeSelect) themeSelect.value = userSettings.theme;
        if (enableSoundEffectsToggle) enableSoundEffectsToggle.checked = userSettings.enableSoundEffects;
        if (enableInspectionToggle) enableInspectionToggle.checked = userSettings.enableInspection;
        if (cubeTypeSelect) cubeTypeSelect.value = userSettings.cubeType;
        if (show3DCubeViewToggle) show3DCubeViewToggle.checked = userSettings.show3DCubeView;
        if (wakeWordInput) wakeWordInput.value = userSettings.wakeWord;

        settingsModal.style.display = 'block';
        settingsModal.setAttribute('aria-hidden', 'false');
    }
}

function hideSettingsModal() {
    if (settingsModal) {
        settingsModal.style.display = 'none';
        settingsModal.setAttribute('aria-hidden', 'true');
    }
}


function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) {
        console.warn("[WARN] Toast container not found.");
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`; // 'toast info', 'toast success', 'toast error', 'toast warning'
    toast.textContent = message;
    toastContainer.appendChild(toast);

    // Auto-hide after duration
    setTimeout(() => {
        toast.remove();
    }, duration);
}

function showPenaltyButtons() {
    if (penaltyButtons) {
        penaltyButtons.style.display = 'flex'; // Use flex to show
    }
}

function hidePenaltyButtons() {
    if (penaltyButtons) {
        penaltyButtons.style.display = 'none'; // Hide buttons
    }
}


// --- Sound Effects (Tone.js) ---
let startSound, stopSound, inspectionBeep, goSound;

function initializeSound() {
    // Define the synths only once
    startSound = new Tone.MembraneSynth().toDestination();
    stopSound = new Tone.MetalSynth().toDestination();
    inspectionBeep = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.0, release: 0.1 }
    }).toDestination();
    goSound = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.05, decay: 0.1, sustain: 0.0, release: 0.1 }
    }).toDestination();

    console.log("[DEBUG] Tone.js startSound initialized.");
    console.log("[DEBUG] Tone.js stopSound initialized.");
    console.log("[DEBUG] Tone.js inspectionBeep initialized.");
    console.log("[DEBUG] Tone.js goSound initialized.");
}


// --- Initialize Application on Window Load ---
window.onload = async () => {
    console.log("[DEBUG] window.onload triggered. Initializing DOM elements and listeners.");

    // Initialize Tone.js sounds
    initializeSound();
    console.log("[DEBUG] Initial settings variables set.");

    setupEventListeners(); // Attaches all event listeners and assigns global DOM element variables.
    domElementsReady = true; // Set the flag to indicate DOM elements are ready

    // Initialize core features that need DOM elements ready
    scramble = generateScramble(); // Generates initial scramble and updates displays

    // Attempt to initialize user data and settings now that DOM is ready.
    // This function itself checks if Firebase Auth is also ready.
    await initializeUserDataAndSettings(); // Use await here

    // Start continuous listening for wake word if Web Speech API is supported
    if (recognition) {
        try {
            console.log("[DEBUG] Initial SpeechRecognition.start() called for continuous wake word listening via attemptRestartRecognition.");
            attemptRestartRecognition(); // Use the controlled restart for initial start
        } catch (e) {
            console.error("[ERROR] Initial recognition.start() failed:", e);
        }
    } else {
        console.warn("[WARN] Web Speech API not supported, cannot start continuous listening.");
    }

    console.log("[DEBUG] window.onload complete. Application should now be fully initialized.");
};

