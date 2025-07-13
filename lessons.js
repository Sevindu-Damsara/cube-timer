// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, query, getDocs, addDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for lessons.js completed.");
console.log("[DEBUG] Value of getDoc after import:", getDoc); // ADDED DEBUG LOG FOR getDoc

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---
// These are duplicated from script.js to ensure lessons.js can function independently.
// =====================================================================================================
// Firebase configuration extracted from script.js as per Sir Sevindu's instruction.
// This ensures direct synchronization with the main timer page's Firebase setup.
const appId = 'my-production-speedcube-timer'; // Global app ID from script.js
const firebaseConfig = {
    apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M",
    authDomain: "ubically-timer.firebaseapp.com",
    projectId: "ubically-timer",
    storageBucket: "ubically-timer.firebaseystorage.app",
    messagingSenderId: "467118524389",
    appId: "1:467118524389:web:d3455f5be5747be2cb910c", // Specific appId from script.js config
    measurementId: "G-YOUR_MEASUREMENT_ID" // Placeholder, if needed, or remove if not in script.js
};
// The __initial_auth_token is provided by the Canvas environment for session sync.
// We must check if it's defined to prevent ReferenceErrors.
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 

let app;
let db;
let auth;
let userId;
let isAuthReady = false;
let isUserAuthenticated = false;

// Global state variables for the current course and lesson
let currentCourse = null;
let currentModuleIndex = 0;
let currentLessonIndex = 0;
let currentLessonStepIndex = 0; // For multi-step lessons (theory, alg, quiz)

// User settings for AI context and UI rendering
let currentCubeType = '3x3'; // Default, will be loaded from settings
let currentTheme = 'dark'; // Default, will be loaded from settings
let userLevel = 'beginner'; // Determined by best solve time, for AI context
let show3DCubeView = true; // Controls visibility of 3D cube in lessons, default to true

// DOM Elements
let lessonHub, lessonViewer, lessonHistorySection;
let startNewCourseBtn, courseList, noCoursesMessage;
let courseCreationModal, closeCourseCreationModalBtn, courseChatContainer, courseChatMessages, courseChatInput, sendCourseChatBtn, courseChatSpinner;
let courseNavigationSidebar, currentCourseTitle, courseProgressBarContainer, courseProgressBar, moduleList;
let lessonTitleElement, lessonStepCounterElement, editLessonBtn, lessonContentDisplay;
let lessonEditorContainer, lessonMarkdownEditorInstance, saveLessonContentBtn, cancelEditLessonBtn;
let scramble3DContainer, scramble3DViewer, playPreviewBtn, pausePreviewBtn, stepForwardBtn, stepBackwardBtn, resetAlgBtn, applyScrambleBtn;
let quizArea, quizQuestionsContainer, submitQuizBtn, quizFeedback;
let prevLessonStepBtn, nextLessonStepBtn, completeLessonBtn, lessonCompletionMessage;
let inLessonChatContainer, closeInLessonChatBtn, inLessonChatMessages, inLessonChatInput, sendInLessonChatBtn, inLessonChatSpinner;
let globalLoadingSpinner;
let courseTypeFilter, courseLevelFilter;

// SimpleMDE editor instance
let simpleMDE;

// Chat history for course creation modal
let courseChatHistory = [];
// Chat history for in-lesson chat
let inLessonChatHistory = [];

// =====================================================================================================
// --- Firebase Initialization and Authentication ---
// =====================================================================================================
async function initializeFirebaseAndAuth() {
    try {
        if (!app) { // Initialize only once
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] Firebase app and services initialized.");
        }

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isUserAuthenticated = !user.isAnonymous; // Check if user is not anonymous
                console.log(`[DEBUG] Auth state changed. User ID: ${userId}, Authenticated: ${isUserAuthenticated}`);
            } else {
                // If no user is signed in (e.g., after sign-out or initial load)
                // Attempt to sign in with the provided initialAuthToken.
                // If initialAuthToken is not provided by Canvas (unlikely), fall back to anonymous.
                console.log("[DEBUG] No user signed in. Attempting sign-in with initialAuthToken or anonymously.");
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                        console.log("[DEBUG] Signed in with initialAuthToken.");
                    } else {
                        await signInAnonymously(auth);
                        console.log("[DEBUG] Signed in anonymously (initialAuthToken not provided).");
                    }
                    userId = auth.currentUser.uid;
                    isUserAuthenticated = !auth.currentUser.isAnonymous;
                } catch (error) {
                    console.error("[ERROR] Failed to sign in with initialAuthToken or anonymously:", error);
                    // Fallback to a random ID if all authentication attempts truly fail
                    userId = `guest-fallback-${crypto.randomUUID()}`;
                    isUserAuthenticated = false;
                    showToast("Authentication failed. Course saving/loading may not work.", "error");
                }
            }
            isAuthReady = true;
            await loadUserSettings(); // Load user settings once auth is ready
            loadInitialView(); // Determine which view to show initially
            loadCourses(); // Load courses after auth is ready and settings are loaded
        });

        // The onAuthStateChanged listener handles the initial sign-in state,
        // so no need for a separate initial signInWithCustomToken call here.
        // It will be triggered once the Firebase app is initialized.

    } catch (e) {
        console.error("[ERROR] Firebase initialization or authentication failed:", e);
        isAuthReady = true; // Mark as ready even on failure to proceed with UI
        userId = `guest-fallback-${crypto.randomUUID()}`; // Fallback to a random ID if everything fails
        isUserAuthenticated = false;
        await loadUserSettings(); // Attempt to load settings from local storage
        loadInitialView();
        loadCourses(); // Attempt to load courses (will be empty for guests)
    }
}

// =====================================================================================================
// --- User Settings and Level Determination ---
// =====================================================================================================

/**
 * Loads user settings (cube type, theme, show3DCubeView) from Firestore or localStorage.
 * Also determines user skill level.
 */
async function loadUserSettings() {
    if (!userId) {
        console.warn("[WARN] userId not set during loadUserSettings. Cannot load settings.");
        return;
    }

    let settingsLoaded = false;
    if (isUserAuthenticated && db) { // Only try Firestore if explicitly authenticated (not anonymous)
        try {
            const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/settings/userSettings`);
            const docSnap = await getDoc(settingsDocRef);

            if (docSnap.exists()) {
                const settings = docSnap.data();
                currentCubeType = settings.cubeType || '3x3';
                currentTheme = settings.theme || 'dark';
                show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : true; // Default to true if not set
                document.body.className = `theme-${currentTheme}`; // Apply theme
                console.log(`[DEBUG] Loaded user settings from Firestore: Cube Type: ${currentCubeType}, Theme: ${currentTheme}, Show 3D: ${show3DCubeView}`);
                settingsLoaded = true;
            } else {
                console.log("[INFO] No user settings found in Firestore. Using defaults and saving.");
                await setDoc(settingsDocRef, { cubeType: currentCubeType, theme: currentTheme, show3DCubeView: show3DCubeView }, { merge: true });
                settingsLoaded = true; // Defaults are now effectively loaded/saved
            }
        } catch (e) {
            console.error("[ERROR] Error loading user settings from Firestore:", e);
            // Fallback to local storage if Firestore read fails
        }
    } else if (db) { // If anonymous, still try to load/save settings to Firestore using the anonymous ID
        try {
            const settingsDocRef = doc(db, `artifacts/${appId}/users/${userId}/settings/userSettings`);
            const docSnap = await getDoc(settingsDocRef);

            if (docSnap.exists()) {
                const settings = docSnap.data();
                currentCubeType = settings.cubeType || '3x3';
                currentTheme = settings.theme || 'dark';
                show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : true; // Default to true if not set
                document.body.className = `theme-${currentTheme}`; // Apply theme
                console.log(`[DEBUG] Loaded user settings from Firestore (anonymous): Cube Type: ${currentCubeType}, Theme: ${currentTheme}, Show 3D: ${show3DCubeView}`);
                settingsLoaded = true;
            } else {
                console.log("[INFO] No user settings found in Firestore for anonymous user. Using defaults and saving.");
                await setDoc(settingsDocRef, { cubeType: currentCubeType, theme: currentTheme, show3DCubeView: show3DCubeView }, { merge: true });
                settingsLoaded = true;
            }
        } catch (e) {
            console.error("[ERROR] Error loading/saving anonymous user settings to Firestore:", e);
        }
    }


    if (!settingsLoaded) {
        // If Firestore failed or was not attempted, try local storage (for compatibility with main timer page)
        try {
            const localSettings = JSON.parse(localStorage.getItem('cubingTimerSettings'));
            if (localSettings) {
                currentCubeType = localSettings.cubeType || '3x3';
                currentTheme = localSettings.theme || 'dark';
                show3DCubeView = localSettings.show3DCubeView !== undefined ? localSettings.show3DCubeView : true; // Default to true
                document.body.className = `theme-${currentTheme}`; // Apply theme
                console.log(`[DEBUG] Loaded user settings from localStorage: Cube Type: ${currentCubeType}, Theme: ${currentTheme}, Show 3D: ${show3DCubeView}`);
            } else {
                console.log("[INFO] No user settings found in localStorage. Using defaults.");
            }
        } catch (e) {
            console.error("[ERROR] Error loading user settings from localStorage:", e);
        }
    }
    
    // Determine user level after settings are loaded
    userLevel = await getUserLevel();
}

/**
 * Determines the user's skill level based on their best 3x3 solve time.
 * This is a simplified heuristic.
 * @returns {string} 'beginner', 'intermediate', 'advanced', or 'expert'.
 */
async function getUserLevel() {
    let bestTime = null;

    if (db && userId) { // Try Firestore first if DB is ready and userId exists
        try {
            const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/userSettings`);
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                bestTime = docSnap.data().bestTime3x3; // Assuming bestTime3x3 is stored in milliseconds
            }
        } catch (e) {
            console.error("[ERROR] Error getting bestTime3x3 from Firestore for user level:", e);
        }
    }
    
    // Fallback to local storage if Firestore failed or not applicable
    if (bestTime === null || bestTime === undefined) {
        try {
            const localSettings = JSON.parse(localStorage.getItem('cubingTimerSettings'));
            if (localSettings && localSettings.bestTime3x3 !== undefined && localSettings.bestTime3x3 !== null) {
                bestTime = localSettings.bestTime3x3;
            }
        } catch (e) {
            console.error("[ERROR] Error getting bestTime3x3 from localStorage for user level:", e);
        }
    }

    if (bestTime === undefined || bestTime === null) {
        return 'beginner'; // Default if no time found
    }

    // Heuristics for skill level (in milliseconds)
    const beginnerThreshold = 60 * 1000; // > 1 minute
    const intermediateThreshold = 30 * 1000; // > 30 seconds
    const advancedThreshold = 15 * 1000; // > 15 seconds

    if (bestTime > beginnerThreshold) {
        return 'beginner';
    } else if (bestTime > intermediateThreshold) {
        return 'intermediate';
    } else if (bestTime > advancedThreshold) {
        return 'advanced';
    } else {
        return 'expert'; // Sub-15 seconds
    }
}

/**
 * Retrieves the current theme's background color in hex format for Twisty-Player.
 * @returns {string} Hex color string (e.g., '#0f172a').
 */
function getThemeBackgroundColorHex() {
    const body = document.body;
    const computedStyle = getComputedStyle(body);
    let bgColor = computedStyle.getPropertyValue('--bg-color-primary').trim();

    // Fallback if CSS variable is not defined or transparent
    if (!bgColor || bgColor === 'transparent') {
        switch (currentTheme) {
            case 'light':
                bgColor = '#f1f5f9'; // Light theme primary background
                break;
            case 'vibrant':
                bgColor = '#1a1a2e'; // Vibrant theme primary background
                break;
            case 'dark':
            default:
                bgColor = '#0f172a'; // Dark theme primary background
                break;
        }
    }
    return bgColor;
}

/**
 * Maps internal cube type strings to Twisty-Player puzzle type strings.
 * @param {string} cubeType Internal cube type (e.g., '3x3', 'pyraminx').
 * @returns {string} Twisty-Player puzzle type (e.g., '3x3x3', 'pyraminx').
 */
function getTwistyPlayerPuzzleType(cubeType) {
    switch (cubeType) {
        case '2x2':
            return '2x2x2';
        case '3x3':
            return '3x3x3';
        case '4x4':
            return '4x4x4';
        case 'pyraminx':
            return 'pyraminx';
        // Add more cases as needed
        default:
            return '3x3x3'; // Default to 3x3 if unknown
    }
}

// =====================================================================================================
// --- UI State Management (Showing/Hiding Sections) ---
// =====================================================================================================
function showSection(sectionElement) {
    const sections = [lessonHub, lessonViewer, lessonHistorySection, courseCreationModal];
    sections.forEach(sec => {
        if (sec) {
            sec.classList.add('hidden');
            sec.classList.remove('flex'); // Remove flex if it was added for layout
            sec.classList.remove('block'); // Remove block if it was added
        }
    });
    if (sectionElement) {
        sectionElement.classList.remove('hidden');
        // Apply appropriate display type based on section
        if (sectionElement.id === 'lessonViewer') {
            sectionElement.classList.add('flex');
            if (window.innerWidth >= 1024) { // For large screens, show sidebar
                courseNavigationSidebar.classList.remove('hidden');
                courseNavigationSidebar.classList.add('block');
            } else {
                courseNavigationSidebar.classList.add('hidden'); // Hide sidebar on smaller screens
            }
            // Ensure in-lesson chat is also correctly displayed/hidden based on its own state
            // For now, let's ensure it's hidden by default when a new lesson is loaded
            inLessonChatContainer.classList.add('hidden');
        } else if (sectionElement.id === 'courseCreationModal') {
            sectionElement.classList.add('flex'); // Modal overlay needs flex for centering
        } else {
            sectionElement.classList.add('block');
        }
    }
    showGlobalLoadingSpinner(false); // Hide global spinner once a section is displayed
}

function showGlobalLoadingSpinner(show) {
    if (globalLoadingSpinner) {
        globalLoadingSpinner.classList.toggle('hidden', !show);
    }
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        console.warn("Toast container not found.");
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type} p-3 rounded-lg shadow-md flex items-center space-x-2 transition-all duration-300 transform translate-y-full opacity-0`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-info-circle'}"></i> <span>${message}</span>`;

    toastContainer.appendChild(toast);

    // Animate in
    setTimeout(() => {
        toast.classList.remove('translate-y-full', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    }, 100);

    // Animate out and remove
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('translate-y-full', 'opacity-0');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 5000);
}

// =====================================================================================================
// --- Jarvis Voice Feedback ---
// =====================================================================================================
let synth = window.speechSynthesis;
let jarvisVoice = null;

function loadJarvisVoice() {
    if (!synth) {
        console.warn("SpeechSynthesis API not supported.");
        return;
    }
    synth.onvoiceschanged = () => {
        const voices = synth.getVoices();
        jarvisVoice = voices.find(voice => voice.name.includes('Google US English') || voice.lang === 'en-US');
        if (!jarvisVoice) {
            jarvisVoice = voices.find(voice => voice.lang === 'en-GB' || voice.lang === 'en-AU');
        }
        if (!jarvisVoice) {
            jarvisVoice = voices[0]; // Fallback to first available voice
        }
        console.log("[DEBUG] Jarvis voice loaded:", jarvisVoice ? jarvisVoice.name : "None found, using default.");
    };
    // Call immediately in case voices are already loaded
    if (synth.getVoices().length > 0) {
        synth.onvoiceschanged();
    }
}
loadJarvisVoice(); // Load voice on script load

function speakAsJarvis(text) {
    if (!synth || !jarvisVoice) {
        console.warn("Speech synthesis not ready or voice not found.");
        return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = jarvisVoice;
    utterance.rate = 1.0; // Normal speed
    utterance.pitch = 1.0; // Normal pitch
    synth.speak(utterance);
    console.log(`[Jarvis Says]: ${text}`);
}

// =====================================================================================================
// --- Course Hub Functionality ---
// =====================================================================================================
async function loadCourses() {
    if (!isAuthReady) {
        console.log("[DEBUG] Auth not ready, delaying loadCourses.");
        return;
    }
    showGlobalLoadingSpinner(true);
    courseList.innerHTML = ''; // Clear existing courses
    noCoursesMessage.classList.add('hidden');

    try {
        const coursesRef = collection(db, `artifacts/${appId}/users/${userId}/courses`);
        const q = query(coursesRef);
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            noCoursesMessage.classList.remove('hidden');
            showToast("No courses found, Sir Sevindu. Please create a new one.", "info");
            speakAsJarvis("No courses found, Sir Sevindu. Please create a new one.");
        } else {
            querySnapshot.forEach((doc) => {
                const course = doc.data();
                renderCourseCard(course);
            });
        }
    } catch (error) {
        console.error("[ERROR] Error loading courses:", error);
        showToast("Failed to load courses, Sir Sevindu. " + error.message, "error");
        speakAsJarvis("I regret to inform you, Sir Sevindu, that I encountered an error while attempting to load your courses.");
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

function renderCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'course-card p-6 rounded-lg shadow-lg bg-gray-800 border border-gray-700 hover:border-blue-500 transition-all duration-300 cursor-pointer';
    card.innerHTML = `
        <h3 class="text-xl font-bold text-gradient mb-2">${course.course_title}</h3>
        <p class="text-gray-400 text-sm mb-4">${course.course_description}</p>
        <div class="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div class="bg-blue-500 h-2 rounded-full" style="width: ${course.progress || 0}%;"></div>
        </div>
        <p class="text-gray-400 text-xs text-right">${course.progress || 0}% Complete</p>
        <button class="button-secondary mt-4 w-full" data-course-id="${course.course_id}">
            <i class="fas fa-play-circle mr-2"></i> ${course.progress > 0 ? 'Resume Course' : 'Start Course'}
        </button>
    `;
    card.querySelector('button').addEventListener('click', () => {
        loadCourse(course.course_id);
    });
    courseList.appendChild(card);
}

// =====================================================================================================
// --- Course Creation Chat Modal Functionality ---
// =====================================================================================================
function openCourseCreationModal() {
    showSection(courseCreationModal);
    courseChatHistory = []; // Reset chat history
    courseChatMessages.innerHTML = ''; // Clear messages
    courseChatInput.value = '';
    courseChatInput.disabled = false;
    sendCourseChatBtn.disabled = false;
    appendChatMessage("Jarvis", "Greetings, Sir Sevindu. I am prepared to assist you in designing a new cubing course. To begin, please inform me of your desired cube type, skill level, and any specific areas of focus.", "ai");
    speakAsJarvis("Greetings, Sir Sevindu. I am prepared to assist you in designing a new cubing course. To begin, please inform me of your desired cube type, skill level, and any specific areas of focus.");
    courseChatInput.focus();
}

function closeCourseCreationModal() {
    showSection(lessonHub); // Go back to course hub
    courseChatHistory = []; // Clear chat history on close
}

async function sendCourseChatMessage() {
    const message = courseChatInput.value.trim();
    if (!message) return;

    appendChatMessage("You", message, "user");
    courseChatHistory.push({ role: "user", parts: [{ text: message }] });
    courseChatInput.value = '';
    courseChatInput.disabled = true;
    sendCourseChatBtn.disabled = true;
    showCourseChatSpinner(true);

    try {
        const response = await fetch('/api/lesson-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'lesson_chat',
                chatHistory: courseChatHistory,
                cubeType: currentCubeType, // Pass current user's cube type
                userLevel: userLevel // Pass current user's skill level
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        appendChatMessage("Jarvis", data.message, "ai");
        speakAsJarvis(data.message);
        courseChatHistory.push({ role: "model", parts: [{ text: data.message }] });

        if (data.action === 'generate_course') {
            showToast("Jarvis is now compiling your personalized course...", "info");
            speakAsJarvis("Your personalized course is now being compiled.");
            await generateAndSaveCourse();
        }

    } catch (error) {
        console.error("[ERROR] Error sending course chat message:", error);
        appendChatMessage("Jarvis", `My apologies, Sir Sevindu. An error occurred: ${error.message}. Please try again.`, "ai");
        speakAsJarvis(`My apologies, Sir Sevindu. An error occurred: ${error.message}. Please try again.`);
        showToast(`Error: ${error.message}`, "error");
    } finally {
        showCourseChatSpinner(false);
        courseChatInput.disabled = false;
        sendCourseChatBtn.disabled = false;
        courseChatInput.focus();
    }
}

function appendChatMessage(sender, message, type) {
    const msgElement = document.createElement('div');
    msgElement.className = `chat-message ${type}`;
    msgElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
    courseChatMessages.appendChild(msgElement);
    courseChatMessages.scrollTop = courseChatMessages.scrollHeight; // Auto-scroll to bottom
}

function showCourseChatSpinner(show) {
    if (courseChatSpinner) {
        courseChatSpinner.classList.toggle('hidden', !show);
    }
    courseChatInput.disabled = show;
    sendCourseChatBtn.disabled = show;
}

async function generateAndSaveCourse() {
    showCourseChatSpinner(true);
    showToast("Generating course, this may take a moment...", "info");
    speakAsJarvis("Generating your course, Sir Sevindu. This may take a moment.");

    try {
        const response = await fetch('/api/generate-course', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chatHistory: courseChatHistory,
                cubeType: currentCubeType, // Pass current user's cube type
                skillLevel: userLevel, // Pass current user's skill level
                learningStyle: 'Conceptual', // Default or derive from chat history
                focusArea: 'General' // Default or derive from chat history
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const courseData = await response.json();
        console.log("[DEBUG] Generated Course Data:", courseData);

        // Save course to Firestore
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, courseData.course_id);
        await setDoc(courseRef, {
            ...courseData,
            createdAt: new Date(),
            progress: 0, // Initialize progress
            lastAccessedModuleIndex: 0,
            lastAccessedLessonIndex: 0,
            lastAccessedStepIndex: 0
        });

        showToast("Course generated and saved successfully, Sir Sevindu!", "success");
        speakAsJarvis("Your course has been successfully generated and saved, Sir Sevindu.");
        closeCourseCreationModal(); // Close modal
        loadCourses(); // Reload courses to show the new one
        loadCourse(courseData.course_id); // Immediately load the new course
    } catch (error) {
        console.error("[ERROR] Error generating and saving course:", error);
        appendChatMessage("Jarvis", `I encountered a critical error while generating your course: ${error.message}. Please try again.`, "ai");
        speakAsJarvis(`I encountered a critical error while generating your course: ${error.message}. Please try again.`);
        showToast(`Failed to generate course: ${error.message}`, "error");
    } finally {
        showCourseChatSpinner(false);
    }
}

// =====================================================================================================
// --- Course and Lesson Viewer Functionality ---
// =====================================================================================================
async function loadCourse(courseId) {
    if (!isAuthReady) {
        console.log("[DEBUG] Auth not ready, delaying loadCourse.");
        return;
    }
    showGlobalLoadingSpinner(true);
    showSection(lessonViewer);

    try {
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, courseId);
        const courseSnap = await getDoc(courseRef);

        if (!courseSnap.exists()) {
            throw new Error("Course not found.");
        }

        currentCourse = courseSnap.data();
        console.log("[DEBUG] Loaded Course:", currentCourse);

        // Load last accessed state
        currentModuleIndex = currentCourse.lastAccessedModuleIndex || 0;
        currentLessonIndex = currentCourse.lastAccessedLessonIndex || 0;
        currentLessonStepIndex = currentCourse.lastAccessedStepIndex || 0;

        renderCourseNavigation();
        loadLesson(currentModuleIndex, currentLessonIndex);

    } catch (error) {
        console.error("[ERROR] Error loading course:", error);
        showToast("Failed to load course, Sir Sevindu. " + error.message, "error");
        speakAsJarvis("I regret to inform you, Sir Sevindu, that I encountered an error while attempting to load the course.");
        showSection(lessonHub); // Go back to hub on error
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

function renderCourseNavigation() {
    if (!currentCourse) return;

    currentCourseTitle.textContent = currentCourse.course_title;
    updateCourseProgressBar();

    moduleList.innerHTML = ''; // Clear existing modules

    currentCourse.modules.forEach((module, modIdx) => {
        const moduleItem = document.createElement('li');
        moduleItem.className = 'module-item mb-2';
        moduleItem.innerHTML = `
            <div class="module-header flex items-center justify-between p-3 bg-gray-700 rounded-md cursor-pointer hover:bg-gray-600 transition-colors duration-200">
                <h4 class="text-md font-semibold text-white">${module.module_title}</h4>
                <i class="fas fa-chevron-down text-gray-400"></i>
            </div>
            <ul class="lesson-list ml-4 mt-2 space-y-1 ${modIdx === currentModuleIndex ? 'block' : 'hidden'}">
                <!-- Lessons will be appended here -->
            </ul>
        `;
        const moduleHeader = moduleItem.querySelector('.module-header');
        const lessonList = moduleItem.querySelector('.lesson-list');
        const chevron = moduleHeader.querySelector('.fas');

        moduleHeader.addEventListener('click', () => {
            lessonList.classList.toggle('hidden');
            chevron.classList.toggle('fa-chevron-down');
            chevron.classList.toggle('fa-chevron-up');
        });

        module.lessons.forEach((lesson, lesIdx) => {
            const lessonItem = document.createElement('li');
            const isCompleted = currentCourse.completedLessons && currentCourse.completedLessons[module.module_id] && currentCourse.completedLessons[module.module_id][lesson.lesson_id];
            const isActive = (modIdx === currentModuleIndex && lesIdx === currentLessonIndex);
            lessonItem.className = `lesson-item p-2 rounded-md cursor-pointer ${isActive ? 'bg-blue-600 text-white' : 'hover:bg-gray-700 text-gray-300'} flex items-center`;
            lessonItem.innerHTML = `
                <i class="fas ${isCompleted ? 'fa-check-circle text-green-400' : 'fa-circle text-gray-500'} mr-2 text-sm"></i>
                <span class="text-sm">${lesson.lesson_title}</span>
            `;
            lessonItem.addEventListener('click', () => {
                currentModuleIndex = modIdx;
                currentLessonIndex = lesIdx;
                currentLessonStepIndex = 0; // Reset step when changing lesson
                loadLesson(modIdx, lesIdx);
                renderCourseNavigation(); // Re-render to update active state
            });
            lessonList.appendChild(lessonItem);
        });
        moduleList.appendChild(lessonItem);
    });
}

function updateCourseProgressBar() {
    if (!currentCourse) return;
    const totalLessons = currentCourse.modules.reduce((acc, mod) => acc + mod.lessons.length, 0);
    let completedCount = 0;
    if (currentCourse.completedLessons) {
        for (const moduleId in currentCourse.completedLessons) {
            for (const lessonId in currentCourse.completedLessons[moduleId]) {
                if (currentCourse.completedLessons[moduleId][lessonId]) {
                    completedCount++;
                }
            }
        }
    }
    const progress = totalLessons > 0 ? (completedCount / totalLessons) * 100 : 0;
    currentCourse.progress = progress; // Update course object
    courseProgressBar.style.width = `${progress}%`;
    // Also update the text on the course card in the hub if visible
    // This requires re-rendering the specific course card or updating its text directly
}

async function loadLesson(moduleIdx, lessonIdx) {
    if (!currentCourse || !currentCourse.modules[moduleIdx] || !currentCourse.modules[moduleIdx].lessons[lessonIdx]) {
        console.error("[ERROR] Invalid module or lesson index.");
        showToast("Invalid lesson selection, Sir Sevindu.", "error");
        return;
    }

    const lesson = currentCourse.modules[moduleIdx].lessons[lessonIdx];
    lessonTitleElement.textContent = lesson.lesson_title;

    // Reset UI elements
    lessonEditorContainer.classList.add('hidden');
    lessonContentDisplay.classList.remove('hidden');
    quizArea.classList.add('hidden');
    scramble3DContainer.classList.add('hidden');
    completeLessonBtn.style.display = 'none';
    lessonCompletionMessage.style.display = 'none';
    prevLessonStepBtn.style.display = 'inline-block';
    nextLessonStepBtn.style.display = 'inline-block';

    // Initialize SimpleMDE if not already done
    if (!simpleMDE) {
        simpleMDE = new SimpleMDE({ element: lessonMarkdownEditor, spellChecker: false });
    }

    // Render the current step of the lesson
    renderLessonStep();
    await saveUserProgress(); // Save current lesson/step to Firestore
}

function renderLessonStep() {
    if (!currentCourse) return;

    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    const lessonType = lesson.lesson_type;
    const totalSteps = 1; // For now, each lesson is a single "step" in terms of content type
                        // This will be expanded if we break down lesson.content into multiple pages.
    lessonStepCounterElement.textContent = `Step ${currentLessonStepIndex + 1} of ${totalSteps}`;

    // Hide all dynamic content areas first
    lessonContentDisplay.classList.add('hidden');
    scramble3DContainer.classList.add('hidden');
    quizArea.classList.add('hidden');

    // Show content based on lesson type
    if (lessonType.includes('theory') || lessonType.includes('conceptual')) {
        lessonContentDisplay.innerHTML = window.marked.parse(lesson.content || 'No content provided for this lesson.'); // MODIFIED HERE
        lessonContentDisplay.classList.remove('hidden');
    }

    if (lessonType.includes('scramble_practice') || lessonType.includes('algorithm_drill')) {
        scramble3DContainer.classList.remove('hidden');
        // Configure twisty-player for the current cube type and theme
        scramble3DViewer.puzzle = getTwistyPlayerPuzzleType(currentCubeType);
        scramble3DViewer.style.setProperty('--twisty-player-background', getThemeBackgroundColorHex());
        scramble3DViewer.camera = 'plan'; // Default camera view

        if (lesson.scrambles && lesson.scrambles.length > 0) {
            scramble3DViewer.scramble = lesson.scrambles[0]; // Display first scramble for practice
            scramble3DViewer.alg = ''; // Clear any algorithm animation
            scramble3DViewer.reset();
            applyScrambleBtn.style.display = 'inline-block';
        } else {
            applyScrambleBtn.style.display = 'none';
        }
        if (lesson.algorithms && lesson.algorithms.length > 0) {
            scramble3DViewer.alg = lesson.algorithms[0]; // Set algorithm for playback
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        } else {
            playPreviewBtn.style.display = 'none';
            pausePreviewBtn.style.display = 'none';
        }
    }

    if (lessonType.includes('interactive_quiz')) {
        renderQuiz(lesson.quiz_questions);
        quizArea.classList.remove('hidden');
        nextLessonStepBtn.style.display = 'none'; // Hide next until quiz submitted
        prevLessonStepBtn.style.display = 'none';
        completeLessonBtn.style.display = 'none';
    } else {
        submitQuizBtn.style.display = 'none';
    }

    // Adjust button visibility based on lesson type/state
    if (lessonType.includes('interactive_quiz')) {
        nextLessonStepBtn.classList.add('hidden');
        prevLessonStepBtn.classList.add('hidden');
    } else {
        nextLessonStepBtn.classList.remove('hidden');
        prevLessonStepBtn.classList.remove('hidden');
    }

    // Control 3D cube visibility based on user setting
    if (!show3DCubeView) {
        scramble3DContainer.classList.add('hidden');
    }
}

// =====================================================================================================
// --- Lesson Navigation and Progress ---
// =====================================================================================================
async function goToNextLessonStep() {
    if (!currentCourse) return;

    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    // For now, only one "step" per lesson content. This can be expanded later.
    const totalStepsInLesson = 1;

    if (currentLessonStepIndex < totalStepsInLesson - 1) {
        currentLessonStepIndex++;
    } else {
        // Mark current lesson as completed before moving to next
        await markLessonCompleted(currentCourse.modules[currentModuleIndex].module_id, lesson.lesson_id);

        // Move to next lesson
        currentLessonStepIndex = 0; // Reset step for next lesson
        currentLessonIndex++;
        if (currentLessonIndex >= currentCourse.modules[currentModuleIndex].lessons.length) {
            // Move to next module
            currentLessonIndex = 0; // Reset lesson for next module
            currentModuleIndex++;
            if (currentModuleIndex >= currentCourse.modules.length) {
                // Course completed
                showToast("Congratulations, Sir Sevindu! You have completed the course!", "success");
                speakAsJarvis("Congratulations, Sir Sevindu! You have completed the course!");
                markCourseCompleted();
                showSection(lessonHub); // Go back to hub
                return;
            }
        }
    }
    await saveUserProgress();
    loadLesson(currentModuleIndex, currentLessonIndex);
    renderCourseNavigation(); // Update sidebar active state
}

async function goToPreviousLessonStep() {
    if (!currentCourse) return;

    if (currentLessonStepIndex > 0) {
        currentLessonStepIndex--;
    } else {
        // Move to previous lesson
        currentLessonIndex--;
        if (currentLessonIndex < 0) {
            // Move to previous module
            currentModuleIndex--;
            if (currentModuleIndex < 0) {
                showToast("You are at the beginning of the course, Sir Sevindu.", "info");
                speakAsJarvis("You are at the beginning of the course, Sir Sevindu.");
                currentModuleIndex = 0; // Stay at first module
                currentLessonIndex = 0; // Stay at first lesson
                currentLessonStepIndex = 0;
                await saveUserProgress();
                loadLesson(currentModuleIndex, currentLessonIndex);
                renderCourseNavigation();
                return;
            }
            currentLessonIndex = currentCourse.modules[currentModuleIndex].lessons.length - 1; // Last lesson of prev module
        }
        currentLessonStepIndex = 0; // Reset step for previous lesson
    }
    await saveUserProgress();
    loadLesson(currentModuleIndex, currentLessonIndex);
    renderCourseNavigation(); // Update sidebar active state
}

async function saveUserProgress() {
    if (!currentCourse || !userId) return;

    try {
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, currentCourse.course_id);
        await updateDoc(courseRef, {
            lastAccessedModuleIndex: currentModuleIndex,
            lastAccessedLessonIndex: currentLessonIndex,
            lastAccessedStepIndex: currentLessonStepIndex,
            progress: currentCourse.progress // Save updated progress percentage
        });
        console.log("[DEBUG] User progress saved.");
    }
    catch (error) {
        console.error("[ERROR] Failed to save user progress:", error);
        showToast("Failed to save progress, Sir Sevindu.", "error");
    }
}

async function markLessonCompleted(moduleId, lessonId) {
    if (!currentCourse || !userId) return;

    try {
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, currentCourse.course_id);
        
        // Fetch current course data to safely update nested map
        const courseSnap = await getDoc(courseRef);
        if (courseSnap.exists()) {
            const data = courseSnap.data();
            const completedLessons = data.completedLessons || {};
            if (!completedLessons[moduleId]) {
                completedLessons[moduleId] = {};
            }
            completedLessons[moduleId][lessonId] = true; // Mark as completed
            
            await updateDoc(courseRef, { completedLessons: completedLessons });
            console.log(`[DEBUG] Lesson ${lessonId} marked as completed.`);
            updateCourseProgressBar(); // Recalculate and update progress bar
            renderCourseNavigation(); // Re-render sidebar to show checkmark
        }
    } catch (error) {
        console.error("[ERROR] Failed to mark lesson completed:", error);
        showToast("Failed to mark lesson completed, Sir Sevindu.", "error");
    }
}

async function markCourseCompleted() {
    if (!currentCourse || !userId) return;

    try {
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, currentCourse.course_id);
        await updateDoc(courseRef, {
            progress: 100,
            completedAt: new Date()
        });
        console.log("[DEBUG] Course marked as 100% completed.");
        showToast("Course marked as completed!", "success");
    } catch (error) {
        console.error("[ERROR] Failed to mark course completed:", error);
        showToast("Failed to mark course completed, Sir Sevindu.", "error");
    }
}

// =====================================================================================================
// --- 3D Cube Interaction ---
// =====================================================================================================
function playAlgorithm() {
    if (scramble3DViewer && scramble3DViewer.alg) {
        scramble3DViewer.play();
        playPreviewBtn.style.display = 'none';
        pausePreviewBtn.style.display = 'inline-block';
    } else {
        speakAsJarvis("Pardon me, Sir Sevindu. There is no algorithm to play for this step.");
    }
}

function pauseAlgorithm() {
    if (scramble3DViewer) {
        scramble3DViewer.pause();
        playPreviewBtn.style.display = 'inline-block';
        pausePreviewBtn.style.display = 'none';
    }
}

function stepForwardAlgorithm() {
    if (scramble3DViewer) {
        scramble3DViewer.next();
    }
}

function stepBackwardAlgorithm() {
    if (scramble3DViewer) {
        scramble3DViewer.back();
    }
}

function resetAlgorithm() {
    if (scramble3DViewer) {
        scramble3DViewer.reset();
        playPreviewBtn.style.display = 'inline-block';
        pausePreviewBtn.style.display = 'none';
    }
}

function applyScrambleToViewer() {
    if (scramble3DViewer && scramble3DViewer.scramble) {
        scramble3DViewer.alg = scramble3DViewer.scramble; // Apply scramble as an algorithm to visualize it
        scramble3DViewer.play();
        speakAsJarvis("Scramble applied, Sir Sevindu.");
    } else {
        speakAsJarvis("Pardon me, Sir Sevindu. There is no scramble to apply for this step.");
    }
}

// =====================================================================================================
// --- Quiz Functionality ---
// =====================================================================================================
function renderQuiz(questions) {
    quizQuestionsContainer.innerHTML = '';
    quizFeedback.textContent = '';
    if (!questions || questions.length === 0) {
        quizQuestionsContainer.innerHTML = '<p class="text-gray-400">No quiz questions available for this lesson.</p>';
        submitQuizBtn.style.display = 'none';
        return;
    }

    questions.forEach((q, index) => {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'bg-gray-800 p-4 rounded-lg shadow-md';
        questionDiv.innerHTML = `
            <p class="font-semibold text-white mb-3">${index + 1}. ${q.question}</p>
            <div class="options-container space-y-2">
                ${q.options.map((option, optIndex) => `
                    <label class="flex items-center space-x-2 text-gray-300 cursor-pointer">
                        <input type="${Array.isArray(q.answer) && q.answer.length > 1 ? 'checkbox' : 'radio'}" name="question-${index}" value="${option}" class="form-radio text-blue-500">
                        <span>${option}</span>
                    </label>
                `).join('')}
            </div>
        `;
        quizQuestionsContainer.appendChild(questionDiv);
    });
    submitQuizBtn.style.display = 'block';
}

function submitQuiz() {
    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    const questions = lesson.quiz_questions;
    let correctAnswers = 0;
    let totalQuestions = questions.length;

    questions.forEach((q, index) => {
        const selectedOptions = Array.from(document.querySelectorAll(`input[name="question-${index}"]:checked`)).map(input => input.value);
        const isCorrect = Array.isArray(q.answer)
            ? selectedOptions.length === q.answer.length && q.answer.every(ans => selectedOptions.includes(ans))
            : selectedOptions.length === 1 && selectedOptions[0] === q.answer;

        if (isCorrect) {
            correctAnswers++;
        }
        // Optionally provide immediate feedback per question
        // const questionDiv = quizQuestionsContainer.children[index];
        // questionDiv.style.backgroundColor = isCorrect ? '#16a34a' : '#dc2626'; // Tailwind green-600 / red-600
    });

    const score = (correctAnswers / totalQuestions) * 100;
    quizFeedback.textContent = `You scored ${correctAnswers} out of ${totalQuestions} (${score.toFixed(0)}%).`;
    quizFeedback.className = `mt-4 text-center font-semibold ${score >= 70 ? 'text-green-400' : 'text-red-400'}`;
    speakAsJarvis(`Sir Sevindu, you scored ${score.toFixed(0)} percent on the quiz.`);

    // Mark lesson as completed if score is satisfactory (e.g., > 70%)
    if (score >= 70) {
        markLessonCompleted(currentCourse.modules[currentModuleIndex].module_id, lesson.lesson_id);
        showToast("Quiz passed! Lesson completed.", "success");
        speakAsJarvis("Quiz passed. Lesson completed, Sir Sevindu.");
        nextLessonStepBtn.classList.remove('hidden'); // Allow progression
        prevLessonStepBtn.classList.remove('hidden');
    } else {
        showToast("Quiz not passed. Please review and try again.", "info");
        speakAsJarvis("Quiz not passed. Please review and try again, Sir Sevindu.");
        // Optionally, reset quiz or provide option to retry
    }
    submitQuizBtn.style.display = 'none'; // Hide submit button after submission
}


// =====================================================================================================
// --- In-Lesson AI Chat Functionality ---
// =====================================================================================================
function toggleInLessonChat() {
    inLessonChatContainer.classList.toggle('hidden');
    if (!inLessonChatContainer.classList.contains('hidden')) {
        inLessonChatInput.focus();
        inLessonChatMessages.scrollTop = inLessonChatMessages.scrollHeight;
    }
}

async function sendInLessonChatMessage() {
    const message = inLessonChatInput.value.trim();
    if (!message) return;

    appendInLessonChatMessage("You", message, "user");
    inLessonChatHistory.push({ role: "user", parts: [{ text: message }] });
    inLessonChatInput.value = '';
    inLessonChatInput.disabled = true;
    sendInLessonChatBtn.disabled = true;
    showInLessonChatSpinner(true);

    try {
        const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
        const response = await fetch('/api/lesson-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'lesson_chat',
                chatHistory: inLessonChatHistory,
                currentLessonContext: { // Provide detailed context for Jarvis
                    lessonTitle: lesson.lesson_title,
                    lessonType: lesson.lesson_type,
                    content: lesson.content,
                    scrambles: lesson.scrambles,
                    algorithms: lesson.algorithms,
                    quizQuestions: lesson.quiz_questions
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        appendInLessonChatMessage("Jarvis", data.message, "ai");
        speakAsJarvis(data.message);
        inLessonChatHistory.push({ role: "model", parts: [{ text: data.message }] });

        // In-lesson chat action should typically be 'continue_chat'
        if (data.action && data.action !== 'continue_chat') {
            console.warn(`[WARN] Unexpected action '${data.action}' received in in-lesson chat.`);
        }

    } catch (error) {
        console.error("[ERROR] Error sending in-lesson chat message:", error);
        appendInLessonChatMessage("Jarvis", `My apologies, Sir Sevindu. An error occurred: ${error.message}. Please try again.`, "ai");
        speakAsJarvis(`My apologies, Sir Sevindu. An error occurred: ${error.message}. Please try again.`);
        showToast(`Error: ${error.message}`, "error");
    } finally {
        showInLessonChatSpinner(false);
        inLessonChatInput.disabled = false;
        sendInLessonChatBtn.disabled = false;
        inLessonChatInput.focus();
    }
}

function appendInLessonChatMessage(sender, message, type) {
    const msgElement = document.createElement('div');
    msgElement.className = `chat-message ${type}`;
    msgElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
    inLessonChatMessages.appendChild(msgElement);
    inLessonChatMessages.scrollTop = inLessonChatMessages.scrollHeight;
}

function showInLessonChatSpinner(show) {
    if (inLessonChatSpinner) {
        inLessonChatSpinner.classList.toggle('hidden', !show);
    }
    inLessonChatInput.disabled = show;
    sendInLessonChatBtn.disabled = show;
}

// =====================================================================================================
// --- Lesson Editing Functionality ---
// =====================================================================================================
function enableEditMode() {
    if (!currentCourse || !userId) {
        showToast("Cannot edit lesson. Please ensure a lesson is loaded and you are authenticated.", "error");
        return;
    }

    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    if (!lesson) {
        showToast("No lesson content to edit, Sir Sevindu.", "info");
        return;
    }

    lessonContentDisplay.classList.add('hidden');
    lessonEditorContainer.classList.remove('hidden');
    
    // Set SimpleMDE content
    simpleMDE.value(lesson.content || '');
    simpleMDE.codemirror.focus(); // Focus the editor

    // Hide other interactive elements during edit mode
    scramble3DContainer.classList.add('hidden');
    quizArea.classList.add('hidden');
    prevLessonStepBtn.classList.add('hidden');
    nextLessonStepBtn.classList.add('hidden');
    completeLessonBtn.style.display = 'none';
    editLessonBtn.classList.add('hidden'); // Hide edit button itself
    inLessonChatContainer.classList.add('hidden'); // Hide chat during edit
}

async function saveLessonContent() {
    if (!currentCourse || !userId) {
        showToast("Authentication required to save changes, Sir Sevindu.", "error");
        return;
    }

    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    const updatedContent = simpleMDE.value();

    if (lesson.content === updatedContent) {
        showToast("No changes detected, Sir Sevindu.", "info");
        disableEditMode(); // Exit edit mode if no changes
        return;
    }

    showGlobalLoadingSpinner(true);
    showToast("Saving lesson content...", "info");
    speakAsJarvis("Saving lesson content, Sir Sevindu.");

    try {
        // Update the lesson content directly in the currentCourse object
        lesson.content = updatedContent;

        // Update the specific lesson within the course document in Firestore
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, currentCourse.course_id);
        
        // Firestore doesn't allow direct update of nested array elements by index.
        // We need to update the entire 'modules' array.
        await updateDoc(courseRef, {
            modules: currentCourse.modules // Save the entire updated modules array
        });

        showToast("Lesson content saved successfully, Sir Sevindu!", "success");
        speakAsJarvis("Lesson content saved successfully, Sir Sevindu.");
        disableEditMode();
        renderLessonStep(); // Re-render the lesson to show updated content
    } catch (error) {
        console.error("[ERROR] Error saving lesson content:", error);
        showToast(`Failed to save lesson content: ${error.message}`, "error");
        speakAsJarvis(`I regret to inform you, Sir Sevindu, that I encountered an error while attempting to save the lesson content.`);
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

function cancelEditLesson() {
    showToast("Lesson editing cancelled, Sir Sevindu.", "info");
    disableEditMode();
    renderLessonStep(); // Re-render original content
}

function disableEditMode() {
    lessonEditorContainer.classList.add('hidden');
    lessonContentDisplay.classList.remove('hidden');
    editLessonBtn.classList.remove('hidden'); // Show edit button again

    // Re-show other interactive elements based on lesson type
    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    if (show3DCubeView && (lesson.lesson_type.includes('scramble_practice') || lesson.lesson_type.includes('algorithm_drill'))) {
        scramble3DContainer.classList.remove('hidden');
    }
    if (lesson.lesson_type.includes('interactive_quiz')) {
        quizArea.classList.remove('hidden');
    }
    prevLessonStepBtn.classList.remove('hidden');
    nextLessonStepBtn.classList.remove('hidden');
    // inLessonChatContainer.classList.remove('hidden'); // Re-show chat if it was open
}

// =====================================================================================================
// --- Event Listeners and Initial Setup ---
// =====================================================================================================
function setupEventListeners() {
    console.log("[DEBUG] lessons.js: Setting up event listeners.");

    // Assign DOM elements
    lessonHub = document.getElementById('lessonHub');
    lessonViewer = document.getElementById('lessonViewer');
    lessonHistorySection = document.getElementById('lessonHistorySection'); // Still exists in HTML, but less used now

    startNewCourseBtn = document.getElementById('startNewCourseBtn');
    courseList = document.getElementById('courseList');
    noCoursesMessage = document.getElementById('noCoursesMessage');
    courseTypeFilter = document.getElementById('courseTypeFilter');
    courseLevelFilter = document.getElementById('courseLevelFilter');

    courseCreationModal = document.getElementById('courseCreationModal');
    closeCourseCreationModalBtn = document.getElementById('closeCourseCreationModalBtn');
    courseChatContainer = document.getElementById('courseChatContainer');
    courseChatMessages = document.getElementById('courseChatMessages');
    courseChatInput = document.getElementById('courseChatInput');
    sendCourseChatBtn = document.getElementById('sendCourseChatBtn');
    courseChatSpinner = document.getElementById('courseChatSpinner');

    courseNavigationSidebar = document.getElementById('courseNavigationSidebar');
    currentCourseTitle = document.getElementById('currentCourseTitle');
    courseProgressBarContainer = document.getElementById('courseProgressBarContainer');
    courseProgressBar = document.getElementById('courseProgressBar');
    moduleList = document.getElementById('moduleList');

    lessonTitleElement = document.getElementById('lessonTitle');
    lessonStepCounterElement = document.getElementById('lessonStepCounter');
    editLessonBtn = document.getElementById('editLessonBtn');
    lessonContentDisplay = document.getElementById('lessonContentDisplay');

    lessonEditorContainer = document.getElementById('lessonEditorContainer');
    // lessonMarkdownEditor is initialized later with SimpleMDE
    saveLessonContentBtn = document.getElementById('saveLessonContentBtn');
    cancelEditLessonBtn = document.getElementById('cancelEditLessonBtn');

    scramble3DContainer = document.getElementById('scramble3DContainer');
    scramble3DViewer = document.getElementById('scramble3DViewer');
    playPreviewBtn = document.getElementById('playPreviewBtn');
    pausePreviewBtn = document.getElementById('pausePreviewBtn');
    stepForwardBtn = document.getElementById('stepForwardBtn');
    stepBackwardBtn = document.getElementById('stepBackwardBtn');
    resetAlgBtn = document.getElementById('resetAlgBtn');
    applyScrambleBtn = document.getElementById('applyScrambleBtn');

    quizArea = document.getElementById('quizArea');
    quizQuestionsContainer = document.getElementById('quizQuestionsContainer');
    submitQuizBtn = document.getElementById('submitQuizBtn');
    quizFeedback = document.getElementById('quizFeedback');

    prevLessonStepBtn = document.getElementById('prevLessonStepBtn');
    nextLessonStepBtn = document.getElementById('nextLessonStepBtn');
    completeLessonBtn = document.getElementById('completeLessonBtn');
    lessonCompletionMessage = document.getElementById('lessonCompletionMessage');

    inLessonChatContainer = document.getElementById('inLessonChatContainer');
    closeInLessonChatBtn = document.getElementById('closeInLessonChatBtn');
    inLessonChatMessages = document.getElementById('inLessonChatMessages');
    inLessonChatInput = document.getElementById('inLessonChatInput');
    sendInLessonChatBtn = document.getElementById('sendInLessonChatBtn');
    inLessonChatSpinner = document.getElementById('inLessonChatSpinner');

    globalLoadingSpinner = document.getElementById('globalLoadingSpinner');

    // Add event listeners
    if (startNewCourseBtn) startNewCourseBtn.addEventListener('click', openCourseCreationModal);
    if (closeCourseCreationModalBtn) closeCourseCreationModalBtn.addEventListener('click', closeCourseCreationModal);
    if (sendCourseChatBtn) sendCourseChatBtn.addEventListener('click', sendCourseChatMessage);
    if (courseChatInput) courseChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendCourseChatMessage();
    });

    if (playPreviewBtn) playPreviewBtn.addEventListener('click', playAlgorithm);
    if (pausePreviewBtn) pausePreviewBtn.addEventListener('click', pauseAlgorithm);
    if (stepForwardBtn) stepForwardBtn.addEventListener('click', stepForwardAlgorithm);
    if (stepBackwardBtn) stepBackwardBtn.addEventListener('click', stepBackwardAlgorithm);
    if (resetAlgBtn) resetAlgBtn.addEventListener('click', resetAlgorithm);
    if (applyScrambleBtn) applyScrambleBtn.addEventListener('click', applyScrambleToViewer);

    if (submitQuizBtn) submitQuizBtn.addEventListener('click', submitQuiz);

    if (prevLessonStepBtn) prevLessonStepBtn.addEventListener('click', goToPreviousLessonStep);
    if (nextLessonStepBtn) nextLessonStepBtn.addEventListener('click', goToNextLessonStep);
    if (completeLessonBtn) completeLessonBtn.addEventListener('click', () => {
        if (currentCourse && currentCourse.modules[currentModuleIndex] && currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex]) {
            markLessonCompleted(currentCourse.modules[currentModuleIndex].module_id, currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].lesson_id);
            showToast("Lesson marked as complete!", "success");
            speakAsJarvis("Lesson marked as complete, Sir Sevindu.");
        }
    });

    if (editLessonBtn) editLessonBtn.addEventListener('click', enableEditMode);
    if (saveLessonContentBtn) saveLessonContentBtn.addEventListener('click', saveLessonContent);
    if (cancelEditLessonBtn) cancelEditLessonBtn.addEventListener('click', cancelEditLesson);

    // In-lesson chat listeners
    if (sendInLessonChatBtn) sendInLessonChatBtn.addEventListener('click', sendInLessonChatMessage);
    if (inLessonChatInput) inLessonChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendInLessonChatMessage();
    });
    if (closeInLessonChatBtn) closeInLessonChatBtn.addEventListener('click', toggleInLessonChat);

    // Initial state for in-lesson chat (can be triggered by a button later)
    // For now, let's add a temporary button or just keep it hidden until a user action.
    // A button to open/close in-lesson chat could be added to lessonViewer section.
    // For demonstration, let's make it visible when a lesson is loaded.
    // This will be handled in loadLesson to conditionally show/hide.
}

/**
 * Determines which section to show initially based on user state or last activity.
 */
async function loadInitialView() {
    // For now, always start at the hub. In a more complex app,
    // we might check if a lesson was in progress and then resume it directly.
    showSection(lessonHub);
    showGlobalLoadingSpinner(false); // Hide global spinner once initial view is set
}


/**
 * Initializes the lessons page by setting up DOM elements and Firebase.
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] lessons.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");
    setupEventListeners(); // Assign DOM elements and add listeners
    initializeFirebaseAndAuth(); // Initialize Firebase and authentication
});

// Add a window resize listener for responsive sidebar
window.addEventListener('resize', () => {
    if (lessonViewer && !lessonViewer.classList.contains('hidden')) {
        if (window.innerWidth >= 1024) {
            courseNavigationSidebar.classList.remove('hidden');
            courseNavigationSidebar.classList.add('block');
        } else {
            courseNavigationSidebar.classList.add('hidden');
        }
    }
});
