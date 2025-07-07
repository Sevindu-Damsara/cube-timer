// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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
const geminiInsightFunctionUrl = "https://cube-timer-ten.vercel.app/api/gemini-insight"; // Assuming this handles lesson generation too
// =====================================================================================================

let app;
let db;
let auth;
let userId = null;
let isAuthReady = false; // Flag to indicate if Firebase auth state has been determined
let isUserAuthenticated = false; // True if user is signed in via Email/Google, false for guests/signed out

let currentLesson = null; // Stores the entire structured lesson object
let currentLessonStepIndex = 0; // Current step being displayed
let currentLessonId = null; // NEW: ID of the current lesson (from AI response or generated)
let completedSteps = {}; // NEW: Tracks completed steps for the current lesson {stepIndex: true}

let currentCubeType = '3x3'; // Default, will be loaded from settings
let currentTheme = 'dark'; // Default, will be loaded from settings

// DOM elements
let lessonTopicInput;
let generateLessonBtn;
let lessonGenerationError;
let lessonLoadingSpinner;
let lessonInputSection; // NEW: Added for showing/hiding
let lessonDisplayArea;
let lessonTitleDisplay;
let lessonStepTitleDisplay;
let lessonStepDescriptionDisplay;
let lessonVisualContainer;
let twistyPlayerLessonViewer; // Reference to the twisty-player instance
let lessonExplanationDisplay;
let prevLessonStepBtn;
let nextLessonStepBtn;
let lessonStepCounter;
let backToTimerBtn; // Reference to the back button
let lessonProgressBar; // NEW: Progress bar element
let markStepCompleteBtn; // NEW: Mark as Complete button
let completeLessonBtn; // NEW: Complete Lesson button
let lessonCompletionMessage; // NEW: Lesson completion message

// Twisty-player controls
let lessonPlayBtn;
let lessonPauseBtn;
let lessonResetViewBtn;
let lessonScrambleCubeBtn;
let lessonSolveCubeBtn;

// Global variable for initial auth token (provided by Canvas environment)
const __initial_auth_token = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;

// --- Local Storage Functions for Guest Mode ---
const LOCAL_STORAGE_PREFIX = `${appId}_guest_`;

/**
 * Loads user settings from local storage.
 */
function loadLocalUserSettings() {
    console.log("[DEBUG] lessons.js: Loading user settings from local storage.");
    try {
        const storedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (storedSettings) {
            const settings = JSON.parse(storedSettings);
            currentCubeType = settings.cubeType || '3x3';
            currentTheme = settings.theme || 'dark';
            console.log("[DEBUG] lessons.js: User settings loaded from local storage:", settings);
        } else {
            console.log("[DEBUG] lessons.js: No user settings found in local storage, using defaults.");
        }
    } catch (e) {
        console.error("[ERROR] lessons.js: Error loading settings from local storage:", e);
    }
    document.body.className = `theme-${currentTheme}`; // Apply theme
}

/**
 * Retrieves the hexadecimal color code for the primary background based on the current theme.
 * This function is duplicated from script.js to ensure lessons.js can function independently.
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
 * Determines the user's cubing level based on their best 3x3 solve time.
 * This function needs to fetch the user's best time, either from Firestore or local storage.
 * For simplicity, we'll assume a default level if no best time is found or if it's not 3x3.
 * @param {number} defaultTimeMs - A fallback time if no actual best time is found.
 * @param {string} cubeType - The type of cube for context.
 * @returns {string} The estimated level (e.g., "Beginner", "Intermediate", "Advanced", "Expert").
 */
async function getUserLevel(defaultTimeMs, cubeType) {
    console.log(`[DEBUG] lessons.js: Determining user level for ${cubeType}.`);
    let bestTimeMs = defaultTimeMs; // Start with a default

    if (isUserAuthenticated && db && userId) {
        // Fetch best time from Firestore
        const userStatsRef = doc(db, `artifacts/${appId}/users/${userId}/stats/summary`);
        try {
            const docSnap = await getDoc(userStatsRef);
            if (docSnap.exists() && docSnap.data().bestTime !== undefined && docSnap.data().bestTime !== null) {
                bestTimeMs = docSnap.data().bestTime;
                console.log(`[DEBUG] lessons.js: User best time from Firestore: ${bestTimeMs}ms`);
            } else {
                console.log("[DEBUG] lessons.js: No best time found in Firestore. Using default.");
            }
        } catch (e) {
            console.error("[ERROR] lessons.js: Error fetching best time from Firestore:", e);
        }
    } else {
        // Fetch best time from local storage (for guests)
        try {
            const storedSolves = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}solves`);
            if (storedSolves) {
                const solves = JSON.parse(storedSolves);
                const validSolves = solves.filter(s => s.penalty !== 'DNF');
                let actualTimes = validSolves.map(s => s.time + (s.penalty === '+2' ? 2000 : 0));
                if (actualTimes.length > 0) {
                    bestTimeMs = Math.min(...actualTimes);
                    console.log(`[DEBUG] lessons.js: User best time from local storage: ${bestTimeMs}ms`);
                }
            }
        } catch (e) {
            console.error("[ERROR] lessons.js: Error fetching best time from local storage:", e);
        }
    }

    // Apply level logic based on bestTimeMs and cubeType
    if (cubeType === '3x3') {
        if (bestTimeMs === defaultTimeMs) return "Beginner"; // If no solves, assume beginner
        if (bestTimeMs > 120000) return "Beginner"; // Over 2 minutes (120,000 ms)
        if (bestTimeMs > 60000) return "Novice";   // 1-2 minutes (60,000 ms)
        if (bestTimeMs > 30000) return "Intermediate"; // 30-60 seconds (30,000 ms)
        if (bestTimeMs > 15000) return "Advanced";   // 15-30 seconds (15,000 ms)
        return "Expert"; // Under 15 seconds
    }
    // For other cube types, a general level might be more appropriate or require specific thresholds
    return "General Cubist"; // Default for other cube types or if not specified
}

/**
 * Jarvis speaks. Simplified version for lessons.js to be self-contained.
 * @param {string} text - The text for Jarvis to speak.
 */
function speakAsJarvis(text) {
    console.log(`[DEBUG] lessons.js: Jarvis would speak: "${text}"`);
    // This is a placeholder. In a full application, this would integrate with a global speech synthesis utility.
    // For now, it just logs to console.
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    utterance.voice = voices.find(voice => voice.name === 'Google UK English Male' && voice.lang === 'en-GB') ||
                      voices.find(voice => voice.name.includes('Google US English') && voice.lang === 'en-US' && voice.gender === 'male') ||
                      voices.find(voice => voice.lang === 'en-US') ||
                      voices[0];
    utterance.pitch = 1;
    utterance.rate = 1;
    synth.speak(utterance);
}

/**
 * Loads the progress for a specific lesson from Firestore or local storage.
 * @param {string} lessonId - The unique ID of the lesson.
 * @returns {Promise<Object>} A promise that resolves with the completed steps object.
 */
async function loadLessonProgress(lessonId) {
    if (!lessonId) return {};
    console.log(`[DEBUG] lessons.js: Loading progress for lesson ID: ${lessonId}`);
    if (isUserAuthenticated && db && userId) {
        try {
            const lessonProgressRef = doc(db, `artifacts/${appId}/users/${userId}/lessonProgress/${lessonId}`);
            const docSnap = await getDoc(lessonProgressRef);
            if (docSnap.exists()) {
                console.log("[DEBUG] lessons.js: Lesson progress loaded from Firestore:", docSnap.data().completedSteps);
                return docSnap.data().completedSteps || {};
            }
        } catch (e) {
            console.error("[ERROR] lessons.js: Error loading lesson progress from Firestore:", e);
        }
    } else {
        try {
            const storedProgress = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}lessonProgress_${lessonId}`);
            if (storedProgress) {
                console.log("[DEBUG] lessons.js: Lesson progress loaded from local storage.");
                return JSON.parse(storedProgress);
            }
        } catch (e) {
            console.error("[ERROR] lessons.js: Error loading lesson progress from local storage:", e);
        }
    }
    return {}; // Return empty object if no progress found
}

/**
 * Saves the progress for a specific lesson to Firestore or local storage.
 * @param {string} lessonId - The unique ID of the lesson.
 * @param {Object} progress - The object containing completed steps.
 */
async function saveLessonProgress(lessonId, progress) {
    if (!lessonId) return;
    console.log(`[DEBUG] lessons.js: Saving progress for lesson ID: ${lessonId}`, progress);
    if (isUserAuthenticated && db && userId) {
        try {
            const lessonProgressRef = doc(db, `artifacts/${appId}/users/${userId}/lessonProgress/${lessonId}`);
            await setDoc(lessonProgressRef, { completedSteps: progress, lastUpdated: Date.now() }, { merge: true });
            console.log("[DEBUG] lessons.js: Lesson progress saved to Firestore.");
        } catch (e) {
            console.error("[ERROR] lessons.js: Error saving lesson progress to Firestore:", e);
        }
    } else {
        try {
            localStorage.setItem(`${LOCAL_STORAGE_PREFIX}lessonProgress_${lessonId}`, JSON.stringify(progress));
            console.log("[DEBUG] lessons.js: Lesson progress saved to local storage.");
        } catch (e) {
            console.error("[ERROR] lessons.js: Error saving lesson progress to local storage:", e);
        }
    }
}

/**
 * Requests a structured lesson from the AI based on topic, cube type, and user level.
 * @param {string} topic - The user's requested lesson topic.
 * @param {string} cubeType - The current cube type (e.g., '3x3').
 * @param {string} userLevel - The estimated user skill level.
 */
async function requestLessonFromAI(topic, cubeType, userLevel) {
    console.log(`[DEBUG] Requesting lesson from AI: Topic='${topic}', CubeType='${cubeType}', UserLevel='${userLevel}'`);

    // Reset display and show loading spinner
    if (lessonDisplayArea) lessonDisplayArea.style.display = 'none';
    if (lessonInputSection) lessonInputSection.style.display = 'none'; // NEW: Hide input section immediately
    if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'block';
    if (lessonGenerationError) lessonGenerationError.style.display = 'none';
    if (lessonCompletionMessage) lessonCompletionMessage.style.display = 'none'; // Hide completion message

    const requestData = {
        type: "generate_lesson", // Indicate the type of request for the AI
        topic: topic,
        cubeType: cubeType,
        userLevel: userLevel
    };

    const apiUrl = geminiInsightFunctionUrl; // Assuming this endpoint handles lesson generation

    if (!apiUrl || apiUrl === "YOUR_GEMINI_INSIGHT_VERCEL_FUNCTION_URL") {
        if (lessonGenerationError) {
            lessonGenerationError.textContent = "AI Lesson Cloud Function URL not configured. Please ensure your Vercel function is deployed and the URL is correct.";
            lessonGenerationError.style.display = 'block';
        }
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
        if (lessonInputSection) lessonInputSection.style.display = 'block'; // Show input on error
        console.error("[ERROR] Gemini Insight Cloud Function URL is not set or is default placeholder.");
        return;
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
        console.log("[DEBUG] AI Lesson Cloud Function raw response:", result);

        if (result.lessonTitle && result.steps && Array.isArray(result.steps) && result.steps.length > 0) {
            currentLesson = result;
            currentLessonId = result.lessonId || crypto.randomUUID(); // Use AI-provided ID or generate one
            currentLessonStepIndex = 0; // Start at the first step
            completedSteps = await loadLessonProgress(currentLessonId); // Load user's progress for this lesson

            if (lessonTitleDisplay) lessonTitleDisplay.textContent = currentLesson.lessonTitle;
            displayLessonStep(currentLessonStepIndex);
            if (lessonDisplayArea) lessonDisplayArea.style.display = 'block';
            if (lessonInputSection) lessonInputSection.style.display = 'none'; // NEW: Hide input section on success
            speakAsJarvis(`Sir Sevindu, your lesson on "${currentLesson.lessonTitle}" is ready.`);
        } else {
            if (lessonGenerationError) {
                lessonGenerationError.textContent = "Failed to generate a structured lesson. Please try a different topic or check the AI response format.";
                lessonGenerationError.style.display = 'block';
            }
            currentLesson = null; // Clear any incomplete lesson
            currentLessonId = null;
            completedSteps = {};
            if (lessonInputSection) lessonInputSection.style.display = 'block'; // Show input on AI response error
            if (lessonDisplayArea) lessonDisplayArea.style.display = 'none'; // Hide lesson display on AI response error
        }

    } catch (e) {
        if (lessonGenerationError) {
            lessonGenerationError.textContent = `Failed to generate lesson: ${e.message}. Please try again.`;
            lessonGenerationError.style.display = 'block';
        }
        console.error("[ERROR] Error calling Cloud Function for lesson generation:", e);
        if (lessonInputSection) lessonInputSection.style.display = 'block'; // Show input on fetch error
        if (lessonDisplayArea) lessonDisplayArea.style.display = 'none'; // Hide lesson display on fetch error
    } finally {
        if (lessonLoadingSpinner) lessonLoadingSpinner.style.display = 'none';
    }
}

/**
 * Displays a specific step of the current lesson.
 * @param {number} index - The index of the lesson step to display.
 */
function displayLessonStep(index) {
    if (!currentLesson || !currentLesson.steps || index < 0 || index >= currentLesson.steps.length) {
        console.error("[ERROR] Attempted to display invalid lesson step index or no lesson loaded.");
        return;
    }

    const step = currentLesson.steps[index];
    console.log(`[DEBUG] Displaying lesson step ${index}:`, step);

    if (lessonStepTitleDisplay) lessonStepTitleDisplay.textContent = step.title || `Step ${index + 1}`;
    if (lessonStepDescriptionDisplay) lessonStepDescriptionDisplay.textContent = step.description || '';
    if (lessonExplanationDisplay) lessonExplanationDisplay.textContent = step.explanation || '';

    // Handle twisty-player for visual scramble/algorithm
    if (step.scramble || step.algorithm) {
        if (lessonVisualContainer) lessonVisualContainer.style.display = 'flex'; // Show container
        if (twistyPlayerLessonViewer) {
            twistyPlayerLessonViewer.puzzle = getTwistyPlayerPuzzleType(currentCubeType);
            // Prioritize scramble if both are present for initial view
            twistyPlayerLessonViewer.alg = step.scramble || step.algorithm || '';
            // Set the 3D viewer background directly using the hex color for the chosen theme
            twistyPlayerLessonViewer.setAttribute('background', getThemeBackgroundColorHex(currentTheme));
            twistyPlayerLessonViewer.jumpToStart(); // Reset view for new step
            console.log(`[DEBUG] Twisty-player updated: Puzzle=${twistyPlayerLessonViewer.puzzle}, Alg=${twistyPlayerLessonViewer.alg}`);
        }
        // Show twisty-player controls
        if (lessonPlayBtn) lessonPlayBtn.style.display = 'inline-block';
        if (lessonPauseBtn) lessonPauseBtn.style.display = 'inline-block';
        if (lessonResetViewBtn) lessonResetViewBtn.style.display = 'inline-block';
        if (lessonScrambleCubeBtn) lessonScrambleCubeBtn.style.display = 'inline-block';
        if (lessonSolveCubeBtn) lessonSolveCubeBtn.style.display = 'inline-block';
    } else {
        if (lessonVisualContainer) lessonVisualContainer.style.display = 'none'; // Hide container if no visual
        if (twistyPlayerLessonViewer) twistyPlayerLessonViewer.alg = ''; // Clear previous alg
        // Hide twisty-player controls
        if (lessonPlayBtn) lessonPlayBtn.style.display = 'none';
        if (lessonPauseBtn) lessonPauseBtn.style.display = 'none';
        if (lessonResetViewBtn) lessonResetViewBtn.style.display = 'none';
        if (lessonScrambleCubeBtn) lessonScrambleCubeBtn.style.display = 'none';
        if (lessonSolveCubeBtn) lessonSolveCubeBtn.style.display = 'none';
    }

    // Update step counter
    if (lessonStepCounter) lessonStepCounter.textContent = `Step ${index + 1} of ${currentLesson.steps.length}`;

    // Update navigation button states
    if (prevLessonStepBtn) prevLessonStepBtn.disabled = (index === 0);
    if (nextLessonStepBtn) nextLessonStepBtn.disabled = (index === currentLesson.steps.length - 1);

    // Update "Mark Step Complete" button state
    if (markStepCompleteBtn) {
        if (completedSteps[index]) {
            markStepCompleteBtn.textContent = "Step Completed!";
            markStepCompleteBtn.disabled = true;
            markStepCompleteBtn.classList.add('button-completed'); // Add a class for styling
            markStepCompleteBtn.style.display = 'block'; // Always show if it's a practice step
        } else {
            markStepCompleteBtn.textContent = "Mark Step Complete";
            markStepCompleteBtn.disabled = false;
            markStepCompleteBtn.classList.remove('button-completed');
            // Show only if there's a visual or explicit practice involved
            if (step.scramble || step.algorithm || step.requiresCompletion) { // 'requiresCompletion' is a hypothetical AI flag
                markStepCompleteBtn.style.display = 'block';
            } else {
                markStepCompleteBtn.style.display = 'none';
            }
        }
    }

    // Show/hide "Complete Lesson" button
    if (completeLessonBtn) {
        // Only show if it's the last step AND all steps are completed
        const allStepsCompleted = Object.keys(completedSteps).length === currentLesson.steps.length;
        if (index === currentLesson.steps.length - 1 && allStepsCompleted) {
            completeLessonBtn.style.display = 'block';
        } else {
            completeLessonBtn.style.display = 'none';
        }
    }

    updateLessonProgressBar(); // Update progress bar
    speakAsJarvis(`Step ${index + 1}: ${step.title}.`); // Jarvis reads out the step
}

/**
 * Updates the lesson progress bar based on completed steps.
 */
function updateLessonProgressBar() {
    if (currentLesson && lessonProgressBar) {
        const totalSteps = currentLesson.steps.length;
        const completedCount = Object.keys(completedSteps).length;
        const progressPercentage = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
        lessonProgressBar.style.width = `${progressPercentage}%`;
        console.log(`[DEBUG] Lesson progress: ${completedCount}/${totalSteps} steps completed (${progressPercentage.toFixed(2)}%)`);
    }
}

/**
 * Marks the current lesson step as complete and saves progress.
 */
async function markStepComplete() {
    if (currentLesson && currentLessonStepIndex !== null && !completedSteps[currentLessonStepIndex]) {
        completedSteps[currentLessonStepIndex] = true;
        await saveLessonProgress(currentLessonId, completedSteps);
        displayLessonStep(currentLessonStepIndex); // Re-render to update button and progress
        speakAsJarvis(`Step ${currentLessonStepIndex + 1} marked as complete, Sir Sevindu.`);
    }
}

/**
 * Marks the entire lesson as complete.
 */
async function completeLesson() {
    if (currentLesson && currentLessonId) {
        // Ensure all steps are marked complete
        for (let i = 0; i < currentLesson.steps.length; i++) {
            completedSteps[i] = true;
        }
        await saveLessonProgress(currentLessonId, completedSteps); // Save final state
        updateLessonProgressBar(); // Ensure progress bar updates to 100%
        if (lessonCompletionMessage) {
            lessonCompletionMessage.textContent = `Congratulations, Sir Sevindu! You have successfully completed the lesson: "${currentLesson.lessonTitle}"!`;
            lessonCompletionMessage.style.display = 'block';
        }
        speakAsJarvis(`Congratulations, Sir Sevindu! You have successfully completed the lesson: "${currentLesson.lessonTitle}"!`);
        // Optionally, disable further navigation or offer a new lesson
        if (prevLessonStepBtn) prevLessonStepBtn.disabled = true;
        if (nextLessonStepBtn) nextLessonStepBtn.disabled = true;
        if (markStepCompleteBtn) markStepCompleteBtn.style.display = 'none';
        if (completeLessonBtn) completeLessonBtn.style.display = 'none';
    }
}

/**
 * Maps internal cube type names to twisty-player puzzle types.
 * @param {string} cubeType - The internal cube type (e.g., '3x3').
 * @returns {string} The corresponding twisty-player puzzle type.
 */
function getTwistyPlayerPuzzleType(cubeType) {
    switch (cubeType) {
        case '2x2': return '2x2x2';
        case '3x3': return '3x3x3';
        case '4x4': return '4x4x4';
        case 'pyraminx': return 'pyraminx';
        default: return '3x3x3'; // Default to 3x3x3
    }
}

/**
 * Navigates to the previous lesson step.
 */
function prevLessonStep() {
    console.log(`[DEBUG] prevLessonStep called. currentLessonStepIndex: ${currentLessonStepIndex}`);
    if (currentLesson && currentLessonStepIndex > 0) {
        currentLessonStepIndex--;
        console.log(`[DEBUG] New currentLessonStepIndex: ${currentLessonStepIndex}`);
        displayLessonStep(currentLessonStepIndex);
    }
}

/**
 * Navigates to the next lesson step.
 */
function nextLessonStep() {
    console.log(`[DEBUG] nextLessonStep called. currentLessonStepIndex: ${currentLessonStepIndex}`);
    if (currentLesson && currentLessonStepIndex < currentLesson.steps.length - 1) {
        currentLessonStepIndex++;
        console.log(`[DEBUG] New currentLessonStepIndex: ${currentLessonStepIndex}`);
        displayLessonStep(currentLessonStepIndex);
    }
}

/**
 * Initializes Firebase and loads user data for the lessons page.
 */
async function initializeLessonsPage() {
    console.log("[DEBUG] lessons.js: Initializing Firebase and loading data.");

    if (!app) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] lessons.js: Firebase initialized.");

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    isUserAuthenticated = !user.isAnonymous; // True if signed in via email/google
                    isAuthReady = true;
                    console.log(`[DEBUG] lessons.js: User authenticated: ${userId}. Authenticated status: ${isUserAuthenticated}`);
                } else {
                    // Sign in anonymously if no user, to get a UID for consistent pathing
                    try {
                        if (__initial_auth_token) {
                            const userCredential = await signInWithCustomToken(auth, __initial_auth_token);
                            userId = userCredential.user.uid;
                            isUserAuthenticated = false; // Still considered guest for persistence purposes
                            console.log(`[DEBUG] lessons.js: Signed in with custom token. User ID: ${userId}`);
                        } else {
                            const userCredential = await signInAnonymously(auth);
                            userId = userCredential.user.uid;
                            isUserAuthenticated = false; // Anonymous user is a guest
                            console.log(`[DEBUG] lessons.js: Signed in anonymously. User ID: ${userId}`);
                        }
                    } catch (e) {
                        console.error("[ERROR] lessons.js: Anonymous sign-in failed:", e);
                        userId = `guest-${crypto.randomUUID()}`; // Fallback to local UUID
                        isUserAuthenticated = false;
                    }
                    isAuthReady = true;
                }
                await loadLocalUserSettings(); // Load settings (theme, cube type)
                // Check if a lesson topic was passed from the main page (e.g., via voice command)
                const lessonTopicFromSession = sessionStorage.getItem('lessonTopicForAI');
                if (lessonTopicFromSession) {
                    lessonTopicInput.value = lessonTopicFromSession;
                    sessionStorage.removeItem('lessonTopicForAI'); // Clear it after use
                    const userLevel = await getUserLevel(0, currentCubeType); // Pass current cube type for context
                    requestLessonFromAI(lessonTopicFromSession, currentCubeType, userLevel);
                }
            });
        } catch (e) {
            console.error("[ERROR] lessons.js: Firebase initialization failed:", e);
            isAuthReady = true; // Mark auth ready even if it failed, to proceed with local storage
            userId = `guest-${crypto.randomUUID()}`;
            isUserAuthenticated = false;
            await loadLocalUserSettings();
            // Check for session topic even in offline mode
            const lessonTopicFromSession = sessionStorage.getItem('lessonTopicForAI');
            if (lessonTopicFromSession) {
                lessonTopicInput.value = lessonTopicFromSession;
                sessionStorage.removeItem('lessonTopicForAI');
                const userLevel = await getUserLevel(0, currentCubeType);
                requestLessonFromAI(lessonTopicFromSession, currentCubeType, userLevel);
            }
        }
    } else {
        isAuthReady = true;
        await loadLocalUserSettings();
        const lessonTopicFromSession = sessionStorage.getItem('lessonTopicForAI');
        if (lessonTopicFromSession) {
            lessonTopicInput.value = lessonTopicFromSession;
            sessionStorage.removeItem('lessonTopicForAI');
            const userLevel = await getUserLevel(0, currentCubeType);
            requestLessonFromAI(lessonTopicFromSession, currentCubeType, userLevel);
        }
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] lessons.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");

    // Assign DOM elements
    lessonTopicInput = document.getElementById('lessonTopicInput');
    generateLessonBtn = document.getElementById('generateLessonBtn');
    lessonGenerationError = document.getElementById('lessonGenerationError');
    lessonLoadingSpinner = document.getElementById('lessonLoadingSpinner');
    lessonInputSection = document.getElementById('lessonInputSection'); // Assign the input section
    lessonDisplayArea = document.getElementById('lessonDisplayArea');
    lessonTitleDisplay = document.getElementById('lessonTitleDisplay');
    lessonStepTitleDisplay = document.getElementById('lessonStepTitleDisplay');
    lessonStepDescriptionDisplay = document.getElementById('lessonStepDescriptionDisplay');
    lessonVisualContainer = document.getElementById('lessonVisualContainer');
    twistyPlayerLessonViewer = document.getElementById('twistyPlayerLessonViewer'); // Assign twisty-player
    lessonExplanationDisplay = document.getElementById('lessonExplanationDisplay');
    prevLessonStepBtn = document.getElementById('prevLessonStepBtn');
    nextLessonStepBtn = document.getElementById('nextLessonStepBtn');
    lessonStepCounter = document.getElementById('lessonStepCounter');
    backToTimerBtn = document.querySelector('a[href="index.html"]'); // Get the back button
    lessonProgressBar = document.getElementById('lessonProgressBar'); // Assign progress bar
    markStepCompleteBtn = document.getElementById('markStepCompleteBtn'); // Assign mark complete button
    completeLessonBtn = document.getElementById('completeLessonBtn'); // Assign complete lesson button
    lessonCompletionMessage = document.getElementById('lessonCompletionMessage'); // Assign completion message

    // Twisty-player controls
    lessonPlayBtn = document.getElementById('lessonPlayBtn');
    lessonPauseBtn = document.getElementById('lessonPauseBtn');
    lessonResetViewBtn = document.getElementById('lessonResetViewBtn');
    lessonScrambleCubeBtn = document.getElementById('lessonScrambleCubeBtn');
    lessonSolveCubeBtn = document.getElementById('lessonSolveCubeBtn');


    // Add event listeners
    if (generateLessonBtn) generateLessonBtn.addEventListener('click', async () => {
        const topic = lessonTopicInput.value.trim();
        if (topic) {
            const userLevel = await getUserLevel(0, currentCubeType); // Pass current cube type for context
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
    if (markStepCompleteBtn) markStepCompleteBtn.addEventListener('click', markStepComplete);
    if (completeLessonBtn) completeLessonBtn.addEventListener('click', completeLesson);

    // Twisty-player control listeners
    if (lessonPlayBtn) lessonPlayBtn.addEventListener('click', () => {
        if (twistyPlayerLessonViewer) twistyPlayerLessonViewer.play();
    });
    if (lessonPauseBtn) lessonPauseBtn.addEventListener('click', () => {
        if (twistyPlayerLessonViewer) twistyPlayerLessonViewer.pause();
    });
    if (lessonResetViewBtn) lessonResetViewBtn.addEventListener('click', () => {
        if (twistyPlayerLessonViewer) twistyPlayerLessonViewer.jumpToStart();
    });
    if (lessonScrambleCubeBtn) lessonScrambleCubeBtn.addEventListener('click', () => {
        if (twistyPlayerLessonViewer && currentLesson && currentLesson.steps[currentLessonStepIndex]) {
            const step = currentLesson.steps[currentLessonStepIndex];
            if (step.scramble) {
                twistyPlayerLessonViewer.alg = step.scramble; // Apply the scramble
                twistyPlayerLessonViewer.play(); // Play the scramble animation
            } else {
                speakAsJarvis("Pardon me, Sir Sevindu. This step does not have a specific scramble to apply.");
            }
        }
    });
    if (lessonSolveCubeBtn) lessonSolveCubeBtn.addEventListener('click', () => {
        if (twistyPlayerLessonViewer && currentLesson && currentLesson.steps[currentLessonStepIndex]) {
            const step = currentLesson.steps[currentLessonStepIndex];
            if (step.algorithm) {
                twistyPlayerLessonViewer.alg = step.algorithm; // Apply the algorithm
                twistyPlayerLessonViewer.play(); // Play the algorithm animation
            } else {
                speakAsJarvis("Pardon me, Sir Sevindu. This step does not have a specific algorithm to demonstrate the solve.");
            }
        }
    });


    // Initialize Firebase and load settings when the DOM is ready
    initializeLessonsPage();
});
