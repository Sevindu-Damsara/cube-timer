// Firebase imports are assumed to be available in the execution environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

console.log("Jarvis systems online. Initializing lesson protocols.");

// --- Global Configuration & Variables ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'cubically-ai-timer';
// CORRECTED: Use the provided __firebase_config global or the valid fallback configuration.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M",
    authDomain: "ubically-timer.firebaseapp.com",
    projectId: "ubically-timer",
    storageBucket: "ubically-timer.appspot.com",
    messagingSenderId: "467118524389",
    appId: "1:467118524389:web:d3455f5be5747be2cb910c"
};

// Firebase Services
let app, db, auth;
let userId = null;
let coursesUnsubscribe = null; // To hold the onSnapshot listener

// DOM Elements
let dom = {}; // Object to hold all DOM element references

// State Management
let state = {
    currentView: 'lessonHub', // 'lessonHub', 'courseCreationSection', 'lessonViewer'
    currentCourse: null,
    currentModuleIndex: 0,
    currentLessonIndex: 0,
    currentLessonStepIndex: 0,
    simpleMDEInstance: null,
    courseChatHistory: [],
    inLessonChatHistory: [],
    currentQuizAnswers: {},
    isAuthReady: false,
};

// --- Core Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM fully loaded and parsed. Commencing setup.");
    assignDomElements();
    setupEventListeners();
    await initializeFirebase();
});

/**
 * Initializes Firebase and sets up authentication.
 */
async function initializeFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        console.log("Firebase services initialized.");

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                console.log(`Authentication state changed. User is present. UID: ${userId}`);
            } else {
                console.log("No user found. Attempting to sign in.");
                try {
                    const token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                    if (token) {
                        await signInWithCustomToken(auth, token);
                        console.log("Signed in with custom token.");
                    } else {
                        await signInAnonymously(auth);
                        console.log("Signed in anonymously.");
                    }
                    userId = auth.currentUser.uid;
                } catch (error) {
                    console.error("Critical authentication error:", error);
                    showToast("Authentication failed. Some features may not work.", "error");
                    userId = `guest-${crypto.randomUUID()}`;
                }
            }
            state.isAuthReady = true;
            await handleInitialView();
        });
    } catch (e) {
        console.error("Firebase initialization failed:", e);
        showToast("Application services could not be initialized.", "error");
    }
}

/**
 * Assigns all necessary DOM elements to the `dom` object.
 */
function assignDomElements() {
    const ids = [
        'sidebar', 'lessonHub', 'courseCreationSection', 'lessonViewer', 'globalLoadingSpinner',
        'startNewCourseBtn', 'courseTypeFilter', 'courseLevelFilter', 'courseListContainer',
        'historyLoadingSpinner', 'noCoursesMessage', 'courseList', 'backToCoursesBtn',
        'courseChatContainer', 'courseChatMessages', 'courseChatInput', 'sendCourseChatBtn', 'courseChatSpinner',
        'courseNavigationSidebar', 'backToHubFromViewerBtn', 'currentCourseTitle', 'courseProgressBarContainer',
        'courseProgressBar', 'moduleList', 'lessonTitle', 'editLessonBtn', 'openInLessonChatBtn',
        'lessonContentDisplay', 'lessonEditorContainer', 'lessonMarkdownEditor', 'cancelEditLessonBtn',
        'saveLessonContentBtn', 'scramble3DContainer', 'scramble3DViewer', 'playPreviewBtn', 'pausePreviewBtn',
        'resetAlgBtn', 'quizArea', 'quizQuestionsContainer', 'quizFeedback', 'submitQuizBtn',
        'prevLessonStepBtn', 'lessonStepCounter', 'nextLessonStepBtn', 'completeCourseBtn',
        'inLessonChatContainer', 'closeInLessonChatBtn', 'inLessonChatMessages', 'inLessonChatInput',
        'sendInLessonChatBtn', 'inLessonChatSpinner', 'toast-container'
    ];
    ids.forEach(id => dom[id] = document.getElementById(id));
    console.log("DOM elements assigned.");
}

/**
 * Sets up all primary event listeners for the application.
 */
function setupEventListeners() {
    dom.startNewCourseBtn.addEventListener('click', async () => {
        // CORRECTED: Resume AudioContext on user gesture to prevent browser warnings.
        if (Tone.context.state !== 'running') {
            await Tone.start();
            console.log("Tone.js AudioContext resumed on user gesture.");
        }
        switchView('courseCreationSection');
    });
    dom.backToCoursesBtn.addEventListener('click', () => switchView('lessonHub'));
    dom.backToHubFromViewerBtn.addEventListener('click', () => switchView('lessonHub'));

    dom.sendCourseChatBtn.addEventListener('click', () => processCourseChatInput());
    dom.courseChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            processCourseChatInput();
        }
    });

    dom.courseTypeFilter.addEventListener('change', () => loadCourseList(true));
    dom.courseLevelFilter.addEventListener('change', () => loadCourseList(true));

    dom.prevLessonStepBtn.addEventListener('click', goToPreviousStep);
    dom.nextLessonStepBtn.addEventListener('click', goToNextStep);
    dom.completeCourseBtn.addEventListener('click', completeCourse);

    dom.submitQuizBtn.addEventListener('click', submitQuiz);

    dom.editLessonBtn.addEventListener('click', toggleLessonEditor);
    dom.cancelEditLessonBtn.addEventListener('click', () => toggleLessonEditor(false));
    dom.saveLessonContentBtn.addEventListener('click', saveLessonContent);

    // 3D Viewer Controls
    dom.playPreviewBtn.addEventListener('click', () => {
        dom.scramble3DViewer.play();
        dom.playPreviewBtn.classList.add('hidden');
        dom.pausePreviewBtn.classList.remove('hidden');
    });
    dom.pausePreviewBtn.addEventListener('click', () => {
        dom.scramble3DViewer.pause();
        dom.pausePreviewBtn.classList.add('hidden');
        dom.playPreviewBtn.classList.remove('hidden');
    });
    dom.resetAlgBtn.addEventListener('click', () => {
        dom.scramble3DViewer.reset();
        dom.pausePreviewBtn.classList.add('hidden');
        dom.playPreviewBtn.classList.remove('hidden');
    });

    // In-Lesson Chat
    dom.openInLessonChatBtn.addEventListener('click', () => dom.inLessonChatContainer.classList.add('open'));
    dom.closeInLessonChatBtn.addEventListener('click', () => dom.inLessonChatContainer.classList.remove('open'));
    dom.sendInLessonChatBtn.addEventListener('click', () => sendInLessonChatPrompt());
    dom.inLessonChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sendInLessonChatPrompt();
        }
    });

    console.log("Event listeners configured.");
}

// --- View & State Management ---

/**
 * Switches the main view of the application.
 * @param {string} viewName - The name of the view to switch to.
 */
function switchView(viewName) {
    console.log(`Switching view to: ${viewName}`);
    state.currentView = viewName;
    ['lessonHub', 'courseCreationSection', 'lessonViewer'].forEach(viewId => {
        if(dom[viewId]) dom[viewId].classList.add('hidden');
    });
    if(dom[viewName]) dom[viewName].classList.remove('hidden');

    if (viewName === 'lessonHub') {
        loadCourseList(true); // Refresh list when returning to hub
    } else if (viewName === 'courseCreationSection') {
        // Reset and prime the course creation chat
        state.courseChatHistory = [];
        dom.courseChatMessages.innerHTML = '';
        displayCourseChatMessage('jarvis', "Greetings, Sir Sevindu. I am ready to design a new cubing course. Please describe your requirements, including cube type, skill level, and any specific topics of interest.");
    }
}

/**
 * Determines the initial view to load.
 */
async function handleInitialView() {
    if (!state.isAuthReady) {
        console.log("Authentication not ready. Deferring initial view load.");
        return;
    }
    console.log("Authentication is ready. Loading initial view.");
    switchView('lessonHub');
}

/**
 * Shows or hides a global loading spinner.
 * @param {boolean} show - True to show, false to hide.
 */
function showGlobalSpinner(show) {
    if (dom.globalLoadingSpinner) {
        dom.globalLoadingSpinner.classList.toggle('hidden', !show);
    }
}

/**
 * Displays a toast notification.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', or 'info'.
 */
function showToast(message, type = 'info') {
    const toastContainer = dom['toast-container'];
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast show`;
    let bgColor = 'bg-blue-500';
    if (type === 'success') bgColor = 'bg-green-500';
    if (type === 'error') bgColor = 'bg-red-500';
    toast.classList.add(bgColor, 'text-white', 'p-3', 'rounded-lg', 'shadow-lg');
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// --- Firestore & Data Handling ---

/**
 * Gets the Firestore collection reference for user-specific data.
 * @param {string} collectionName - The name of the sub-collection.
 * @returns {import("firebase/firestore").CollectionReference | null}
 */
function getUserCollectionRef(collectionName) {
    if (!db || !userId) {
        console.error("Firestore DB or User ID not available.");
        return null;
    }
    return collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
}

/**
 * Loads and displays the list of courses from Firestore.
 * @param {boolean} forceRefresh - If true, re-attaches the snapshot listener.
 */
function loadCourseList(forceRefresh = false) {
    if (!state.isAuthReady) return;
    if (coursesUnsubscribe && !forceRefresh) return; // Already listening
    if (coursesUnsubscribe) coursesUnsubscribe(); // Detach old listener

    dom.historyLoadingSpinner.classList.remove('hidden');
    dom.noCoursesMessage.classList.add('hidden');
    dom.courseList.innerHTML = '';

    const coursesRef = getUserCollectionRef('courses');
    if (!coursesRef) {
        showToast("Cannot load courses: Authentication error.", "error");
        dom.historyLoadingSpinner.classList.add('hidden');
        return;
    }

    coursesUnsubscribe = onSnapshot(query(coursesRef), (snapshot) => {
        console.log(`Received course snapshot with ${snapshot.docs.length} documents.`);
        const courses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const typeFilter = dom.courseTypeFilter.value;
        const levelFilter = dom.courseLevelFilter.value;

        const filteredCourses = courses.filter(course =>
            (typeFilter === 'all' || course.cubeType === typeFilter) &&
            (levelFilter === 'all' || course.level === levelFilter)
        );

        dom.historyLoadingSpinner.classList.add('hidden');
        dom.courseList.innerHTML = '';
        if (filteredCourses.length === 0) {
            dom.noCoursesMessage.classList.remove('hidden');
        } else {
            dom.noCoursesMessage.classList.add('hidden');
            filteredCourses.forEach(renderCourseCard);
        }
    }, (error) => {
        console.error("Error listening to course updates:", error);
        showToast("Failed to load courses in real-time.", "error");
        dom.historyLoadingSpinner.classList.add('hidden');
    });
}

/**
 * Renders a single course card in the lesson hub.
 * @param {object} course - The course data.
 */
function renderCourseCard(course) {
    const card = document.createElement('div');
    card.className = 'course-card';
    const totalLessons = course.modules ? course.modules.reduce((acc, mod) => acc + (mod.lessons ? mod.lessons.length : 0), 0) : 0;

    card.innerHTML = `
        <div>
            <h3 class="text-gradient">${course.title || 'Untitled Course'}</h3>
            <p class="course-description">${course.description || 'No description.'}</p>
        </div>
        <div>
            <div class="course-meta">
                <span><i class="fas fa-cube"></i> ${course.cubeType || 'N/A'}</span>
                <span><i class="fas fa-signal"></i> ${course.level || 'N/A'}</span>
                <span><i class="fas fa-layer-group"></i> ${course.modules ? course.modules.length : 0} Modules</span>
                <span><i class="fas fa-book-open"></i> ${totalLessons} Lessons</span>
            </div>
            <div class="course-card-actions">
                <button class="button-secondary delete-course-btn text-sm !px-3 !py-1.5"><i class="fas fa-trash-alt"></i></button>
                <button class="button-primary start-course-btn text-sm !px-4 !py-1.5">Start Course <i class="fas fa-play-circle ml-2"></i></button>
            </div>
        </div>
    `;
    dom.courseList.appendChild(card);

    card.querySelector('.start-course-btn').addEventListener('click', () => loadCourse(course.id));
    card.querySelector('.delete-course-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Are you sure you want to delete the course "${course.title}"? This action cannot be undone.`)) {
            deleteCourse(course.id);
        }
    });
}

/**
 * Deletes a course from Firestore.
 * @param {string} courseId - The ID of the course to delete.
 */
async function deleteCourse(courseId) {
    showGlobalSpinner(true);
    try {
        await deleteDoc(doc(getUserCollectionRef('courses'), courseId));
        showToast("Course deleted successfully.", "success");
    } catch (e) {
        console.error("Error deleting course:", e);
        showToast("Failed to delete course.", "error");
    } finally {
        showGlobalSpinner(false);
    }
}

// --- AI Course Creation ---

/**
 * Displays a message in the course creation chat.
 * @param {string} sender - 'user' or 'jarvis'.
 * @param {string} message - The message content.
 */
function displayCourseChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${sender === 'user' ? 'user-message' : 'jarvis-message'}`;
    const formattedMessage = marked.parse(message); // Parse markdown
    messageElement.innerHTML = `<span class="font-bold">${sender === 'user' ? 'You' : 'Jarvis'}:</span> ${formattedMessage}`;
    dom.courseChatMessages.appendChild(messageElement);
    dom.courseChatMessages.scrollTop = dom.courseChatMessages.scrollHeight;
}

/**
 * Processes user input for course creation via AI.
 */
async function processCourseChatInput() {
    const prompt = dom.courseChatInput.value.trim();
    if (!prompt) return;

    displayCourseChatMessage('user', prompt);
    state.courseChatHistory.push({ role: "user", parts: [{ text: prompt }] });
    dom.courseChatInput.value = '';
    dom.courseChatSpinner.classList.remove('hidden');
    dom.sendCourseChatBtn.disabled = true;

    try {
        const payload = {
            type: 'generate_course',
            chatHistory: state.courseChatHistory
        };

        const response = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // CORRECTED: Handle non-JSON responses from server errors
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server responded with status ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        
        await saveCourse(result);
        displayCourseChatMessage('jarvis', `Excellent, Sir Sevindu. I have constructed the course framework for "${result.title}". You may now return to the hub to begin.`);

    } catch (e) {
        console.error("Error processing course chat:", e);
        // Display a more informative error message
        const errorMessage = e.message.includes("not valid JSON") 
            ? "My apologies, Sir. The AI service returned an invalid response. This may be a temporary issue."
            : `My apologies, Sir. I encountered an error: ${e.message}`;
        displayCourseChatMessage('jarvis', errorMessage);
    } finally {
        dom.courseChatSpinner.classList.add('hidden');
        dom.sendCourseChatBtn.disabled = false;
    }
}

/**
 * Saves a new course to Firestore.
 * @param {object} courseData - The course data generated by the AI.
 */
async function saveCourse(courseData) {
    showGlobalSpinner(true);
    try {
        const coursesRef = getUserCollectionRef('courses');
        const dataToSave = {
            ...courseData,
            createdAt: new Date().toISOString(),
            lastAccessedModuleIndex: 0,
            lastAccessedLessonIndex: 0,
            lastAccessedStepIndex: 0,
            completed: false,
        };
        await addDoc(coursesRef, dataToSave);
        showToast("Course created successfully!", "success");
    } catch (e) {
        console.error("Error saving course:", e);
        showToast("Failed to save the new course.", "error");
    } finally {
        showGlobalSpinner(false);
    }
}

// --- Lesson Viewer ---

/**
 * Loads a specific course into the lesson viewer.
 * @param {string} courseId - The ID of the course to load.
 */
async function loadCourse(courseId) {
    showGlobalSpinner(true);
    try {
        const courseDoc = await getDoc(doc(getUserCollectionRef('courses'), courseId));
        if (!courseDoc.exists()) {
            throw new Error("Course not found.");
        }
        state.currentCourse = { id: courseDoc.id, ...courseDoc.data() };
        
        state.currentModuleIndex = state.currentCourse.lastAccessedModuleIndex || 0;
        state.currentLessonIndex = state.currentCourse.lastAccessedLessonIndex || 0;
        state.currentLessonStepIndex = state.currentCourse.lastAccessedStepIndex || 0;

        dom.currentCourseTitle.textContent = state.currentCourse.title;
        renderModuleList();
        await loadLessonStep();
        switchView('lessonViewer');
    } catch (e) {
        console.error("Error loading course:", e);
        showToast(e.message, "error");
        switchView('lessonHub');
    } finally {
        showGlobalSpinner(false);
    }
}

/**
 * Renders the list of modules and lessons in the sidebar.
 */
function renderModuleList() {
    dom.moduleList.innerHTML = '';
    if (!state.currentCourse || !state.currentCourse.modules) return;

    state.currentCourse.modules.forEach((module, modIndex) => {
        const moduleItem = document.createElement('div');
        moduleItem.className = 'module-item';
        moduleItem.innerHTML = `
            <div class="module-title">
                <i class="fas fa-chevron-right module-chevron"></i>
                <span>${module.moduleTitle}</span>
            </div>
            <div class="lesson-list hidden"></div>
        `;
        const lessonListEl = moduleItem.querySelector('.lesson-list');
        if (module.lessons) {
            module.lessons.forEach((lesson, lessonIndex) => {
                const lessonItem = document.createElement('div');
                lessonItem.className = 'lesson-item';
                lessonItem.textContent = lesson.lessonTitle;
                lessonItem.dataset.modIndex = modIndex;
                lessonItem.dataset.lessonIndex = lessonIndex;
                lessonItem.addEventListener('click', async () => {
                    state.currentModuleIndex = modIndex;
                    state.currentLessonIndex = lessonIndex;
                    state.currentLessonStepIndex = 0;
                    await loadLessonStep();
                });
                lessonListEl.appendChild(lessonItem);
            });
        }
        moduleItem.querySelector('.module-title').addEventListener('click', (e) => {
            const lessonList = e.currentTarget.nextElementSibling;
            const chevron = e.currentTarget.querySelector('.module-chevron');
            e.currentTarget.classList.toggle('expanded');
            chevron.classList.toggle('rotate-90');
            lessonList.classList.toggle('hidden');
            lessonList.classList.toggle('open');
        });
        dom.moduleList.appendChild(moduleItem);
    });
}

/**
 * Loads a specific step of a lesson into the viewer.
 */
async function loadLessonStep() {
    const { currentCourse, currentModuleIndex, currentLessonIndex, currentLessonStepIndex } = state;
    if (!currentCourse) return;

    const module = currentCourse.modules[currentModuleIndex];
    if (!module || !module.lessons) return;
    const lesson = module.lessons[currentLessonIndex];
    if (!lesson || !lesson.steps) {
        lesson.steps = [{ stepId: crypto.randomUUID(), content: 'This lesson appears to be empty, Sir.' }];
    }
    const step = lesson.steps[currentLessonStepIndex];

    dom.lessonTitle.textContent = lesson.lessonTitle;
    dom.lessonStepCounter.textContent = `Step ${currentLessonStepIndex + 1} of ${lesson.steps.length}`;
    dom.lessonContentDisplay.innerHTML = marked.parse(step.content || '');
    
    dom.scramble3DContainer.classList.add('hidden');
    dom.quizArea.classList.add('hidden');
    
    if (step.algorithm || step.scramble) {
        dom.scramble3DContainer.classList.remove('hidden');
        dom.scramble3DContainer.classList.add('flex');
        dom.scramble3DViewer.puzzle = currentCourse.cubeType || '3x3x3';
        dom.scramble3DViewer.alg = step.algorithm || step.scramble;
        dom.scramble3DViewer.reset();
        dom.pausePreviewBtn.classList.add('hidden');
        dom.playPreviewBtn.classList.remove('hidden');
    }

    if (step.quiz && step.quiz.length > 0) {
        dom.quizArea.classList.remove('hidden');
        dom.quizArea.classList.add('flex');
        renderQuiz(step.quiz);
    }
    
    updateNavigation();
    highlightCurrentLesson();
    updateCourseProgressBar();
    await updateCourseProgressInFirestore();
}

/**
 * Updates the visibility and state of navigation buttons.
 */
function updateNavigation() {
    const { currentCourse, currentModuleIndex, currentLessonIndex, currentLessonStepIndex } = state;
    const isFirstStep = currentModuleIndex === 0 && currentLessonIndex === 0 && currentLessonStepIndex === 0;
    
    const lastModuleIndex = currentCourse.modules.length - 1;
    const lastLessonIndex = currentCourse.modules[lastModuleIndex].lessons.length - 1;
    const lastStepIndex = currentCourse.modules[lastModuleIndex].lessons[lastLessonIndex].steps.length - 1;
    const isLastStep = currentModuleIndex === lastModuleIndex && currentLessonIndex === lastLessonIndex && currentLessonStepIndex === lastStepIndex;

    dom.prevLessonStepBtn.classList.toggle('hidden', isFirstStep);
    dom.nextLessonStepBtn.classList.toggle('hidden', isLastStep);
    dom.completeCourseBtn.classList.toggle('hidden', !isLastStep);
}

/**
 * Highlights the active lesson in the sidebar.
 */
function highlightCurrentLesson() {
    dom.moduleList.querySelectorAll('.lesson-item').forEach(el => el.classList.remove('active'));
    dom.moduleList.querySelectorAll('.module-title').forEach(el => el.classList.remove('expanded'));
    dom.moduleList.querySelectorAll('.lesson-list').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('open');
    });

    const moduleEl = dom.moduleList.children[state.currentModuleIndex];
    if (moduleEl) {
        const moduleTitle = moduleEl.querySelector('.module-title');
        const lessonList = moduleEl.querySelector('.lesson-list');
        moduleTitle.classList.add('expanded');
        lessonList.classList.remove('hidden');
        lessonList.classList.add('open');
        const lessonEl = lessonList.querySelector(`[data-mod-index="${state.currentModuleIndex}"][data-lesson-index="${state.currentLessonIndex}"]`);
        if (lessonEl) {
            lessonEl.classList.add('active');
        }
    }
}

/**
 * Updates the user's progress in Firestore.
 */
async function updateCourseProgressInFirestore() {
    const { currentCourse, currentModuleIndex, currentLessonIndex, currentLessonStepIndex } = state;
    if (!currentCourse) return;

    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), currentCourse.id);
        await updateDoc(courseDocRef, {
            lastAccessedModuleIndex: currentModuleIndex,
            lastAccessedLessonIndex: currentLessonIndex,
            lastAccessedStepIndex: currentLessonStepIndex,
            modules: currentCourse.modules
        });
        console.log("Course progress saved.");
    } catch (e) {
        console.error("Error updating course progress:", e);
        showToast("Failed to save your progress.", "error");
    }
}

/**
 * Updates the visual progress bar based on completed steps.
 */
function updateCourseProgressBar() {
    if (!state.currentCourse || !state.currentCourse.modules) return;
    let totalSteps = 0;
    let completedSteps = 0;
    state.currentCourse.modules.forEach(mod => {
        if(mod.lessons) {
            mod.lessons.forEach(les => {
                if (les.steps) {
                    totalSteps += les.steps.length;
                    les.steps.forEach(step => {
                        if (step.completed) completedSteps++;
                    });
                }
            });
        }
    });
    const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
    dom.courseProgressBar.style.width = `${progress}%`;
}


// --- Lesson Step Navigation and Completion ---

async function goToNextStep() {
    const { currentCourse, currentModuleIndex, currentLessonIndex, currentLessonStepIndex } = state;
    const lesson = currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex];

    // Mark current step as complete before moving
    if (lesson.steps && lesson.steps[currentLessonStepIndex]) {
        lesson.steps[currentLessonStepIndex].completed = true;
    }

    if (currentLessonStepIndex < lesson.steps.length - 1) {
        state.currentLessonStepIndex++;
    } else if (currentLessonIndex < currentCourse.modules[currentModuleIndex].lessons.length - 1) {
        state.currentLessonIndex++;
        state.currentLessonStepIndex = 0;
    } else if (currentModuleIndex < currentCourse.modules.length - 1) {
        state.currentModuleIndex++;
        state.currentLessonIndex = 0;
        state.currentLessonStepIndex = 0;
    }
    await loadLessonStep();
}

async function goToPreviousStep() {
    const { currentCourse, currentModuleIndex, currentLessonIndex, currentLessonStepIndex } = state;

    if (currentLessonStepIndex > 0) {
        state.currentLessonStepIndex--;
    } else if (currentLessonIndex > 0) {
        state.currentLessonIndex--;
        const prevLesson = currentCourse.modules[currentModuleIndex].lessons[state.currentLessonIndex];
        state.currentLessonStepIndex = prevLesson.steps.length - 1;
    } else if (currentModuleIndex > 0) {
        state.currentModuleIndex--;
        const prevModule = currentCourse.modules[state.currentModuleIndex];
        state.currentLessonIndex = prevModule.lessons.length - 1;
        const prevLesson = prevModule.lessons[state.currentLessonIndex];
        state.currentLessonStepIndex = prevLesson.steps.length - 1;
    }
    await loadLessonStep();
}

async function completeCourse() {
    if (!state.currentCourse) return;
    showGlobalSpinner(true);
    try {
        // Mark the final step as complete
        const lastModule = state.currentCourse.modules[state.currentCourse.modules.length - 1];
        const lastLesson = lastModule.lessons[lastModule.lessons.length - 1];
        if (lastLesson.steps && lastLesson.steps.length > 0) {
            const lastStep = lastLesson.steps[lastLesson.steps.length - 1];
            lastStep.completed = true;
        }

        const courseDocRef = doc(getUserCollectionRef('courses'), state.currentCourse.id);
        await updateDoc(courseDocRef, {
            completed: true,
            completionDate: new Date().toISOString(),
            modules: state.currentCourse.modules // Save final completion status
        });
        showToast("Course completed! Congratulations!", "success");
        updateCourseProgressBar();
        switchView('lessonHub');
    } catch (e) {
        console.error("Error completing course:", e);
        showToast("Failed to mark course as complete.", "error");
    } finally {
        showGlobalSpinner(false);
    }
}


// --- Quiz Logic ---
function renderQuiz(quizData) {
    dom.quizQuestionsContainer.innerHTML = '';
    dom.quizFeedback.textContent = '';
    dom.submitQuizBtn.classList.remove('hidden');
    state.currentQuizAnswers = {};

    quizData.forEach((q, qIndex) => {
        const questionElement = document.createElement('div');
        questionElement.className = 'question-item';
        questionElement.innerHTML = `<p>${qIndex + 1}. ${q.question}</p>`;
        const optionsContainer = document.createElement('div');
        
        q.options.forEach(option => {
            const isMulti = Array.isArray(q.answer);
            const inputType = isMulti ? 'checkbox' : 'radio';
            const optionId = `q${qIndex}-opt-${option.replace(/\s+/g, '-')}`;
            
            const optionLabel = document.createElement('label');
            optionLabel.className = 'answer-option';
            optionLabel.setAttribute('for', optionId);
            optionLabel.innerHTML = `
                <input type="${inputType}" id="${optionId}" name="question-${qIndex}" value="${option}">
                <span>${option}</span>
            `;
            optionsContainer.appendChild(optionLabel);
        });
        questionElement.appendChild(optionsContainer);
        dom.quizQuestionsContainer.appendChild(questionElement);
    });
}

function submitQuiz() {
    const quizData = state.currentCourse.modules[state.currentModuleIndex].lessons[state.currentLessonIndex].steps[state.currentLessonStepIndex].quiz;
    let correctCount = 0;

    // First, gather all user answers
    quizData.forEach((q, qIndex) => {
        const inputs = dom.quizQuestionsContainer.querySelectorAll(`[name="question-${qIndex}"]:checked`);
        if (Array.isArray(q.answer)) { // Checkbox
            state.currentQuizAnswers[qIndex] = Array.from(inputs).map(input => input.value);
        } else { // Radio
            state.currentQuizAnswers[qIndex] = inputs.length > 0 ? inputs[0].value : undefined;
        }
    });

    // Now, check answers and provide feedback
    quizData.forEach((q, qIndex) => {
        const userAnswer = state.currentQuizAnswers[qIndex];
        let isCorrect = false;
        const correctAnswers = Array.isArray(q.answer) ? q.answer : [q.answer];

        if (Array.isArray(userAnswer)) { // Multi-choice
            isCorrect = userAnswer.length === correctAnswers.length && userAnswer.every(ans => correctAnswers.includes(ans));
        } else { // Single-choice
            isCorrect = userAnswer === correctAnswers[0];
        }

        if (isCorrect) correctCount++;
        
        // Visually mark options
        const optionInputs = dom.quizQuestionsContainer.querySelectorAll(`[name="question-${qIndex}"]`);
        optionInputs.forEach(input => {
            const parentLabel = input.closest('.answer-option');
            
            if (correctAnswers.includes(input.value)) {
                parentLabel.classList.add('reveal-correct');
            }
            if (input.checked && !correctAnswers.includes(input.value)) {
                parentLabel.classList.add('incorrect');
            }
            input.disabled = true;
        });
    });

    if (correctCount === quizData.length) {
        dom.quizFeedback.textContent = "Excellent! All answers are correct.";
        dom.quizFeedback.className = 'text-center font-semibold mb-4 text-green-400';
    } else {
        dom.quizFeedback.textContent = `You got ${correctCount} of ${quizData.length} correct. Review the correct answers.`;
        dom.quizFeedback.className = 'text-center font-semibold mb-4 text-yellow-400';
    }
    dom.submitQuizBtn.classList.add('hidden');
}


// --- Editor & In-Lesson Chat ---
function toggleLessonEditor(forceClose = null) {
    const isEditing = !dom.lessonEditorContainer.classList.contains('hidden');
    
    if (forceClose === false || (forceClose === null && isEditing)) { // Close editor
        dom.lessonEditorContainer.classList.add('hidden');
        dom.lessonContentDisplay.classList.remove('hidden');
        dom.editLessonBtn.innerHTML = '<i class="fas fa-pencil-alt mr-2"></i>Edit';
        dom.lessonContentDisplay.innerHTML = marked.parse(state.simpleMDEInstance.value());
    } else { // Open editor
        dom.lessonContentDisplay.classList.add('hidden');
        dom.lessonEditorContainer.classList.remove('hidden');
        dom.editLessonBtn.innerHTML = '<i class="fas fa-eye mr-2"></i>Preview';
        if (!state.simpleMDEInstance) {
            state.simpleMDEInstance = new SimpleMDE({
                element: dom.lessonMarkdownEditor,
                spellChecker: false,
                status: false,
            });
        }
        const currentContent = state.currentCourse.modules[state.currentModuleIndex].lessons[state.currentLessonIndex].steps[state.currentLessonStepIndex].content;
        state.simpleMDEInstance.value(currentContent || '');
    }
}

async function saveLessonContent() {
    if (!state.currentCourse || !state.simpleMDEInstance) return;
    showGlobalSpinner(true);
    const newContent = state.simpleMDEInstance.value();
    state.currentCourse.modules[state.currentModuleIndex].lessons[state.currentLessonIndex].steps[state.currentLessonStepIndex].content = newContent;

    try {
        await updateCourseProgressInFirestore();
        showToast("Lesson content saved!", "success");
        toggleLessonEditor(false); // Close the editor
    } catch (e) {
        showToast("Failed to save content.", "error");
    } finally {
        showGlobalSpinner(false);
    }
}

async function sendInLessonChatPrompt() {
    const prompt = dom.inLessonChatInput.value.trim();
    if (!prompt) return;

    displayInLessonChatMessage('user', prompt);
    state.inLessonChatHistory.push({ role: 'user', parts: [{ text: prompt }] });
    dom.inLessonChatInput.value = '';
    dom.inLessonChatSpinner.classList.remove('hidden');
    dom.sendInLessonChatBtn.disabled = true;

    try {
        const currentStep = state.currentCourse.modules[state.currentModuleIndex].lessons[state.currentLessonIndex].steps[state.currentLessonStepIndex];
        const payload = {
            type: 'lesson_chat',
            chatHistory: state.inLessonChatHistory,
            currentLessonContext: {
                lessonTitle: state.currentCourse.modules[state.currentModuleIndex].lessons[state.currentLessonIndex].lessonTitle,
                content: currentStep.content,
                algorithm: currentStep.algorithm,
                scramble: currentStep.scramble,
            }
        };

        const response = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server responded with status ${response.status}: ${errorText}`);
        }

        const result = await response.json();

        displayInLessonChatMessage('jarvis', result.message);
        state.inLessonChatHistory.push({ role: 'model', parts: [{ text: result.message }] });

    } catch (e) {
        console.error("Error with in-lesson chat:", e);
        const errorMessage = e.message.includes("not valid JSON") 
            ? "My apologies, Sir. The AI service returned an invalid response."
            : `My apologies, Sir. I am unable to assist at this moment. ${e.message}`;
        displayInLessonChatMessage('jarvis', errorMessage);
    } finally {
        dom.inLessonChatSpinner.classList.add('hidden');
        dom.sendInLessonChatBtn.disabled = false;
    }
}

function displayInLessonChatMessage(sender, message) {
    const messageElement = document.createElement('div');
    messageElement.className = `chat-message ${sender === 'user' ? 'user-message' : 'jarvis-message'}`;
    messageElement.innerHTML = `<span class="font-bold">${sender === 'user' ? 'You' : 'Jarvis'}:</span> ${marked.parse(message)}`;
    dom.inLessonChatMessages.appendChild(messageElement);
    dom.inLessonChatMessages.scrollTop = dom.inLessonChatMessages.scrollHeight;
}
