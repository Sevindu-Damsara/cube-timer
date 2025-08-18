// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, deleteDoc, onSnapshot, collection, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for history.js completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---\
// These are duplicated from script.js to ensure history.js can function independently.
// =====================================================================================================
const appId = 'my-production-speedcube-timer'; // A unique ID for your app's data
const firebaseConfig = {
    apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M",
    authDomain: "ubically-timer.firebaseapp.com",
    projectId: "ubically-timer",
    storageBucket: "ubically-timer.firebaseystorage.app",
    messagingSenderId: "467118524389",
    appId: "1:467118524389:web:d3455f5be5747be2cb910c",
    measurementId: "G-6033SRP9WC"
};
const geminiInsightFunctionUrl = "https://cube-timer-ten.vercel.app/api/gemini-insight";
// =====================================================================================================

let app;
let db;
let auth;
let userId = null;
let isAuthReady = false; // Flag to indicate if Firebase auth state has been determined
let isUserAuthenticated = false; // True if user is signed in via Email/Google, false for guests/signed out

let solves = []; // Array to store solve objects
let currentTheme = 'dark'; // Default theme, will be loaded from settings
let currentCubeType = '3x3'; // Default cube type, will be loaded from settings

// DOM elements
let solveHistoryList;
let noSolvesMessage;
let historyLoadingSpinner;

// AI Insight Modal elements (duplicated for self-containment)
let aiInsightModal;
let closeAiInsightModalBtn;
let aiInsightContentDisplay;
let insightMessageElement;
let insightSpinner;
let scrambleAnalysisDisplay;
let scrambleAnalysisText;
let personalizedTipDisplay;
let personalizedTipText;
let targetedPracticeFocusDisplay;
let targetedPracticeFocusText;

// Global variable for initial auth token (provided by Canvas environment)
const __initial_auth_token = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;


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
 * Renders the solve history list.
 */
function renderSolveHistory() {
    console.log("[DEBUG] Entering renderSolveHistory for history.html.");
    if (!solveHistoryList) {
        console.warn("[WARN] renderSolveHistory called before solveHistoryList is initialized. Skipping render.");
        return;
    }

    solveHistoryList.innerHTML = '';
    if (solves.length === 0) {
        if (noSolvesMessage) noSolvesMessage.style.display = 'block';
        console.log("[DEBUG] renderSolveHistory: No solves, displaying empty message.");
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
            <div class="scramble-text text-xs text-gray-500 mt-1">Scramble: ${solve.scramble || 'N/A'}</div>
            <div class="penalty-buttons">
                <button class="insight-button button-secondary" onclick="getSolveInsight('${solve.id}')">Get Insight ✨</button>
                <button class="plus2 button-secondary" onclick="applyPenalty('${solve.id}', '+2')">+2</button>
                <button class="button-secondary" onclick="applyPenalty('${solve.id}', 'DNF')">DNF</button>
                <button class="clear-penalty button-secondary" onclick="applyPenalty('${solve.id}', null)">Clear</button>
                <button class="delete button-secondary" onclick="deleteSolve('${solve.id}')">Delete</button>
            </div>
        `;
        solveHistoryList.appendChild(solveItem);
    });
    console.log("[DEBUG] Exiting renderSolveHistory.");
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
 * Loads solves from local storage.
 */
function loadLocalSolves() {
    console.log("[DEBUG] Loading solves from local storage (history.js).");
    try {
        const storedSolves = localStorage.getItem(`${appId}_guest_solves`);
        solves = storedSolves ? JSON.parse(storedSolves) : [];
        solves.forEach(solve => {
            if (typeof solve.timestamp === 'string') {
                solve.timestamp = new Date(solve.timestamp).getTime();
            }
        });
        console.log(`[DEBUG] Loaded ${solves.length} solves from local storage.`);
    } catch (e) {
        console.error("[ERROR] Error loading solves from local storage (history.js):", e);
        solves = [];
    }
}

/**
 * Saves solves to local storage.
 */
function saveLocalSolves() {
    console.log("[DEBUG] Saving solves to local storage (history.js).");
    try {
        localStorage.setItem(`${appId}_guest_solves`, JSON.stringify(solves));
        console.log("[DEBUG] Solves saved to local storage.");
    } catch (e) {
        console.error("[ERROR] Error saving solves to local storage (history.js):", e);
    }
}

/**
 * Sets up the real-time listener for user's solves from Firestore.
 * This function is only called for authenticated users.
 */
function setupRealtimeSolvesListener() {
    console.log("[DEBUG] Entering setupRealtimeSolvesListener for history.js.");
    if (!solveHistoryList) {
        console.warn("[WARN] setupRealtimeSolvesListener called before solveHistoryList is initialized. Skipping setup.");
        return;
    }

    if (isUserAuthenticated && db && userId) {
        console.log("[DEBUG] setupRealtimeSolvesListener: Authenticated and Firestore ready. Setting up onSnapshot.");
        const solvesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/solves`);
        const q = query(solvesCollectionRef, orderBy('timestamp', 'desc')); // Order by timestamp for history page

        solves = []; // Clear current solves to repopulate from snapshot
        if (historyLoadingSpinner) historyLoadingSpinner.style.display = 'block';

        onSnapshot(q, (snapshot) => {
            console.log("[DEBUG] onSnapshot callback triggered for history.js. Processing snapshot changes.");
            solves = []; // Clear current solves to repopulate from snapshot
            snapshot.forEach((doc) => {
                solves.push({ id: doc.id, ...doc.data() });
            });
            console.log(`[DEBUG] Solves updated from Firestore. Total solves: ${solves.length}.`);
            renderSolveHistory();
            if (historyLoadingSpinner) historyLoadingSpinner.style.display = 'none';
        }, (error) => {
            console.error("[ERROR] Error listening to solves (history.js): ", error);
            if (historyLoadingSpinner) historyLoadingSpinner.style.display = 'none';
            if (error.code === 'permission-denied') {
                console.warn("[WARN] Firestore permission denied for solves listener. Falling back to local storage for solves.");
                isUserAuthenticated = false;
                loadLocalSolves();
                renderSolveHistory();
            }
        });
    } else {
        console.log("[DEBUG] setupRealtimeSolvesListener: Not authenticated, Firestore listener not setup. Loading local solves.");
        loadLocalSolves();
        renderSolveHistory();
        if (historyLoadingSpinner) historyLoadingSpinner.style.display = 'none';
    }
    console.log("[DEBUG] Exiting setupRealtimeSolvesListener.");
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
    if (personalizedTipDisplay) personalizedTipDisplay.style.display = 'none';
    if (scrambleAnalysisDisplay) scrambleAnalysisDisplay.style.display = 'none';
    if (targetedPracticeFocusDisplay) targetedPracticeFocusDisplay.style.display = 'none';

    if (aiInsightModal) {
        aiInsightModal.classList.add('open');
        aiInsightModal.focus(); // Focus the modal for accessibility
    }

    // Determine user level for personalized tip
    const userLevel = getUserLevel(solve.time, currentCubeType); // Use currentCubeType from settings

    // Prepare the data to send to the Cloud Function
    const requestData = {
        type: "get_insight", // Indicate the type of request
        scramble: solve.scramble,
        cubeType: currentCubeType, // Use currentCubeType from settings
        time_ms: solve.time,
        penalty: solve.penalty,
        userLevel: userLevel
    };

    const apiUrl = geminiInsightFunctionUrl;

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        if (insightMessageElement) insightMessageElement.textContent = "AI Insight Cloud Function URL not configured. Please ensure your Vercel function is deployed and the URL is correct.";
        if (insightSpinner) insightSpinner.style.display = 'none';
        console.error("[ERROR] Gemini Insight Cloud Function URL is not set or is default placeholder.");
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

        if (result.scrambleAnalysis && scrambleAnalysisText && scrambleAnalysisDisplay) {
            scrambleAnalysisText.textContent = result.scrambleAnalysis;
            scrambleAnalysisDisplay.style.display = 'block';
        } else {
            if (scrambleAnalysisDisplay) scrambleAnalysisDisplay.style.display = 'none';
        }

        if (result.targetedPracticeFocus && targetedPracticeFocusText && targetedPracticeFocusDisplay) {
            targetedPracticeFocusText.textContent = result.targetedPracticeFocus;
            targetedPracticeFocusDisplay.style.display = 'block';
        } else {
            if (targetedPracticeFocusDisplay) targetedPracticeFocusDisplay.style.display = 'none';
        }

        if (result.personalizedTip && personalizedTipText && personalizedTipDisplay) {
            personalizedTipText.textContent = result.personalizedTip;
            personalizedTipDisplay.style.display = 'block';
        } else {
            if (personalizedTipDisplay) personalizedTipDisplay.style.display = 'none';
        }

        console.log("[DEBUG] Cloud Function response received and displayed.");

    } catch (e) {
        if (insightMessageElement) insightMessageElement.textContent = `Failed to get insight: ${e.message}`;
        console.error("[ERROR] Error calling Cloud Function:", e);
    } finally {
        if (insightSpinner) insightSpinner.style.display = 'none'; // Hide spinner
        console.log("[DEBUG] AI Insight generation process completed.");
    }
};

/**
 * Loads user settings specifically for the history page (mainly theme and cubeType).
 */
async function loadUserSettingsForHistory() {
    console.log("[DEBUG] history.js: Entering loadUserSettingsForHistory.");

    let loadedSettings = null;

    // Try to load from Firestore if authenticated
    if (auth.currentUser && db && userId && !auth.currentUser.isAnonymous) {
        console.log("[DEBUG] history.js: Authenticated user. Attempting to load settings from Firestore.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        try {
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                loadedSettings = docSnap.data();
                console.log("[DEBUG] history.js: Settings loaded from Firestore:", loadedSettings);
            } else {
                console.log("[DEBUG] history.js: No user settings found in Firestore.");
            }
        } catch (e) {
            console.error("[ERROR] history.js: Error loading user settings from Firestore:", e);
        }
    }

    // Fallback to local storage if not authenticated or Firestore failed
    if (!loadedSettings) {
        console.log("[DEBUG] history.js: Loading settings from local storage as fallback.");
        try {
            const storedSettings = localStorage.getItem(`${appId}_guest_settings`);
            if (storedSettings) {
                loadedSettings = JSON.parse(storedSettings);
                console.log("[DEBUG] history.js: Settings loaded from local storage:", loadedSettings);
            } else {
                console.log("[DEBUG] history.js: No settings found in local storage, using defaults.");
            }
        } catch (e) {
            console.error("[ERROR] history.js: Error loading settings from local storage:", e);
        }
    }

    // Apply loaded settings or defaults
    if (loadedSettings) {
        currentTheme = loadedSettings.theme || 'dark';
        currentCubeType = loadedSettings.cubeType || '3x3';
    } else {
        currentTheme = 'dark';
        currentCubeType = '3x3';
    }
    document.body.className = `theme-${currentTheme}`; // Apply theme to body
    console.log(`[DEBUG] history.js: Applied theme: ${currentTheme}, Cube Type: ${currentCubeType}`);
    console.log("[DEBUG] history.js: Exiting loadUserSettingsForHistory.");
}


/**
 * Initializes Firebase and loads user data for the history page.
 */
async function initializeHistoryPage() {
    console.log("[DEBUG] history.js: Initializing Firebase and loading data.");

    if (!app) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] history.js: Firebase initialized.");

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    isUserAuthenticated = !user.isAnonymous; // True if signed in via email/google
                    isAuthReady = true;
                    console.log(`[DEBUG] history.js: User authenticated: ${userId}. Authenticated status: ${isUserAuthenticated}`);
                } else {
                    // Sign in anonymously if no user, to get a UID for potential Firestore access
                    // (even if rules restrict it, having a UID helps consistent pathing)
                    try {
                        // Use __initial_auth_token if available, otherwise sign in anonymously
                        if (__initial_auth_token) {
                            const userCredential = await signInWithCustomToken(auth, __initial_auth_token);
                            userId = userCredential.user.uid;
                            isUserAuthenticated = false; // Still considered guest for persistence purposes
                            console.log(`[DEBUG] history.js: Signed in with custom token. User ID: ${userId}`);
                        } else {
                            const userCredential = await signInAnonymously(auth);
                            userId = userCredential.user.uid;
                            isUserAuthenticated = false; // Anonymous user is a guest
                            console.log(`[DEBUG] history.js: Signed in anonymously. User ID: ${userId}`);
                        }
                    } catch (e) {
                        console.error("[ERROR] history.js: Anonymous sign-in failed:", e);
                        userId = `guest-${crypto.randomUUID()}`; // Fallback to local UUID
                        isUserAuthenticated = false;
                    }
                    isAuthReady = true;
                }
                await loadUserSettingsForHistory(); // Load settings after auth state is known
                setupRealtimeSolvesListener(); // Setup listener after auth and settings are ready
            });
        } catch (e) {
            console.error("[ERROR] history.js: Firebase initialization failed:", e);
            isAuthReady = true; // Mark auth ready even if it failed, to proceed with local storage
            userId = `guest-${crypto.randomUUID()}`;
            isUserAuthenticated = false;
            await loadUserSettingsForHistory();
            setupRealtimeSolvesListener(); // Attempt to load local solves
        }
    } else {
        isAuthReady = true;
        await loadUserSettingsForHistory();
        setupRealtimeSolvesListener();
    }
}


// --- Event Listeners for history.html ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] history.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");

    // Assign DOM elements
    solveHistoryList = document.getElementById('solveHistoryList');
    noSolvesMessage = document.getElementById('noSolvesMessage');
    historyLoadingSpinner = document.getElementById('historyLoadingSpinner');

    aiInsightModal = document.getElementById('aiInsightModal');
    closeAiInsightModalBtn = document.getElementById('closeAiInsightModal');
    aiInsightContentDisplay = document.getElementById('aiInsightContent');
    insightMessageElement = document.getElementById('insightMessage');
    insightSpinner = aiInsightContentDisplay ? aiInsightContentDisplay.querySelector('.spinner') : null;
    scrambleAnalysisDisplay = document.getElementById('scrambleAnalysisDisplay');
    scrambleAnalysisText = document.getElementById('scrambleAnalysisText');
    personalizedTipDisplay = document.getElementById('personalizedTipDisplay');
    personalizedTipText = document.getElementById('personalizedTipText');
    targetedPracticeFocusDisplay = document.getElementById('targetedPracticeFocusDisplay');
    targetedPracticeFocusText = document.getElementById('targetedPracticeFocusText');


    if (closeAiInsightModalBtn) closeAiInsightModalBtn.addEventListener('click', () => {
        if (aiInsightModal) aiInsightModal.classList.remove('open');
        console.log("[DEBUG] AI Insight modal closed by button.");
    });


    // Initialize Firebase and load data when the DOM is ready
    initializeHistoryPage();
});
