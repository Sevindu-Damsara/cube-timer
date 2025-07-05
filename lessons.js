// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for lessons.js completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---
// These are duplicated from script.js to ensure lessons.js can function independently.
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

// Lesson state variables
let currentLesson = null;
let currentLessonStepIndex = 0;
let currentTheme = 'dark'; // Default theme, will be loaded from settings

// DOM elements for lessons page
let lessonModalTitle; // Renamed from modalTitle
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

// Utility function (duplicated from script.js for self-containment)
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

    const apiUrl = geminiInsightFunctionUrl;

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        console.error("[ERROR] Gemini Insight Cloud Function URL not configured for lesson generation.");
        if (lessonGenerationError) {
            lessonGenerationError.textContent = "AI Lesson service not configured. Please check the backend URL.";
            lessonGenerationError.style.display = 'block';
        }
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
        // No Jarvis speech on this page, only visual error
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
            return null;
        }

    } catch (e) {
        console.error("[ERROR] Error calling Cloud Function for lesson generation:", e);
        if (lessonGenerationError) {
            lessonGenerationError.textContent = `Failed to generate lesson: ${e.message}`;
            lessonGenerationError.style.display = 'block';
        }
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
        return null;
    }
}

/**
 * Displays the loaded lesson data on the page.
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

            // FIX: Map cubeType to twisty-player's expected puzzle format
            const puzzleMap = {
                '3x3': '3x3x3',
                '2x2': '2x2x2',
                '4x4': '4x4x4',
                'pyraminx': 'pyraminx'
            };
            const twistyPuzzleType = puzzleMap[currentLesson.cubeType] || '3x3x3'; // Default to 3x3x3 if unknown

            twistyPlayerElement.setAttribute('puzzle', twistyPuzzleType);
            twistyPlayerElement.setAttribute('control-panel', 'bottom'); // Show controls
            twistyPlayerElement.setAttribute('background', getThemeBackgroundColorHex(currentTheme)); // Match theme
            twistyPlayerElement.style.width = '100%';
            twistyPlayerElement.style.height = '100%';

            try {
                lessonVisualContainer.appendChild(twistyPlayerElement);
                lessonVisualContainer.style.display = 'flex'; // Show container
                console.log(`[DEBUG] Twisty-player loaded for lesson step: alg="${currentStep.visualAlgorithm}", puzzle="${twistyPuzzleType}"`);
            } catch (e) {
                console.error("[ERROR] Failed to append twisty-player:", e);
                lessonVisualContainer.style.display = 'none';
                lessonVisualContainer.textContent = "Error loading cube visualization.";
            }
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

/**
 * Initializes Firebase and loads user settings for the lessons page.
 */
async function initializeLessonsPage() {
    console.log("[DEBUG] lessons.js: Initializing Firebase and loading settings.");

    // Initialize Firebase if not already
    if (!app) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] lessons.js: Firebase initialized.");

            // Sign in anonymously if no existing user, or get current user
            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    isAuthReady = true;
                    console.log(`[DEBUG] lessons.js: User authenticated: ${userId}`);
                } else {
                    // This page doesn't need to sign in anonymously if it just needs settings
                    // but it needs a userId to fetch settings.
                    // For simplicity, if not authenticated, we'll use a guest ID and local storage.
                    userId = `guest-${crypto.randomUUID()}`;
                    isAuthReady = true;
                    console.log("[DEBUG] lessons.js: No authenticated user. Operating as guest.");
                }
                await loadUserSettingsForLessons(); // Load settings after auth state is known
                // Check if a lesson topic was passed from the main page
                const storedTopic = sessionStorage.getItem('lessonTopicForAI');
                if (storedTopic) {
                    sessionStorage.removeItem('lessonTopicForAI'); // Clear it after retrieval
                    lessonTopicInput.value = storedTopic;
                    // Automatically generate the lesson if a topic was provided
                    const userLevel = getUserLevel(0, currentLesson ? currentLesson.cubeType : '3x3'); // Use default if no lesson yet
                    requestLessonFromAI(storedTopic, currentLesson ? currentLesson.cubeType : '3x3', userLevel);
                }
            });
        } catch (e) {
            console.error("[ERROR] lessons.js: Firebase initialization failed:", e);
            // Fallback to local storage for settings if Firebase fails
            isAuthReady = true; // Mark auth ready even if it failed, to proceed with local storage
            userId = `guest-${crypto.randomUUID()}`;
            await loadUserSettingsForLessons();
        }
    } else {
        // Firebase already initialized (e.g., if script was re-run in dev tools)
        isAuthReady = true;
        await loadUserSettingsForLessons();
    }
}

/**
 * Loads user settings specifically for the lessons page (mainly theme and cubeType).
 */
async function loadUserSettingsForLessons() {
    console.log("[DEBUG] lessons.js: Entering loadUserSettingsForLessons.");
    // Ensure auth is ready before attempting Firestore read
    if (!isAuthReady) {
        console.log("[DEBUG] lessons.js: Auth not ready for settings. Waiting.");
        return;
    }

    let loadedSettings = null;

    // Try to load from Firestore if authenticated
    if (auth.currentUser && db && userId && !auth.currentUser.isAnonymous) {
        console.log("[DEBUG] lessons.js: Authenticated user. Attempting to load settings from Firestore.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        try {
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                loadedSettings = docSnap.data();
                console.log("[DEBUG] lessons.js: Settings loaded from Firestore:", loadedSettings);
            } else {
                console.log("[DEBUG] lessons.js: No user settings found in Firestore.");
            }
        } catch (e) {
            console.error("[ERROR] lessons.js: Error loading user settings from Firestore:", e);
        }
    }

    // Fallback to local storage if not authenticated or Firestore failed
    if (!loadedSettings) {
        console.log("[DEBUG] lessons.js: Loading settings from local storage as fallback.");
        try {
            const storedSettings = localStorage.getItem(`${appId}_guest_settings`);
            if (storedSettings) {
                loadedSettings = JSON.parse(storedSettings);
                console.log("[DEBUG] lessons.js: Settings loaded from local storage:", loadedSettings);
            } else {
                console.log("[DEBUG] lessons.js: No settings found in local storage, using defaults.");
            }
        } catch (e) {
            console.error("[ERROR] lessons.js: Error loading settings from local storage:", e);
        }
    }

    // Apply loaded settings or defaults
    if (loadedSettings) {
        currentTheme = loadedSettings.theme || 'dark';
        // cubeType = loadedSettings.cubeType || '3x3'; // Keep cubeType if needed for lesson generation context
    } else {
        currentTheme = 'dark';
        // cubeType = '3x3';
    }
    document.body.className = `theme-${currentTheme}`; // Apply theme to body
    console.log(`[DEBUG] lessons.js: Applied theme: ${currentTheme}`);
    console.log("[DEBUG] lessons.js: Exiting loadUserSettingsForLessons.");
}


// --- Event Listeners for lessons.html ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] lessons.js: DOMContentLoaded triggered. Assigning event listeners.");

    // Assign DOM elements
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

    const closeLessonsModalBtn = document.getElementById('closeLessonsModalBtn');
    // The "closeLessonsModalBtn" now acts as a "Back to Timer" button,
    // but the ID is kept for consistency with the original modal structure.
    // Its click listener should navigate back.
    if (closeLessonsModalBtn) {
        closeLessonsModalBtn.addEventListener('click', () => {
            window.location.href = 'index.html'; // Navigate back to the main timer page
        });
    }

    if (generateLessonBtn) generateLessonBtn.addEventListener('click', () => {
        const topic = lessonTopicInput.value.trim();
        if (topic) {
            // Retrieve current cube type from local storage (or default)
            let currentCubeType = '3x3'; // Default
            try {
                const storedSettings = localStorage.getItem(`${appId}_guest_settings`);
                if (storedSettings) {
                    const settings = JSON.parse(storedSettings);
                    currentCubeType = settings.cubeType || '3x3';
                }
            } catch (e) {
                console.error("[ERROR] lessons.js: Error retrieving cube type from local storage:", e);
            }

            const userLevel = getUserLevel(0, currentCubeType); // Pass current cube type for context
            requestLessonFromAI(topic, currentCubeType, userLevel);
        } else {
            if (lessonGenerationError) {
                lessonGenerationError.textContent = "Please enter a lesson topic.";
                lessonGenerationError.style.display = 'block';
            }
        }
    });

    if (prevLessonStepBtn) prevLessonStepBtn.addEventListener('click', prevLessonStep);
    if (nextLessonStepBtn) nextLessonStepBtn.addEventListener('click', nextLessonStep);

    // Initialize Firebase and load settings when the DOM is ready
    initializeLessonsPage();
});

