// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, orderBy, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for lessons.js completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---
// These are duplicated from script.js to ensure lessons.js can function independently.
// =====================================================================================================
// Use Canvas global variables if they are defined, otherwise fall back to hardcoded values.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'my-production-speedcube-timer';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M",
    authDomain: "ubically-timer.firebaseapp.com",
    projectId: "ubically-timer",
    storageBucket: "ubically-timer.firebaseystorage.app",
    messagingSenderId: "467118524389",
    appId: "1:467118524389:web:d3455f5be5747be2cb910c",
    measurementId: "G-XXXXXXXXXX" // Placeholder, if a specific value is not available.
};
// __initial_auth_token is provided globally by Canvas and should NOT be redeclared with 'const' here.


// Firebase variables
let app;
let db;
let auth;
let userId = null;
let isAuthReady = false;
let isUserAuthenticated = false; // Track if user is explicitly authenticated (not anonymous)

// Tone.js Synth for sound effects
let synth;

// Cubing.js 3D viewer instance
let scramble3DViewer;

// DOM Elements
let globalLoadingSpinner;
let lessonHub, lessonViewer, lessonHistorySection;
let startNewCourseBtn, courseTypeFilter, courseLevelFilter, courseList, noCoursesMessage;
let courseCreationModal, closeCourseCreationModalBtn, courseChatContainer, courseChatMessages, courseChatInput, sendCourseChatBtn, courseChatSpinner;
let courseNavigationSidebar, currentCourseTitle, courseProgressBarContainer, courseProgressBar, moduleList;
let lessonTitle, lessonStepCounter, editLessonBtn, lessonContentDisplay, lessonEditorContainer, lessonMarkdownEditor, cancelEditLessonBtn, saveLessonContentBtn;
let scramble3DContainer, playPreviewBtn, pausePreviewBtn, stepBackwardBtn, stepForwardBtn, resetAlgBtn, applyScrambleBtn;
let quizArea, quizQuestionsContainer, quizFeedback, submitQuizBtn;
let prevLessonStepBtn, nextLessonStepBtn, completeLessonBtn, lessonCompletionMessage;
let openInLessonChatBtn, inLessonChatContainer, closeInLessonChatBtn, inLessonChatMessages, inLessonChatInput, sendInLessonChatBtn, inLessonChatSpinner;
let lessonHistoryList, noLessonsMessage, historyLoadingSpinner;

// State variables
let currentCourse = null;
let currentModuleIndex = 0;
let currentLessonIndex = 0;
let currentLessonStepIndex = 0;
let simpleMDEInstance = null; // To store the SimpleMDE instance
let courseChatHistory = []; // History for course creation chat
let inLessonChatHistory = []; // History for in-lesson chat
let currentQuizAnswers = {}; // To store user's answers for the current quiz

// =====================================================================================================
// --- Utility Functions ---
// =====================================================================================================

/**
 * Displays a toast notification.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', 'info'.
 */
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        console.error("Toast container not found!");
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type} p-3 rounded-md shadow-lg text-white flex items-center space-x-2`;

    let iconClass = '';
    let bgColor = '';
    switch (type) {
        case 'success':
            iconClass = 'fas fa-check-circle';
            bgColor = 'bg-green-500';
            break;
        case 'error':
            iconClass = 'fas fa-times-circle';
            bgColor = 'bg-red-500';
            break;
        case 'info':
        default:
            iconClass = 'fas fa-info-circle';
            bgColor = 'bg-blue-500';
            break;
    }

    toast.innerHTML = `<i class="${iconClass}"></i><span>${message}</span>`;
    toast.classList.add(bgColor);

    toastContainer.appendChild(toast);

    // Show the toast
    setTimeout(() => {
        toast.classList.add('show');
    }, 10); // Small delay for transition to work

    // Hide and remove the toast after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

/**
 * Speaks a given text using the Web Speech API.
 * @param {string} text The text to speak.
 */
function speakAsJarvis(text) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        // Attempt to find a suitable voice, e.g., a British male voice
        const voices = speechSynthesis.getVoices();
        const jarvisVoice = voices.find(voice => voice.name.includes('Google UK English Male') || voice.name.includes('Microsoft David') || voice.lang === 'en-US'); // Fallback to US English
        if (jarvisVoice) {
            utterance.voice = jarvisVoice;
            console.log(`[DEBUG] Jarvis voice loaded: ${jarvisVoice.name} - ${jarvisVoice.lang}`);
        } else {
            console.warn("[WARN] Jarvis voice not found, using default voice.");
        }
        utterance.pitch = 1.0;
        utterance.rate = 1.0;
        speechSynthesis.speak(utterance);
    } else {
        console.warn("Speech Synthesis API not supported in this browser.");
    }
}

/**
 * Shows or hides the global loading spinner.
 * @param {boolean} show - True to show, false to hide.
 */
function showGlobalLoadingSpinner(show) {
    if (globalLoadingSpinner) {
        globalLoadingSpinner.classList.toggle('hidden', !show);
        globalLoadingSpinner.classList.toggle('flex', show);
    }
}

/**
 * Hides all main sections.
 */
function hideAllSections() {
    lessonHub.classList.add('hidden');
    lessonViewer.classList.add('hidden');
    lessonHistorySection.classList.add('hidden');
}

/**
 * Shows a specific section.
 * @param {HTMLElement} sectionElement - The section to show.
 */
function showSection(sectionElement) {
    hideAllSections();
    sectionElement.classList.remove('hidden');
    sectionElement.classList.add('flex'); // Ensure it's flex for its internal layout
}

/**
 * Updates the course progress bar.
 */
function updateCourseProgressBar() {
    if (!currentCourse || !currentCourse.modules || currentCourse.modules.length === 0) {
        courseProgressBar.style.width = '0%';
        return;
    }

    let totalSteps = 0;
    let completedSteps = 0;

    currentCourse.modules.forEach(module => {
        module.lessons.forEach(lesson => {
            lesson.steps.forEach(step => {
                totalSteps++;
                if (step.completed) {
                    completedSteps++;
                }
            });
        });
    });

    const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
    courseProgressBar.style.width = `${progress}%`;
    courseProgressBar.title = `${completedSteps} of ${totalSteps} steps completed`;
}

// =====================================================================================================
// --- Firebase Initialization and Authentication ---
// =====================================================================================================

/**
 * Initializes Firebase app and services.
 */
async function initializeFirebaseAndAuth() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        console.log("[DEBUG] Firebase app and services initialized.");

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isUserAuthenticated = !user.isAnonymous;
                console.log(`[DEBUG] Auth state changed. User ID: ${userId}, Authenticated: ${isUserAuthenticated}`);
            } else {
                // Sign in anonymously if no user is logged in
                try {
                    // Access __initial_auth_token directly as it's globally provided by Canvas
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token !== null) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                        console.log("[DEBUG] Signed in with custom token.");
                    } else {
                        await signInAnonymously(auth);
                        console.log("[DEBUG] Signed in anonymously.");
                    }
                    userId = auth.currentUser.uid;
                    isUserAuthenticated = !auth.currentUser.isAnonymous;
                } catch (anonError) {
                    console.error("[ERROR] Anonymous sign-in failed:", anonError);
                    showToast("Authentication failed. Please try again.", "error");
                    // Fallback to a random UUID if anonymous sign-in fails
                    userId = `guest-${crypto.randomUUID()}`;
                    isUserAuthenticated = false;
                }
            }
            isAuthReady = true;
            await loadInitialView(); // Load initial view after auth is ready
        });
    } catch (e) {
        console.error("[ERROR] Firebase initialization failed:", e);
        showToast("Failed to initialize application services.", "error");
        // Proceed as guest if Firebase init fails
        userId = `guest-${crypto.randomUUID()}`;
        isAuthReady = true;
        isUserAuthenticated = false;
        await loadInitialView();
    }
}

/**
 * Gets the Firestore collection reference for user-specific data.
 * @param {string} collectionName - The name of the sub-collection (e.g., 'courses').
 * @returns {firebase.firestore.CollectionReference}
 */
function getUserCollectionRef(collectionName) {
    if (!db || !userId) {
        console.error("Firestore DB or User ID not available.");
        return null;
    }
    // Use 'public' data for collaborative apps, otherwise 'users/{userId}'
    // For this app, lessons are user-specific, so use 'users/{userId}'
    return collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
}

// =====================================================================================================
// --- Course Hub Functions ---
// =====================================================================================================

/**
 * Loads and displays the list of courses.
 */
async function loadCourseList() {
    showGlobalLoadingSpinner(true);
    historyLoadingSpinner.classList.remove('hidden');
    noCoursesMessage.classList.add('hidden');
    courseList.innerHTML = ''; // Clear existing list

    try {
        const coursesRef = getUserCollectionRef('courses');
        if (!coursesRef) {
            showToast("Failed to load courses: Authentication not ready.", "error");
            historyLoadingSpinner.classList.add('hidden');
            showGlobalLoadingSpinner(false);
            return;
        }

        // Listen for real-time updates to the courses collection
        onSnapshot(coursesRef, (snapshot) => {
            console.log("[DEBUG] Course list snapshot received.");
            courseList.innerHTML = ''; // Clear list on every update
            if (snapshot.empty) {
                noCoursesMessage.classList.remove('hidden');
                historyLoadingSpinner.classList.add('hidden');
                showGlobalLoadingSpinner(false);
                return;
            }

            const courses = [];
            snapshot.forEach(doc => {
                const courseData = doc.data();
                courses.push({ id: doc.id, ...courseData });
            });

            // Apply filters
            const typeFilter = courseTypeFilter.value;
            const levelFilter = courseLevelFilter.value;

            const filteredCourses = courses.filter(course => {
                const matchesType = typeFilter === 'all' || course.cubeType === typeFilter;
                const matchesLevel = levelFilter === 'all' || course.level === levelFilter;
                return matchesType && matchesLevel;
            });

            if (filteredCourses.length === 0) {
                noCoursesMessage.classList.remove('hidden');
            } else {
                noCoursesMessage.classList.add('hidden');
                filteredCourses.forEach(course => {
                    renderCourseCard(course);
                });
            }
            historyLoadingSpinner.classList.add('hidden');
            showGlobalLoadingSpinner(false);
        }, (error) => {
            console.error("Error listening to courses:", error);
            showToast("Error loading courses.", "error");
            historyLoadingSpinner.classList.add('hidden');
            showGlobalLoadingSpinner(false);
        });

    } catch (e) {
        console.error("Error loading course list:", e);
        showToast("Failed to load course list.", "error");
        historyLoadingSpinner.classList.add('hidden');
        showGlobalLoadingSpinner(false);
    }
}

/**
 * Renders a single course card in the lesson hub.
 * @param {Object} course - The course data.
 */
function renderCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'course-card glass-panel p-6 rounded-xl shadow-lg border border-gray-700';
    card.innerHTML = `
        <h3 class="text-xl font-bold text-gradient mb-2">${course.title || 'Untitled Course'}</h3>
        <p class="text-gray-300 text-sm mb-3">${course.description || 'No description provided.'}</p>
        <div class="flex flex-wrap items-center gap-2 text-xs text-gray-400">
            <span class="bg-gray-700 px-2 py-1 rounded-md"><i class="fas fa-cube mr-1"></i> ${course.cubeType || 'N/A'}</span>
            <span class="bg-gray-700 px-2 py-1 rounded-md"><i class="fas fa-signal mr-1"></i> ${course.level || 'N/A'}</span>
            <span class="bg-gray-700 px-2 py-1 rounded-md"><i class="fas fa-layer-group mr-1"></i> ${course.modules ? course.modules.length : 0} Modules</span>
            <span class="bg-gray-700 px-2 py-1 rounded-md"><i class="fas fa-book mr-1"></i> ${course.modules ? course.modules.reduce((acc, mod) => acc + mod.lessons.length, 0) : 0} Lessons</span>
        </div>
        <div class="flex justify-end mt-4 space-x-2">
            <button class="button-secondary text-sm px-3 py-1.5 rounded-lg delete-course-btn" data-id="${course.id}">
                <i class="fas fa-trash-alt"></i> Delete
            </button>
            <button class="button-primary text-sm px-3 py-1.5 rounded-lg start-course-btn" data-id="${course.id}">
                <i class="fas fa-play-circle"></i> Start Course
            </button>
        </div>
    `;
    courseList.appendChild(card);

    card.querySelector('.start-course-btn').addEventListener('click', async () => {
        await loadCourse(course.id);
        showSection(lessonViewer);
    });

    card.querySelector('.delete-course-btn').addEventListener('click', async (event) => {
        event.stopPropagation(); // Prevent start-course-btn from being triggered
        if (confirm("Are you sure you want to delete this course?")) {
            await deleteCourse(course.id);
        }
    });
}

/**
 * Deletes a course from Firestore.
 * @param {string} courseId - The ID of the course to delete.
 */
async function deleteCourse(courseId) {
    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), courseId);
        await deleteDoc(courseDocRef);
        showToast("Course deleted successfully!", "success");
        // No need to reload course list, onSnapshot will handle it
    } catch (e) {
        console.error("Error deleting course:", e);
        showToast("Failed to delete course.", "error");
    }
}

// =====================================================================================================
// --- Course Creation Functions ---
// =====================================================================================================

/**
 * Displays a chat message in the course creation modal.
 * @param {string} sender - 'user' or 'jarvis'.
 * @param {string} message - The message content.
 */
function displayCourseChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', sender === 'user' ? 'user-message' : 'jarvis-message');
    messageElement.innerHTML = `
        <span class="font-bold ${sender === 'user' ? 'text-green-400' : 'text-indigo-400'}">${sender === 'user' ? 'You' : 'Jarvis'}:</span>
        <span class="${sender === 'user' ? 'text-white' : 'text-gray-200'}">${message}</span>
    `;
    courseChatMessages.appendChild(messageElement);
    courseChatMessages.scrollTop = courseChatMessages.scrollHeight; // Auto-scroll to bottom
}

/**
 * Sends a message to the Gemini API for course creation.
 * @param {string} prompt - The user's prompt.
 */
async function sendCourseCreationPrompt(prompt) {
    displayCourseChatMessage('user', prompt);
    courseChatInput.value = '';
    courseChatSpinner.classList.remove('hidden');
    sendCourseChatBtn.disabled = true;

    courseChatHistory.push({ role: "user", parts: [{ text: prompt }] });

    try {
        const payload = {
            contents: courseChatHistory,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "course": {
                            type: "OBJECT",
                            properties: {
                                "title": { "type": "STRING" },
                                "description": { "type": "STRING" },
                                "cubeType": { "type": "STRING", "enum": ["3x3", "2x2", "4x4", "pyraminx"] },
                                "level": { "type": "STRING", "enum": ["beginner", "intermediate", "advanced", "expert"] },
                                "modules": {
                                    "type": "ARRAY",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "moduleTitle": { "type": "STRING" },
                                            "lessons": {
                                                "type": "ARRAY",
                                                "items": {
                                                    "type": "OBJECT",
                                                    "properties": {
                                                        "lessonTitle": { "type": "STRING" },
                                                        "steps": {
                                                            "type": "ARRAY",
                                                            "items": {
                                                                "type": "OBJECT",
                                                                "properties": {
                                                                    "stepTitle": { "type": "STRING" },
                                                                    "content": { "type": "STRING" },
                                                                    "scramble": { "type": "STRING" },
                                                                    "algorithm": { "type": "STRING" },
                                                                    "quiz": {
                                                                        "type": "ARRAY",
                                                                        "items": {
                                                                            "type": "OBJECT",
                                                                            "properties": {
                                                                                "question": { "type": "STRING" },
                                                                                "options": { "type": "ARRAY", "items": { "type": "STRING" } },
                                                                                "correctAnswer": { "type": "STRING" }
                                                                            },
                                                                            "required": ["question", "options", "correctAnswer"]
                                                                        }
                                                                    }
                                                                },
                                                                "required": ["stepTitle", "content"]
                                                            }
                                                        }
                                                    },
                                                    "required": ["lessonTitle", "steps"]
                                                }
                                            }
                                        },
                                        "required": ["moduleTitle", "lessons"]
                                    }
                                }
                            },
                            "required": ["title", "description", "cubeType", "level", "modules"]
                        }
                    }
                }
            }
        };

        const apiKey = ""; // Canvas will provide this
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log("[DEBUG] Gemini API response:", result);

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const jsonString = result.candidates[0].content.parts[0].text;
            let parsedJson;
            try {
                parsedJson = JSON.parse(jsonString);
            } catch (jsonParseError) {
                console.error("JSON parsing error:", jsonParseError, "Raw JSON:", jsonString);
                displayCourseChatMessage('jarvis', "I apologize, Sir Sevindu, but I encountered an error parsing the generated course. The format was not as expected. Could you please try a different prompt or be more specific?");
                courseChatHistory.push({ role: "model", parts: [{ text: "I apologize, Sir Sevindu, but I encountered an error parsing the generated course. The format was not as expected. Could you please try a different prompt or be more specific?" }] });
                return;
            }

            if (parsedJson.course) {
                const newCourse = parsedJson.course;
                // Add default values for lastAccessed indices if not provided by AI
                newCourse.lastAccessedModuleIndex = 0;
                newCourse.lastAccessedLessonIndex = 0;
                newCourse.lastAccessedStepIndex = 0;
                await saveCourse(newCourse);
                displayCourseChatMessage('jarvis', `Excellent, Sir Sevindu! I have designed a new course titled "${newCourse.title}" for ${newCourse.cubeType} at ${newCourse.level} level. You may now close this chat and start the course.`);
                speakAsJarvis(`Excellent, Sir Sevindu! I have designed a new course titled "${newCourse.title}" for ${newCourse.cubeType} at ${newCourse.level} level. You may now close this chat and start the course.`);
                courseChatHistory.push({ role: "model", parts: [{ text: `Excellent, Sir Sevindu! I have designed a new course titled "${newCourse.title}" for ${newCourse.cubeType} at ${newCourse.level} level. You may now close this chat and start the course.` }] });
            } else if (result.candidates[0].content.parts[0].text) {
                // If no structured course, but raw text response, display it as Jarvis's chat
                const rawText = result.candidates[0].content.parts[0].text;
                displayCourseChatMessage('jarvis', rawText);
                courseChatHistory.push({ role: "model", parts: [{ text: rawText }] });
            } else {
                displayCourseChatMessage('jarvis', "I am unable to generate a course based on your request, Sir Sevindu. Please provide more details about the type of course you would like to create (e.g., 'a beginner 3x3 course').");
                courseChatHistory.push({ role: "model", parts: [{ text: "I am unable to generate a course based on your request, Sir Sevindu. Please provide more details about the type of course you would like to create (e.g., 'a beginner 3x3 course')." }] });
            }
        } else {
            displayCourseChatMessage('jarvis', "I encountered an issue generating a response. Please try again.");
            courseChatHistory.push({ role: "model", parts: [{ text: "I encountered an. issue generating a response. Please try again." }] });
        }
    } catch (e) {
        console.error("Error calling Gemini API for course creation:", e);
        displayCourseChatMessage('jarvis', "My apologies, Sir Sevindu. I am experiencing a technical difficulty and cannot generate the course at this moment. Please check your internet connection or try again later.");
        courseChatHistory.push({ role: "model", parts: [{ text: "My apologies, Sir Sevindu. I am experiencing a technical difficulty and cannot generate the course at this moment. Please check your internet connection or try again later." }] });
    } finally {
        courseChatSpinner.classList.add('hidden');
        sendCourseChatBtn.disabled = false;
    }
}


/**
 * Saves a new course to Firestore.
 * @param {Object} courseData - The course data to save.
 */
async function saveCourse(courseData) {
    try {
        const coursesRef = getUserCollectionRef('courses');
        if (!coursesRef) {
            showToast("Failed to save course: Authentication not ready.", "error");
            return;
        }
        const docRef = await addDoc(coursesRef, courseData);
        console.log("Course saved with ID:", docRef.id);
        showToast("Course created successfully!", "success");
        // No need to reload course list, onSnapshot will handle it
    } catch (e) {
        console.error("Error saving course:", e);
        showToast("Failed to save course.", "error");
    }
}

// =====================================================================================================
// --- Lesson Viewer Functions ---
// =====================================================================================================

/**
 * Loads a specific course into the lesson viewer.
 * @param {string} courseId - The ID of the course to load.
 */
async function loadCourse(courseId) {
    showGlobalLoadingSpinner(true);
    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), courseId);
        const courseDoc = await getDoc(courseDocRef);

        if (courseDoc.exists()) {
            currentCourse = { id: courseDoc.id, ...courseDoc.data() };
            console.log("[DEBUG] Loaded Course:", currentCourse);

            currentCourseTitle.textContent = currentCourse.title;
            renderModuleList();
            updateCourseProgressBar();

            // Load the last accessed step, or the very first step if no history
            currentModuleIndex = currentCourse.lastAccessedModuleIndex || 0;
            currentLessonIndex = currentCourse.lastAccessedLessonIndex || 0;
            currentLessonStepIndex = currentCourse.lastAccessedStepIndex || 0;

            // Ensure indices are within bounds
            if (currentModuleIndex >= currentCourse.modules.length) currentModuleIndex = 0;
            const currentModule = currentCourse.modules[currentModuleIndex];
            if (currentModule && currentLessonIndex >= currentModule.lessons.length) currentLessonIndex = 0;
            const currentLesson = currentModule.lessons[currentLessonIndex];
            if (currentLesson && currentLessonStepIndex >= currentLesson.steps.length) currentLessonStepIndex = 0;

            await loadLessonStep(currentModuleIndex, currentLessonIndex, currentLessonStepIndex);
            showSection(lessonViewer);
        } else {
            showToast("Course not found.", "error");
            console.error("Course not found:", courseId);
            showSection(lessonHub); // Go back to hub if course not found
        }
    } catch (e) {
        console.error("Error loading course:", e);
        showToast("Failed to load course details.", "error");
        showSection(lessonHub); // Go back to hub on error
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

/**
 * Renders the list of modules and lessons in the sidebar.
 */
function renderModuleList() {
    moduleList.innerHTML = ''; // Clear existing list
    currentCourse.modules.forEach((module, modIndex) => {
        const moduleItem = document.createElement('li');
        moduleItem.className = 'module-item';
        moduleItem.innerHTML = `
            <div class="module-title flex items-center cursor-pointer p-2 rounded-lg hover:bg-gray-700 transition-colors">
                <i class="fas fa-chevron-right mr-2 transition-transform"></i>
                <span>${module.moduleTitle}</span>
            </div>
            <ul class="lesson-list hidden space-y-1"></ul>
        `;
        const lessonListElement = moduleItem.querySelector('.lesson-list');
        const moduleTitleElement = moduleItem.querySelector('.module-title');
        const chevronIcon = moduleItem.querySelector('.fas.fa-chevron-right');

        module.lessons.forEach((lesson, lessonIndex) => {
            const lessonItem = document.createElement('li');
            lessonItem.className = 'lesson-item text-gray-400 hover:text-white hover:bg-gray-700 px-3 py-1 rounded-md transition-colors';
            lessonItem.textContent = lesson.lessonTitle;
            lessonItem.dataset.modIndex = modIndex;
            lessonItem.dataset.lessonIndex = lessonIndex;
            lessonItem.addEventListener('click', async () => {
                currentModuleIndex = modIndex;
                currentLessonIndex = lessonIndex;
                currentLessonStepIndex = 0; // Reset to first step when changing lesson
                await loadLessonStep(modIndex, lessonIndex, 0);
                updateCourseProgressInFirestore();
            });
            lessonListElement.appendChild(lessonItem);
        });

        moduleTitleElement.addEventListener('click', () => {
            lessonListElement.classList.toggle('hidden');
            lessonListElement.classList.toggle('open'); // For smooth transition
            chevronIcon.classList.toggle('expanded');
        });

        moduleList.appendChild(moduleItem);
    });
    highlightCurrentLesson();
}

/**
 * Highlights the currently active lesson in the sidebar.
 */
function highlightCurrentLesson() {
    moduleList.querySelectorAll('.lesson-item').forEach(item => {
        item.classList.remove('active');
        item.classList.remove('bg-blue-600'); // Remove active background
        item.classList.add('text-gray-400'); // Ensure default text color
    });

    const currentLessonElement = moduleList.querySelector(`[data-mod-index="${currentModuleIndex}"][data-lesson-index="${currentLessonIndex}"]`);
    if (currentLessonElement) {
        currentLessonElement.classList.add('active');
        currentLessonElement.classList.remove('text-gray-400');
        currentLessonElement.classList.add('bg-blue-600'); // Add active background
        // Ensure parent module is expanded
        const parentModuleList = currentLessonElement.closest('.lesson-list');
        if (parentModuleList && parentModuleList.classList.contains('hidden')) {
            parentModuleList.classList.remove('hidden');
            parentModuleList.classList.add('open');
            const parentModuleTitle = parentModuleList.previousElementSibling;
            if (parentModuleTitle) {
                parentModuleTitle.querySelector('.fas.fa-chevron-right').classList.add('expanded');
            }
        }
    }
}

/**
 * Loads a specific step of a lesson.
 * @param {number} modIndex - Module index.
 * @param {number} lessonIndex - Lesson index.
 * @param {number} stepIndex - Step index.
 */
async function loadLessonStep(modIndex, lessonIndex, stepIndex) {
    if (!currentCourse || !currentCourse.modules[modIndex] || !currentCourse.modules[modIndex].lessons[lessonIndex] || !currentCourse.modules[modIndex].lessons[lessonIndex].steps[stepIndex]) {
        showToast("Lesson step not found.", "error");
        return;
    }

    currentModuleIndex = modIndex;
    currentLessonIndex = lessonIndex;
    currentLessonStepIndex = stepIndex;

    const lesson = currentCourse.modules[modIndex].lessons[lessonIndex];
    const step = lesson.steps[stepIndex];

    lessonTitle.textContent = lesson.lessonTitle;
    lessonStepCounter.textContent = `Step ${stepIndex + 1} of ${lesson.steps.length}`;
    lessonContentDisplay.innerHTML = marked.parse(step.content || 'No content for this step.');

    // Handle 3D visualizer
    if (step.scramble || step.algorithm) {
        scramble3DContainer.classList.remove('hidden');
        scramble3DContainer.classList.add('flex');
        scramble3DViewer.puzzle = currentCourse.cubeType || '3x3x3'; // Set puzzle type
        scramble3DViewer.alg = step.scramble || ''; // Set scramble
        scramble3DViewer.alg = step.algorithm || ''; // Set algorithm (will override scramble if both exist)
        // Reset player state
        scramble3DViewer.reset();
        playPreviewBtn.style.display = 'inline-block';
        pausePreviewBtn.style.display = 'none';
    } else {
        scramble3DContainer.classList.add('hidden');
        scramble3DContainer.classList.remove('flex');
    }

    // Handle Quiz
    if (step.quiz && step.quiz.length > 0) {
        quizArea.classList.remove('hidden');
        quizArea.classList.add('flex');
        renderQuiz(step.quiz);
    } else {
        quizArea.classList.add('hidden');
        quizArea.classList.remove('flex');
    }

    // Update navigation buttons visibility
    prevLessonStepBtn.style.display = (stepIndex === 0 && lessonIndex === 0 && modIndex === 0) ? 'none' : 'inline-flex';
    nextLessonStepBtn.style.display = 'inline-flex';
    completeLessonBtn.style.display = 'none';
    lessonCompletionMessage.style.display = 'none';

    // If it's the last step of the last lesson of the last module
    const lastModuleIndex = currentCourse.modules.length - 1;
    const lastLessonIndex = currentCourse.modules[lastModuleIndex].lessons.length - 1;
    const lastStepIndex = currentCourse.modules[lastModuleIndex].lessons[lastLessonIndex].steps.length - 1;

    if (modIndex === lastModuleIndex && lessonIndex === lastLessonIndex && stepIndex === lastStepIndex) {
        nextLessonStepBtn.style.display = 'none';
        completeLessonBtn.style.display = 'inline-flex';
    }

    highlightCurrentLesson();
    // Ensure editor is hidden when viewing content
    lessonEditorContainer.classList.add('hidden');
    lessonContentDisplay.classList.remove('hidden');
    editLessonBtn.textContent = 'Edit'; // Reset edit button text
}

/**
 * Renders the quiz questions for the current step.
 * @param {Array} quizData - Array of quiz questions.
 */
function renderQuiz(quizData) {
    quizQuestionsContainer.innerHTML = '';
    quizFeedback.textContent = '';
    submitQuizBtn.classList.remove('hidden');
    currentQuizAnswers = {}; // Reset answers

    quizData.forEach((q, qIndex) => {
        const questionElement = document.createElement('div');
        questionElement.className = 'question-item bg-gray-800 p-4 rounded-lg shadow-md';
        questionElement.innerHTML = `
            <p class="text-white font-semibold mb-3">${qIndex + 1}. ${q.question}</p>
            <div class="options-container space-y-2"></div>
        `;
        const optionsContainer = questionElement.querySelector('.options-container');

        q.options.forEach((option, oIndex) => {
            const optionElement = document.createElement('label');
            optionElement.className = 'answer-option flex items-center text-gray-300 cursor-pointer hover:bg-gray-700 p-2 rounded-md';
            const inputType = q.correctAnswer.includes(',') ? 'checkbox' : 'radio'; // Simple check for multiple correct answers
            optionElement.innerHTML = `
                <input type="${inputType}" name="question-${qIndex}" value="${option}" class="mr-2">
                <span>${option}</span>
            `;
            optionsContainer.appendChild(optionElement);

            optionElement.querySelector('input').addEventListener('change', (event) => {
                if (inputType === 'radio') {
                    currentQuizAnswers[qIndex] = event.target.value;
                } else {
                    // For checkboxes, store an array of selected options
                    if (!currentQuizAnswers[qIndex]) {
                        currentQuizAnswers[qIndex] = [];
                    }
                    if (event.target.checked) {
                        currentQuizAnswers[qIndex].push(event.target.value);
                    } else {
                        currentQuizAnswers[qIndex] = currentQuizAnswers[qIndex].filter(ans => ans !== event.target.value);
                    }
                }
            });
        });
        quizQuestionsContainer.appendChild(questionElement);
    });
}

/**
 * Submits the quiz and checks answers.
 */
function submitQuiz() {
    let correctCount = 0;
    const quizData = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].quiz;

    quizData.forEach((q, qIndex) => {
        const questionElement = quizQuestionsContainer.children[qIndex];
        const options = questionElement.querySelectorAll('.answer-option');
        const userAnswer = currentQuizAnswers[qIndex];
        const correctAnswers = q.correctAnswer.split(',').map(ans => ans.trim()); // Handle multiple correct answers

        let isQuestionCorrect = false;

        if (Array.isArray(userAnswer)) { // Checkbox
            isQuestionCorrect = userAnswer.length === correctAnswers.length &&
                                userAnswer.every(ans => correctAnswers.includes(ans));
        } else { // Radio
            isQuestionCorrect = (userAnswer === q.correctAnswer);
        }

        if (isQuestionCorrect) {
            correctCount++;
            questionElement.classList.add('correct');
        } else {
            questionElement.classList.add('incorrect');
        }

        // Disable options after submission and show correct answer
        options.forEach(optionElement => {
            optionElement.querySelector('input').disabled = true;
            const optionText = optionElement.querySelector('span').textContent;
            if (correctAnswers.includes(optionText)) {
                optionElement.classList.add('font-bold', 'text-green-300'); // Highlight correct answer
            }
        });
    });

    if (correctCount === quizData.length) {
        quizFeedback.textContent = "Excellent, Sir Sevindu! All answers are correct!";
        quizFeedback.classList.remove('text-red-400');
        quizFeedback.classList.add('text-green-400');
        showToast("Quiz completed successfully!", "success");
    } else {
        quizFeedback.textContent = `You got ${correctCount} out of ${quizData.length} correct. Review the lesson and try again.`;
        quizFeedback.classList.remove('text-green-400');
        quizFeedback.classList.add('text-red-400');
        showToast("Quiz has incorrect answers.", "error");
    }
    submitQuizBtn.classList.add('hidden'); // Hide submit button after submission
}


/**
 * Navigates to the next lesson step.
 */
async function goToNextStep() {
    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];
    if (currentLessonStepIndex < lesson.steps.length - 1) {
        currentLessonStepIndex++;
    } else {
        // Move to next lesson
        if (currentLessonIndex < currentCourse.modules[currentModuleIndex].lessons.length - 1) {
            currentLessonIndex++;
            currentLessonStepIndex = 0;
        } else {
            // Move to next module
            if (currentModuleIndex < currentCourse.modules.length - 1) {
                currentModuleIndex++;
                currentLessonIndex = 0;
                currentLessonStepIndex = 0;
            } else {
                // End of course
                showToast("You have completed the course!", "success");
                completeLessonBtn.style.display = 'inline-flex';
                nextLessonStepBtn.style.display = 'none';
                return;
            }
        }
    }
    await loadLessonStep(currentModuleIndex, currentLessonIndex, currentLessonStepIndex);
    updateCourseProgressInFirestore();
}

/**
 * Navigates to the previous lesson step.
 */
async function goToPreviousStep() {
    if (currentLessonStepIndex > 0) {
        currentLessonStepIndex--;
    } else {
        // Move to previous lesson
        if (currentLessonIndex > 0) {
            currentLessonIndex--;
            currentLessonStepIndex = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps.length - 1;
        } else {
            // Move to previous module
            if (currentModuleIndex > 0) {
                currentModuleIndex--;
                currentLessonIndex = currentCourse.modules[currentModuleIndex].lessons.length - 1;
                currentLessonStepIndex = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps.length - 1;
            } else {
                showToast("You are at the beginning of the course.", "info");
                return;
            }
        }
    }
    await loadLessonStep(currentModuleIndex, currentLessonIndex, currentLessonStepIndex);
    updateCourseProgressInFirestore();
}

/**
 * Marks the current step as completed and updates progress.
 */
async function completeCurrentStep() {
    if (!currentCourse) return;

    const currentStep = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex];
    if (!currentStep.completed) {
        currentStep.completed = true;
        await updateCourseProgressInFirestore();
        showToast("Step marked as complete!", "success");
    } else {
        showToast("Step already completed.", "info");
    }
}

/**
 * Updates the user's progress in the current course in Firestore.
 */
async function updateCourseProgressInFirestore() {
    if (!currentCourse || !db || !userId) return;

    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), currentCourse.id);
        await updateDoc(courseDocRef, {
            lastAccessedModuleIndex: currentModuleIndex,
            lastAccessedLessonIndex: currentLessonIndex,
            lastAccessedStepIndex: currentLessonStepIndex,
            modules: currentCourse.modules // Save the updated modules array (for step completion)
        });
        console.log("[DEBUG] Course progress updated in Firestore.");
        updateCourseProgressBar(); // Update the visual progress bar
    } catch (e) {
        console.error("Error updating course progress:", e);
        showToast("Failed to save progress.", "error");
    }
}

/**
 * Marks the entire course as completed.
 */
async function completeCourse() {
    if (!currentCourse) return;

    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), currentCourse.id);
        await updateDoc(courseDocRef, {
            completed: true,
            completionDate: new Date().toISOString()
        });
        showToast("Course completed! Congratulations, Sir Sevindu!", "success");
        lessonCompletionMessage.textContent = "Course Completed!";
        lessonCompletionMessage.style.display = 'block';
        completeLessonBtn.style.display = 'none';
        speakAsJarvis("Course completed! Congratulations, Sir Sevindu!");
    } catch (e) {
        console.error("Error marking course as complete:", e);
        showToast("Failed to mark course as complete.", "error");
    }
}

/**
 * Toggles the lesson content between display and editor mode.
 */
function toggleLessonEditor() {
    const isEditing = lessonEditorContainer.classList.contains('hidden'); // If hidden, we want to show editor
    const currentStep = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex];

    if (isEditing) {
        // Switch to editor mode
        lessonContentDisplay.classList.add('hidden');
        lessonEditorContainer.classList.remove('hidden');
        editLessonBtn.textContent = 'Preview';

        // Initialize SimpleMDE if it's not already
        if (!simpleMDEInstance) {
            // Ensure SimpleMDE is loaded before initializing
            if (typeof SimpleMDE === 'undefined') {
                console.error("SimpleMDE library not loaded. Cannot initialize editor.");
                showToast("Editor library not loaded. Please try refreshing.", "error");
                return;
            }
            simpleMDEInstance = new SimpleMDE({
                element: lessonMarkdownEditor,
                spellChecker: false,
                hideIcons: ["guide", "fullscreen", "side-by-side"],
                showIcons: ["undo", "redo", "heading", "bold", "italic", "strikethrough", "code", "quote", "unordered-list", "ordered-list", "link", "image", "table"],
                status: false, // Hide status bar
                toolbarTips: true,
            });
            console.log("[DEBUG] SimpleMDE initialized.");
        }
        // Set content to editor
        simpleMDEInstance.value(currentStep.content || '');
    } else {
        // Switch to display mode
        lessonEditorContainer.classList.add('hidden');
        lessonContentDisplay.classList.remove('hidden');
        editLessonBtn.textContent = 'Edit';

        // Update content display with markdown
        lessonContentDisplay.innerHTML = marked.parse(simpleMDEInstance.value() || '');
    }
}

/**
 * Saves the edited lesson content.
 */
async function saveLessonContent() {
    if (!currentCourse || !simpleMDEInstance) return;

    const newContent = simpleMDEInstance.value();
    currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].content = newContent;

    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), currentCourse.id);
        await updateDoc(courseDocRef, {
            modules: currentCourse.modules // Update the entire modules array
        });
        showToast("Lesson content saved!", "success");
        console.log("[DEBUG] Lesson content updated in Firestore.");
        toggleLessonEditor(); // Switch back to display mode
    } catch (e) {
        console.error("Error saving lesson content:", e);
        showToast("Failed to save lesson content.", "error");
    }
}

// =====================================================================================================
// --- In-Lesson Chat Functions ---
// =====================================================================================================

/**
 * Displays a chat message in the in-lesson chat modal.
 * @param {string} sender - 'user' or 'jarvis'.
 * @param {string} message - The message content.
 */
function displayInLessonChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', sender === 'user' ? 'user-message' : 'jarvis-message');
    messageElement.innerHTML = `
        <span class="font-bold ${sender === 'user' ? 'text-green-400' : 'text-indigo-400'}">${sender === 'user' ? 'You' : 'Jarvis'}:</span>
        <span class="${sender === 'user' ? 'text-white' : 'text-gray-200'}">${message}</span>
    `;
    inLessonChatMessages.appendChild(messageElement);
    inLessonChatMessages.scrollTop = inLessonChatMessages.scrollHeight; // Auto-scroll to bottom
}

/**
 * Sends a message to the Gemini API for in-lesson assistance.
 * @param {string} prompt - The user's prompt.
 */
async function sendInLessonChatPrompt(prompt) {
    displayInLessonChatMessage('user', prompt);
    inLessonChatInput.value = '';
    inLessonChatSpinner.classList.remove('hidden');
    sendInLessonChatBtn.disabled = true;

    // Include current lesson context in the chat history
    const currentLessonContext = `
        Current Course: ${currentCourse.title} (${currentCourse.cubeType}, ${currentCourse.level})
        Current Module: ${currentCourse.modules[currentModuleIndex].moduleTitle}
        Current Lesson: ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].lessonTitle}
        Current Step: ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].stepTitle}
        Step Content: ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].content}
        ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].scramble ? `Scramble: ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].scramble}` : ''}
        ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].algorithm ? `Algorithm: ${currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].algorithm}` : ''}
    `;

    const chatPayload = [
        { role: "user", parts: [{ text: `Here is the context of the current lesson step: ${currentLessonContext}\n\nMy question is: ${prompt}` }] }
    ];

    // Add previous chat history for continuity
    chatPayload.unshift(...inLessonChatHistory);

    try {
        const payload = {
            contents: chatPayload,
        };

        const apiKey = ""; // Canvas will provide this
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        console.log("[DEBUG] Gemini API response (in-lesson chat):", result);

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const jarvisResponse = result.candidates[0].content.parts[0].text;
            displayInLessonChatMessage('jarvis', jarvisResponse);
            inLessonChatHistory.push({ role: "user", parts: [{ text: prompt }] }); // Add user prompt to history
            inLessonChatHistory.push({ role: "model", parts: [{ text: jarvisResponse }] }); // Add Jarvis response to history
            speakAsJarvis(jarvisResponse);
        } else {
            displayInLessonChatMessage('jarvis', "I am unable to provide assistance at this moment, Sir Sevindu. Please try again.");
            inLessonChatHistory.push({ role: "user", parts: [{ text: prompt }] });
            inLessonChatHistory.push({ role: "model", parts: [{ text: "I am unable to provide assistance at this moment, Sir Sevindu. Please try again." }] });
        }
    } catch (e) {
        console.error("Error calling Gemini API for in-lesson chat:", e);
        displayInLessonChatMessage('jarvis', "My apologies, Sir Sevindu. I am experiencing a technical difficulty. Please check your internet connection or try again later.");
        inLessonChatHistory.push({ role: "user", parts: [{ text: prompt }] });
        inLessonChatHistory.push({ role: "model", parts: [{ text: "My apologies, Sir Sevindu. I am experiencing a technical difficulty. Please check your internet connection or try again later." }] });
    } finally {
        inLessonChatSpinner.classList.add('hidden');
        sendInLessonChatBtn.disabled = false;
    }
}


// =====================================================================================================
// --- Event Listeners and Initialization ---
// =====================================================================================================

/**
 * Assigns DOM elements and sets up event listeners.
 */
function setupEventListeners() {
    console.log("[DEBUG] lessons.js: Setting up event listeners.");

    // Assign DOM elements
    globalLoadingSpinner = document.getElementById('globalLoadingSpinner');
    lessonHub = document.getElementById('lessonHub');
    lessonViewer = document.getElementById('lessonViewer');
    lessonHistorySection = document.getElementById('lessonHistorySection');

    startNewCourseBtn = document.getElementById('startNewCourseBtn');
    courseTypeFilter = document.getElementById('courseTypeFilter');
    courseLevelFilter = document.getElementById('courseLevelFilter');
    courseList = document.getElementById('courseList');
    noCoursesMessage = document.getElementById('noCoursesMessage');
    historyLoadingSpinner = document.getElementById('historyLoadingSpinner'); // Re-using for course list loading

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

    lessonTitle = document.getElementById('lessonTitle');
    lessonStepCounter = document.getElementById('lessonStepCounter');
    editLessonBtn = document.getElementById('editLessonBtn');
    lessonContentDisplay = document.getElementById('lessonContentDisplay');
    lessonEditorContainer = document.getElementById('lessonEditorContainer');
    lessonMarkdownEditor = document.getElementById('lessonMarkdownEditor');
    cancelEditLessonBtn = document.getElementById('cancelEditLessonBtn');
    saveLessonContentBtn = document.getElementById('saveLessonContentBtn');

    scramble3DContainer = document.getElementById('scramble3DContainer');
    scramble3DViewer = document.getElementById('scramble3DViewer');
    playPreviewBtn = document.getElementById('playPreviewBtn');
    pausePreviewBtn = document.getElementById('pausePreviewBtn');
    stepBackwardBtn = document.getElementById('stepBackwardBtn');
    stepForwardBtn = document.getElementById('stepForwardBtn');
    resetAlgBtn = document.getElementById('resetAlgBtn');
    applyScrambleBtn = document.getElementById('applyScrambleBtn');

    quizArea = document.getElementById('quizArea');
    quizQuestionsContainer = document.getElementById('quizQuestionsContainer');
    quizFeedback = document.getElementById('quizFeedback');
    submitQuizBtn = document.getElementById('submitQuizBtn');

    prevLessonStepBtn = document.getElementById('prevLessonStepBtn');
    nextLessonStepBtn = document.getElementById('nextLessonStepBtn');
    completeLessonBtn = document.getElementById('completeLessonBtn');
    lessonCompletionMessage = document.getElementById('lessonCompletionMessage');

    openInLessonChatBtn = document.getElementById('openInLessonChatBtn');
    inLessonChatContainer = document.getElementById('inLessonChatContainer');
    closeInLessonChatBtn = document.getElementById('closeInLessonChatBtn');
    inLessonChatMessages = document.getElementById('inLessonChatMessages');
    inLessonChatInput = document.getElementById('inLessonChatInput');
    sendInLessonChatBtn = document.getElementById('sendInLessonChatBtn');
    inLessonChatSpinner = document.getElementById('inLessonChatSpinner');

    lessonHistoryList = document.getElementById('lessonHistoryList');
    noLessonsMessage = document.getElementById('noLessonsMessage');


    // Event Listeners
    if (startNewCourseBtn) startNewCourseBtn.addEventListener('click', () => {
        courseCreationModal.classList.remove('hidden');
        courseChatHistory = []; // Clear chat history for new course creation
        courseChatMessages.innerHTML = '';
        displayCourseChatMessage('jarvis', "Greetings, Sir Sevindu. I am ready to assist you in designing a new cubing course. Please tell me what type of cube (e.g., 3x3, Pyraminx), what skill level (e.g., beginner, advanced), and any specific topics or methods you would like to include.");
    });
    if (closeCourseCreationModalBtn) closeCourseCreationModalBtn.addEventListener('click', () => courseCreationModal.classList.add('hidden'));
    if (sendCourseChatBtn) sendCourseChatBtn.addEventListener('click', () => sendCourseCreationPrompt(courseChatInput.value));
    if (courseChatInput) courseChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && courseChatInput.value.trim() !== '') {
            sendCourseCreationPrompt(courseChatInput.value);
        }
    });

    if (courseTypeFilter) courseTypeFilter.addEventListener('change', loadCourseList);
    if (courseLevelFilter) courseLevelFilter.addEventListener('change', loadCourseList);

    if (prevLessonStepBtn) prevLessonStepBtn.addEventListener('click', goToPreviousStep);
    if (nextLessonStepBtn) nextLessonStepBtn.addEventListener('click', goToNextStep);
    if (completeLessonBtn) completeLessonBtn.addEventListener('click', completeCourse);
    if (submitQuizBtn) submitQuizBtn.addEventListener('click', submitQuiz);

    if (editLessonBtn) editLessonBtn.addEventListener('click', toggleLessonEditor);
    if (cancelEditLessonBtn) cancelEditLessonBtn.addEventListener('click', toggleLessonEditor); // Cancel also just toggles back
    if (saveLessonContentBtn) saveLessonContentBtn.addEventListener('click', saveLessonContent);

    // 3D Viewer Controls
    if (playPreviewBtn) playPreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.play();
            playPreviewBtn.style.display = 'none';
            pausePreviewBtn.style.display = 'inline-block';
        } else {
            speakAsJarvis("Pardon me, Sir Sevindu. The 3D visualizer is not ready.");
        }
    });

    if (pausePreviewBtn) pausePreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.pause();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        }
    });

    if (stepBackwardBtn) stepBackwardBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.backward();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        }
    });

    if (stepForwardBtn) stepForwardBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.forward();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        }
    });

    if (resetAlgBtn) resetAlgBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.reset();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        }
    });

    if (applyScrambleBtn) applyScrambleBtn.addEventListener('click', () => {
        if (scramble3DViewer && currentCourse && currentCourse.modules[currentModuleIndex] && currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex] && currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex] && currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].scramble) {
            scramble3DViewer.alg = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].scramble;
            scramble3DViewer.play(); // Play the scramble animation
            playPreviewBtn.style.display = 'none';
            pausePreviewBtn.style.display = 'inline-block';
        } else {
            speakAsJarvis("Pardon me, Sir Sevindu. This step does not have a specific scramble to apply.");
        }
    });

    // In-lesson chat listeners
    if (openInLessonChatBtn) openInLessonChatBtn.addEventListener('click', () => {
        inLessonChatContainer.classList.remove('hidden');
        inLessonChatContainer.classList.add('open');
        inLessonChatMessages.scrollTop = inLessonChatMessages.scrollHeight; // Scroll to bottom on open
    });
    if (closeInLessonChatBtn) closeInLessonChatBtn.addEventListener('click', () => {
        inLessonChatContainer.classList.remove('open');
        inLessonChatContainer.classList.add('hidden');
    });
    if (sendInLessonChatBtn) sendInLessonChatBtn.addEventListener('click', () => sendInLessonChatPrompt(inLessonChatInput.value));
    if (inLessonChatInput) inLessonChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && inLessonChatInput.value.trim() !== '') {
            sendInLessonChatPrompt(inLessonChatInput.value);
        }
    });
}

/**
 * Determines which section to show initially based on user state or last activity.
 */
async function loadInitialView() {
    // For now, always start at the hub. In a more complex app,
    // we might check if a lesson was in progress and resume it directly.
    showSection(lessonHub);
    await loadCourseList(); // Load courses for the hub
    showGlobalLoadingSpinner(false); // Hide global spinner once initial view is set
}


/**
 * Initializes the lessons page by setting up DOM elements and Firebase.
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[DEBUG] lessons.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");
    setupEventListeners(); // Assign DOM elements and add listeners
    await initializeFirebaseAndAuth(); // Initialize Firebase and authentication

    // Initialize Tone.js only after a user gesture (e.g., DOMContentLoaded is often triggered by initial click to page)
    // If audio still doesn't play, a dedicated "play sound" button might be needed.
    try {
        synth = new Tone.Synth().toDestination();
        console.log("[DEBUG] Tone.js Synth initialized.");
    } catch (e) {
        console.warn("[WARN] Tone.js initialization failed:", e.message);
        showToast("Audio playback may not work. Please interact with the page.", "info");
    }
});
