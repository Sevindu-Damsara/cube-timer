// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, deleteDoc, onSnapshot, collection, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for history.js completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---
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
let db; // Firestore instance
let auth; // Auth instance
let userId = null; // Will be Firebase UID or a local UUID for guests
let isAuthReady = false; // Flag to indicate if Firebase auth state has been determined
let isUserAuthenticated = false; // True if user is signed in via Email/Google, false for guests/signed out

let solves = []; // Array to store solve objects: [{ id: uuid, time: ms, penalty: null|'+2'|'DNF', timestamp: date, scramble: string }]
let currentTheme = 'dark'; // Default theme, will be loaded from settings
let currentCubeType = '3x3'; // Default cube type, will be loaded from settings

// DOM element variables
let solveHistoryList;
let bestTimeDisplay;
let ao5Display;
let ao12Display;
let solveCountDisplay;
let noSolvesMessage;
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
let sidebarToggleBtn;
let sidebarElement;
let mainLayoutElement;

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
    const userLevel = getUserLevel(solve.time, solve.cubeType || '3x3'); // Use solve's cubeType if available, else default

    // Prepare the data to send to the Cloud Function
    const requestData = {
        type: "get_insight", // Indicate the type of request
        scramble: solve.scramble,
        cubeType: solve.cubeType || '3x3', // Use solve's cubeType
        solveTimeMs: solve.time,
        penalty: solve.penalty,
        userLevel: userLevel
    };

    const apiUrl = geminiInsightFunctionUrl;

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        if (insightMessageElement) insightMessageElement.textContent = "AI Insight Cloud Function URL not configured. Please ensure your Vercel function is deployed and the URL is correct.";
        if (insightSpinner) insightSpinner.style.display = 'none';
        console.error("[ERROR] Gemini Insight Cloud Function URL is not set or is default placeholder.");
        // No Jarvis speech on this page, only visual error
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

        // Display Targeted Practice Focus
        if (result.targetedPracticeFocus && targetedPracticeFocusText && targetedPracticeFocusDisplay) {
            targetedPracticeFocusText.textContent = result.targetedPracticeFocus;
            targetedPracticeFocusDisplay.style.display = 'block';
        } else {
            if (targetedPracticeFocusDisplay) targetedPracticeFocusFocusDisplay.style.display = 'none';
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
        // Ensure timestamps are numbers for sorting
        solves.forEach(solve => {
            if (typeof solve.timestamp === 'string') {
                solve.timestamp = new Date(solve.timestamp).getTime();
            }
            // Ensure cubeType is present, default to 3x3 if not
            if (!solve.cubeType) {
                solve.cubeType = '3x3';
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
 * Loads user settings from local storage (only theme and cubeType needed here).
 */
function loadLocalUserSettings() {
    console.log("[DEBUG] Loading user settings from local storage for history page.");
    try {
        const storedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (storedSettings) {
            const settings = JSON.parse(storedSettings);
            currentTheme = settings.theme || 'dark';
            currentCubeType = settings.cubeType || '3x3';
            console.log("[DEBUG] User settings loaded from local storage:", { theme: currentTheme, cubeType: currentCubeType });
        } else {
            console.log("[DEBUG] No user settings found in local storage, using defaults.");
        }
    } catch (e) {
        console.error("[ERROR] Error loading settings from local storage:", e);
    }
    applySettingsToUI(); // Apply theme
}

// --- Core History/Stats Logic ---

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
    if (!solveHistoryList || !bestTimeDisplay || !ao5Display || !ao12Display || !solveCountDisplay || !noSolvesMessage) {
        console.warn("[WARN] renderSolveHistory called before all DOM elements are initialized. Skipping render.");
        return; // Exit if DOM elements are not ready
    }

    solveHistoryList.innerHTML = '';
    if (solves.length === 0) {
        noSolvesMessage.style.display = 'block';
        bestTimeDisplay.textContent = '--:--.--';
        ao5Display.textContent = '--:--.--';
        ao12Display.textContent = '--:--.--';
        solveCountDisplay.textContent = '0';
        console.log("[DEBUG] renderSolveHistory: No solves, displaying empty stats.");
        return;
    } else {
        noSolvesMessage.style.display = 'none';
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
    });

    updateStatistics();
    console.log("[DEBUG] Exiting renderSolveHistory. Statistics updated.");
}

/**
 * Updates the best time, Ao5, Ao12, and solve count displays.
 */
function updateStatistics() {
    console.log("[DEBUG] Entering updateStatistics.");
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
    console.log(`[DEBUG] Statistics: Solve Count: ${solves.length}`);
    console.log("[DEBUG] Exiting updateStatistics.");
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
        // Find the Firestore document ID associated with the local ID
        const solveToUpdate = solves.find(s => s.id === id);
        if (!solveToUpdate || !solveToUpdate.firestoreId) {
             console.error("[ERROR] applyPenalty: Solve not found or missing Firestore ID.");
             return;
        }
        const solveRef = doc(db, `artifacts/${appId}/users/${userId}/solves`, solveToUpdate.firestoreId);
        try {
            console.log(`[DEBUG] applyPenalty: Attempting to update doc in Firestore: ${solveRef.path}`);
            await updateDoc(solveRef, { penalty: penaltyType });
            console.log(`[DEBUG] Penalty ${penaltyType} applied to solve ${id} in Firestore.`);
            // The onSnapshot listener will update the 'solves' array and re-render
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
         // Find the Firestore document ID associated with the local ID
         const solveToDelete = solves.find(s => s.id === id);
         if (!solveToDelete || !solveToDelete.firestoreId) {
              console.error("[ERROR] deleteSolve: Solve not found or missing Firestore ID.");
              return;
         }
        const solveRef = doc(db, `artifacts/${appId}/users/${userId}/solves`, solveToDelete.firestoreId);
        try {
            console.log(`[DEBUG] deleteSolve: Attempting to delete doc from Firestore: ${solveRef.path}`);
            await deleteDoc(solveRef);
            console.log(`[DEBUG] Solve ${id} deleted from Firestore.`);
            // The onSnapshot listener will update the 'solves' array and re-render
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
    if (!solveHistoryList) {
        console.warn("[WARN] setupRealtimeSolvesListener called before solveHistoryList is initialized. Skipping setup.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Only set up for authenticated users
        console.log("[DEBUG] setupRealtimeSolvesListener: Authenticated and Firestore ready. Setting up onSnapshot.");
        const solvesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/solves`);
        // Order by timestamp descending
        const q = query(solvesCollectionRef, orderBy('timestamp', 'desc'));

        // Clear previous local data if any from guest mode
        solves = [];
        renderSolveHistory(); // Render empty list while Firestore data loads

        onSnapshot(q, (snapshot) => {
            console.log("[DEBUG] onSnapshot callback triggered. Processing snapshot changes.");
            solves = []; // Clear current solves to repopulate from snapshot
            snapshot.forEach((doc) => {
                 // Store Firestore doc ID along with data
                solves.push({ id: crypto.randomUUID(), firestoreId: doc.id, ...doc.data() });
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
        // For guests, local solves are handled by loadLocalSolves in initializeHistoryPage
    }
    console.log("[DEBUG] Exiting setupRealtimeSolvesListener.");
}

/**
 * Applies loaded/default settings (theme) to the UI elements.
 */
function applySettingsToUI() {
    console.log("[DEBUG] Entering applySettingsToUI for history page.");
    document.body.className = `theme-${currentTheme} main-layout-history`; // Apply theme class and page layout class
    console.log(`[DEBUG] Applied theme: ${currentTheme}`);
    console.log("[DEBUG] Exiting applySettingsToUI.");
}

// --- Sidebar Toggle Logic ---

function toggleSidebar() {
    console.log("[DEBUG] Toggling sidebar.");
    if (sidebarElement && mainLayoutElement) {
        const isCollapsed = sidebarElement.classList.toggle('collapsed');
        mainLayoutElement.classList.toggle('sidebar-collapsed', isCollapsed);
        // Update button icon
        const icon = sidebarToggleBtn.querySelector('i');
        if (icon) {
            icon.classList.remove(isCollapsed ? 'fa-chevron-left' : 'fa-chevron-right');
            icon.classList.add(isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left');
        }
        // Save state to local storage
        localStorage.setItem('sidebarCollapsed', isCollapsed);
        console.log(`[DEBUG] Sidebar is now ${isCollapsed ? 'collapsed' : 'expanded'}. State saved.`);
    }
}

function loadSidebarState() {
    console.log("[DEBUG] Loading sidebar state.");
    if (sidebarElement && mainLayoutElement) {
        const savedState = localStorage.getItem('sidebarCollapsed');
        const isCollapsed = savedState === 'true'; // Default to false if not saved
        if (isCollapsed) {
            sidebarElement.classList.add('collapsed');
            mainLayoutElement.classList.add('sidebar-collapsed');
             // Update button icon
            const icon = sidebarToggleBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-left');
                icon.classList.add('fa-chevron-right');
            }
            console.log("[DEBUG] Sidebar loaded as collapsed.");
        } else {
             // Ensure it's not collapsed if state is false or not set
            sidebarElement.classList.remove('collapsed');
            mainLayoutElement.classList.remove('sidebar-collapsed');
             // Update button icon
            const icon = sidebarToggleBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-left');
            }
             console.log("[DEBUG] Sidebar loaded as expanded.");
        }
    }
}

// --- Initialization ---

/**
 * Initializes Firebase and loads user data/settings for the history page.
 */
async function initializeHistoryPage() {
    console.log("[DEBUG] history.js: Initializing Firebase and loading data.");

    // Initialize Firebase if not already
    if (!app) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] history.js: Firebase initialized.");

            // Sign in anonymously if no existing user, or get current user
            onAuthStateChanged(auth, async (user) => {
                console.log("[DEBUG] history.js: onAuthStateChanged triggered. User:", user ? user.uid : "null");
                if (user && !user.isAnonymous) { // User is explicitly signed in (Email/Google)
                    userId = user.uid;
                    isUserAuthenticated = true; // Set flag
                    isAuthReady = true;
                    console.log(`[DEBUG] history.js: User authenticated: ${userId}`);
                    await loadUserSettings(); // Load settings (theme, cubeType)
                    setupRealtimeSolvesListener(); // Setup Firestore listener
                } else { // User is signed out or anonymous
                    console.log("[DEBUG] history.js: Not authenticated. Operating as guest.");
                    userId = `guest-${crypto.randomUUID()}`; // Use a new local UUID for guest session
                    isUserAuthenticated = false; // Set flag
                    isAuthReady = true;
                    loadLocalUserSettings(); // Load settings from local storage
                    loadLocalSolves(); // Load solves from local storage
                    renderSolveHistory(); // Render local solves
                }
            });
        } catch (e) {
            console.error("[ERROR] history.js: Firebase initialization failed:", e);
            // Fallback to local storage for settings and solves if Firebase fails
            isAuthReady = true; // Mark auth ready even if it failed, to proceed with local storage
            userId = `guest-${crypto.randomUUID()}`; // Fallback guest ID
            isUserAuthenticated = false;
            loadLocalUserSettings();
            loadLocalSolves();
            renderSolveHistory();
        }
    } else {
        // Firebase already initialized (e.g., if script was re-run in dev tools)
        isAuthReady = true;
        // The onAuthStateChanged listener should still fire if auth state changes
        // but if it's already in a known state, we might need to manually trigger
        // the data load based on the current auth state.
        const user = auth.currentUser;
         if (user && !user.isAnonymous) {
            userId = user.uid;
            isUserAuthenticated = true;
            await loadUserSettings();
            setupRealtimeSolvesListener();
        } else {
            userId = `guest-${crypto.randomUUID()}`; // Ensure guest ID is set
            isUserAuthenticated = false;
            loadLocalUserSettings();
            loadLocalSolves();
            renderSolveHistory();
        }
    }
}

/**
 * Loads user settings (theme, cubeType) from Firestore for authenticated users.
 */
async function loadUserSettings() {
    console.log("[DEBUG] Entering loadUserSettings for history page.");
    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] loadUserSettings: Authenticated and Firestore ready. Attempting to load settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        try {
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                const settings = docSnap.data();
                currentTheme = settings.theme || 'dark';
                currentCubeType = settings.cubeType || '3x3';
                console.log("[DEBUG] User settings loaded from Firestore:", { theme: currentTheme, cubeType: currentCubeType });
            } else {
                console.log("[DEBUG] No user settings found in Firestore, using defaults.");
            }
        } catch (e) {
            console.error("[ERROR] Error loading user settings from Firestore: ", e);
             if (e.code === 'permission-denied') {
                console.warn("[WARN] Firestore permission denied for settings. Falling back to local storage for settings.");
                // Fallback to local if permissions fail
                loadLocalUserSettings();
            }
        }
    } else { // Guest user (handled by loadLocalUserSettings)
         console.log("[DEBUG] loadUserSettings: Not authenticated, using local storage settings.");
         loadLocalUserSettings();
    }
    applySettingsToUI(); // Apply theme
    console.log("[DEBUG] Exiting loadUserSettings.");
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] history.js: DOMContentLoaded triggered. Assigning DOM elements and event listeners.");

    // Assign DOM elements
    solveHistoryList = document.getElementById('solveHistoryList');
    bestTimeDisplay = document.getElementById('bestTime');
    ao5Display = document.getElementById('ao5');
    ao12Display = document.getElementById('ao12');
    solveCountDisplay = document.getElementById('solveCount');
    noSolvesMessage = document.getElementById('noSolvesMessage');
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
    sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    sidebarElement = document.getElementById('sidebar');
    mainLayoutElement = document.querySelector('.main-layout');

    // Add event listeners
    if (closeAiInsightModalBtn) closeAiInsightModalBtn.addEventListener('click', () => {
        if (aiInsightModal) aiInsightModal.classList.remove('open');
        console.log("[DEBUG] AI Insight modal closed by button.");
    }); else console.error("[ERROR] closeAiInsightModalBtn not found!");

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
            if (aiInsightModal && aiInsightModal.classList.contains('open')) {
                aiInsightModal.classList.remove('open');
                console.log("[DEBUG] AI Insight modal closed by Escape key.");
            }
        }
    });

    // Sidebar toggle listener
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar); else console.error("[ERROR] sidebarToggleBtn not found!");

    // Initialize Firebase and load data/settings
    initializeHistoryPage();

    // Load sidebar state on page load
    loadSidebarState();

    console.log("[DEBUG] history.js: DOMContentLoaded complete.");
});
