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
service cloud.firestore {
  match /databases/{database}/documents {
    // Rule for private user data: Allows read/write only if the user is authenticated
    // and the 'userId' in the path matches their authenticated UID.
    // This now only applies to explicitly signed-in users.
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
*/
// =====================================================================================================

// =====================================================================================================
// --- IMPORTANT: Firebase Authentication Methods (MUST BE ENABLED IN FIREBASE CONSOLE) ---
// To allow users to sign in (with email/password, or Google),
// you MUST enable these sign-in providers in your Firebase project.
// Go to Firebase Console -> Authentication -> Sign-in method tab.
// - Ensure 'Email/Password' provider is enabled.
// - Ensure 'Google' provider is enabled (if you intend to use Google Sign-In).
// - IMPORTANT: The 'Anonymous' provider is no longer used by this client-side code.
// =====================================================================================================


// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting ---
// REPLACE THE PLACEHOLDER VALUES BELOW WITH YOUR ACTUAL FIREBASE PROJECT CONFIGURATION.
// You can find these in your Firebase project settings -> Project settings -> General -> Your apps -> Firebase SDK snippet (Config).
// The API key you found: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M" will now be accepted by the validation.
//
// NOTE: The geminiApiKey is handled by a serverless function for security.
// You will need to deploy a Vercel Serverless Function for AI Insight.
// =====================================================================================================
const appId = 'my-production-speedcube-timer'; // A unique ID for your app's data in e.g., 'rubik-timer-prod-v1'
const firebaseConfig = {
    apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M", // This is the key you found in your console.
    authDomain: "ubically-timer.firebaseapp.com",
    projectId: "ubically-timer",
    storageBucket: "ubically-timer.firebaseystorage.app",
    messagingSenderId: "467118524389",
    appId: "1:467118524389:web:d3455f5be5747be2cb910c",
    measurementId: "G-6033SRP9WC"
};
// The URL for your deployed Vercel Serverless Function for AI insights.
// This will be provided AFTER you deploy the function to Vercel and then updated here.
const geminiInsightFunctionUrl = "https://cube-timer-ten.vercel.app/api/gemini-insight";
// NEW: The URL for your deployed Vercel Serverless Function for Gemini NLU.
// You will need to deploy api/gemini-nlu.py and update this URL.
const geminiNluFunctionUrl = "https://cube-timer-ten.vercel.app/api/gemini-nlu"; // <<< IMPORTANT: Update this after deployment!
// =====================================================================================================
// --- END IMPORTANT CONFIGURATION ---
// =====================================================================================================

console.log(`[DEBUG] App ID: ${appId}`);
// ADDED: Log the actual firebaseConfig object for debugging
console.log("[DEBUG] firebaseConfig received:", JSON.stringify(firebaseConfig, null, 2));


let app;
let db; // Firestore instance
let auth; // Auth instance
let userId = null; // Will be Firebase UID or a local UUID for guests
let isAuthReady = false; // Flag to indicate if Firebase auth state has been determined
let domElementsReady = false; // New flag to indicate all DOM elements are assigned
let isUserAuthenticated = false; // NEW: True if user is signed in via Email/Google, false for guests/signed out
let audioContextResumed = false; // NEW: Flag to track if AudioContext has been resumed by user gesture

// --- AudioContext Resume Listener (NEW) ---
// This listener ensures that Tone.js AudioContext is resumed only after a direct user gesture.
// It's added to the body and removes itself after the first execution.
const resumeAudioContextOnFirstGesture = async () => {
    // Only attempt to resume if the context is suspended and not already resumed by our flag
    if (!audioContextResumed) {
        try {
            // Attempt to resume the underlying AudioContext directly if it's suspended
            if (Tone.context.state === 'suspended') {
                await Tone.context.resume();
                console.log("[DEBUG] Tone.js AudioContext explicitly resumed.");
            }
            // Now start Tone.js, which will ensure its internal state is 'running'
            await Tone.start();
            audioContextResumed = true;
            console.log("[DEBUG] Tone.js AudioContext successfully started/resumed by user gesture.");
        } catch (e) {
            console.error("[ERROR] Failed to resume Tone.js AudioContext on user gesture:", e);
        }
    }
    // Remove the listeners after the first interaction to prevent multiple calls
    document.body.removeEventListener('click', resumeAudioContextOnFirstGesture);
    document.body.removeEventListener('touchstart', resumeAudioContextOnFirstGesture);
};

// Attach the one-time listeners
document.body.addEventListener('click', resumeAudioContextOnFirstGesture);
document.body.addEventListener('touchstart', resumeAudioContextOnFirstGesture);


/**
 * Function to fetch and display username from Firestore for authenticated users,
 * or set to "Guest" for local users.
 */
async function fetchAndDisplayUsername(uid, email = null, displayName = null) {
    console.log(`[DEBUG] Entering fetchAndDisplayUsername for UID: ${uid}`);
    const usernameDisplayElement = document.getElementById('usernameDisplay');
    if (!usernameDisplayElement) {
        console.warn("[WARN] fetchAndDisplayUsername: usernameDisplayElement not found. Skipping username display.");
        return;
    }

    if (isUserAuthenticated && db && uid) { // Authenticated user, fetch from Firestore
        const userProfileRef = doc(db, `artifacts/${appId}/users/${uid}/profile/data`);
        try {
            console.log(`[DEBUG] Attempting to get user profile from Firestore: ${userProfileRef.path}`);
            const docSnap = await getDoc(userProfileRef);
            let customUsername = null;

            if (docSnap.exists() && docSnap.data().username) {
                customUsername = docSnap.data().username;
                console.log(`[DEBUG] User profile exists. Username: ${customUsername}`);
            } else {
                console.log("[DEBUG] User profile not found or no username. Generating default.");
                let defaultUsername = displayName || (email ? email.split('@')[0] : 'User');
                await setDoc(userProfileRef, { username: defaultUsername }, { merge: true });
                console.log(`[DEBUG] Default username created and saved: ${defaultUsername}`);
                customUsername = defaultUsername;
            }
            // MODIFIED: Ensure only the username is set, "Current User: " is in HTML
            usernameDisplayElement.textContent = customUsername;
            console.log(`[DEBUG] Username display updated to: ${usernameDisplayElement.textContent}`);

        } catch (e) {
            console.error("[ERROR] Error fetching or setting username:", e);
            // MODIFIED: Ensure only the UID is set for error, "Current User: " is in HTML
            usernameDisplayElement.textContent = `${uid} (Error fetching username)`;
        }
    } else { // Guest user (local storage)
        // MODIFIED: Ensure only 'Guest' is set, "Current User: " is in HTML
        usernameDisplayElement.textContent = 'Guest';
        console.log(`[DEBUG] Username display updated to: Guest (Local Mode)`);
    }
    console.log("[DEBUG] Exiting fetchAndDisplayUsername.");
}


// This function attempts to initialize user data and settings (Firestore listener, settings load).
// It will only proceed if both `domElementsReady` AND `isAuthReady` are true.
const initializeUserDataAndSettings = async () => {
    console.log("[DEBUG] initializeUserDataAndSettings called.");
    if (!domElementsReady) {
        console.log("[DEBUG] Deferred initializeUserDataAndSettings: DOM not ready. Waiting.");
        return;
    }
    if (!isAuthReady) {
        console.log("[DEBUG] Deferred initializeUserDataAndSettings: Auth not ready. Waiting.");
        return;
    }

    // NEW: Conditional initialization based on authentication status
    if (isUserAuthenticated && db && userId) {
        console.log("[DEBUG] Authenticated user. Proceeding with Firestore data initialization.");
        // Use a simple attribute flag on an element to prevent duplicate initialization
        if (solveHistoryList && !solveHistoryList.hasAttribute('data-initialized-firestore')) {
            await loadUserSettings(); // This loads settings and calls applySettingsToUI
            setupRealtimeSolvesListener(); // This sets up onSnapshot listener
            solveHistoryList.setAttribute('data-initialized-firestore', 'true'); // Mark as initialized
        } else {
            console.log("[DEBUG] Firestore user data/settings already initialized.");
        }
    } else { // Guest user (not authenticated via Email/Google)
        console.log("[DEBUG] Guest user. Proceeding with Local Storage data initialization.");
        // Use a simple attribute flag on an element to prevent duplicate initialization
        if (solveHistoryList && !solveHistoryList.hasAttribute('data-initialized-local')) {
            loadLocalUserSettings(); // Load settings from local storage
            loadLocalSolves();       // Load solves from local storage
            renderSolveHistory();    // Render local solves
            solveHistoryList.setAttribute('data-initialized-local', 'true'); // Mark as initialized
        } else {
            console.log("[DEBUG] Local user data/settings already initialized.");
        }
    }
    // Ensure timer/scramble are reset/generated regardless of auth state
    resetTimer();
    console.log("[DEBUG] initializeUserDataAndSettings completed.");
};

// Helper to check if Firebase config is valid (more robust than just checking for non-empty strings)
function isFirebaseConfigValid(config) {
    // This function now only checks for basic presence, letting Firebase SDK handle deeper validity.
    return config && config.apiKey && config.authDomain && config.projectId;
}

// --- Firebase Initialization and Auth Listener ---
// This block runs immediately when the script loads.
// It sets up Firebase and the authentication listener.
if (isFirebaseConfigValid(firebaseConfig)) { // Use the robust check here
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    console.log("[DEBUG] Firebase initialized. Setting up auth state listener.");

    onAuthStateChanged(auth, async (user) => {
        console.log("[DEBUG] onAuthStateChanged callback triggered. User:", user ? user.uid : "null");
        if (user && !user.isAnonymous) { // User is explicitly signed in (Email/Google)
            userId = user.uid;
            isUserAuthenticated = true; // Set flag
            isAuthReady = true;

            // Update UI for authenticated user (buttons can be accessed before general app init)
            const signInBtn = document.getElementById('signInBtn');
            const signUpBtn = document.getElementById('signUpBtn');
            const signOutBtn = document.getElementById('signOutBtn');
            if (signInBtn) signInBtn.style.display = 'none';
            if (signUpBtn) signUpBtn.style.display = 'none';
            if (signOutBtn) signOutBtn.style.display = 'inline-block';
            console.log("[DEBUG] Auth UI updated for signed in user.");

            await fetchAndDisplayUsername(user.uid, user.email, user.displayName);
            console.log("[DEBUG] Username fetched and displayed.");

            initializeUserDataAndSettings(); // Attempt to initialize user data/settings
        } else { // User is signed out (including if they were previously anonymous)
            console.log("[DEBUG] User not authenticated (signed out). Initializing as Guest.");
            userId = `guest-${crypto.randomUUID()}`; // Use a new local UUID for guest session
            isUserAuthenticated = false; // Set flag
            isAuthReady = true;

            // Update UI for guest user
            const usernameDisplayElement = document.getElementById('usernameDisplay');
            // MODIFIED: Simplified Guest display
            if (usernameDisplayElement) usernameDisplayElement.textContent = 'Guest';
            const signInBtn = document.getElementById('signInBtn');
            const signUpBtn = document.getElementById('signUpBtn');
            const signOutBtn = document.getElementById('signOutBtn');
            if (signInBtn) signInBtn.style.display = 'inline-block';
            if (signUpBtn) signUpBtn.style.display = 'inline-block';
            if (signOutBtn) signOutBtn.style.display = 'none';
            console.log("[DEBUG] Auth UI updated for guest user.");

            initializeUserDataAndSettings(); // Attempt to initialize in local storage mode
        }
    });
} else {
    // Offline/guest mode (Firebase config missing or incomplete)
    console.warn("[DEBUG] Firebase config missing or incomplete. Running in offline/guest mode without persistent storage (solves will not be saved beyond session).");
    userId = `guest-${crypto.randomUUID()}`; // Fallback for no Firebase config/validity
    isUserAuthenticated = false; // Not authenticated
    isAuthReady = true; // Auth state determined (offline)

    const usernameDisplayElement = document.getElementById('usernameDisplay');
    // MODIFIED: Simplified Offline Guest display
    if (usernameDisplayElement) usernameDisplayElement.textContent = 'Guest (Offline Mode)';
    const signInBtn = document.getElementById('signInBtn');
    const signUpBtn = document.getElementById('signUpBtn');
    const signOutBtn = document.getElementById('signOutBtn');
    if (signInBtn) signInBtn.style.display = 'inline-block';
    if (signUpBtn) signUpBtn.style.display = 'inline-block';
    if (signOutBtn) signOutBtn.style.display = 'none';
    initializeUserDataAndSettings(); // Attempt to initialize in offline mode
}

/**
 * Determines the user's cubing level based on solve time for a 3x3 cube.
 * This is a simple heuristic and can be adjusted.
 * @param {number} solveTimeMs - The solve time in milliseconds.
 * @param {string} cubeType - The type of cube (e.g., '3x3').
 * @returns {string} The estimated level (e.g., "Beginner", "Intermediate", "Advanced", "Expert").
 */
function getUserLevel(solveTimeMs, cubeType) {
    console.log(`[DEBUG] Determining user level for ${cubeType} solve time: ${solveTimeMs}ms`);
    if (cubeType === '3x3') {
        if (solveTimeMs > 120000) return "Beginner"; // Over 2 minutes (120,000 ms)
        if (solveTimeMs > 60000) return "Novice";   // 1-2 minutes (60,000 ms)
        if (solveTimeMs > 30000) return "Intermediate"; // 30-60 seconds (30,000 ms)
        if (solveTimeMs > 15000) return "Advanced";   // 15-30 seconds (15,000 ms)
        return "Expert"; // Under 15 seconds
    }
    // Add more cube types and their thresholds here if needed
    return "General Cubist"; // Default for other cube types or if not specified
}

/**
 * Fetches an AI-generated insight for a specific solve from the Cloud Function.
 * @param {string} solveId - The ID of the solve for which to generate an insight.
 */
window.getSolveInsight = async function (solveId) {
    console.log(`[DEBUG] Requesting AI insight for solve ID: ${solveId}`);
    const solve = solves.find(s => s.id === solveId);

    if (!solve) {
        if (insightMessageElement) insightMessageElement.textContent = "Error: Solve not found.";
        if (insightSpinner) insightSpinner.style.display = 'none';
        if (aiInsightModal) aiInsightModal.classList.add('open');
        console.error(`[ERROR] Solve with ID ${solveId} not found.`);
        return;
    }

    // Display loading state and hide previous content
    if (insightMessageElement) insightMessageElement.textContent = "Generating insight...";
    if (insightSpinner) insightSpinner.style.display = 'block';
    // Removed optimalSolutionDisplay references
    if (personalizedTipDisplay) personalizedTipDisplay.style.display = 'none';
    if (scrambleAnalysisDisplay) scrambleAnalysisDisplay.style.display = 'none';
    // NEW: Hide targetedPracticeFocusDisplay during loading
    if (targetedPracticeFocusDisplay) targetedPracticeFocusDisplay.style.display = 'none';

    if (aiInsightModal) {
        aiInsightModal.classList.add('open');
        aiInsightModal.focus(); // Focus the modal for accessibility
    }

    // Determine user level for personalized tip
    const userLevel = getUserLevel(solve.time, cubeType);

    // Prepare the data to send to the Cloud Function
    const requestData = {
        type: "get_insight", // Indicate the type of request
        scramble: solve.scramble,
        cubeType: cubeType,
        solveTimeMs: solve.time,
        penalty: solve.penalty,
        userLevel: userLevel
    };

    // Use the Cloud Function URL
    const apiUrl = geminiInsightFunctionUrl; // Corrected to use the variable directly

    // Now, this check truly verifies if the URL is set.
    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        if (insightMessageElement) insightMessageElement.textContent = "AI Insight Cloud Function URL not configured. Please ensure your Vercel function is deployed and the URL is correct.";
        if (insightSpinner) insightSpinner.style.display = 'none';
        console.error("[ERROR] Gemini Insight Cloud Function URL is not set or is default placeholder.");
        speakAsJarvis("Sir Sevindu, the AI insight system is currently offline. Please configure the cloud function URL.");
        return;
    }

    try {
        console.log("[DEBUG] Making Cloud Function call for insight with data:", requestData);
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloud Function error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("[DEBUG] Cloud Function raw response:", result);

        // Display insights
        if (result.insight && insightMessageElement) {
            insightMessageElement.textContent = result.insight;
            insightMessageElement.style.display = 'block';
        } else {
            insightMessageElement.textContent = "General insight unavailable.";
        }

        // Display Scramble Analysis
        if (result.scrambleAnalysis && scrambleAnalysisText && scrambleAnalysisDisplay) {
            scrambleAnalysisText.textContent = result.scrambleAnalysis;
            scrambleAnalysisDisplay.style.display = 'block';
        } else {
            if (scrambleAnalysisDisplay) scrambleAnalysisDisplay.style.display = 'none';
        }

        // Removed optimalSolutionText references
        // if (result.optimalSolution && optimalSolutionText && optimalSolutionDisplay) {
        //     optimalSolutionText.textContent = result.optimalSolution;
        //     optimalSolutionDisplay.style.display = 'block';
        // } else {
        //     if (optimalSolutionDisplay) optimalSolutionDisplay.style.display = 'none';
        // }

        // NEW: Display Targeted Practice Focus
        if (result.targetedPracticeFocus && targetedPracticeFocusText && targetedPracticeFocusDisplay) {
            targetedPracticeFocusText.textContent = result.targetedPracticeFocus;
            targetedPracticeFocusDisplay.style.display = 'block';
        } else {
            if (targetedPracticeFocusDisplay) targetedPracticeFocusDisplay.style.display = 'none';
        }


        if (result.personalizedTip && personalizedTipText && personalizedTipDisplay) {
            personalizedTipText.textContent = result.personalizedTip;
            personalizedTipDisplay.style.display = 'block';
            // We only speak the tip, as the overall Jarvis persona handles the greeting
            // speakAsJarvis(`Sir Sevindu, my analysis suggests: ${result.personalizedTip}`);
        } else {
            if (personalizedTipDisplay) personalizedTipDisplay.style.display = 'none';
        }

        console.log("[DEBUG] Cloud Function response received and displayed.");

    } catch (e) {
        if (insightMessageElement) insightMessageElement.textContent = `Failed to get insight: ${e.message}`;
        console.error("[ERROR] Error calling Cloud Function:", e);
        speakAsJarvis(`Sir Sevindu, I encountered an error while generating insight: ${e.message}`);
    } finally {
        if (insightSpinner) insightSpinner.style.display = 'none'; // Hide spinner
        console.log("[DEBUG] AI Insight generation process completed.");
    }
};

/**
 * Fetches an AI-generated algorithm or explanation for a given query.
 * @param {string} query - The user's query about an algorithm or concept.
 * @returns {Promise<string>} A promise that resolves with the AI's response.
 */
async function getAlgorithmOrExplanation(query) {
    console.log(`[DEBUG] Requesting algorithm/explanation for query: "${query}"`);

    const requestData = {
        type: "get_algorithm", // New type for algorithm requests
        query: query
    };

    const apiUrl = geminiInsightFunctionUrl; // Re-using insight function for now, could be a separate endpoint

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        console.error("[ERROR] Gemini Insight Cloud Function URL not configured for algorithm lookup.");
        return "Sir Sevindu, my knowledge base is currently offline. Please configure the cloud function URL.";
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloud Function error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("[DEBUG] Algorithm/Explanation Cloud Function raw response:", result);

        if (result.algorithm || result.explanation) {
            return result.algorithm || result.explanation;
        } else {
            return "Pardon me, Sir Sevindu. I could not find information for that algorithm or concept.";
        }

    } catch (e) {
        console.error("[ERROR] Error calling Cloud Function for algorithm/explanation:", e);
        return `Sir Sevindu, I encountered an error retrieving that information: ${e.message}`;
    }
}

/**
 * Fetches a general answer from the AI for a given query.
 * This is used for questions about cubing concepts, history, or the web application itself.
 * @param {string} query - The user's general question.
 * @returns {Promise<string>} A promise that resolves with the AI's answer.
 */
async function getGeneralAnswer(query) {
    console.log(`[DEBUG] Requesting general answer for query: "${query}"`);

    const requestData = {
        type: "get_answer", // New type for general questions
        query: query
    };

    const apiUrl = geminiInsightFunctionUrl; // Using the same insight function endpoint

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        console.error("[ERROR] Gemini Insight Cloud Function URL not configured for general answers.");
        return "Sir Sevindu, my knowledge base is currently offline. Please configure the cloud function URL.";
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloud Function error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("[DEBUG] General Answer Cloud Function raw response:", result);

        if (result.answer) {
            return result.answer;
        } else {
            return "Pardon me, Sir Sevindu. I could not find an answer to that question.";
        }

    } catch (e) {
        console.error("[ERROR] Error calling Cloud Function for general answer:", e);
        return `Sir Sevindu, I encountered an error retrieving that information: ${e.message}`;
    }
}

/**
 * Requests a structured lesson from the AI.
 * @param {string} topic - The topic for the lesson (e.g., "F2L Introduction").
 * @param {string} cubeType - The type of cube (e.g., "3x3").
 * @param {string} userLevel - The user's cubing level (e.g., "Intermediate").
 * @returns {Promise<Object|null>} A promise that resolves with the lesson data or null on error.
 */
async function requestLessonFromAI(topic, cubeType, userLevel) {
    console.log(`[DEBUG] Requesting lesson from AI for topic: "${topic}", cubeType: "${cubeType}", userLevel: "${userLevel}"`);

    if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'block';
    if (lessonGenerationError) lessonGenerationError.style.display = 'none';
    if (lessonContentDisplay) lessonContentDisplay.style.display = 'none'; // Hide previous content

    const requestData = {
        type: "generate_lesson",
        topic: topic,
        cubeType: cubeType,
        userLevel: userLevel
    };

    const apiUrl = geminiInsightFunctionUrl; // Using the same insight function endpoint

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        console.error("[ERROR] Gemini Insight Cloud Function URL not configured for lesson generation.");
        if (lessonGenerationError) {
            lessonGenerationError.textContent = "AI Lesson service not configured. Please check the backend URL.";
            lessonGenerationError.style.display = 'block';
        }
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
        speakAsJarvis("Sir Sevindu, the AI lesson service is currently offline. Please configure the cloud function URL.");
        return null;
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloud Function error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("[DEBUG] Lesson Generation Cloud Function raw response:", result);

        if (result.lessonTitle && result.steps) {
            if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
            displayLesson(result);
            return result;
        } else {
            if (lessonGenerationError) {
                lessonGenerationError.textContent = "AI could not generate a complete lesson for that topic. Please try a different query.";
                lessonGenerationError.style.display = 'block';
            }
            if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
            speakAsJarvis("Pardon me, Sir Sevindu. I could not generate a complete lesson for that topic. Please try a different query.");
            return null;
        }

    } catch (e) {
        console.error("[ERROR] Error calling Cloud Function for lesson generation:", e);
        if (lessonGenerationError) {
            lessonGenerationError.textContent = `Failed to generate lesson: ${e.message}`;
            lessonGenerationError.style.display = 'block';
        }
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
        speakAsJarvis(`Sir Sevindu, I encountered an error while generating the lesson: ${e.message}`);
        return null;
    }
}


// --- Timer Variables ---
let startTime;
let elapsedTime = 0;
let timerInterval;
let isInspecting = false;
let isTiming = false;
let inspectionTimeLeft = 15;
let inspectionCountdownInterval;
let scramble = '';
let solves = []; // Array to store solve objects: [{ id: uuid, time: ms, penalty: null|'+2'|'DNF', timestamp: date, scramble: string }]
let spaceDownTime = 0; // Initialize here, directly in the module scope.

// Declare DOM element variables globally, assign them in window.onload
let timerDisplay;
let scrambleTextDisplay; // Renamed
let cube3DContainer;     // New
let scramble3DViewer;    // New (now twisty-player)
let startStopBtn;
let resetBtn;
let scrambleBtn;
let settingsBtn;
let solveHistoryList;
let bestTimeDisplay;
let ao5Display;
let ao12Display;
let solveCountDisplay;
let noSolvesMessage;
let inspectionToggle;
let soundEffectsToggle;
let cubeTypeSelect;
let themeSelect;
let cubeViewToggle; // New
let settingsUsernameInput;
let saveUsernameBtn;
let usernameUpdateMessage;
let aiInsightModal;
let closeAiInsightModalBtn;
let aiInsightContentDisplay;
let insightMessageElement;
let insightSpinner;
let scrambleAnalysisDisplay; // NEW
let scrambleAnalysisText;    // NEW
// Removed optimalSolutionDisplay and optimalSolutionText
// let optimalSolutionDisplay;
// let optimalSolutionText;
let personalizedTipDisplay; // New
let personalizedTipText;    // New
// NEW: Targeted Practice Focus elements
let targetedPracticeFocusDisplay;
let targetedPracticeFocusText;

// New variables for toolbar buttons
let playPreviewBtn;
let pausePreviewBtn;
let restartPreviewBtn;
// Voice command button
let voiceCommandBtn; // New
let voiceFeedbackDisplay; // NEW: Element for voice feedback
let voiceListeningText;   // NEW: Text inside voice feedback
let voiceListeningIndicator; // NEW: Indicator dots
let voiceLiveTranscript; // NEW: Element to show live recognized text

// Chatbox elements
let chatModal;
let closeChatModalBtn;
let chatHistoryDisplay;
let chatInput;
let chatSendBtn;
let openChatBtn;

// NEW: Lessons Button
let openLessonsBtn;

// Lessons Modal elements (NEW)
let lessonsModal;
let closeLessonsModalBtn;
let lessonModalTitle;
let lessonTopicSelection;
let lessonTopicInput;
let generateLessonBtn;
let lessonGenerationError;
let lessonContentDisplay;
let lessonTitleDisplay;
let lessonDescriptionDisplay;
let lessonStepsContainer;
let lessonStepTitleDisplay;
let lessonStepDescriptionDisplay;
let lessonVisualContainer;
let lessonExplanationDisplay;
let prevLessonStepBtn;
let nextLessonStepBtn;
let lessonStepCounter;
let lessonLoadingSpinner;

// Lesson state variables (NEW)
let currentLesson = null;
let currentLessonStepIndex = 0;


// NEW: State variables for SpeechRecognition management
let isContinuousListeningEnabled = true; // User's preference for continuous voice input
let isRecognitionActive = false; // Reflects actual state of browser SpeechRecognition API
let awaitingActualCommand = false; // True after wake word, waiting for command
let commandTimeoutId = null; // To clear timeout for awaitingActualCommand
let isStartingRecognition = false; // Flag to prevent multiple recognition.start() calls
let recognitionRestartTimeoutId = null; // To debounce recognition restarts

// Added variables for no-speech error tracking
let noSpeechErrorCount = 0; // This is now redundant with noSpeechErrorTimestamps.
const NO_SPEECH_ERROR_LIMIT = 5;
const NO_SPEECH_ERROR_TIME_WINDOW_MS = 60000; // 1 minute
let noSpeechErrorTimestamps = [];

// Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SpeechSynthesis = window.SpeechSynthesisUtterance;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
const synth = window.speechSynthesis;

/**
 * Updates the visual voice feedback display.
 * @param {string} text - The main text to display (e.g., "Listening for 'Jarvis'...").
 * @param {boolean} showIndicator - Whether to show the bouncing dots indicator.
 * @param {boolean} showDisplay - Whether to show or hide the entire display.
 * @param {boolean} isSpeaking - Whether Jarvis is currently speaking (for speaking animation).
 * @param {string} [liveTranscriptText] - Optional: The live, interim recognized text from the user.
 */
function updateVoiceFeedbackDisplay(text, showIndicator, showDisplay, isSpeaking = false, liveTranscriptText = '') {
    if (voiceFeedbackDisplay) {
        if (showDisplay) {
            voiceFeedbackDisplay.classList.add('listening-active');
        } else {
            voiceFeedbackDisplay.classList.remove('listening-active');
        }

        // Add/remove 'speaking' class based on isSpeaking flag
        if (isSpeaking) {
            voiceFeedbackDisplay.classList.add('speaking');
        } else {
            voiceFeedbackDisplay.classList.remove('speaking');
        }
    }
    if (voiceListeningText) {
        voiceListeningText.textContent = text;
    }
    if (voiceListeningIndicator) {
        voiceListeningIndicator.style.display = showIndicator ? 'flex' : 'none';
    }
    // NEW: Update live transcript display
    if (voiceLiveTranscript) {
        if (liveTranscriptText) {
            voiceLiveTranscript.textContent = liveTranscriptText;
            voiceLiveTranscript.style.display = 'block';
        } else {
            voiceLiveTranscript.textContent = '';
            voiceLiveTranscript.style.display = 'none';
        }
    }
}

/**
 * Attempts to start or restart SpeechRecognition after a delay.
 * Ensures only one start attempt is active at a time to prevent InvalidStateError.
 * This version includes more robust error handling and state management.
 */
function attemptRestartRecognition() {
    // Check if continuous listening is even enabled by the user
    if (!isContinuousListeningEnabled) {
        console.log("[DEBUG] attemptRestartRecognition: Continuous listening is disabled. Not starting recognition.");
        return;
    }

    // Check if no-speech error count exceeded limit within time window
    const now = Date.now();
    // Remove timestamps older than time window
    noSpeechErrorTimestamps = noSpeechErrorTimestamps.filter(ts => now - ts < NO_SPEECH_ERROR_TIME_WINDOW_MS);
    if (noSpeechErrorTimestamps.length >= NO_SPEECH_ERROR_LIMIT) {
        console.warn(`[WARN] No-speech error limit reached (${NO_SPEECH_ERROR_LIMIT}) within ${NO_SPEECH_ERROR_TIME_WINDOW_MS / 1000}s. Voice recognition restart paused.`);
        speakAsJarvis("Voice recognition has been paused due to repeated silence. Please speak or disable voice commands.");
        if (voiceCommandBtn) voiceCommandBtn.classList.remove('active');
        isContinuousListeningEnabled = false; // Disable continuous listening
        updateVoiceFeedbackDisplay("Voice paused (too much silence)", false, true); // Show message
        setTimeout(() => updateVoiceFeedbackDisplay("", false, false), 5000); // Hide after 5s
        return; // Do not restart recognition
    }

    console.log(`[DEBUG] attemptRestartRecognition called. State: isStartingRecognition=${isStartingRecognition}, isRecognitionActive=${isRecognitionActive}, recognition.readyState=${recognition ? recognition.readyState : "N/A"}, recognition.listening=${recognition ? recognition.listening : "N/A"}`);
    if (!recognition) {
        console.warn("[WARN] SpeechRecognition API not available, cannot restart.");
        updateVoiceFeedbackDisplay("Voice commands not supported", false, true);
        if (voiceCommandBtn) voiceCommandBtn.style.display = 'none'; // Hide button if not supported
        return;
    }

    // Clear any pending restart timeout
    if (recognitionRestartTimeoutId) {
        clearTimeout(recognitionRestartTimeoutId);
        recognitionRestartTimeoutId = null;
        console.log("[DEBUG] Cleared existing recognition restart timeout.");
    }

    // If recognition is already active or we are already trying to start it, do nothing.
    // This is the critical guard against InvalidStateError.
    if (isRecognitionActive || isStartingRecognition) {
        console.log("[DEBUG] Recognition already active or starting. Aborting redundant restart attempt.");
        if (voiceCommandBtn) voiceCommandBtn.classList.add('active'); // Keep visual consistent
        updateVoiceFeedbackDisplay("Listening...", true, true);
        return;
    }

    isStartingRecognition = true;
    if (voiceCommandBtn) voiceCommandBtn.classList.add('active'); // Indicate active state while trying to start
    updateVoiceFeedbackDisplay("Starting voice input...", true, true); // Show starting message

    // Re-assign handlers to ensure they are always set correctly before attempting start.
    recognition.onend = recognitionOnEndHandler;
    recognition.onerror = recognitionOnErrorHandler;

    recognitionRestartTimeoutId = setTimeout(() => {
        try {
            // Only call start if it's truly idle or closed.
            if (recognition.readyState === 'idle' || recognition.readyState === 'closed' || recognition.readyState === undefined) {
                recognition.start();
                console.log("[DEBUG] SpeechRecognition.start() called after delay and state check.");
            } else {
                console.warn(`[WARN] Recognition in non-idle state (${recognition.readyState}). Will retry.`);
                // If not idle, it means a previous stop/abort hasn't fully completed.
                // Schedule a retry of attemptRestartRecognition itself.
                // Reset isStartingRecognition so the retry can proceed.
                isStartingRecognition = false;
                attemptRestartRecognition(); // Recursive call, but protected by setTimeout and flags
            }
        } catch (e) {
            console.error("[ERROR] Failed to start recognition after delay:", e);
            speakAsJarvis("Pardon me, Sir Sevindu. I encountered a persistent error activating voice input.");
            updateVoiceFeedbackDisplay("Error activating voice input", false, true); // Show error
            setTimeout(() => updateVoiceFeedbackDisplay("", false, false), 3000);
        } finally {
            isStartingRecognition = false; // Reset the flag once the attempt (successful or not) completes
            recognitionRestartTimeoutId = null; // Clear the timeout ID
        }
    }, 1000 + Math.random() * 500); // Increased delay with jitter for more stability
}

// Define handlers separately to reassign them
const recognitionOnEndHandler = () => {
    console.log(`[DEBUG] Voice recognition ENDED. State: isContinuousListeningEnabled=${isContinuousListeningEnabled}, awaitingActualCommand=${awaitingActualCommand}, recognition.readyState=${recognition ? recognition.readyState : "N/A"}`);
    isRecognitionActive = false; // API is no longer active
    if (voiceCommandBtn) voiceCommandBtn.classList.remove('active');
    updateVoiceFeedbackDisplay("", false, false); // Hide feedback display

    if (commandTimeoutId) {
        console.log("[DEBUG] Clearing command timeout on recognition END.");
        clearTimeout(commandTimeoutId);
        commandTimeoutId = null;
    }

    // If continuous listening is enabled by user, attempt to restart
    if (isContinuousListeningEnabled) {
        console.log("[DEBUG] recognition.onend: Continuous listening enabled. Attempting controlled restart.");
        attemptRestartRecognition();
    }
};

const recognitionOnErrorHandler = (event) => {
    console.error(`[ERROR] Voice recognition ERROR: ${event.error}. State: isContinuousListeningEnabled=${isContinuousListeningEnabled}, awaitingActualCommand=${awaitingActualCommand}, recognition.readyState=${recognition ? recognition.readyState : "N/A"}`);
    isRecognitionActive = false; // API is no longer active
    if (voiceCommandBtn) voiceCommandBtn.classList.remove('active');
    updateVoiceFeedbackDisplay("", false, false); // Hide feedback display on error

    if (commandTimeoutId) {
        console.log("[DEBUG] Clearing command timeout on recognition ERROR.");
        clearTimeout(commandTimeoutId);
        commandTimeoutId = null;
    }

    // Reset the flag to prevent redundant starts
    isStartingRecognition = false;

    if (event.error === 'no-speech') {
        // Track no-speech error timestamps for rate limiting
        const now = Date.now();
        noSpeechErrorTimestamps = noSpeechErrorTimestamps.filter(ts => now - ts < NO_SPEECH_ERROR_TIME_WINDOW_MS);
        noSpeechErrorTimestamps.push(now);
        console.log(`[DEBUG] recognition.onerror: no-speech error count: ${noSpeechErrorTimestamps.length}`);

        if (noSpeechErrorTimestamps.length >= NO_SPEECH_ERROR_LIMIT) {
            console.warn(`[WARN] recognition.onerror: No-speech error limit reached (${NO_SPEECH_ERROR_LIMIT}) within ${NO_SPEECH_ERROR_TIME_WINDOW_MS / 1000}s. Voice recognition restart paused.`);
            speakAsJarvis("Voice recognition has been paused due to repeated silence. Please speak or disable voice commands.");
            isContinuousListeningEnabled = false; // Disable continuous listening
            updateVoiceFeedbackDisplay("Voice paused (too much silence)", false, true); // Show message
            setTimeout(() => updateVoiceFeedbackDisplay("", false, false), 5000); // Hide after 5s
            return; // Do not restart recognition
        }
    } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        // Critical permission/hardware errors, disable continuous listening permanently
        speakAsJarvis("Pardon me, Sir Sevindu. Microphone access was denied or there's an audio issue. Voice commands disabled.");
        if (voiceCommandBtn) voiceCommandBtn.style.display = 'none';
        isContinuousListeningEnabled = false; // Disable continuous listening
        updateVoiceFeedbackDisplay("Microphone access denied/error", false, true); // Show message
        return; // Do not restart
    }

    // For 'aborted' or any other non-critical error, if continuous listening is desired, attempt restart
    if (isContinuousListeningEnabled) {
        console.log("[DEBUG] recognition.onerror: Attempting controlled restart for continuous listening.");
        if (recognitionRestartTimeoutId) clearTimeout(recognitionRestartTimeoutId);
        recognitionRestartTimeoutId = setTimeout(() => {
            attemptRestartRecognition();
        }, 1000 + Math.random() * 500); // Delay restart after an error with jitter
    }
};

if (recognition) {
    recognition.continuous = true; // IMPORTANT: Enable continuous listening for wake word
    recognition.interimResults = true; // NEW: Enable interim results for live display
    recognition.lang = 'en-US'; // Set language

    // Assign initial handlers
    recognition.onstart = () => {
        console.log("[DEBUG] Voice recognition STARTED. recognition.readyState:", recognition.readyState);
        isRecognitionActive = true; // System is now listening continuously
        if (voiceCommandBtn) voiceCommandBtn.classList.add('active'); // Visual feedback
        isStartingRecognition = false; // Ensure this is reset once it truly starts
        // Clear any pending restart timeout, as it has successfully started
        if (recognitionRestartTimeoutId) {
            clearTimeout(recognitionRestartTimeoutId);
            recognitionRestartTimeoutId = null;
        }
        // Update voice feedback display
        updateVoiceFeedbackDisplay("Listening for 'Jarvis'...", true, true, false, ""); // Clear live transcript on start
    };

    recognition.onresult = (event) => {
        console.log("[DEBUG] Voice recognition ONRESULT triggered. Current awaitingActualCommand:", awaitingActualCommand);
        // Log full event.results for debugging
        // console.log("[DEBUG] Full event.results:", event.results); // Too verbose for continuous logging

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        const currentLiveTranscript = finalTranscript || interimTranscript; // Prioritize final if available
        if (currentLiveTranscript) {
            // console.log(`[DEBUG] Live Transcript: "${currentLiveTranscript.trim()}"`); // Avoid excessive logging
            updateVoiceFeedbackDisplay(
                awaitingActualCommand ? "Command ready..." : "Listening for 'Jarvis'...",
                true, true, false, currentLiveTranscript.trim()
            );
        }

        if (finalTranscript) {
            console.log(`[DEBUG] Final voice transcript: "${finalTranscript.toLowerCase().trim()}"`);

            // Clear any existing command timeout, as a new final transcript has arrived
            if (commandTimeoutId) {
                console.log("[DEBUG] Clearing existing command timeout on new final transcript.");
                clearTimeout(commandTimeoutId);
                commandTimeoutId = null;
            }

            const lowerTranscript = finalTranscript.toLowerCase().trim();
            const jarvisIndex = lowerTranscript.indexOf('jarvis');

            if (awaitingActualCommand) {
                // If already in command mode, process the whole transcript as a command
                console.log("[DEBUG] Awaiting command mode is TRUE: Processing final transcript as command.");
                awaitingActualCommand = false; // Reset after processing
                processVoiceCommandWithGemini(lowerTranscript);
            } else if (jarvisIndex !== -1) {
                // Wake word detected.
                const commandPart = lowerTranscript.substring(jarvisIndex + 'jarvis'.length).trim();
                if (commandPart) {
                    // Command immediately follows wake word in the same utterance
                    console.log("[DEBUG] Wake word 'Jarvis' detected with immediate command. Processing command.");
                    speakAsJarvis("At your service, Sir Sevindu. Processing your command.");
                    processVoiceCommandWithGemini(commandPart);
                    // No need to enter awaitingActualCommand mode, as command was given immediately
                } else {
                    // Only wake word detected, no immediate command. Enter awaitingActualCommand mode.
                    console.log("[DEBUG] Wake word 'Jarvis' detected. Entering command mode.");
                    speakAsJarvis("At your service, Sir Sevindu. Your command?");
                    updateVoiceFeedbackDisplay("Command ready...", true, true);
                    awaitingActualCommand = true;
                    // Set a timeout for the follow-up command
                    commandTimeoutId = setTimeout(() => {
                        awaitingActualCommand = false;
                        speakAsJarvis("No command received, Sir Sevindu. I shall continue to listen for your instructions.");
                        updateVoiceFeedbackDisplay("No command. Listening for 'Jarvis'...", true, true);
                        console.log("[DEBUG] Command mode timed out. Reverted to wake word listening.");
                    }, 10000); // 10 seconds timeout for follow-up command
                }
            } else {
                console.log("[DEBUG] No wake word detected and not in command mode. Continuing continuous listening for 'Jarvis'.");
                updateVoiceFeedbackDisplay("Listening for 'Jarvis'...", true, true);
            }
        }
    };

    recognition.onend = recognitionOnEndHandler; // Assign the defined handler
    recognition.onerror = recognitionOnErrorHandler; // Assign the defined handler

} else {
    console.warn("[WARN] Web Speech API not supported in this browser. Voice commands will be disabled.");
    // If the API is not supported, hide the voice command button.
    document.addEventListener('DOMContentLoaded', () => {
        const voiceBtn = document.getElementById('voiceCommandBtn');
        if (voiceBtn) {
            voiceBtn.style.display = 'none';
        }
        updateVoiceFeedbackDisplay("Voice commands not supported by browser.", false, true);
    });
}

/**
 * Jarvis speaks.
 * @param {string} text - The text for Jarvis to speak.
 */
function speakAsJarvis(text) {
    console.log(`[DEBUG] speakAsJarvis called with text: "${text}"`);
    addMessageToChat('Jarvis', text, true); // Add Jarvis's response to chatbox

    // Prevent overlapping speech
    if (synth.speaking) {
        console.log("[DEBUG] Speech synthesis already active, skipping new utterance.");
        return;
    }

    // Only attempt to speak if sound effects are enabled AND AudioContext is resumed AND running
    if (enableSoundEffects && synth && SpeechSynthesis && audioContextResumed && Tone.context.state === 'running') {
        // NEW: Abort recognition before speaking
        if (recognition && isRecognitionActive) { // Check if recognition is actually active
            console.log("[DEBUG] speakAsJarvis: Aborting SpeechRecognition before speaking.");
            recognition.abort(); // Use abort for immediate stop
            // recognition.onend or onerror will be triggered and handle restart if continuous listening is enabled
        }

        const utterance = new SpeechSynthesis(text);
        const voices = synth.getVoices();

        // Prioritize a male, English voice, preferably "Google UK English Male" for a more formal AI sound
        utterance.voice = voices.find(voice => voice.name === 'Google UK English Male' && voice.lang === 'en-GB') ||
                          voices.find(voice => voice.name.includes('Google US English') && voice.lang === 'en-US' && voice.gender === 'male') ||
                          voices.find(voice => voice.lang === 'en-US') ||
                          voices[0]; // Fallback to first available voice

        utterance.pitch = 1; // Default pitch
        utterance.rate = 1;  // Default rate

        // Adjust pitch/rate slightly for a more "AI" feel if a specific voice is found
        if (utterance.voice && utterance.voice.name === 'Google UK English Male') {
            utterance.rate = 0.95; // Slightly slower
            utterance.pitch = 1.05; // Slightly higher pitch
        } else if (utterance.voice && utterance.voice.name.includes('Google US English')) {
            utterance.rate = 0.98;
            utterance.pitch = 1.02;
        }

        utterance.onstart = () => {
            console.log("[DEBUG] SpeechSynthesis started.");
            updateVoiceFeedbackDisplay(text, false, true, true); // Show text, no dots, indicate speaking
        };

        utterance.onend = () => {
            console.log("[DEBUG] SpeechSynthesis ended.");
            // After speaking, if continuous listening is enabled, attempt to restart recognition.
            if (isContinuousListeningEnabled) {
                console.log("[DEBUG] SpeechSynthesis ended. Attempting to restart SpeechRecognition for continuous listening.");
                attemptRestartRecognition(); // Restart recognition
            } else {
                updateVoiceFeedbackDisplay("", false, false); // Hide if not listening
            }
        };

        utterance.onerror = (event) => {
            console.error("[ERROR] SpeechSynthesisUtterance error:", event);
            // Fallback to console log if speech fails
            console.log(`[DEBUG] Jarvis would speak (SpeechSynthesis error): "${text}"`);
            updateVoiceFeedbackDisplay("Speech error", false, true);
            setTimeout(() => updateVoiceFeedbackDisplay("", false, false), 3000);
            // Ensure recognition is restarted even on error if continuous listening is enabled
            if (isContinuousListeningEnabled) {
                console.log("[DEBUG] SpeechSynthesis error. Attempting to restart SpeechRecognition.");
                attemptRestartRecognition();
            }
        };

        synth.speak(utterance);
        console.log(`[DEBUG] Jarvis speaking: "${text}" (Voice: ${utterance.voice ? utterance.voice.name : 'Default'})`);

    } else {
        console.log(`[DEBUG] Jarvis would speak (sounds disabled or API not supported or AudioContext not resumed): "${text}"`);
        // If speech is disabled, still show the text visually for a short period
        updateVoiceFeedbackDisplay(text, false, true);
        setTimeout(() => updateVoiceFeedbackDisplay("", false, false), 3000);
    }
}

/**
 * Sends the raw voice transcript to Gemini NLU Cloud Function for interpretation.
 * @param {string} rawTranscript - The raw, unparsed transcript from speech recognition.
 */
async function processVoiceCommandWithGemini(rawTranscript) {
    console.log(`[DEBUG] Sending raw transcript to Gemini NLU: "${rawTranscript}"`);

    if (!geminiNluFunctionUrl || geminiNluFunctionUrl === "YOUR_GEMINI_NLU_VERCEL_FUNCTION_URL") {
        speakAsJarvis("Sir Sevindu, the Natural Language Understanding module is not configured. Please provide its deployment URL.");
        console.error("[ERROR] Gemini NLU Cloud Function URL is not configured.");
        updateVoiceFeedbackDisplay("NLU not configured", false, true);
        setTimeout(() => updateVoiceFeedbackDisplay("", false, false), 3000);
        return;
    }

    // Removed direct speakAsJarvis("Interpreting command...") to rely on visual feedback
    updateVoiceFeedbackDisplay("Interpreting command...", false, true);

    try {
        const response = await fetch(geminiNluFunctionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: rawTranscript })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cloud Function error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("[DEBUG] Gemini NLU response:", result);

        const canonicalCommand = result.canonicalCommand;
        const commandValue = result.commandValue; // May be present for settings
        const nluConfidence = result.confidence; // NEW: NLU confidence score
        const query = result.query; // NEW: Query for general questions

        if (canonicalCommand) {
            handleCanonicalCommand(canonicalCommand, commandValue, query); // Pass query to handler
        } else {
            speakAsJarvis("Pardon me, Sir Sevindu. I could not determine a clear command from your request.");
            console.warn("[WARN] Gemini NLU did not return a canonical command.");
        }

    } catch (e) {
        speakAsJarvis(`Sir Sevindu, I encountered an error communicating with the Natural Language Understanding module: ${e.message}`);
        console.error("[ERROR] Error calling Gemini NLU Cloud Function:", e);
        updateVoiceFeedbackDisplay("NLU communication error", false, true);
    } finally {
        // After processing command, ensure recognition restarts to listen for wake word
        // Use the centralized restart function
        console.log("[DEBUG] processVoiceCommandWithGemini: Initiating controlled recognition restart after command processing.");
        // updateVoiceFeedbackDisplay("", false, false); // Hide processing message (handled by speakAsJarvis.onend)
        // No need to call attemptRestartRecognition here, as the continuous listener is always on.
        // We just need to ensure the UI reverts to wake word listening state.
        if (isContinuousListeningEnabled) { // Only if continuous listening is still active
            updateVoiceFeedbackDisplay("Listening for 'Jarvis'...", true, true);
        } else {
            updateVoiceFeedbackDisplay("", false, false); // Hide if not listening
        }
    }
}

/**
 * Handles the canonical command received from Gemini NLU.
 * @param {string} canonicalCommand - The simplified, standardized command (e.g., "start_timer").
 * @param {string} [value] - Optional value for commands like setting cube type or theme.
 * @param {string} [query] - Optional query for general questions.
 */
async function handleCanonicalCommand(canonicalCommand, value = null, query = null) {
    console.log(`[DEBUG] Handling canonical command: "${canonicalCommand}" with value: "${value}", query: "${query}"`);

    switch (canonicalCommand) {
        case 'start_timer':
            if (!isTiming) {
                speakAsJarvis("Initiating timer sequence, Sir Sevindu.");
                toggleTimer();
            } else {
                // Removed redundant verbal feedback, rely on visual
                // speakAsJarvis("The timer is already in progress, Sir Sevindu.");
            }
            break;
        case 'stop_timer':
            if (isTiming) {
                speakAsJarvis("Timer halted, Sir Sevindu.");
                toggleTimer(); // This will stop the timer and add solve
            } else {
                // Removed redundant verbal feedback, rely on visual
                // speakAsJarvis("The timer is not currently running, Sir Sevindu.");
            }
            break;
        case 'new_scramble':
            speakAsJarvis("Generating new scramble, Sir Sevindu.");
            scramble = generateScramble();
            resetTimer();
            break;
        case 'reset_timer':
            speakAsJarvis("Timer reset, Sir Sevindu.");
            resetTimer();
            break;
        case 'open_settings':
            speakAsJarvis("Opening settings, Sir Sevindu.");
            if (settingsBtn) settingsBtn.click();
            break;
        case 'close_settings':
            speakAsJarvis("Closing settings, Sir Sevindu.");
            // Check if settings modal is open before attempting to close
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal && settingsModal.classList.contains('open')) {
                closeSettingsModalBtn.click();
            } else {
                // Removed redundant verbal feedback, rely on visual
                // speakAsJarvis("The settings panel is not currently open, Sir Sevindu.");
            }
            break;
        case 'analyze_solve': // Renamed from get_insight
            if (solves.length > 0) {
                speakAsJarvis("Accessing neural network for solve analysis, Sir Sevindu.");
                getSolveInsight(solves[solves.length - 1].id); // Get insight for the last solve
            } else {
                speakAsJarvis("There are no solves recorded to analyze, Sir Sevindu.");
            }
            break;
        // NEW: Voice commands for settings
        case 'toggle_inspection':
            enableInspection = !enableInspection;
            speakAsJarvis(`Inspection mode is now ${enableInspection ? 'enabled' : 'disabled'}, Sir Sevindu.`);
            saveUserSettings();
            applySettingsToUI(); // Re-apply to update UI
            break;
        case 'toggle_sound_effects':
            enableSoundEffects = !enableSoundEffects;
            speakAsJarvis(`Sound effects are now ${enableSoundEffects ? 'enabled' : 'disabled'}, Sir Sevindu.`);
            saveUserSettings();
            // applySettingsToUI is not strictly needed for this, but consistent
            break;
        case 'set_cube_type':
            const validCubeTypes = ['3x3', '2x2', '4x4', 'pyraminx'];
            if (value && validCubeTypes.includes(value.toLowerCase())) {
                cubeType = value.toLowerCase();
                speakAsJarvis(`Cube type set to ${value}, Sir Sevindu.`);
                saveUserSettings();
                applySettingsToUI(); // Re-apply to update scramble, etc.
                resetTimer(); // Reset timer and generate new scramble for new cube type
            } else {
                speakAsJarvis(`Pardon me, Sir Sevindu. I cannot set the cube type to '${value}'. Please choose from 3x3, 2x2, 4x4, or Pyraminx.`);
            }
            break;
        case 'set_theme':
            const validThemes = ['dark', 'light', 'vibrant'];
            if (value && validThemes.includes(value.toLowerCase())) {
                currentTheme = value.toLowerCase();
                document.body.className = `theme-${currentTheme}`; // Directly apply class
                speakAsJarvis(`Theme set to ${value}, Sir Sevindu.`);
                saveUserSettings();
                applySettingsToUI(); // Re-apply to update 3D cube background if visible
            } else {
                speakAsJarvis(`Pardon me, Sir Sevindu. I cannot set the theme to '${value}'. Please choose from Dark, Light, or Vibrant.`);
            }
            break;
        case 'toggle_3d_cube_view':
            show3DCubeView = !show3DCubeView;
            speakAsJarvis(`3D cube view is now ${show3DCubeView ? 'enabled' : 'disabled'}, Sir Sevindu.`);
            saveUserSettings();
            applySettingsToUI(); // Re-apply to toggle visibility
            break;
        case 'get_best_time':
            speakAsJarvis(`Your best recorded time is ${bestTimeDisplay.textContent}, Sir Sevindu.`);
            break;
        case 'get_ao5':
            speakAsJarvis(`Your average of five is ${ao5Display.textContent}, Sir Sevindu.`);
            break;
        case 'get_ao12':
            speakAsJarvis(`Your average of twelve is ${ao12Display.textContent}, Sir Sevindu.`);
            break;
        case 'general_query': // Handle general questions
            if (query) {
                speakAsJarvis("Accessing knowledge base, Sir Sevindu. Please wait.");
                const answer = await getGeneralAnswer(query);
                speakAsJarvis(answer);
            } else {
                speakAsJarvis("Pardon me, Sir Sevindu. I received a general query without a specific question.");
            }
            break;
        case 'generate_lesson': // NEW: Handle lesson generation
            if (query) {
                speakAsJarvis(`Generating a lesson on ${query}, Sir Sevindu. This may take a moment.`);
                openLessonsModal(); // Open the modal and show loading
                // Pass the query as the topic for the lesson
                const userLevel = getUserLevel(0, cubeType); // Get current user level for context
                requestLessonFromAI(query, cubeType, userLevel);
            } else {
                speakAsJarvis("Pardon me, Sir Sevindu. To generate a lesson, please specify a topic.");
            }
            break;
        case 'unknown':
        default:
            speakAsJarvis("Pardon me, Sir Sevindu. I did not fully comprehend your instruction. Please try again.");
            break;
    }
}

// Sound effects
// Initialize Tone.js synths. These are global to avoid re-creating them on every play.
const startSound = new Tone.Synth({
    oscillator: { type: "triangle" },
    envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.1,
        release: 0.5,
    }
}).toDestination();
console.log("[DEBUG] Tone.js startSound initialized.");

const stopSound = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 8,
    envelope: {
        attack: 0.001,
        decay: 0.4,
        sustain: 0.01,
        release: 0.6,
    }
}).toDestination();
console.log("[DEBUG] Tone.js stopSound initialized.");

const inspectionBeep = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: {
        attack: 0.005,
        decay: 0.05,
        sustain: 0.0,
        release: 0.05,
    }
}).toDestination();
console.log("[DEBUG] Tone.js inspectionBeep initialized.");

// New sound for "Go!"
const goSound = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: {
        attack: 0.02,
        decay: 0.2,
        sustain: 0.1,
        release: 0.3,
    }
}).toDestination();
console.log("[DEBUG] Tone.js goSound initialized.");

// Settings variables
let enableInspection = true;
let enableSoundEffects = true;
let cubeType = '3x3';
let currentTheme = 'dark'; // Default theme
let show3DCubeView = false; // New: Default to text scramble view
console.log("[DEBUG] Initial settings variables set.");

// --- Local Storage Functions for Guest Mode ---
const LOCAL_STORAGE_PREFIX = `${appId}_guest_`;

/**
 * Loads solves from local storage.
 */
function loadLocalSolves() {
    console.log("[DEBUG] Loading solves from local storage.");
    try {
        const storedSolves = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}solves`);
        solves = storedSolves ? JSON.parse(storedSolves) : [];
        // Ensure timestamps are Date objects if needed later, or numbers for sorting
        solves.forEach(solve => {
            if (typeof solve.timestamp === 'string') {
                solve.timestamp = new Date(solve.timestamp).getTime();
            }
        });
        console.log(`[DEBUG] Loaded ${solves.length} solves from local storage.`);
    } catch (e) {
        console.error("[ERROR] Error loading solves from local storage:", e);
        solves = [];
    }
}

/**
 * Saves solves to local storage.
 */
function saveLocalSolves() {
    console.log("[DEBUG] Saving solves to local storage.");
    try {
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}solves`, JSON.stringify(solves));
        console.log("[DEBUG] Solves saved to local storage.");
    } catch (e) {
        console.error("[ERROR] Error saving solves to local storage:", e);
    }
}

/**
 * Loads user settings from local storage.
 */
function loadLocalUserSettings() {
    console.log("[DEBUG] Loading user settings from local storage.");
    try {
        const storedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (storedSettings) {
            const settings = JSON.parse(storedSettings);
            enableInspection = settings.enableInspection !== undefined ? settings.enableInspection : true;
            enableSoundEffects = settings.soundEffects !== undefined ? settings.soundEffects : true;
            cubeType = settings.cubeType || '3x3';
            currentTheme = settings.theme || 'dark';
            show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : false;
            console.log("[DEBUG] User settings loaded from local storage:", settings);
        } else {
            console.log("[DEBUG] No user settings found in local storage, using defaults.");
            saveLocalUserSettings(); // Save defaults for next time
        }
    } catch (e) {
        console.error("[ERROR] Error loading settings from local storage:", e);
    }
    applySettingsToUI();
}

/**
 * Saves current user settings to local storage.
 */
function saveLocalUserSettings() {
    console.log("[DEBUG] Saving user settings to local storage.");
    try {
        const settingsToSave = {
            enableInspection: enableInspection,
            enableSoundEffects: enableSoundEffects,
            cubeType: cubeType,
            theme: currentTheme,
            show3DCubeView: show3DCubeView,
            lastUpdated: Date.now()
        };
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}settings`, JSON.stringify(settingsToSave));
        console.log("[DEBUG] User settings saved to local storage.");
    } catch (e) {
        console.error("[ERROR] Error saving settings to local storage:", e);
    }
}

/**
 * Loads username from local storage.
 */
function loadLocalUsername() {
    console.log("[DEBUG] Loading username from local storage.");
    return localStorage.getItem(`${LOCAL_STORAGE_PREFIX}username`) || 'Guest';
}

/**
 * Saves username to local storage.
 */
function saveLocalUsername(username) {
    console.log("[DEBUG] Saving username to local storage.");
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}username`, username);
}

// --- Utility Functions ---

/**
 * Formats milliseconds into M:SS.mmm string.
 * @param {number} ms - Milliseconds to format.
 * @returns {string} Formatted time string.
 */
function formatTime(ms) {
    if (ms === null || isNaN(ms)) {
        return '--:--.--';
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = Math.floor(ms % 1000);
    const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
    return formatted;
}

/**
 * Generates a scramble based on the selected cube type.
 * @returns {string} A new scramble string.
 */
function generateScramble() {
    console.log("[DEBUG] Entering generateScramble.");
    const moves3x3 = ['R', 'L', 'U', 'D', 'F', 'B'];
    const moves2x2 = ['R', 'U', 'F'];
    const moves4x4 = ['R', 'L', 'U', 'D', 'F', 'B', 'Rw', 'Uw', 'Fw']; // Simplified for demo
    const movesPyraminx = ['R', 'L', 'U', 'B']; // Main moves
    const movesPyraminxTips = ['r', 'l', 'u', 'b']; // Tips moves
    const suffixes = ['', "'", '2']; // For 3x3, 2x2, 4x4
    const suffixesPyraminx = ['', "'"]; // For Pyraminx

    let scrambleMoves = [];
    let length = 0;
    let twistyPlayerPuzzleType = '3x3x3'; // Default for twisty-player

    const getRandomMove = (movesArray, suffixArray) => {
        const move = movesArray[Math.floor(Math.random() * movesArray.length)];
        const suffix = suffixArray[Math.floor(Math.random() * suffixArray.length)];
        return move + suffix;
    };

    switch (cubeType) {
        case '2x2':
            length = 9 + Math.floor(Math.random() * 3); // 9-11 moves
            twistyPlayerPuzzleType = '2x2x2';
            for (let i = 0; i < length; i++) {
                scrambleMoves.push(getRandomMove(moves2x2, suffixes));
            }
            break;
        case '3x3':
            length = 20 + Math.floor(Math.random() * 2); // 20-21 moves
            twistyPlayerPuzzleType = '3x3x3';
            for (let i = 0; i < length; i++) {
                scrambleMoves.push(getRandomMove(moves3x3, suffixes));
            }
            break;
        case '4x4': // Corrected 4x4 logic
            length = 40 + Math.floor(Math.random() * 5); // 40-44 moves
            twistyPlayerPuzzleType = '4x4x4'; // Correct puzzle type for 4x4
            for (let i = 0; i < length; i++) {
                scrambleMoves.push(getRandomMove(moves4x4, suffixes));
            }
            break;
        case 'pyraminx':
            length = 8 + Math.floor(Math.random() * 3); // 8-10 moves for main
            twistyPlayerPuzzleType = 'pyraminx'; // twisty-player supports 'pyraminx' puzzle type
            for (let i = 0; i < length; i++) {
                scrambleMoves.push(getRandomMove(movesPyraminx, suffixesPyraminx));
            }
            // Add tip moves (usually 0-4 tip moves)
            for (let i = 0; i < Math.floor(Math.random() * 5); i++) {
                scrambleMoves.push(getRandomMove(movesPyraminxTips, suffixesPyraminx));
            }
            break;
        default:
            // Fallback to 3x3 if something unexpected
            length = 20;
            twistyPlayerPuzzleType = '3x3x3';
            for (let i = 0; i < length; i++) {
                scrambleMoves.push(getRandomMove(moves3x3, suffixes));
            }
    }
    const generated = scrambleMoves.join(' ');
    console.log(`[DEBUG] generateScramble: Generated for ${cubeType}: ${generated}`);

    // Update both displays regardless of current view setting
    if (scrambleTextDisplay) { // Defensive check
        scrambleTextDisplay.textContent = generated;
    }
    if (scramble3DViewer) { // Ensure the element is available
        // Always set puzzle type explicitly.
        scramble3DViewer.puzzle = twistyPlayerPuzzleType;
        // Set algorithm after a very short delay if puzzle type is pyraminx
        // to give the component a moment to fully reconfigure its parser.
        // This specifically targets the "Invalid suffix" error that seems specific to Pyraminx
        // due to timing sensitivities with twisty-player's internal parsing.
        if (cubeType === 'pyraminx') {
            // Clear alg first to ensure a fresh parse.
            scramble3DViewer.alg = '';
            setTimeout(() => {
                scramble3DViewer.alg = generated;
                console.log(`[DEBUG] 3D Viewer (Pyraminx, delayed) updated with alg: ${generated}`);
            }, 50); // A small delay (50ms) to ensure internal parser is ready.
        } else {
            scramble3DViewer.alg = generated;
            console.log(`[DEBUG] 3D Viewer updated with alg: ${generated} and puzzle: ${twistyPlayerPuzzleType}`);
        }
    } else {
        console.warn("[WARN] scramble3DViewer is not yet available during generateScramble. This is expected on initial load if 3D view is off.");
    }
    return generated;
}

/**
 * Calculates the average of the last N solves, dropping the best and worst times.
 * @param {Array<Object>} solveList - Array of solve objects.
 * @param {number} n - Number of solves to consider (e.g., 5 for Ao5, 12 for Ao12).
 * @returns {string} Formatted average time or '--:--.--'.
 */
function calculateAverage(solveList, n) {
    console.log(`[DEBUG] Entering calculateAverage for N=${n} with ${solveList.length} solves.`);
    if (solveList.length < n) {
        console.log(`[DEBUG] calculateAverage: Not enough solves ( ${solveList.length} < ${n}). Returning '--:--.--'.`);
        return '--:--.--';
    }

    // Get the last N solves
    const lastNSolves = solveList.slice(-n);
    console.log(`[DEBUG] calculateAverage: Last ${n} solves:`, lastNSolves.map(s => `${s.time}ms (penalty: ${s.penalty})`));

    // Filter out DNFs and apply +2 penalties for calculations
    let timesForAvg = [];
    let hasDNF = false;
    lastNSolves.forEach(solve => {
        if (solve.penalty === 'DNF') {
            hasDNF = true;
            console.log("[DEBUG] calculateAverage: DNF found.");
        } else if (solve.penalty === '+2') {
            timesForAvg.push(solve.time + 2000);
            console.log(`[DEBUG] calculateAverage: Added +2 penalty to ${solve.time}ms.`);
        } else {
            timesForAvg.push(solve.time);
        }
    });

    // If there's a DNF, the average is DNF
    if (hasDNF) {
        console.log("[DEBUG] calculateAverage: Returning 'DNF' due to DNF in list.");
        return 'DNF';
    }

    // Sort times to drop best and worst
    timesForAvg.sort((a, b) => a - b);
    console.log("[DEBUG] calculateAverage: Times sorted:", timesForAvg);

    // Drop best and worst if timesForAvg.length allows (e.g., for Ao5, drop 1st and last from 5)
    if (timesForAvg.length > 2) {
        timesForAvg = timesForAvg.slice(1, -1);
        console.log("[DEBUG] calculateAverage: Dropped best/worst. Remaining times:", timesForAvg);
    } else {
        console.log("[DEBUG] calculateAverage: Not enough times to drop best/worst after filtering or N is too small.");
    }


    if (timesForAvg.length === 0) {
        console.log("[DEBUG] calculateAverage: No valid times for average. Returning '--:--.--'.");
        return '--:--.--';
    }

    const sum = timesForAvg.reduce((acc, time) => acc + time, 0);
    const avg = sum / timesForAvg.length;
    const formattedAvg = formatTime(avg);
    console.log(`[DEBUG] calculateAverage: Sum: ${sum}, Count: ${timesForAvg.length}, Avg: ${avg}ms, Formatted: ${formattedAvg}`);
    return formattedAvg;
}

/**
 * Renders the solve history list and updates statistics.
 */
function renderSolveHistory() {
    console.log("[DEBUG] Entering renderSolveHistory.");
    // Ensure solveHistoryList is defined before accessing its properties
    if (!solveHistoryList) {
        console.warn("[WARN] renderSolveHistory called before solveHistoryList is initialized. Skipping render.");
        return; // Exit if DOM element is not ready
    }

    solveHistoryList.innerHTML = '';
    if (solves.length === 0) {
        if (noSolvesMessage) noSolvesMessage.style.display = 'block';
        if (bestTimeDisplay) bestTimeDisplay.textContent = '--:--.--';
        if (ao5Display) ao5Display.textContent = '--:--.--';
        if (ao12Display) ao12Display.textContent = '--:--.--';
        if (solveCountDisplay) solveCountDisplay.textContent = '0';
        console.log("[DEBUG] renderSolveHistory: No solves, displaying empty stats.");
        return;
    } else {
        if (noSolvesMessage) noSolvesMessage.style.display = 'none';
    }

    // Sort solves by timestamp (descending) for display
    const sortedSolves = [...solves].sort((a, b) => b.timestamp - a.timestamp);
    console.log(`[DEBUG] renderSolveHistory: Rendering ${sortedSolves.length} sorted solves.`);

    sortedSolves.forEach(solve => {
        const solveItem = document.createElement('div');
        solveItem.className = 'solve-history-item';
        solveItem.setAttribute('data-id', solve.id);

        let displayTime = solve.time;
        let penaltyText = '';
        if (solve.penalty === '+2') {
            displayTime += 2000;
            penaltyText = ' (+2)';
        } else if (solve.penalty === 'DNF') {
            displayTime = 'DNF';
            penaltyText = ' (DNF)';
        }

        solveItem.innerHTML = `
            <div class="time">${displayTime === 'DNF' ? 'DNF' : formatTime(displayTime)}<span class="text-sm text-gray-400 ml-2">${penaltyText}</span></div>
            <div class="penalty-buttons">
                <button class="insight-button button-secondary" onclick="getSolveInsight('${solve.id}')">Get Insight ✨</button>
                <button class="plus2 button-secondary" onclick="applyPenalty('${solve.id}', '+2')">+2</button>
                <button class="button-secondary" onclick="applyPenalty('${solve.id}', 'DNF')">DNF</button>
                <button class="clear-penalty button-secondary" onclick="applyPenalty('${solve.id}', null)">Clear</button>
                <button class="delete button-secondary" onclick="deleteSolve('${solve.id}')">Delete</button>
            </div>
        `;
        solveHistoryList.appendChild(solveItem);
        // console.log(`[DEBUG] renderSolveHistory: Appended solve item for ID: ${solve.id}`);
    });

    updateStatistics();
    console.log("[DEBUG] Exiting renderSolveHistory. Statistics updated.");
}

/**
 * Updates the best time, Ao5, Ao12, and solve count displays.
 */
function updateStatistics() {
    console.log("[DEBUG] Entering updateStatistics.");
    // Ensure elements are defined
    if (!bestTimeDisplay || !ao5Display || !ao12Display || !solveCountDisplay) {
        console.warn("[WARN] updateStatistics called before all display elements are initialized. Skipping update.");
        return;
    }

    const validSolves = solves.filter(s => s.penalty !== 'DNF');
    let actualTimes = validSolves.map(s => s.time + (s.penalty === '+2' ? 2000 : 0));

    const best = actualTimes.length > 0 ? Math.min(...actualTimes) : null;
    bestTimeDisplay.textContent = formatTime(best);
    console.log(`[DEBUG] Statistics: Best Time: ${formatTime(best)}`);

    ao5Display.textContent = calculateAverage(solves, 5);
    console.log(`[DEBUG] Statistics: Ao5: ${ao5Display.textContent}`);
    ao12Display.textContent = calculateAverage(solves, 12);
    console.log(`[DEBUG] Statistics: Ao12: ${ao12Display.textContent}`);
    solveCountDisplay.textContent = solves.length;
    console.log("[DEBUG] Statistics: Solve Count: ${solves.length}");
    console.log("[DEBUG] Exiting updateStatistics.");
}

/**
 * Adds a new solve to the history.
 * Uses Firestore for authenticated users, Local Storage for guests.
 * @param {number} time - The solve time in milliseconds.
 */
async function addSolve(time) {
    console.log(`[DEBUG] Entering addSolve with time: ${time}ms.`);
    const newSolve = {
        id: crypto.randomUUID(), // Always generate a local ID for consistency
        time: time,
        penalty: null,
        timestamp: Date.now(),
        scramble: scramble, // Store the scramble with the solve
    };

    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] addSolve: Authenticated and Firestore ready. Attempting to add to Firestore.");
        try {
            const solvesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/solves`);
            // Firestore will generate its own ID, so we remove the local 'id' for addDoc
            const { id, ...solveDataToSave } = newSolve;
            const docRef = await addDoc(solvesCollectionRef, solveDataToSave);
            console.log("[DEBUG] Document written to Firestore with ID: ", docRef.id);
            // The onSnapshot listener will update the 'solves' array and re-render
        } catch (e) {
            console.error("[ERROR] Error adding document to Firestore: ", e);
            // Fallback to local array if Firestore fails, but won't persist across sessions
            solves.push(newSolve); // Use the locally generated ID
            saveLocalSolves(); // Save locally for current session
            renderSolveHistory();
            console.log("[DEBUG] addSolve: Firestore failed, added to local array (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] addSolve: Guest user. Adding to local array and saving to local storage.");
        solves.push(newSolve);
        saveLocalSolves(); // Save to local storage for guest
        renderSolveHistory();
    }
    console.log("[DEBUG] Exiting addSolve.");

    // Automatically trigger AI insight after a solve
    // Check if AI Insight function URL is configured before calling
    // This is the correct constant to check, not a hardcoded string
    if (geminiInsightFunctionUrl) {
        speakAsJarvis("Your solve is complete, Sir Sevindu. Analyzing your performance.");
        // Use the latest solve (which is the newSolve just added)
        getSolveInsight(newSolve.id);
    } else {
        console.warn("[WARN] Gemini Insight function URL not configured, skipping automatic insight generation.");
    }
}

/**
 * Applies or clears a penalty for a given solve.
 * Uses Firestore for authenticated users, Local Storage for guests.
 * @param {string} id - The ID of the solve to update.
 * @param {string|null} penaltyType - '+2', 'DNF', or null to clear.
 */
window.applyPenalty = async function (id, penaltyType) {
    console.log(`[DEBUG] Entering applyPenalty for ID: ${id}, Penalty: ${penaltyType}`);
    if (isUserAuthenticated && db && userId) { // Authenticated user
        const solveRef = doc(db, `artifacts/${appId}/users/${userId}/solves`, id);
        try {
            console.log(`[DEBUG] applyPenalty: Attempting to update doc in Firestore: ${solveRef.path}`);
            await updateDoc(solveRef, { penalty: penaltyType });
            console.log(`[DEBUG] Penalty ${penaltyType} applied to solve ${id} in Firestore.`);
        } catch (e) {
            console.error("[ERROR] Error updating penalty in Firestore: ", e);
            // Fallback to local update if Firestore fails
            const solveIndex = solves.findIndex(s => s.id === id);
            if (solveIndex !== -1) {
                solves[solveIndex].penalty = penaltyType;
                saveLocalSolves(); // Save locally for current session
                renderSolveHistory(); // Re-render local changes
                console.log("[DEBUG] applyPenalty: Firestore failed, applied locally (non-persistent).");
            } else {
                console.log("[DEBUG] applyPenalty: Solve not found in local array.");
            }
        }
    } else { // Guest user
        console.log("[DEBUG] applyPenalty: Guest user. Applying penalty to local array and saving to local storage.");
        const solveIndex = solves.findIndex(s => s.id === id);
        if (solveIndex !== -1) {
            solves[solveIndex].penalty = penaltyType;
            saveLocalSolves(); // Save locally for guest
            renderSolveHistory(); // Re-render local changes
        } else {
            console.log("[DEBUG] applyPenalty: Solve not found in local array.");
        }
    }
    console.log("[DEBUG] Exiting applyPenalty.");
};

/**
 * Deletes a solve from the history.
 * Uses Firestore for authenticated users, Local Storage for guests.
 * @param {string} id - The ID of the solve to delete.
 */
window.deleteSolve = async function (id) {
    console.log(`[DEBUG] Entering deleteSolve for ID: ${id}`);
    if (isUserAuthenticated && db && userId) { // Authenticated user
        const solveRef = doc(db, `artifacts/${appId}/users/${userId}/solves`, id);
        try {
            console.log(`[DEBUG] deleteSolve: Attempting to delete doc from Firestore: ${solveRef.path}`);
            await deleteDoc(solveRef);
            console.log(`[DEBUG] Solve ${id} deleted from Firestore.`);
        } catch (e) {
            console.error("[ERROR] Error deleting solve from Firestore: ", e);
            // Fallback to local delete if Firestore fails
            solves = solves.filter(s => s.id !== id);
            saveLocalSolves(); // Save locally for current session
            renderSolveHistory(); // Re-render local changes
            console.log("[DEBUG] deleteSolve: Firestore failed, deleted locally (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] deleteSolve: Guest user. Deleting from local array and saving to local storage.");
        solves = solves.filter(s => s.id !== id);
        saveLocalSolves(); // Save locally for guest
        renderSolveHistory();
    }
    console.log("[DEBUG] Exiting deleteSolve.");
};

/**
 * Sets up the real-time listener for user's solves from Firestore.
 * This function is only called for authenticated users.
 */
function setupRealtimeSolvesListener() {
    console.log("[DEBUG] Entering setupRealtimeSolvesListener.");
    // Ensure DOM elements are initialized before proceeding
    if (!solveHistoryList) {
        console.warn("[WARN] setupRealtimeSolvesListener called before solveHistoryList is initialized. Skipping setup.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Only set up for authenticated users
        console.log("[DEBUG] setupRealtimeSolvesListener: Authenticated and Firestore ready. Setting up onSnapshot.");
        const solvesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/solves`);
        // Note: orderBy is commented out due to potential index issues,
        // and data will be sorted in JavaScript.
        const q = query(solvesCollectionRef /*, orderBy('timestamp', 'desc')*/);

        // Clear previous local data if any from guest mode
        solves = [];
        renderSolveHistory(); // Render empty list while Firestore data loads

        onSnapshot(q, (snapshot) => {
            console.log("[DEBUG] onSnapshot callback triggered. Processing snapshot changes.");
            solves = []; // Clear current solves to repopulate from snapshot
            snapshot.forEach((doc) => {
                solves.push({ id: doc.id, ...doc.data() });
            });
            console.log(`[DEBUG] Solves updated from Firestore. Total solves: ${solves.length}.`);
            renderSolveHistory();
        }, (error) => {
            console.error("[ERROR] Error listening to solves: ", error);
            // Handle error, maybe display a message to the user
            // Fallback to local if permissions error occurs on a previously working connection
            if (error.code === 'permission-denied') {
                console.warn("[WARN] Firestore permission denied for solves listener. Falling back to local storage for solves.");
                isUserAuthenticated = false; // Treat as signed out if permissions fail
                // Re-init with local storage for solves to ensure functionality
                loadLocalSolves();
                renderSolveHistory();
            }
        });
    } else {
        console.log("[DEBUG] setupRealtimeSolvesListener: Not authenticated, Firestore listener not setup.");
        // For guests, local solves are handled by loadLocalSolves in initializeUserDataAndSettings
    }
    console.log("[DEBUG] Exiting setupRealtimeSolvesListener.");
}

/**
 * Loads user settings. Uses Firestore for authenticated users, Local Storage for guests.
 */
async function loadUserSettings() {
    console.log("[DEBUG] Entering loadUserSettings.");
    // Ensure DOM elements are initialized before proceeding
    if (!inspectionToggle || !soundEffectsToggle || !cubeTypeSelect || !themeSelect || !cubeViewToggle) {
        console.warn("[WARN] loadUserSettings called before settings UI elements are initialized. Skipping load.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] loadUserSettings: Authenticated and Firestore ready. Attempting to load settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        try {
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                const settings = docSnap.data();
                enableInspection = settings.enableInspection !== undefined ? settings.enableInspection : true;
                enableSoundEffects = settings.soundEffects !== undefined ? settings.soundEffects : true;
                cubeType = settings.cubeType || '3x3';
                currentTheme = settings.theme || 'dark';
                show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : false; // Load new setting
                console.log("[DEBUG] User settings loaded from Firestore:", settings);
            } else {
                console.log("[DEBUG] No user settings found in Firestore, using defaults and saving.");
                saveUserSettings(); // Save default settings to Firestore
            }
        }
        catch (e) {
            console.error("[ERROR] Error loading user settings from Firestore: ", e);
            if (e.code === 'permission-denied') {
                console.warn("[WARN] Firestore permission denied for settings. Falling back to local storage for settings.");
                // Fallback to local if permissions fail
                loadLocalUserSettings();
            }
        }
    } else { // Guest user
        console.log("[DEBUG] loadUserSettings: Guest user. Loading settings from local storage.");
        loadLocalUserSettings(); // Load from local storage
    }
    applySettingsToUI();
    console.log("[DEBUG] Exiting loadUserSettings.");
}

/**
 * Saves current user settings. Uses Firestore for authenticated users, Local Storage for guests.
 */
async function saveUserSettings() {
    console.log("[DEBUG] Entering saveUserSettings.");
    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] saveUserSettings: Authenticated and Firestore ready. Attempting to save settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        const settingsToSave = {
            enableInspection: enableInspection,
            enableSoundEffects: enableSoundEffects,
            cubeType: cubeType,
            theme: currentTheme,
            show3DCubeView: show3DCubeView, // Save new setting
            lastUpdated: Date.now()
        };
        try {
            console.log("[DEBUG] Attempting to set doc in Firestore:", settingsToSave);
            await setDoc(userSettingsRef, settingsToSave, { merge: true });
            console.log("[DEBUG] User settings saved to Firestore.");
        } catch (e) {
            console.error("[ERROR] Error saving user settings to Firestore: ", e);
            // Fallback to local save if Firestore fails
            saveLocalUserSettings();
            console.warn("[WARN] Firestore failed to save settings, saved to local storage (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] saveUserSettings: Guest user. Saving settings to local storage.");
        saveLocalUserSettings(); // Save to local storage
    }
    console.log("[DEBUG] Exiting saveUserSettings.");
}

/**
 * Retrieves the hexadecimal color code for the primary background based on the current theme.
 * @param {string} theme - The name of the current theme ('dark', 'light', 'vibrant').
 * @returns {string} The hexadecimal color code.
 */
function getThemeBackgroundColorHex(theme) {
    switch (theme) {
        case 'dark':
            return '#0f172a';
        case 'light':
            return '#f0f2f5';
        case 'vibrant':
            return '#2d0b57';
        default:
            return '#0f172a'; // Default to dark theme's primary background
    }
}

/**
 * Applies loaded/default settings to the UI elements.
 */
function applySettingsToUI() {
    console.log("[DEBUG] Entering applySettingsToUI.");
    // Ensure UI elements are initialized before trying to apply settings to them
    if (!inspectionToggle || !soundEffectsToggle || !cubeTypeSelect || !themeSelect || !cubeViewToggle) {
        console.warn("[WARN] applySettingsToUI called before settings UI elements are initialized. Skipping apply.");
        return;
    }

    if (inspectionToggle) inspectionToggle.checked = enableInspection;
    if (soundEffectsToggle) soundEffectsToggle.checked = enableSoundEffects;
    if (cubeTypeSelect) cubeTypeSelect.value = cubeType;
    if (themeSelect) themeSelect.value = currentTheme;
    if (cubeViewToggle) cubeViewToggle.checked = show3DCubeView; // Apply new setting to UI

    document.body.className = `theme-${currentTheme}`; // Apply theme class

    // Toggle visibility of scramble displays
    if (show3DCubeView) {
        if (scrambleTextDisplay) scrambleTextDisplay.style.display = 'none';
        if (cube3DContainer) cube3DContainer.style.display = 'flex'; // Use flex for centering
        if (scramble3DViewer) {
            // Set the 3D viewer background directly using the hex color for the chosen theme
            scramble3DViewer.setAttribute('background', getThemeBackgroundColorHex(currentTheme));
        }
    } else {
        if (scrambleTextDisplay) scrambleTextDisplay.style.display = 'block';
        if (cube3DContainer) cube3DContainer.style.display = 'none';
    }

    // Ensure scramble is generated/updated for the correct display
    scramble = generateScramble();
    console.log("[DEBUG] UI settings applied and scramble regenerated.");
    console.log("[DEBUG] Exiting applySettingsToUI.");
}

/**
 * Updates the username in Firestore for authenticated users, or local storage for guests.
 */
async function updateUsername() {
    console.log("[DEBUG] Entering updateUsername.");
    const newUsername = settingsUsernameInput.value.trim();
    if (!newUsername) {
        if (usernameUpdateMessage) {
            usernameUpdateMessage.textContent = "Username cannot be empty.";
            usernameUpdateMessage.style.color = "#ef4444"; // Red for error
            usernameUpdateMessage.style.display = 'block';
        }
        console.warn("[WARN] New username is empty.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Authenticated user
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        try {
            console.log(`[DEBUG] Attempting to update username in Firestore to: ${newUsername}`);
            await updateDoc(userProfileRef, { username: newUsername });
            if (usernameUpdateMessage) {
                usernameUpdateMessage.textContent = "Username updated successfully!";
                usernameUpdateMessage.style.color = "#22c55e"; // Green for success
                usernameUpdateMessage.style.display = 'block';
            }
            console.log("[DEBUG] Username updated successfully in Firestore.");

            // Update the displayed username immediately
            // MODIFIED: Direct assignment of username. "Current User:" is in HTML
            const usernameDisplayElement = document.getElementById('usernameDisplay'); // Ensure this is defined
            if (usernameDisplayElement) usernameDisplayElement.textContent = newUsername;
            console.log("[DEBUG] Displayed username refreshed after update.");

            setTimeout(() => {
                if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
                console.log("[DEBUG] Username update message hidden.");
            }, 3000); // Hide message after 3 seconds

        } catch (e) {
            console.error("[ERROR] Error updating username in Firestore: ", e);
            if (usernameUpdateMessage) {
                usernameUpdateMessage.textContent = `Failed to update username: ${e.message}`;
                usernameUpdateMessage.style.color = "#ef4444"; // Red for error
                usernameUpdateMessage.style.display = 'block';
            }
            // Fallback to local save if Firestore fails
            saveLocalUsername(newUsername);
            // MODIFIED: Direct assignment for fallback
            const usernameDisplayElement = document.getElementById('usernameDisplay');
            if (usernameDisplayElement) usernameDisplayElement.textContent = newUsername;
            console.warn("[WARN] Firestore failed to update username, saved to local storage (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] updateUsername: Guest user. Updating username in local storage.");
        saveLocalUsername(newUsername);
        if (usernameUpdateMessage) {
            usernameUpdateMessage.textContent = "Username updated locally (not saved online).";
            usernameUpdateMessage.style.color = "#fbbf24"; // Amber for warning
            usernameUpdateMessage.style.display = 'block';
        }
        // MODIFIED: Direct assignment for guest username
        const usernameDisplayElement = document.getElementById('usernameDisplay');
        if (usernameDisplayElement) usernameDisplayElement.textContent = newUsername;
        setTimeout(() => {
            if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
            console.log("[DEBUG] Username update message hidden.");
        }, 3000);
    }
    console.log("[DEBUG] Exiting updateUsername.");
}

// --- Timer Logic ---

/**
 * Starts or stops the timer/inspection.
 */
function toggleTimer() {
    console.log("[DEBUG] Entering toggleTimer.");
    // Ensure AudioContext is running before playing sounds
    if (enableSoundEffects && !audioContextResumed) {
        console.warn("[WARN] Attempted to toggle timer with sounds enabled but AudioContext not resumed. Attempting resume.");
        resumeAudioContextOnFirstGesture(); // Attempt to resume on first interaction
    }

    if (isTiming) {
        console.log("[DEBUG] toggleTimer: Currently timing, stopping timer.");
        // Stop the timer
        clearInterval(timerInterval);
        isTiming = false;
        if (startStopBtn) startStopBtn.textContent = 'Start / Stop (Space)';
        if (timerDisplay) timerDisplay.classList.remove('ready');
        if (enableSoundEffects && audioContextResumed && Tone.context.state === 'running') {
            console.log("[DEBUG] Playing stop sound.");
            stopSound.triggerAttackRelease("C2", "8n");
        }
        addSolve(elapsedTime); // Add solve to history (will handle Firestore/Local Storage)
        scramble = generateScramble(); // Generate new scramble for next solve
        if (timerDisplay) timerDisplay.textContent = formatTime(0); // Reset display to 0 for next solve
        elapsedTime = 0; // Reset elapsedTime
        console.log("[DEBUG] New scramble generated and timer reset for next solve.");
    } else if (isInspecting) {
        console.log("[DEBUG] toggleTimer: Currently inspecting, starting timer early.");
        // User pressed spacebar again during inspection to start timing early
        clearInterval(inspectionCountdownInterval);
        isInspecting = false;
        isTiming = true;
        if (timerDisplay) {
            timerDisplay.classList.remove('inspection');
            timerDisplay.classList.remove('ready'); // Remove ready state if it was there
            timerDisplay.textContent = formatTime(0);
        }
        if (startStopBtn) startStopBtn.textContent = 'Start (Space)';
        startTime = Date.now();
        timerInterval = setInterval(updateTimer, 10); // Update every 10ms for millisecond precision
        if (enableSoundEffects && audioContextResumed && Tone.context.state === 'running') {
            console.log("Playing Go! sound (inspection stopped early).");
            goSound.triggerAttackRelease(["C4", "E4", "G4"], "8n"); // "Go!" sound
        }
    } else {
        console.log("[DEBUG] toggleTimer: Initial start. Checking inspection setting.");
        // Initial start: enter inspection or start timer immediately
        if (enableInspection) {
            isInspecting = true;
            inspectionTimeLeft = 15;
            if (timerDisplay) {
                timerDisplay.classList.add('inspection');
                timerDisplay.textContent = `Inspection: ${inspectionTimeLeft}`;
            }
            if (startStopBtn) startStopBtn.textContent = 'Start (Space)'; // Change button text for inspection phase
            console.log("[DEBUG] Starting 15s inspection countdown.");

            // Start inspection countdown and beeps
            inspectionCountdownInterval = setInterval(() => {
                inspectionTimeLeft--;
                console.log(`[DEBUG] Inspection countdown: ${inspectionTimeLeft}s remaining.`);
                if (timerDisplay) timerDisplay.textContent = `Inspection: ${inspectionTimeLeft}`;
                if (inspectionTimeLeft >= 0) {
                    if (enableSoundEffects && audioContextResumed && Tone.context.state === 'running') {
                        // Play beep at 10 seconds and from 5 seconds down to 1
                        if (inspectionTimeLeft === 10 || (inspectionTimeLeft <= 5 && inspectionTimeLeft > 0)) {
                            console.log(`[DEBUG] Playing inspection beep for ${inspectionTimeLeft}s.`);
                            inspectionBeep.triggerAttackRelease("C5", "16n");
                        } else if (inspectionTimeLeft === 0) {
                            // At 0 seconds, play a distinct beep and the "Go!" sound
                            console.log("[DEBUG] Playing final inspection beep and Go! sound (0s).");
                            inspectionBeep.triggerAttackRelease("C5", "8n"); // Louder/longer beep for 0
                            goSound.triggerAttackRelease(["C4", "E4", "G4"], "8n"); // "Go!" sound

                            // AUTOSTART THE TIMER HERE
                            clearInterval(inspectionCountdownInterval); // Stop inspection countdown
                            isInspecting = false;
                            isTiming = true;
                            if (timerDisplay) timerDisplay.classList.remove('inspection', 'ready');
                            if (timerDisplay) timerDisplay.textContent = formatTime(0);
                            if (startStopBtn) startStopBtn.textContent = 'Stop (Space)';
                            startTime = Date.now();
                            timerInterval = setInterval(updateTimer, 10); // Start actual timer
                            console.log("[DEBUG] Inspection ended. Auto-starting timer.");
                        }
                    }

                    if (inspectionTimeLeft <= 8) { // After 8 seconds, ready to start
                        if (timerDisplay) timerDisplay.classList.add('ready');
                    }
                } else {
                    console.log("[DEBUG] Inspection time ran out. Forcing stop.");
                    clearInterval(inspectionCountdownInterval);
                    isTiming = false; // Ensure timer isn't running without user input
                    isInspecting = false;
                    if (timerDisplay) timerDisplay.classList.remove('inspection', 'ready');
                    if (timerDisplay) timerDisplay.textContent = formatTime(0);
                    scramble = generateScramble();
                    if (startStopBtn) startStopBtn.textContent = 'Start / Stop (Space)';
                    if (enableSoundEffects && audioContextResumed && Tone.context.state === 'running') {
                        console.log("Playing forced stop sound due to inspection timeout.");
                        stopSound.triggerAttackRelease("F2", "8n"); // A different sound for forced stop
                    }
                    addSolve(elapsedTime + 2000); // Adding +2 if it went past 0 without manual start
                }
            }, 1000);
        } else {
            console.log("[DEBUG] No inspection enabled. Starting timer immediately.");
            // No inspection, start timer immediately
            isTiming = true;
            if (timerDisplay) timerDisplay.classList.remove('inspection', 'ready');
            if (timerDisplay) timerDisplay.textContent = formatTime(0);
            if (startStopBtn) startStopBtn.textContent = 'Stop (Space)';
            startTime = Date.now();
            timerInterval = setInterval(updateTimer, 10);
            if (enableSoundEffects && audioContextResumed && Tone.context.state === 'running') {
                console.log("Playing initial start sound (no inspection).");
                startSound.triggerAttackRelease("C4", "8n"); // Initial start sound
            }
        }
    }
    console.log("[DEBUG] Exiting toggleTimer.");
}


/**
 * Updates the timer display during timing phase.
 */
function updateTimer() {
    elapsedTime = Date.now() - startTime;
    if (timerDisplay) timerDisplay.textContent = formatTime(elapsedTime);
}

/**
 * Resets the timer and generates a new scramble.
 */
function resetTimer() {
    clearInterval(timerInterval);
    clearInterval(inspectionCountdownInterval);
    isTiming = false;
    isInspecting = false;
    elapsedTime = 0;
    inspectionTimeLeft = 15;
    if (timerDisplay) {
        timerDisplay.textContent = formatTime(0);
        timerDisplay.classList.remove('inspection', 'ready');
    }
    if (startStopBtn) startStopBtn.textContent = 'Start / Stop (Space)';
    scramble = generateScramble(); // Updates both text and 3D
}

// --- Chatbox Functions (NEW) ---
/**
 * Adds a message to the chat history display.
 * @param {string} sender - 'User' or 'Jarvis'.
 * @param {string} message - The message text.
 * @param {boolean} isJarvis - True if the message is from Jarvis, false for user.
 */
function addMessageToChat(sender, message, isJarvis = false) {
    if (!chatHistoryDisplay) {
        console.warn("[WARN] chatHistoryDisplay not found. Cannot add message to chat.");
        return;
    }
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    messageElement.classList.add(isJarvis ? 'jarvis-message' : 'user-message');

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('font-bold');
    senderSpan.classList.add(isJarvis ? 'text-indigo-400' : 'text-green-400'); // Different color for user
    senderSpan.textContent = `${sender}: `;

    const messageText = document.createTextNode(message);

    messageElement.appendChild(senderSpan);
    messageElement.appendChild(messageText);
    chatHistoryDisplay.appendChild(messageElement);

    // Scroll to the bottom of the chat history
    chatHistoryDisplay.scrollTop = chatHistoryDisplay.scrollHeight;
}

/**
 * Handles sending a text command from the chat input.
 */
function handleChatCommand() {
    const commandText = chatInput.value.trim();
    if (commandText) {
        addMessageToChat('User', commandText, false); // Add user's message to chat
        processVoiceCommandWithGemini(commandText); // Use the same NLU processing for text commands
        chatInput.value = ''; // Clear input field
    }
}

/**
 * Opens the chat modal.
 */
function openChatModal() {
    if (chatModal) {
        chatModal.classList.add('open');
        chatModal.focus();
        // Ensure chat history scrolls to bottom when opened
        if (chatHistoryDisplay) {
            chatHistoryDisplay.scrollTop = chatHistoryDisplay.scrollHeight;
        }
    }
}

/**
 * Closes the chat modal.
 */
function closeChatModal() {
    if (chatModal) {
        chatModal.classList.remove('open');
    }
}

// --- Lessons Functions (NEW) ---

/**
 * Opens the lessons modal and prepares for lesson generation.
 */
function openLessonsModal() {
    if (lessonsModal) {
        lessonsModal.classList.add('open');
        lessonsModal.focus();
        // Reset modal state
        if (lessonTopicSelection) lessonTopicSelection.style.display = 'block';
        if (lessonContentDisplay) lessonContentDisplay.style.display = 'none';
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
        if (lessonGenerationError) lessonGenerationError.style.display = 'none';
        if (lessonTopicInput) lessonTopicInput.value = ''; // Clear previous topic
        currentLesson = null;
        currentLessonStepIndex = 0;
        if (lessonStepCounter) lessonStepCounter.textContent = 'Step 0 of 0'; // Reset counter
    }
}

/**
 * Closes the lessons modal.
 */
function closeLessonsModal() {
    if (lessonsModal) {
        lessonsModal.classList.remove('open');
        // Optionally, reset the content of the modal when closed
        if (lessonContentDisplay) lessonContentDisplay.style.display = 'none';
        if (lessonTopicSelection) lessonTopicSelection.style.display = 'block';
        currentLesson = null;
        currentLessonStepIndex = 0;
    }
}

/**
 * Displays the loaded lesson data in the modal.
 * @param {Object} lessonData - The structured lesson data from the AI.
 */
function displayLesson(lessonData) {
    currentLesson = lessonData;
    currentLessonStepIndex = 0;

    if (lessonTopicSelection) lessonTopicSelection.style.display = 'none';
    if (lessonContentDisplay) lessonContentDisplay.style.display = 'block';
    if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
    if (lessonGenerationError) lessonGenerationError.style.display = 'none';

    if (lessonTitleDisplay) lessonTitleDisplay.textContent = lessonData.lessonTitle;
    if (lessonDescriptionDisplay) lessonDescriptionDisplay.textContent = lessonData.lessonDescription;

    renderCurrentLessonStep();
}

/**
 * Renders the current step of the lesson.
 */
function renderCurrentLessonStep() {
    if (!currentLesson || !currentLesson.steps || currentLesson.steps.length === 0) {
        console.warn("[WARN] No lesson data or steps to render.");
        return;
    }

    const currentStep = currentLesson.steps[currentLessonStepIndex];

    if (lessonStepTitleDisplay) lessonStepTitleDisplay.textContent = currentStep.stepTitle;
    if (lessonStepDescriptionDisplay) lessonStepDescriptionDisplay.textContent = currentStep.stepDescription;
    if (lessonExplanationDisplay) lessonExplanationDisplay.textContent = currentStep.explanation || '';

    // Handle twisty-player visualization
    if (lessonVisualContainer) {
        lessonVisualContainer.innerHTML = ''; // Clear previous player
        if (currentStep.visualAlgorithm) {
            const twistyPlayerElement = document.createElement('twisty-player');
            twistyPlayerElement.setAttribute('alg', currentStep.visualAlgorithm);
            twistyPlayerElement.setAttribute('puzzle', currentLesson.cubeType === 'pyraminx' ? 'pyraminx' : `${currentLesson.cubeType}x${currentLesson.cubeType}`);
            twistyPlayerElement.setAttribute('control-panel', 'bottom'); // Show controls
            twistyPlayerElement.setAttribute('background', getThemeBackgroundColorHex(currentTheme)); // Match theme
            twistyPlayerElement.style.width = '100%';
            twistyPlayerElement.style.height = '100%';
            lessonVisualContainer.appendChild(twistyPlayerElement);
            lessonVisualContainer.style.display = 'flex'; // Show container
            console.log(`[DEBUG] Twisty-player loaded for lesson step: alg="${currentStep.visualAlgorithm}", puzzle="${twistyPlayerElement.getAttribute('puzzle')}"`);
        } else {
            lessonVisualContainer.style.display = 'none'; // Hide container if no algorithm
        }
    }

    // Update navigation buttons and step counter
    if (prevLessonStepBtn) {
        prevLessonStepBtn.disabled = currentLessonStepIndex === 0;
    }
    if (nextLessonStepBtn) {
        nextLessonStepBtn.disabled = currentLessonStepIndex === currentLesson.steps.length - 1;
    }
    if (lessonStepCounter) {
        lessonStepCounter.textContent = `Step ${currentLessonStepIndex + 1} of ${currentLesson.steps.length}`;
    }
}

/**
 * Navigates to the next lesson step.
 */
function nextLessonStep() {
    if (currentLesson && currentLessonStepIndex < currentLesson.steps.length - 1) {
        currentLessonStepIndex++;
        renderCurrentLessonStep();
    }
}

/**
 * Navigates to the previous lesson step.
 */
function prevLessonStep() {
    if (currentLesson && currentLessonStepIndex > 0) {
        currentLessonStepIndex--;
        renderCurrentLessonStep();
    }
}


// --- Event Listeners ---

/**
 * Sets up all event listeners for buttons and keyboard input.
 */
function setupEventListeners() {
    console.log("[DEBUG] setupEventListeners: Assigning event listeners.");
    // Defensive checks for element existence before adding listeners
    timerDisplay = document.getElementById('timerDisplay');
    scrambleTextDisplay = document.getElementById('scrambleTextDisplay');
    cube3DContainer = document.getElementById('cube3DContainer');
    scramble3DViewer = document.getElementById('scramble3DViewer');
    startStopBtn = document.getElementById('startStopBtn');
    resetBtn = document.getElementById('resetBtn');
    scrambleBtn = document.getElementById('scrambleBtn');
    settingsBtn = document.getElementById('settingsBtn');
    solveHistoryList = document.getElementById('solveHistoryList');
    bestTimeDisplay = document.getElementById('bestTime');
    ao5Display = document.getElementById('ao5');
    ao12Display = document.getElementById('ao12');
    solveCountDisplay = document.getElementById('solveCount');
    noSolvesMessage = document.getElementById('noSolvesMessage');
    inspectionToggle = document.getElementById('inspectionToggle');
    soundEffectsToggle = document.getElementById('soundEffectsToggle');
    cubeTypeSelect = document.getElementById('cubeTypeSelect');
    themeSelect = document.getElementById('themeSelect');
    cubeViewToggle = document.getElementById('cubeViewToggle');
    settingsUsernameInput = document.getElementById('settingsUsernameInput');
    saveUsernameBtn = document.getElementById('saveUsernameBtn');
    usernameUpdateMessage = document.getElementById('usernameUpdateMessage');
    aiInsightModal = document.getElementById('aiInsightModal');
    closeAiInsightModalBtn = document.getElementById('closeAiInsightModal');
    aiInsightContentDisplay = document.getElementById('aiInsightContent');
    insightMessageElement = document.getElementById('insightMessage');
    insightSpinner = aiInsightContentDisplay ? aiInsightContentDisplay.querySelector('.spinner') : null; // Safely query
    scrambleAnalysisDisplay = document.getElementById('scrambleAnalysisDisplay'); // NEW
    scrambleAnalysisText = document.getElementById('scrambleAnalysisText');       // NEW
    // Removed optimalSolutionDisplay and optimalSolutionText from assignment
    // optimalSolutionDisplay = document.getElementById('optimalSolutionDisplay');
    // optimalSolutionText = document.getElementById('optimalSolutionText');
    personalizedTipDisplay = document.getElementById('personalizedTipDisplay');
    personalizedTipText = document.getElementById('personalizedTipText');
    // NEW: Targeted Practice Focus elements
    targetedPracticeFocusDisplay = document.getElementById('targetedPracticeFocusDisplay');
    targetedPracticeFocusText = document.getElementById('targetedPracticeFocusText');

    playPreviewBtn = document.getElementById('playPreviewBtn');
    pausePreviewBtn = document.getElementById('pausePreviewBtn');
    restartPreviewBtn = document.getElementById('restartPreviewBtn');
    voiceCommandBtn = document.getElementById('voiceCommandBtn');
    voiceFeedbackDisplay = document.getElementById('voiceFeedbackDisplay'); // Assign new elements
    voiceListeningText = document.getElementById('voiceListeningText');
    voiceListeningIndicator = document.getElementById('voiceListeningIndicator');
    voiceLiveTranscript = document.getElementById('voiceLiveTranscript'); // Assign new live transcript element

    // Chatbox elements
    chatModal = document.getElementById('chatModal');
    closeChatModalBtn = document.getElementById('closeChatModal');
    chatHistoryDisplay = document.getElementById('chatHistory');
    chatInput = document.getElementById('chatInput');
    chatSendBtn = document.getElementById('chatSendBtn');
    openChatBtn = document.getElementById('openChatBtn');

    // NEW: Lessons Button
    openLessonsBtn = document.getElementById('openLessonsBtn');

    // Lessons Modal elements (NEW)
    lessonsModal = document.getElementById('lessonsModal');
    closeLessonsModalBtn = document.getElementById('closeLessonsModalBtn');
    lessonModalTitle = document.getElementById('lessonModalTitle');
    lessonTopicSelection = document.getElementById('lessonTopicSelection');
    lessonTopicInput = document.getElementById('lessonTopicInput');
    generateLessonBtn = document.getElementById('generateLessonBtn');
    lessonGenerationError = document.getElementById('lessonGenerationError');
    lessonContentDisplay = document.getElementById('lessonContentDisplay');
    lessonTitleDisplay = document.getElementById('lessonTitleDisplay');
    lessonDescriptionDisplay = document.getElementById('lessonDescriptionDisplay');
    lessonStepsContainer = document.getElementById('lessonStepsContainer');
    lessonStepTitleDisplay = document.getElementById('lessonStepTitleDisplay');
    lessonStepDescriptionDisplay = document.getElementById('lessonStepDescriptionDisplay');
    lessonVisualContainer = document.getElementById('lessonVisualContainer');
    lessonExplanationDisplay = document.getElementById('lessonExplanationDisplay');
    prevLessonStepBtn = document.getElementById('prevLessonStepBtn');
    nextLessonStepBtn = document.getElementById('nextLessonStepBtn');
    lessonStepCounter = document.getElementById('lessonStepCounter');
    lessonLoadingSpinner = document.getElementById('lessonLoadingSpinner');


    // Authentication related elements
    const authModal = document.getElementById('authModal');
    const authModalTitle = document.getElementById('authModalTitle');
    const emailInput = document.getElementById('email');
    const usernameInputField = document.getElementById('usernameInput');
    const usernameFieldGroup = document.getElementById('usernameFieldGroup');
    const passwordInput = document.getElementById('password');
    const authError = document.getElementById('authError');
    const emailAuthBtn = document.getElementById('emailAuthBtn');
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const signInBtn = document.getElementById('signInBtn');
    const signUpBtn = document.getElementById('signUpBtn');
    const signOutBtn = document.getElementById('signOutBtn');


    if (startStopBtn) startStopBtn.addEventListener('click', toggleTimer); else console.error("[ERROR] startStopBtn not found!");
    if (resetBtn) resetBtn.addEventListener('click', resetTimer); else console.error("[ERROR] resetBtn not found!");
    if (scrambleBtn) scrambleBtn.addEventListener('click', () => {
        scramble = generateScramble();
        resetTimer();
    }); else console.error("[ERROR] scrambleBtn not found!");
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) {
            settingsModal.classList.add('open');
            settingsModal.focus();
        }
        // Pre-fill username input based on current user type
        if (isUserAuthenticated && auth && auth.currentUser && db && userId) {
            const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
            getDoc(userProfileRef).then(docSnap => {
                if (docSnap.exists() && docSnap.data().username && settingsUsernameInput) {
                    settingsUsernameInput.value = docSnap.data().username;
                } else if (settingsUsernameInput) {
                    settingsUsernameInput.value = ''; // Clear if no username found
                }
            }).catch(e => {
                console.error("Error loading username for settings:", e);
                if (settingsUsernameInput) settingsUsernameInput.value = '';
            });
        } else if (settingsUsernameInput) {
            settingsUsernameInput.value = loadLocalUsername(); // Load from local storage for guests
        }

        if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
        applySettingsToUI(); // Apply settings to ensure all toggles/selects reflect current values
    }); else console.error("[ERROR] settingsBtn not found!");

    const closeSettingsModalBtn = document.getElementById('closeSettingsModal');
    if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', () => {
        const settingsModal = document.getElementById('settingsModal');
        if (settingsModal) settingsModal.classList.remove('open');
        console.log("[DEBUG] Settings modal closed by button.");
        saveUserSettings(); // Save settings when modal is closed
    }); else console.error("[ERROR] closeSettingsModal not found!");

    const closeAuthModalBtn = document.getElementById('closeAuthModal');
    if (closeAuthModalBtn) closeAuthModalBtn.addEventListener('click', () => {
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.classList.remove('open');
        clearAuthError();
        console.log("[DEBUG] Auth modal closed by button.");
    }); else console.error("[ERROR] closeAuthModal not found!");

    if (closeAiInsightModalBtn) closeAiInsightModalBtn.addEventListener('click', () => {
        if (aiInsightModal) aiInsightModal.classList.remove('open');
        console.log("[DEBUG] AI Insight modal closed by button.");
    }); else console.error("[ERROR] closeAiInsightModalBtn not found!");


    if (inspectionToggle) inspectionToggle.addEventListener('change', (e) => {
        enableInspection = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] inspectionToggle not found!");

    if (soundEffectsToggle) soundEffectsToggle.addEventListener('change', (e) => {
        enableSoundEffects = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] soundEffectsToggle not found!");

    if (cubeTypeSelect) cubeTypeSelect.addEventListener('change', (e) => {
        cubeType = e.target.value;
        saveUserSettings();
        scramble = generateScramble();
        resetTimer();
        // Ensure the select value matches the updated cubeType (sync UI)
        cubeTypeSelect.value = cubeType;
    }); else console.error("[ERROR] cubeTypeSelect not found!");

    if (themeSelect) themeSelect.addEventListener('change', (e) => {
        currentTheme = e.target.value;
        document.body.className = `theme-${currentTheme}`;
        saveUserSettings();
    }); else console.error("[ERROR] themeSelect not found!");

    if (cubeViewToggle) cubeViewToggle.addEventListener('change', (e) => {
        show3DCubeView = e.target.checked;
        applySettingsToUI();
        saveUserSettings();
    }); else console.error("[ERROR] cubeViewToggle not found!");

    if (saveUsernameBtn) saveUsernameBtn.addEventListener('click', updateUsername); else console.error("[ERROR] saveUsernameBtn not found!");

    // New: Event listeners for custom preview toolbar
    if (playPreviewBtn) playPreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) scramble3DViewer.play();
        console.log("[DEBUG] Play preview button clicked.");
    }); else console.error("[ERROR] playPreviewBtn not found!");

    if (pausePreviewBtn) pausePreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) scramble3DViewer.pause();
        console.log("[DEBUG] Pause preview button clicked.");
    }); else console.error("[ERROR] pausePreviewBtn not found!");

    if (restartPreviewBtn) restartPreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer && scramble) {
            // Jump to the start of the animation (effectively rewinds)
            scramble3DViewer.jumpToStart();
            // Play from the beginning
            scramble3DViewer.play();
            console.log("[DEBUG] Restart preview button clicked. Cube animation restarted from beginning.");
        }
    }); else console.error("[ERROR] restartPreviewBtn not found!");

    // Voice Command Button Listener
    if (voiceCommandBtn && recognition) { // Only add if both exist
        voiceCommandBtn.addEventListener('click', () => {
            console.log("[DEBUG] Voice command button clicked. awaitingActualCommand:", awaitingActualCommand);

            if (awaitingActualCommand) { // If currently in command mode (button pressed again)
                console.log("[DEBUG] Command mode cancelled by button press.");
                clearTimeout(commandTimeoutId);
                commandTimeoutId = null;
                awaitingActualCommand = false;
                speakAsJarvis("Command mode cancelled, Sir Sevindu. I am now listening for the wake word.");
                updateVoiceFeedbackDisplay("Listening for 'Jarvis'...", true, true);
            } else {
                // Toggle continuous listening state
                isContinuousListeningEnabled = !isContinuousListeningEnabled;
                if (isContinuousListeningEnabled) {
                    console.log("[DEBUG] Voice command button: Enabling continuous listening.");
                    attemptRestartRecognition(); // Attempt to start recognition
                    speakAsJarvis("Voice commands enabled, Sir Sevindu. Listening for your instructions.");
                } else {
                    console.log("[DEBUG] Voice command button: Disabling continuous listening.");
                    if (recognition.listening) {
                        recognition.abort(); // Force stop current recognition
                    }
                    speakAsJarvis("Voice commands disabled, Sir Sevindu.");
                    updateVoiceFeedbackDisplay("", false, false); // Hide display
                    if (voiceCommandBtn) voiceCommandBtn.classList.remove('active');
                }
            }
        });
    } else if (voiceCommandBtn) {
        // Hide if SpeechRecognition API is not supported
        voiceCommandBtn.style.display = 'none';
        console.warn("[WARN] Voice command button hidden as Web Speech API is not supported.");
    }

    // NEW: Chat button listeners
    if (openChatBtn) openChatBtn.addEventListener('click', openChatModal);
    if (closeChatModalBtn) closeChatModalBtn.addEventListener('click', closeChatModal);
    if (chatSendBtn) chatSendBtn.addEventListener('click', handleChatCommand);
    if (chatInput) chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { // Send on Enter, allow Shift+Enter for new line
            e.preventDefault();
            handleChatCommand();
        }
    });

    // NEW: Lessons Button Listener
    if (openLessonsBtn) openLessonsBtn.addEventListener('click', openLessonsModal);


    // NEW: Lessons Modal event listeners
    if (closeLessonsModalBtn) closeLessonsModalBtn.addEventListener('click', closeLessonsModal);
    if (generateLessonBtn) generateLessonBtn.addEventListener('click', () => {
        const topic = lessonTopicInput.value.trim();
        if (topic) {
            const userLevel = getUserLevel(0, cubeType); // Use current cube type and estimated level
            requestLessonFromAI(topic, cubeType, userLevel);
        } else {
            if (lessonGenerationError) {
                lessonGenerationError.textContent = "Please enter a lesson topic.";
                lessonGenerationError.style.display = 'block';
            }
        }
    });
    if (prevLessonStepBtn) prevLessonStepBtn.addEventListener('click', prevLessonStep);
    if (nextLessonStepBtn) nextLessonStepBtn.addEventListener('click', nextLessonStep);


    document.addEventListener('keydown', (e) => {
        // FIX: Prevent spacebar from triggering timer when typing in chat input
        if (e.target === chatInput && e.code === 'Space') {
            return; // Do nothing, let the browser handle the space in the textarea
        }
        // Prevent spacebar from triggering timer when typing in lesson topic input
        if (e.target === lessonTopicInput && e.code === 'Space') {
            return;
        }

        if (e.code === 'Escape') {
            const settingsModal = document.getElementById('settingsModal');
            if (settingsModal && settingsModal.classList.contains('open')) {
                settingsModal.classList.remove('open');
                saveUserSettings();
                console.log("[DEBUG] Settings modal closed by Escape key.");
            }
            const authModal = document.getElementById('authModal');
            if (authModal && authModal.classList.contains('open')) {
                authModal.classList.remove('open');
                clearAuthError();
                console.log("[DEBUG] Auth modal closed by Escape key.");
            }
            if (aiInsightModal && aiInsightModal.classList.contains('open')) {
                aiInsightModal.classList.remove('open');
                console.log("[DEBUG] AI Insight modal closed by Escape key.");
            }
            if (chatModal && chatModal.classList.contains('open')) { // Close chat modal on Escape
                chatModal.classList.remove('open');
                console.log("[DEBUG] Chat modal closed by Escape key.");
            }
            if (lessonsModal && lessonsModal.classList.contains('open')) { // Close lessons modal on Escape
                lessonsModal.classList.remove('open');
                console.log("[DEBUG] Lessons modal closed by Escape key.");
            }
        }

        if (e.code === 'Space') {
            e.preventDefault();
            // Ensure AudioContext is running before playing sounds
            if (enableSoundEffects && !audioContextResumed) {
                console.warn("[WARN] Attempted Spacebar press with sounds enabled but AudioContext not resumed. Attempting resume.");
                resumeAudioContextOnFirstGesture(); // Attempt to resume on interaction
            }
            if (e.repeat) return;
            spaceDownTime = Date.now();
            if (timerDisplay) timerDisplay.classList.add('ready');
        }
    });

    document.addEventListener('keyup', (e) => {
        // FIX: Prevent spacebar from triggering timer when typing in chat input
        if (e.target === chatInput && e.code === 'Space') {
            return; // Do nothing, let the browser handle the space in the textarea
        }
        // Prevent spacebar from triggering timer when typing in lesson topic input
        if (e.target === lessonTopicInput && e.code === 'Space') {
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            const spaceUpTime = Date.now();
            const holdDuration = spaceUpTime - spaceDownTime;
            if (timerDisplay) timerDisplay.classList.remove('ready');

            if (holdDuration < 500 && !isTiming && !isInspecting) {
                toggleTimer();
            } else if (isInspecting && holdDuration >= 500) {
                toggleTimer();
            } else if (isTiming) {
                toggleTimer();
            }
            spaceDownTime = 0;
        }
    });

    // --- Authentication Event Listeners ---
    // These elements are assigned here, within setupEventListeners,
    // as they are part of the main application's UI interactions.

    function showAuthError(message) {
        if (authError) {
            authError.textContent = message;
            authError.style.display = 'block';
        }
    }

    function clearAuthError() {
        if (authError) {
            authError.textContent = '';
            authError.style.display = 'none';
        }
    }

    if (signInBtn) signInBtn.addEventListener('click', () => {
        if (authModal) {
            authModal.classList.add('open');
            authModal.focus();
        }
        if (authModalTitle) authModalTitle.textContent = 'Sign In';
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (usernameFieldGroup) usernameFieldGroup.style.display = 'none';
        clearAuthError();
    }); else console.error("[ERROR] signInBtn not found!");

    if (signUpBtn) signUpBtn.addEventListener('click', () => {
        if (authModal) {
            authModal.classList.add('open');
            authModal.focus();
        }
        if (authModalTitle) authModalTitle.textContent = 'Sign Up';
        if (emailAuthBtn) {
            emailAuthBtn.textContent = 'Sign Up';
            emailAuthBtn.onclick = handleSignUp;
        }
        if (emailInput) emailInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (usernameInputField) usernameInputField.value = '';
        if (usernameFieldGroup) usernameFieldGroup.style.display = 'block';
        clearAuthError();
    }); else console.error("[ERROR] signUpBtn not found!");

    if (signOutBtn) signOutBtn.addEventListener('click', async () => {
        if (auth) { // Only attempt sign out if auth object is initialized
            try {
                await signOut(auth);
                // onAuthStateChanged will handle UI and data loading for the now-guest user.
                console.log("User signed out successfully.");
            } catch (error) {
                console.error("Error signing out:", error);
            }
        }
    }); else console.error("[ERROR] signOutBtn not found!");

    if (emailAuthBtn) emailAuthBtn.addEventListener('click', handleSignIn); // Direct assignment, not dynamic
    if (googleSignInBtn) googleSignInBtn.addEventListener('click', async () => {
        // Defensive check for auth before using it
        if (!auth) {
            console.warn("[WARN] Google Sign-In: Firebase Auth not initialized.");
            showAuthError("Authentication service not ready. Please try again.");
            return;
        }
        const provider = new GoogleAuthProvider();
        clearAuthError();
        try {
            const userCredential = await signInWithPopup(auth, provider);
            const user = userCredential.user;

            if (db) { // Ensure db is initialized
                const userProfileRef = doc(db, `artifacts/${appId}/users/${user.uid}/profile/data`);
                const docSnap = await getDoc(userProfileRef);
                if (!docSnap.exists() || !docSnap.data().username) {
                    const defaultUsername = user.displayName || (user.email ? user.email.split('@')[0] : 'GoogleUser');
                    await setDoc(userProfileRef, { username: defaultUsername }, { merge: true });
                    console.log(`[DEBUG] Default username saved for new Google user: ${defaultUsername}`);
                }
            }
            if (authModal) authModal.classList.remove('open');
            console.log("Signed in with Google.");
        } catch (error) {
            showAuthError(error.message);
            console.error("Google sign-in error:", error);
        }
    }); else console.error("[ERROR] googleSignInBtn not found!");

    // Helper functions for auth
    async function handleSignIn() {
        // Defensive check for auth before using it
        if (!auth) {
            console.warn("[WARN] Email Sign-In: Firebase Auth not initialized.");
            showAuthError("Authentication service not ready. Please try again.");
            return;
        }
        const email = emailInput ? emailInput.value : '';
        const password = passwordInput ? password.value : '';
        clearAuthError();
        try {
            await signInWithEmailAndPassword(auth, email, password);
            if (authModal) authModal.classList.remove('open');
            console.log("Signed in with email:", email);
        } catch (error) {
            showAuthError(error.message);
            console.error("Email sign-in error:", error);
        }
    }

    async function handleSignUp() {
        // Defensive check for auth before using it
        if (!auth) {
            console.warn("[WARN] Email Sign-Up: Firebase Auth not initialized.");
            showAuthError("Authentication service not ready. Please try again.");
            return;
        }
        const email = emailInput ? emailInput.value : '';
        const username = usernameInputField ? usernameInputField.value.trim() : '';
        const password = passwordInput ? password.value : '';
        clearAuthError();

        if (!username) {
            showAuthError("Please enter a username.");
            return;
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            if (db) { // Ensure db is initialized
                const userProfileRef = doc(db, `artifacts/${appId}/users/${user.uid}/profile/data`);
                await setDoc(userProfileRef, { username: username }, { merge: true });
                console.log(`[DEBUG] Username saved for new email user: ${username}`);
            }
            if (authModal) authModal.classList.remove('open');
            console.log("Signed up with email:", email, "Username:", username);
        } catch (error) {
            showAuthError(error.message);
            console.error("Email sign-up error:", error);
        }
    }
}

// --- Initialization on Window Load ---
// This callback runs only after the entire DOM is loaded.
window.onload = function () {
    console.log("[DEBUG] window.onload triggered. Initializing DOM elements and listeners.");

    // CRITICAL FIX: Call setupEventListeners FIRST to ensure all DOM elements are assigned
    // to their global variables before any other function attempts to use them.
    setupEventListeners(); // Attaches all event listeners and assigns global DOM element variables.

    // Now that DOM elements are assigned, proceed with other initializations.
    scramble = generateScramble(); // Generates initial scramble and updates displays
    // The previous error "scrambleDisplay is not defined" should now be resolved.

    // Attempt to initialize user data and settings now that DOM is ready.
    // This function itself checks if Firebase Auth is also ready.
    initializeUserDataAndSettings();

    // Start continuous listening for wake word if Web Speech API is supported
    if (recognition) {
        try {
            console.log("[DEBUG] Initial SpeechRecognition.start() called for continuous wake word listening via attemptRestartRecognition.");
            // Only attempt to start if continuous listening is enabled by default or user
            if (isContinuousListeningEnabled) {
                attemptRestartRecognition(); // Use the controlled restart for initial start
            } else {
                console.log("[DEBUG] Continuous listening is disabled. Not starting recognition on load.");
                updateVoiceFeedbackDisplay("Voice commands disabled.", false, true);
            }
        } catch (e) {
            console.error("[ERROR] Initial recognition.start() failed:", e);
            // This can happen if microphone is not available or permissions are denied initially.
            // The onerror will likely catch this and log/handle it.
        }
    } else {
        console.warn("[WARN] Web Speech API not supported, cannot start continuous listening.");
        updateVoiceFeedbackDisplay("Voice commands not supported by browser.", false, true);
    }

    // Set the flag to indicate DOM elements are ready (after setupEventListeners)
    domElementsReady = true;

    console.log("[DEBUG] window.onload complete. Application should now be fully initialized.");
};
