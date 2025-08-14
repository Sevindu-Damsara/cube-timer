// Course creation is now handled by the new courseCreationSection code

function showGeneratedCourse(course) {
    // Hide chat, show a full-screen course view (reuse lessonViewer or create a new section)
    courseBuilderChatSection.classList.add('hidden');
    let courseViewSection = document.getElementById('aiGeneratedCourseView');
    if (!courseViewSection) {
        courseViewSection = document.createElement('section');
        courseViewSection.id = 'aiGeneratedCourseView';
        document.body.appendChild(courseViewSection);
    }
    // Remove all classes and force full viewport with inline styles
    courseViewSection.removeAttribute('class');
    Object.assign(courseViewSection.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '9998', // below spinner overlay
        background: 'rgba(0,0,0,0.95)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        width: '100vw',
        height: '100vh',
        minWidth: '100vw',
        minHeight: '100vh',
        maxWidth: '100vw',
        maxHeight: '100vh',
        overflow: 'auto',
        borderRadius: '0',
        boxShadow: '0 0 40px #000',
        padding: '0',
        margin: '0',
    });
    courseViewSection.innerHTML = `
        <div style="width:100vw;height:100vh;min-height:100vh;min-width:100vw;max-width:100vw;max-height:100vh;display:flex;flex-direction:column;background:rgba(17,24,39,0.98);border-radius:0;box-shadow:0 0 40px #000;">
            <div class="flex items-center justify-between p-4 border-b border-gray-700 sticky top-0 bg-gray-900 bg-opacity-95 z-10">
                <h2 class="text-2xl font-bold text-gradient">${course.title}</h2>
                <button id="closeGeneratedCourseBtn" class="button-secondary"><i class="fas fa-arrow-left"></i> Back</button>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                <div class="text-lg text-gray-200 mb-2">${course.description || ''}</div>
                ${course.modules.map(module => `
                    <div class="mb-6">
                        <h3 class="text-xl font-bold text-gradient mb-2">${module.module_title}</h3>
                        <ul class="list-disc ml-6">
                            ${module.lessons.map(lesson => `<li class="mb-2"><span class="font-semibold">${lesson.lesson_title}:</span> ${lesson.content || ''}</li>`).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    courseViewSection.querySelector('#closeGeneratedCourseBtn').onclick = () => {
        courseViewSection.remove();
        courseBuilderChatSection.classList.remove('hidden');
    };
}
// --- AI Course Builder Chat Event Listeners ---
window.addEventListener('DOMContentLoaded', () => {
    courseBuilderChatSection = document.getElementById('aiCourseBuilderChat');
    closeCourseBuilderBtn = document.getElementById('closeCourseBuilderBtn');
    courseBuilderChatMessages = document.getElementById('courseBuilderChatMessages');
    courseBuilderChatInput = document.getElementById('courseBuilderChatInput');
    // Create New Course button now opens the courseCreationSection
    const startNewCourseBtn = document.getElementById('startNewCourseBtn');
    if (startNewCourseBtn) startNewCourseBtn.addEventListener('click', () => {
        showSection(courseCreationSection);
        courseChatHistory = [];
        courseChatMessages.innerHTML = '';
        displayCourseChatMessage('jarvis', "Greetings, Sir Sevindu. I am ready to assist you in designing a new cubing course. Please tell me what type of cube (e.g., 3x3, Pyraminx), what skill level (e.g., beginner, advanced), and any specific topics or methods you would like to include.");
    });
});
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
const firebaseConfig = {
  apiKey: "AIzaSyBi8BkZJnpW4WI71g5Daa8KqNBI1DjcU_M",
  authDomain: "ubically-timer.firebaseapp.com",
  databaseURL: "[https://ubically-timer-default-rtdb.firebaseio.com](https://ubically-timer-default-rtdb.firebaseio.com)",
  projectId: "ubically-timer",
  storageBucket: "ubically-timer.firebasestorage.app",
  messagingSenderId: "467118524389",
  appId: "1:467118524389:web:d3455f5be5747be2cb910c",
  measurementId: "G-6033SRP9WC"
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
let courseCreationSection, backToCoursesBtn, courseChatContainer, courseChatMessages, courseChatInput, sendCourseChatBtn, courseChatSpinner; // Renamed from courseCreationModal
let courseNavigationSidebar, currentCourseTitle, courseProgressBarContainer, courseProgressBar, moduleList;
let lessonTitle, lessonStepCounter, editLessonBtn, lessonContentDisplay, lessonEditorContainer, lessonMarkdownEditor, cancelEditLessonBtn, saveLessonContentBtn;
let scramble3DContainer, playPreviewBtn, pausePreviewBtn, stepBackwardBtn, stepForwardBtn, resetAlgBtn, applyScrambleBtn;
let quizArea, quizQuestionsContainer, quizFeedback, submitQuizBtn;
let prevLessonStepBtn, nextLessonStepBtn, completeLessonBtn, lessonCompletionMessage;
let openInLessonChatBtn, inLessonChatContainer, closeInLessonChatBtn, inLessonChatMessages, inLessonChatInput, sendInLessonChatBtn, inLessonChatSpinner;
let lessonHistoryList, noLessonsMessage, historyLoadingSpinner;

// --- AI Lesson State ---
let aiCurrentLesson = null;
let aiCurrentStep = 0;


// --- AI Lesson Utility Functions ---
function aiShowLoading(show) {
    if (globalLoadingSpinner) globalLoadingSpinner.classList.toggle('hidden', !show);
}

function aiShowToast(msg, type = "info") {
    showToast(msg, type); // Use existing toast
}

function aiRenderLessonSteps(steps) {
    const lessonStepsList = document.getElementById('lessonStepsList');
    if (!lessonStepsList) return;
    lessonStepsList.innerHTML = "";
    steps.forEach((step, idx) => {
        const li = document.createElement("div");
        li.className = `lesson-step-card card ${idx === aiCurrentStep ? "active" : ""}`;
        li.innerHTML = `<span class='font-bold'>Step ${idx + 1}:</span> ${step.title || step}`;
        li.onclick = () => {
            aiCurrentStep = idx;
            aiRenderCurrentStep();
        };
        lessonStepsList.appendChild(li);
    });
}

function aiRenderCurrentStep() {
    if (!aiCurrentLesson || !aiCurrentLesson.steps) return;
    const step = aiCurrentLesson.steps[aiCurrentStep];
    const stepContent = document.getElementById('stepContent');
    if (stepContent) stepContent.innerHTML = step.content || step;
    const stepCounter = document.getElementById('stepCounter');
    if (stepCounter) stepCounter.innerText = `${aiCurrentStep + 1} / ${aiCurrentLesson.steps.length}`;
    aiRenderLessonSteps(aiCurrentLesson.steps);
}

function aiRenderLessonCard(lesson, opts = {}) {
    // Card for a lesson (for saved/viewed)
    const card = document.createElement("div");
    card.className = "course-card flex flex-col gap-2 mb-4";
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <h3 class="font-bold text-lg">${lesson.title || "AI Lesson"}</h3>
            <div class="flex gap-2">
                <button class="favorite-btn" title="Save to Favorites"><i class="fa${lesson.favorite ? 's' : 'r'} fa-heart"></i></button>
                <button class="share-btn" title="Share Lesson"><i class="fas fa-share-alt"></i></button>
            </div>
        </div>
        <div class="course-description">${lesson.description || ""}</div>
        <div class="course-meta">
            <span><i class="fas fa-layer-group"></i> ${lesson.skillLevel || "-"}</span>
            <span><i class="fas fa-cube"></i> ${lesson.lessonType || "-"}</span>
        </div>
        <button class="button-primary view-btn">View Lesson</button>
    `;
    card.querySelector(".favorite-btn").onclick = (e) => {
        e.stopPropagation();
        aiToggleFavoriteLesson(lesson);
    };
    card.querySelector(".share-btn").onclick = (e) => {
        e.stopPropagation();
        aiShareLesson(lesson);
    };
    card.querySelector(".view-btn").onclick = () => {
        aiViewLesson(lesson);
    };
    return card;
}



function aiToggleFavoriteLesson(lesson) {
    if (!aiUser) return aiShowToast("Sign in to save lessons", "error");
    lesson.favorite = !lesson.favorite;
    if (lesson.favorite) {
        aiSavedLessons.push(lesson);
        aiSaveLessonToFirebase(lesson);
        aiShowToast("Lesson saved!", "success");
    } else {
        aiSavedLessons = aiSavedLessons.filter(l => l.id !== lesson.id);
        aiRemoveLessonFromFirebase(lesson);
        aiShowToast("Lesson removed from favorites", "info");
    }
    aiRenderSavedLessons();
}

function aiShareLesson(lesson) {
    // Share via link and social
    const url = `${window.location.origin}/lessons.html?lessonId=${lesson.id}`;
    if (navigator.share) {
        navigator.share({ title: lesson.title, text: lesson.description, url });
    } else {
        navigator.clipboard.writeText(url);
        aiShowToast("Lesson link copied!", "success");
    }
}

function aiViewLesson(lesson) {
    aiCurrentLesson = lesson;
    aiCurrentStep = 0;
    if (lessonHub) lessonHub.classList.add("hidden");
    if (lessonViewer) lessonViewer.classList.remove("hidden");
    if (lessonTitle) lessonTitle.innerText = lesson.title;
    aiRenderCurrentStep();
}

function aiCloseLessonViewer() {
    if (lessonViewer) lessonViewer.classList.add("hidden");
    if (lessonHub) lessonHub.classList.remove("hidden");
}

// --- Firebase Integration for AI Lessons ---
async function aiFetchUserHistory(uid) {
    const docRef = doc(db, "users", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        return docSnap.data().history || [];
    }
    return [];
}

async function aiSaveLessonToFirebase(lesson) {
    if (!aiUser) return;
    const userRef = doc(db, "users", aiUser.uid);
    await updateDoc(userRef, { savedLessons: arrayUnion(lesson) });
}

async function aiRemoveLessonFromFirebase(lesson) {
    if (!aiUser) return;
    // Remove lesson by id (requires a cloud function or manual update for array removal)
    // For demo, just reload saved lessons
    await aiLoadSavedLessons();
}

async function aiLoadSavedLessons() {
    if (!aiUser) return;
    const docRef = doc(db, "users", aiUser.uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        aiSavedLessons = (docSnap.data().savedLessons || []).map(l => ({ ...l, favorite: true }));
    } else {
        aiSavedLessons = [];
    }
    aiRenderSavedLessons();
}

// --- AI Lesson Generation ---
async function aiGeneratePersonalizedLesson() {
    if (!aiUser) return aiShowToast("Sign in to generate personalized lessons", "error");
    aiShowLoading(true);
    try {
        // Fetch user history for personalization
        aiUserHistory = await aiFetchUserHistory(aiUser.uid);
        const skillLevel = aiSkillLevelSelect.value;
        const lessonType = aiLessonTypeSelect.value;
        // Compose prompt for Gemini
        const prompt = `Generate a personalized Rubik's Cube lesson for a user with the following history: ${JSON.stringify(aiUserHistory)}. Skill level: ${skillLevel}. Lesson type: ${lessonType}. Return a JSON with title, description, and steps (each step with title and content).`;
        const response = await fetch("/api/gemini-nlu.py", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt })
        });
        if (!response.ok) throw new Error("AI lesson generation failed");
        const data = await response.json();
        if (!data || !data.title || !data.steps) throw new Error("Invalid lesson format");
        // Assign a unique id for saving/sharing
        const lesson = {
            ...data,
            id: `lesson_${Date.now()}`,
            skillLevel,
            lessonType,
            favorite: false
        };
        aiCurrentLesson = lesson;
        aiCurrentStep = 0;
        aiViewLesson(lesson);
        aiShowToast("Lesson generated!", "success");
    } catch (err) {
        aiShowToast(err.message, "error");
    } finally {
        aiShowLoading(false);
    }
}



// --- AI Lesson Event Listeners ---


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
        // Always force full viewport and z-index above course view
        globalLoadingSpinner.classList.toggle('hidden', !show);
        globalLoadingSpinner.classList.toggle('flex', show);
        Object.assign(globalLoadingSpinner.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '9999',
            width: '100vw',
            height: '100vh',
            minWidth: '100vw',
            minHeight: '100vh',
            maxWidth: '100vw',
            maxHeight: '100vh',
            display: show ? 'flex' : 'none',
            justifyContent: 'center',
            alignItems: 'center',
            background: 'rgba(0,0,0,0.5)',
            margin: '0',
            padding: '0',
        });
    }
}

/**
 * Hides all main sections and resets specific elements.
 */
function hideAllSections() {
    console.log("[DEBUG] Hiding all sections.");
    const sections = [lessonHub, lessonViewer, lessonHistorySection, courseCreationSection];
    sections.forEach(section => {
        if (section) { // Ensure element exists
            section.style.display = 'none';
            // Removed visibility, height, overflow manipulation here
        }
    });

    // Explicitly clear text content and hide buttons for lessonViewer elements
    // to prevent residual display when lessonViewer is hidden.
    if (currentCourseTitle) currentCourseTitle.textContent = '';
    if (lessonTitle) lessonTitle.textContent = '';
    if (lessonStepCounter) lessonStepCounter.textContent = '';
    
    // Hide navigation buttons
    if (prevLessonStepBtn) prevLessonStepBtn.style.display = 'none';
    if (editLessonBtn) editLessonBtn.style.display = 'none';
    if (openInLessonChatBtn) openInLessonChatBtn.style.display = 'none';
    if (nextLessonStepBtn) nextLessonStepBtn.style.display = 'none';
    if (completeLessonBtn) completeLessonBtn.style.display = 'none';
    if (lessonCompletionMessage) lessonCompletionMessage.style.display = 'none';
    if (scramble3DContainer) scramble3DContainer.style.display = 'none';
    if (quizArea) quizArea.style.display = 'none';

    // Also hide the in-lesson chat modal if open
    if (inLessonChatContainer) inLessonChatContainer.style.display = 'none';
}

/**
 * Shows a specific section.
 * @param {HTMLElement} sectionElement - The section to show.
 */
function showSection(sectionElement) {
    console.log(`[DEBUG] Attempting to show section: ${sectionElement.id}`);
    hideAllSections(); // Ensure all are hidden first

    if (sectionElement) { // Ensure element exists
        // Reset aggressive hiding styles when showing a section
        // Only manage 'display' property
        if (sectionElement === lessonViewer) {
            sectionElement.style.display = 'grid'; // lessonViewer uses grid layout
            // Ensure buttons are visible when lessonViewer is active
            if (prevLessonStepBtn) prevLessonStepBtn.style.display = 'inline-flex';
            if (editLessonBtn) editLessonBtn.style.display = 'inline-flex';
            if (openInLessonChatBtn) openInLessonChatBtn.style.display = 'inline-flex';
            if (nextLessonStepBtn) nextLessonStepBtn.style.display = 'inline-flex';
        } else {
            sectionElement.style.display = 'flex'; // Other sections use flex layout
        }
    }
    console.log(`[DEBUG] Section ${sectionElement.id} display style after show: ${sectionElement.style.display}`);
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
        if (module.lessons) { // Defensive check
            module.lessons.forEach(lesson => {
                if (lesson.steps) { // Defensive check
                    lesson.steps.forEach(step => {
                        totalSteps++;
                        if (step.completed) {
                            completedSteps++;
                        }
                    });
                }
            });
        }
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
            console.log("[DEBUG] Auth ready, calling loadInitialView().");
            await loadInitialView(); // Load initial view after auth is ready
        });
    } catch (e) {
        console.error("[ERROR] Firebase initialization failed:", e);
        showToast("Failed to initialize application services.", "error");
        // Proceed as guest if Firebase init fails
        userId = `guest-${crypto.randomUUID()}`;
        isAuthReady = true;
        isUserAuthenticated = false;
        console.log("[DEBUG] Firebase init failed, proceeding as guest and calling loadInitialView().");
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
    console.log("[DEBUG] loadCourseList() called.");
    // Show spinner before loading
    historyLoadingSpinner.classList.remove('hidden');
    noCoursesMessage.classList.add('hidden');
    courseList.innerHTML = '';
    courseList.style.visibility = 'hidden';


    try {
        const coursesRef = getUserCollectionRef('courses');
        if (!coursesRef) {
            showToast("Failed to load courses: Authentication not ready.", "error");
            historyLoadingSpinner.classList.add('hidden');
            showGlobalLoadingSpinner(false);
            return;
        }

        console.log("[DEBUG] Setting up onSnapshot listener for courses.");
        // Listen for real-time updates to the courses collection
        onSnapshot(coursesRef, (snapshot) => {
            console.log("[DEBUG] Course list snapshot received. Number of documents:", snapshot.docs.length);
            courseList.innerHTML = ''; // Clear list on every update
            
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
                return matchesType && matchesLevel; // Corrected logic here
            });

            if (filteredCourses.length === 0) {
                noCoursesMessage.classList.remove('hidden');
                courseList.style.visibility = 'hidden';
            } else {
                noCoursesMessage.classList.add('hidden');
                courseList.style.visibility = 'visible';
                filteredCourses.forEach(course => {
                    renderCourseCard(course);
                });
            }
            // Always hide spinner after rendering
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
    console.log("[DEBUG] Full course object being rendered:", course); // Diagnostic log: This will show the full course object
    const card = document.createElement('div');
    // Removed 'cursor: pointer' from the card's class list
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
        <div class="flex justify-end mt-4 space-x-2 course-card-actions">
            <button class="button-secondary text-sm px-3 py-1.5 rounded-lg delete-course-btn" data-id="${course.id}">
                <i class="fas fa-trash-alt"></i> Delete
            </button>
            <button class="button-primary text-sm px-3 py-1.5 rounded-lg start-course-btn" data-id="${course.id}">
                <i class="fas fa-play-circle"></i> Start Course
            </button>
        </div>
    `;
    courseList.appendChild(card);

    const startButton = card.querySelector('.start-course-btn');
    const deleteButton = card.querySelector('.delete-course-btn');

    if (startButton) {
        console.log(`[DEBUG] Found Start button for course ID: ${course.id}. Attaching listener.`); // NEW LOG
        startButton.addEventListener('click', async (event) => { // Added event parameter
            event.stopPropagation(); // Prevent click from bubbling up to the card
            console.log(`[DEBUG] Start Course button CLICKED for ID: ${course.id}`); // Renamed for clarity
            await loadCourse(course.id);
            showSection(lessonViewer);
        });
    } else {
        console.error("[ERROR] Start Course button element NOT FOUND for course:", course.id);
    }

    if (deleteButton) {
        console.log(`[DEBUG] Found Delete button for course ID: ${course.id}. Attaching listener.`); // NEW LOG
        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation(); // Prevent start-course-btn from being triggered
            console.log(`[DEBUG] Delete Course button CLICKED for ID: ${course.id}`); // Renamed for clarity
            if (confirm("Are you sure you want to delete this course?")) {
                await deleteCourse(course.id);
            }
        });
    } else {
        console.error("[ERROR] Delete Course button element NOT FOUND for course:", course.id);
    }
}

/**
 * Deletes a course from Firestore.
 * @param {string} courseId - The ID of the course to delete.
 */
async function deleteCourse(courseId) {
    console.log(`[DEBUG] Attempting to delete course with ID: ${courseId}`);
    try {
        const courseDocRef = doc(getUserCollectionRef('courses'), courseId);
        await deleteDoc(courseDocRef);
        showToast("Course deleted successfully!", "success");
        console.log(`[DEBUG] Course ${courseId} deleted from Firestore.`);
        // No need to reload course list, onSnapshot will handle it
    } catch (e) {
        console.error(`[ERROR] Error deleting course ${courseId}:`, e);
        showToast("Failed to delete course.", "error");
    }
}

// =====================================================================================================
// --- Course Creation Functions ---
// =====================================================================================================

/**
 * Displays a chat message in the course creation section.
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
 * Sends a message to the Vercel serverless function to process chat input.
 * It determines whether to continue chat or initiate course generation.
 * @param {string} prompt - The user's prompt.
 */
async function processCourseChatInput(prompt) {
    displayCourseChatMessage('user', prompt);
    courseChatInput.value = '';
    courseChatSpinner.classList.remove('hidden');
    sendCourseChatBtn.disabled = true;

    // Add user's message to history for sending to server
    courseChatHistory.push({ role: "user", parts: [{ text: prompt }] });

    try {
    // Add system prompt instructions for humanized Jarvis chat
    const systemInstructions = {
        role: "system",
        parts: [{
            text: `You are Jarvis, a helpful and conversational cubing assistant. Respond in a friendly, engaging, and humanized manner. 
Ask personalized follow-up questions to better understand the user's needs before generating a course. 
For example, if the user mentions "f2l", respond with: "Oh I see you want to know f2l. How about your current level like beginner, advanced, or ...? Do you know rotations? Do you know any basic f2l currently?" 
Wait for explicit confirmation like "generate the course" before proceeding to generate the course.`
        }]
    };

    // Prepend system instructions to chat history
    const chatHistoryWithInstructions = [systemInstructions, ...courseChatHistory];

        const payload = {
            type: 'lesson_chat', // Always start with a 'lesson_chat' type for conversational input
            chatHistory: chatHistoryWithInstructions, // Send the full history with system instructions for context
            cubeType: courseTypeFilter.value,
            skillLevel: courseLevelFilter.value,
        };
        console.log("[DEBUG] Payload sent to serverless function:", JSON.stringify(payload, null, 2));

        const apiUrl = '/api/gemini-insight'; 

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorText;
            try {
                errorText = await response.text();
                // Try to parse JSON if possible
                const errorData = JSON.parse(errorText);
                throw new Error(`Server responded with status ${response.status}: ${JSON.stringify(errorData)}`);
            } catch (e) {
                // If not JSON, throw raw text
                throw new Error(`Server responded with status ${response.status}: ${errorText}`);
            }
        }

        let result;
        try {
            result = await response.json();
        } catch (e) {
            const text = await response.text();
            console.error("Failed to parse JSON response from serverless function. Raw response:", text);
            throw new Error("Invalid JSON response from serverless function.");
        }
        console.log("[DEBUG] Vercel Serverless Function response (chat processing):", result);

        if (result.message) { // Always display Jarvis's message if available
            displayCourseChatMessage('jarvis', result.message);
            courseChatHistory.push({ role: "model", parts: [{ text: result.message }] });
            speakAsJarvis(result.message);

            if (result.action === 'generate_course') {
                // If the server signals to generate a course, initiate the course generation process
                await initiateCourseGeneration();
            }
        } else {
            const errorMessage = result.error || "I am unable to process your request, Sir Sevindu. Please try again.";
            displayCourseChatMessage('jarvis', errorMessage);
            courseChatHistory.push({ role: "model", parts: [{ text: errorMessage }] });
        }
    } catch (e) {
        console.error("Error calling Vercel Serverless Function for chat processing:", e);
        displayCourseChatMessage('jarvis', "My apologies, Sir Sevindu. I am experiencing a technical difficulty. Please check your internet connection or try again later.");
        courseChatHistory.push({ role: "model", parts: [{ text: "My apologies, Sir Sevindu. I am experiencing a technical difficulty. Please check your internet connection or try again later." }] });
    } finally {
        courseChatSpinner.classList.add('hidden');
        sendCourseChatBtn.disabled = false;
    }
}

/**
 * Initiates the course generation process by sending a specific request to the serverless function.
 */
async function initiateCourseGeneration() {
    displayCourseChatMessage('jarvis', "Understood, Sir Sevindu. I am now generating your personalized cubing course. This may take a moment.");
    speakAsJarvis("Understood, Sir Sevindu. I am now generating your personalized cubing course. This may take a moment.");
    courseChatSpinner.classList.remove('hidden');
    sendCourseChatBtn.disabled = true;

    try {
        const payload = {
            type: 'generate_course', // Explicitly request course generation
            chatHistory: courseChatHistory, // Send the full chat history for context
            cubeType: courseTypeFilter.value,
            skillLevel: courseLevelFilter.value,
            // Add other relevant context from the UI if needed for the AI model
        };

        const apiUrl = '/api/gemini-insight'; 

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Server responded with status ${response.status}: ${JSON.stringify(errorData)}`);
        }

        const result = await response.json();
        console.log("[DEBUG] Vercel Serverless Function response (course generation):", result);

        // Corrected: Check for 'title' directly in the result object, as the server now returns the course object itself with 'title'.
        if (result.title) { 
            const newCourse = result; // Assign the entire result as the newCourse
            newCourse.lastAccessedModuleIndex = 0;
            newCourse.lastAccessedLessonIndex = 0;
            newCourse.lastAccessedStepIndex = 0;
            await saveCourse(newCourse);
            displayCourseChatMessage('jarvis', `Course "${newCourse.title}" created successfully, Sir Sevindu! You may now close this chat and begin your training.`);
            speakAsJarvis(`Course "${newCourse.title}" created successfully, Sir Sevindu! You may now close this chat and begin your training.`);
        } else {
            const errorMessage = result.error || "I encountered an issue generating the course, Sir Sevindu. Please ensure all necessary details were provided or try again.";
            displayCourseChatMessage('jarvis', errorMessage);
            speakAsJarvis(errorMessage);
        }
    } catch (e) {
        console.error("Error calling Vercel Serverless Function for course generation:", e);
        displayCourseChatMessage('jarvis', "My apologies, Sir Sevindu. A critical error occurred during course generation. Please check your network and try again.");
        speakAsJarvis("My apologies, Sir Sevindu. A critical error occurred during course generation. Please check your network and try again.");
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
    console.log("[DEBUG] Attempting to save course to Firestore:", courseData);
    try {
        const coursesRef = getUserCollectionRef('courses');
        if (!coursesRef) {
            showToast("Failed to save course: Authentication not ready.", "error");
            return;
        }
        // Ensure courseData includes necessary top-level fields for Firestore
        const dataToSave = {
            id: courseData.id, // Firestore document ID will be auto-generated, but keeping this for consistency if AI provides it
            title: courseData.title,
            description: courseData.description,
            cubeType: courseData.cubeType,
            level: courseData.level,
            modules: courseData.modules,
            lastAccessedModuleIndex: courseData.lastAccessedModuleIndex,
            lastAccessedLessonIndex: courseData.lastAccessedLessonIndex,
            lastAccessedStepIndex: courseData.lastAccessedStepIndex,
            createdAt: new Date().toISOString()
        };

        const docRef = await addDoc(coursesRef, dataToSave);
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
    console.log(`[DEBUG] Attempting to load course with ID: ${courseId}`);
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
            if (!currentCourse.modules || currentModuleIndex >= currentCourse.modules.length) currentModuleIndex = 0;
            const currentModule = currentCourse.modules ? currentCourse.modules[currentModuleIndex] : null;

            if (!currentModule || !currentModule.lessons || currentLessonIndex >= currentModule.lessons.length) currentLessonIndex = 0;
            const currentLesson = currentModule && currentModule.lessons ? currentModule.lessons[currentLessonIndex] : null;

            if (!currentLesson || !currentLesson.steps || currentLessonStepIndex >= currentLesson.steps.length) currentLessonStepIndex = 0;

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
    if (!currentCourse || !currentCourse.modules) {
        console.warn("[WARN] No modules to render or currentCourse is null.");
        return;
    }
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

        if (module.lessons) {
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
        }

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
            const inputType = q.answer && Array.isArray(q.answer) ? 'checkbox' : 'radio'; // Check if answer is an array for checkbox
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
        const correctAnswers = Array.isArray(q.answer) ? q.answer.map(ans => ans.trim()) : [String(q.answer).trim()]; // Handle both string and array for correct answers and ensure string conversion

        let isQuestionCorrect = false;

        if (Array.isArray(userAnswer)) { // Checkbox
            isQuestionCorrect = userAnswer.length === correctAnswers.length &&
                                userAnswer.every(ans => correctAnswers.includes(ans));
        } else { // Radio
            isQuestionCorrect = (userAnswer === correctAnswers[0]);
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
 * Sends a message to the Vercel serverless function for in-lesson assistance.
 * @param {string} prompt - The user's prompt.
 */
async function sendInLessonChatPrompt(prompt) {
    displayInLessonChatMessage('user', prompt);
    inLessonChatInput.value = '';
    inLessonChatSpinner.classList.remove('hidden');
    sendInLessonChatBtn.disabled = true;

    // Include current lesson context in the chat history
    const currentLessonContext = {
        lessonTitle: currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].lessonTitle,
        lessonType: currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].lesson_type, // Assuming lesson_type exists
        content: currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].content,
        scramble: currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].scramble,
        algorithm: currentCourse.modules[currentModuleIndex].lessons[currentLessonIndex].steps[currentLessonStepIndex].algorithm,
    };

    // The chat history to send to the serverless function
    const chatHistoryToSend = [...inLessonChatHistory, { role: "user", parts: [{ text: prompt }] }];

    // Fetch user history for personalization (if authenticated)
    let userHistory = [];
    try {
        if (auth && auth.currentUser && !auth.currentUser.isAnonymous) {
            const docRef = doc(db, "users", auth.currentUser.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                userHistory = docSnap.data().history || [];
            }
        }
    } catch (e) {
        // Ignore errors, fallback to empty history
    }

    try {
        const payload = {
            type: 'lesson_chat',
            chatHistory: chatHistoryToSend,
            cubeType: currentCourse.cubeType,
            userLevel: currentCourse.level,
            currentLessonContext: currentLessonContext,
            userHistory: userHistory
        };

        // The client-side makes a request to YOUR Vercel serverless function
        const apiUrl = '/api/gemini-insight';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Server responded with status ${response.status}: ${JSON.stringify(errorData)}`);
        }

        const result = await response.json();
        console.log("[DEBUG] Vercel Serverless Function response (in-lesson chat):", result);

        if (result.message) {
            const jarvisResponse = result.message;
            displayInLessonChatMessage('jarvis', jarvisResponse);
            inLessonChatHistory.push({ role: "user", parts: [{ text: prompt }] });
            inLessonChatHistory.push({ role: "model", parts: [{ text: jarvisResponse }] });
            speakAsJarvis(jarvisResponse);
        } else {
            const errorMessage = result.error || "I am unable to provide assistance at this moment, Sir Sevindu. Please try again.";
            displayInLessonChatMessage('jarvis', errorMessage);
            inLessonChatHistory.push({ role: "user", parts: [{ text: prompt }] });
            inLessonChatHistory.push({ role: "model", parts: [{ text: errorMessage }] });
        }
    } catch (e) {
        console.error("Error calling Vercel Serverless Function for in-lesson chat:", e);
        displayInLessonChatMessage('jarvis', "My apologies, Sir Sevindu. I am experiencing a technical difficulty. Please check your internet connection or try again later.");
        inLessonChatHistory.push({ role: "user", parts: [{ text: prompt }] });
        inLessonChatHistory.push({ role: "model", parts: [{ text: "My apologies, Sir Sevindu. I am experiencing a technical difficulty and cannot generate the course at this moment. Please check your internet connection or try again later." }] });
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

    courseCreationSection = document.getElementById('courseCreationSection'); // Renamed from courseCreationModal
    backToCoursesBtn = document.getElementById('backToCoursesBtn'); // New button for navigation
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
    resetAlgBtn = document.getElementById('resetAlgBtn'); // Corrected assignment
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
    if (startNewCourseBtn) startNewCourseBtn.addEventListener('click', async () => {
        // Resume AudioContext on user gesture
        if (Tone.context.state !== 'running') {
            await Tone.start();
            console.log("[DEBUG] Tone.js AudioContext resumed.");
        }
        console.log("[DEBUG] Before showing courseCreationSection, lessonViewer display:", lessonViewer.style.display, "visibility:", lessonViewer.style.visibility, "height:", lessonViewer.style.height); // Added debug log
        showSection(courseCreationSection); // Show the new full-screen section
        courseChatHistory = []; // Clear chat history for new course creation
        courseChatMessages.innerHTML = '';
        displayCourseChatMessage('jarvis', "Greetings, Sir Sevindu. I am ready to assist you in designing a new cubing course. Please tell me what type of cube (e.g., 3x3, Pyraminx), what skill level (e.g., beginner, advanced), and any specific topics or methods you would like to include.");
    });
    if (backToCoursesBtn) backToCoursesBtn.addEventListener('click', () => { // Updated button
        console.log("[DEBUG] Before showing lessonHub, lessonViewer display:", lessonViewer.style.display, "visibility:", lessonViewer.style.visibility, "height:", lessonViewer.style.height); // Added debug log
        showSection(lessonHub); // Go back to the hub
        loadCourseList(); // Refresh course list
    });
    if (sendCourseChatBtn) sendCourseChatBtn.addEventListener('click', () => processCourseChatInput(courseChatInput.value));
    if (courseChatInput) {
        // Auto-expand textarea height on input to prevent scrollbar
        courseChatInput.addEventListener('input', () => {
            courseChatInput.style.height = 'auto';
            courseChatInput.style.height = courseChatInput.scrollHeight + 'px';
        });
        courseChatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && courseChatInput.value.trim() !== '') {
                e.preventDefault(); // Prevent newline on Enter without Shift
                processCourseChatInput(courseChatInput.value);
                courseChatInput.style.height = 'auto'; // Reset height after sending
            }
        });
    }

    if (courseTypeFilter) courseTypeFilter.addEventListener('change', loadCourseList);
    if (courseLevelFilter) courseLevelFilter.addEventListener('change', loadCourseList);

    if (prevLessonStepBtn) prevLessonStepBtn.addEventListener('click', goToPreviousStep); // Corrected to goToPreviousStep
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
        inLessonChatContainer.style.display = 'flex'; // Use style.display for consistency
        inLessonChatMessages.scrollTop = inLessonChatMessages.scrollHeight; // Scroll to bottom on open
    });
    if (closeInLessonChatBtn) closeInLessonChatBtn.addEventListener('click', () => {
        inLessonChatContainer.style.display = 'none'; // Use style.display for consistency
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
    console.log("[DEBUG] loadInitialView() called.");
    // For now, always start at the hub. In a more complex app,
    // we might check if a lesson was in progress and resume it directly.
    showSection(lessonHub);
    console.log("[DEBUG] Calling loadCourseList() from loadInitialView.");
    await loadCourseList(); // Load courses for the hub
    showGlobalLoadingSpinner(false); // Hide global spinner once initial view is set
    console.log("[DEBUG] loadInitialView() completed.");
}


/**
 * Initializes the lessons page by setting up DOM elements and Firebase.
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log("[DEBUG] lessons.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");
    setupEventListeners(); // Assign DOM elements and add listeners
    await initializeFirebaseAndAuth(); // Initialize Firebase and authentication

    // Tone.js Synth initialization is now handled on first user gesture (e.g., clicking 'Create New Course')
    // This resolves the "AudioContext was not allowed to start" warning.
    // Defer Tone.js initialization until user interaction
    synth = null;
    async function initToneJs() {
        if (synth) return; // Already initialized
        try {
            await Tone.start();
            synth = new Tone.Synth().toDestination();
            console.log("[DEBUG] Tone.js Synth initialized successfully");
        } catch (e) {
            console.warn("[WARN] Tone.js initialization failed:", e.message);
            showToast("Audio playback may not work", "info");
        }
    }
    // Add click listener to document to initialize Tone.js on first interaction
    document.addEventListener('click', initToneJs, { once: true });
});
