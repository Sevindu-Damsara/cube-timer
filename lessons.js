// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, orderBy, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for lessons.js completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---
// These are duplicated from script.js to ensure lessons.js can function independently.
// =====================================================================================================
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; // Global app ID
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "YOUR_FIREBASE_API_KEY", // Placeholder, will be replaced by Canvas
    authDomain: "YOUR_FIREBASE_AUTH_DOMAIN",
    projectId: "YOUR_FIREBASE_PROJECT_ID",
    storageBucket: "YOUR_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "YOUR_FIREBASE_MESSAGING_SENDER_ID",
    appId: "YOUR_FIREBASE_APP_ID",
    measurementId: "YOUR_FIREBASE_MEASUREMENT_ID"
};

// Global Firebase variables
let app;
let db;
let auth;
let userId;
let isAuthReady = false;
let isUserAuthenticated = false;

// DOM Elements
let globalLoadingSpinner;
let lessonHubSection, courseList, generateNewCourseCard, noCoursesMessage;
let courseDetailSection, backToCoursesBtn, courseTitle, courseDescription, moduleList;
let lessonViewerSection, backToCourseDetailBtn, lessonTitle, lessonDescription;
let lessonStepTitle, lessonStepCounter, lessonContentDisplay, scramble3DViewer, scramble3DViewerContainer;
let playPreviewBtn, pausePreviewBtn, resetPreviewBtn, lessonSolveCubeBtn;
let prevLessonStepBtn, nextLessonStepBtn, completeLessonBtn, lessonCompletionMessage;
let editLessonBtn, editLessonModal, closeEditLessonModal, editStepTitle, editStepContent, editStepScramble, editStepAlgorithm, saveLessonEditsBtn;
let quizSection, quizQuestion, quizOptions, submitQuizBtn, quizFeedback;
let aiChatWindow, closeChatBtn, chatMessages, chatInput, sendChatBtn;
let lessonHistorySection, historyLoadingSpinner, noLessonsMessage, lessonHistoryList;

// Current state variables
let currentCourse = null;
let currentModule = null;
let currentLesson = null;
let currentLessonStepIndex = 0;
let md; // Markdown-it instance

// Voice Feedback (from script.js, duplicated for self-containment if needed)
let jarvisVoiceSynth = window.speechSynthesis;
let jarvisVoice = null;
const JARVIS_VOICE_NAME = "Google UK English Male"; // Preferred voice

// --- Utility Functions ---

/**
 * Initializes the Firebase app and sets up authentication listener.
 */
async function initializeFirebaseAndAuth() {
    console.log("[DEBUG] Initializing Firebase app.");
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                isUserAuthenticated = true;
                console.log(`[DEBUG] User authenticated: ${userId}`);
            } else {
                // If no user, sign in anonymously for basic functionality
                if (typeof __initial_auth_token !== 'undefined') {
                    await signInWithCustomToken(auth, __initial_auth_token);
                    userId = auth.currentUser.uid;
                    isUserAuthenticated = true;
                    console.log(`[DEBUG] Signed in with custom token: ${userId}`);
                } else {
                    await signInAnonymously(auth);
                    userId = auth.currentUser.uid;
                    isUserAuthenticated = false; // Mark as anonymous
                    console.log(`[DEBUG] Signed in anonymously: ${userId}`);
                }
            }
            isAuthReady = true;
            console.log("[DEBUG] Firebase Auth is ready. Loading initial view.");
            await loadInitialView();
            loadJarvisVoice(); // Load Jarvis voice after auth is ready
        });
    } catch (e) {
        console.error("[ERROR] Firebase initialization failed:", e);
        isAuthReady = true; // Mark as ready even if failed, to proceed with local storage fallback
        userId = `guest-${crypto.randomUUID()}`;
        isUserAuthenticated = false;
        await loadInitialView();
        loadJarvisVoice();
    }
}

/**
 * Shows a specific section and hides others.
 * @param {HTMLElement} sectionToShow - The section to make visible.
 */
function showSection(sectionToShow) {
    const sections = [
        lessonHubSection,
        courseDetailSection,
        lessonViewerSection,
        lessonHistorySection,
        aiChatWindow // Chat window is a persistent overlay, manage its visibility separately if needed
    ];
    sections.forEach(section => {
        if (section) section.classList.add('hidden');
    });
    if (sectionToShow) {
        sectionToShow.classList.remove('hidden');
        // If showing lesson viewer, ensure chat window is also visible if previously open
        if (sectionToShow === lessonViewerSection && aiChatWindow.dataset.wasOpen === 'true') {
            aiChatWindow.classList.remove('hidden');
        } else {
            aiChatWindow.classList.add('hidden'); // Hide chat if not in lesson viewer
            aiChatWindow.dataset.wasOpen = 'false'; // Reset state
        }
    }
    console.log(`[DEBUG] Showing section: ${sectionToShow ? sectionToShow.id : 'None'}`);
}

/**
 * Shows or hides the global loading spinner.
 * @param {boolean} show - True to show, false to hide.
 */
function showGlobalLoadingSpinner(show) {
    if (globalLoadingSpinner) {
        if (show) {
            globalLoadingSpinner.classList.remove('hidden');
        } else {
            globalLoadingSpinner.classList.add('hidden');
        }
    }
}

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
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);

    // Force reflow to enable transition
    void toast.offsetWidth;

    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

/**
 * Loads the preferred Jarvis voice.
 */
function loadJarvisVoice() {
    const voices = jarvisVoiceSynth.getVoices();
    jarvisVoice = voices.find(voice => voice.name === JARVIS_VOICE_NAME) || voices[0]; // Fallback to first available voice
    console.log(`[DEBUG] Jarvis voice loaded: ${jarvisVoice ? jarvisVoice.name : 'None'}`);
}

/**
 * Jarvis speaks the given text.
 * @param {string} text - The text for Jarvis to speak.
 */
function speakAsJarvis(text) {
    if (!jarvisVoiceSynth) {
        console.warn("[WARN] SpeechSynthesis not supported.");
        return;
    }
    if (jarvisVoiceSynth.speaking) {
        jarvisVoiceSynth.cancel(); // Stop current speech if any
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = jarvisVoice;
    utterance.rate = 1.0; // Normal speed
    utterance.pitch = 1.0; // Normal pitch

    utterance.onend = () => {
        console.log("[DEBUG] Jarvis finished speaking.");
    };
    utterance.onerror = (event) => {
        console.error("[ERROR] Jarvis speech error:", event.error);
    };

    jarvisVoiceSynth.speak(utterance);
    console.log(`[DEBUG] Jarvis speaking: "${text}"`);
}


// --- Firebase Data Operations ---

/**
 * Fetches all courses for the current user.
 * @returns {Array} An array of course objects.
 */
async function fetchCourses() {
    if (!isAuthReady || !userId) {
        console.warn("[WARN] Auth not ready or userId not available, cannot fetch courses.");
        return [];
    }
    showGlobalLoadingSpinner(true);
    try {
        const coursesRef = collection(db, `artifacts/${appId}/users/${userId}/courses`);
        const q = query(coursesRef, orderBy('course_title', 'asc')); // Order for consistent display
        const querySnapshot = await getDocs(q);
        const courses = [];
        querySnapshot.forEach((doc) => {
            courses.push({ id: doc.id, ...doc.data() });
        });
        console.log(`[DEBUG] Fetched ${courses.length} courses.`);
        return courses;
    } catch (error) {
        console.error("[ERROR] Error fetching courses:", error);
        showToast("Failed to load courses. Please try again.", "error");
        return [];
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

/**
 * Saves a new course to Firestore.
 * @param {Object} courseData - The course data to save.
 */
async function saveCourse(courseData) {
    if (!isAuthReady || !userId) {
        console.error("[ERROR] Auth not ready or userId not available, cannot save course.");
        showToast("Authentication error. Cannot save course.", "error");
        return;
    }
    showGlobalLoadingSpinner(true);
    try {
        const coursesRef = collection(db, `artifacts/${appId}/users/${userId}/courses`);
        const docRef = await addDoc(coursesRef, courseData);
        console.log("[DEBUG] Course saved with ID:", docRef.id);
        showToast("Course saved successfully!", "success");
        return { id: docRef.id, ...courseData };
    } catch (error) {
        console.error("[ERROR] Error saving course:", error);
        showToast("Failed to save course. Please try again.", "error");
        return null;
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

/**
 * Updates an existing lesson in Firestore.
 * @param {string} courseId - The ID of the course.
 * @param {string} moduleId - The ID of the module.
 * @param {string} lessonId - The ID of the lesson.
 * @param {Object} updatedLessonData - The updated lesson data.
 */
async function updateLesson(courseId, moduleId, lessonId, updatedLessonData) {
    if (!isAuthReady || !userId) {
        console.error("[ERROR] Auth not ready or userId not available, cannot update lesson.");
        showToast("Authentication error. Cannot update lesson.", "error");
        return false;
    }
    showGlobalLoadingSpinner(true);
    try {
        // Find the specific lesson within the course structure and update it
        const courseDocRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, courseId);
        const courseSnap = await getDoc(courseDocRef);

        if (courseSnap.exists()) {
            const courseData = courseSnap.data();
            const moduleIndex = courseData.modules.findIndex(m => m.module_id === moduleId);
            if (moduleIndex !== -1) {
                const lessonIndex = courseData.modules[moduleIndex].lessons.findIndex(l => l.lesson_id === lessonId);
                if (lessonIndex !== -1) {
                    // Update the specific lesson within the array
                    courseData.modules[moduleIndex].lessons[lessonIndex] = {
                        ...courseData.modules[moduleIndex].lessons[lessonIndex],
                        ...updatedLessonData
                    };
                    await updateDoc(courseDocRef, { modules: courseData.modules });
                    console.log(`[DEBUG] Lesson ${lessonId} updated in course ${courseId}.`);
                    showToast("Lesson updated successfully!", "success");
                    return true;
                }
            }
        }
        console.warn(`[WARN] Lesson ${lessonId} not found for update in course ${courseId}.`);
        showToast("Failed to update lesson: Lesson not found.", "error");
        return false;
    } catch (error) {
        console.error("[ERROR] Error updating lesson:", error);
        showToast("Failed to update lesson. Please try again.", "error");
        return false;
    } finally {
        showGlobalLoadingSpinner(false);
    }
}


// --- AI API Calls ---

/**
 * Calls the backend API to generate a new course.
 * @param {string} cubeType
 * @param {string} skillLevel
 * @param {string} learningStyle
 * @returns {Promise<Object|null>} The generated course data or null on error.
 */
async function generateNewCourse(cubeType, skillLevel, learningStyle) {
    showGlobalLoadingSpinner(true);
    speakAsJarvis(`Generating a new ${skillLevel} course for the ${cubeType} cube, Sir Sevindu. This may take a moment.`);
    try {
        const response = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                actionType: 'generateCourse',
                cubeType,
                skillLevel,
                learningStyle
            })
        });
        const data = await response.json();
        if (response.ok) {
            console.log("[DEBUG] Course generated by AI:", data);
            showToast("New course generated successfully!", "success");
            speakAsJarvis("The new course has been successfully generated, Sir Sevindu.");
            return data;
        } else {
            console.error("[ERROR] AI course generation failed:", data.error);
            showToast(`Failed to generate course: ${data.error}`, "error");
            speakAsJarvis(`I encountered an issue generating the course, Sir Sevindu. ${data.error}`);
            return null;
        }
    } catch (error) {
        console.error("[ERROR] Network error during AI course generation:", error);
        showToast("Network error during course generation. Please check your connection.", "error");
        speakAsJarvis("My apologies, Sir Sevindu. I am experiencing network difficulties in generating the course.");
        return null;
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

/**
 * Calls the backend API for in-lesson AI chat.
 * @param {Object} lessonContext - Context of the current lesson.
 * @param {string} userQuery - The user's question.
 * @returns {Promise<string|null>} The AI's response or null on error.
 */
async function getAiChatResponse(lessonContext, userQuery) {
    if (!userQuery.trim()) return;
    showToast("Jarvis is thinking...", "info");
    try {
        const response = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                actionType: 'aiChat',
                lessonContext,
                userQuery
            })
        });
        const data = await response.json();
        if (response.ok) {
            console.log("[DEBUG] AI chat response:", data.response);
            showToast("Jarvis has responded.", "success");
            speakAsJarvis(data.response);
            return data.response;
        } else {
            console.error("[ERROR] AI chat failed:", data.error);
            showToast(`Jarvis encountered an error: ${data.error}`, "error");
            speakAsJarvis(`My apologies, Sir Sevindu. I am unable to process your request at this moment. ${data.error}`);
            return null;
        }
    } catch (error) {
        console.error("[ERROR] Network error during AI chat:", error);
        showToast("Network error during chat. Please check your connection.", "error");
        speakAsJarvis("My apologies, Sir Sevindu. I am experiencing network difficulties in responding.");
        return null;
    }
}


// --- Rendering Functions ---

/**
 * Renders the list of courses in the hub.
 * @param {Array} courses - An array of course objects.
 */
function renderCourseList(courses) {
    if (!courseList) return;
    courseList.innerHTML = ''; // Clear existing courses

    // Add the "Generate New Course" card
    const generateCard = document.createElement('div');
    generateCard.className = "course-card bg-gray-800 p-6 rounded-xl shadow-lg flex flex-col items-center justify-center text-center transition-transform transform hover:scale-105 cursor-pointer";
    generateCard.innerHTML = `
        <i class="fas fa-plus-circle text-5xl text-blue-400 mb-4"></i>
        <h3 class="text-xl font-semibold text-white mb-2">Generate New Course</h3>
        <p class="text-gray-400 text-sm">Let Jarvis create a personalized learning path for you.</p>
    `;
    generateCard.addEventListener('click', async () => {
        // Prompt for cube type, skill level, learning style (using a simple prompt for now, could be a modal)
        const cubeType = prompt("Sir Sevindu, please specify the cube type (e.g., 3x3, 2x2, pyraminx):", "3x3");
        if (!cubeType) return;
        const skillLevel = prompt("Sir Sevindu, please specify the skill level (e.g., Beginner, Intermediate, Advanced):", "Beginner");
        if (!skillLevel) return;
        const learningStyle = prompt("Sir Sevindu, please specify your preferred learning style (e.g., Algorithmic, Visual, Conceptual):", "Algorithmic");
        if (!learningStyle) return;

        const newCourse = await generateNewCourse(cubeType, skillLevel, learningStyle);
        if (newCourse) {
            await saveCourse(newCourse); // Save generated course to Firestore
            await loadInitialView(); // Reload courses to show the new one
        }
    });
    courseList.appendChild(generateCard);

    if (courses.length === 0) {
        noCoursesMessage.classList.remove('hidden');
    } else {
        noCoursesMessage.classList.add('hidden');
        courses.forEach(course => {
            const courseCard = document.createElement('div');
            courseCard.className = "course-card bg-gray-800 p-6 rounded-xl shadow-lg transition-transform transform hover:scale-105 cursor-pointer";
            courseCard.innerHTML = `
                <h3 class="text-xl font-semibold text-gradient mb-2">${course.course_title}</h3>
                <p class="text-gray-400 text-sm mb-3">${course.course_description}</p>
                <div class="text-gray-500 text-xs">Skill Level: ${course.target_skill_level}</div>
                <div class="progress-bar-container mt-3">
                    <div class="progress-bar" style="width: ${0}%"></div>
                </div>
                <p class="text-gray-400 text-xs mt-1">Progress: 0%</p>
            `;
            courseCard.addEventListener('click', () => {
                currentCourse = course;
                renderCourseDetail(course);
                showSection(courseDetailSection);
            });
            courseList.appendChild(courseCard);
        });
    }
}

/**
 * Renders the course detail view.
 * @param {Object} course - The selected course object.
 */
function renderCourseDetail(course) {
    if (!courseDetailSection || !courseTitle || !courseDescription || !moduleList) return;

    courseTitle.textContent = course.course_title;
    courseDescription.textContent = course.course_description;
    moduleList.innerHTML = ''; // Clear existing modules

    course.modules.forEach(module => {
        const moduleDiv = document.createElement('div');
        moduleDiv.className = "module-card bg-gray-800 p-5 rounded-lg shadow-md";
        moduleDiv.innerHTML = `
            <h4 class="text-xl font-semibold text-white mb-2">${module.module_title}</h4>
            <p class="text-gray-400 text-sm mb-3">${module.module_description}</p>
            <ul class="space-y-2">
                ${module.lessons.map(lesson => `
                    <li class="lesson-item flex items-center justify-between p-3 bg-gray-700 rounded-md transition-colors hover:bg-gray-600 cursor-pointer" data-lesson-id="${lesson.lesson_id}" data-module-id="${module.module_id}">
                        <span class="text-white text-base">${lesson.title}</span>
                        <i class="fas fa-chevron-right text-gray-400"></i>
                    </li>
                `).join('')}
            </ul>
        `;
        moduleList.appendChild(moduleDiv);
    });

    // Add event listeners to lesson items
    moduleList.querySelectorAll('.lesson-item').forEach(item => {
        item.addEventListener('click', (event) => {
            const lessonId = event.currentTarget.dataset.lessonId;
            const moduleId = event.currentTarget.dataset.moduleId;
            const selectedModule = currentCourse.modules.find(m => m.module_id === moduleId);
            if (selectedModule) {
                currentModule = selectedModule;
                currentLesson = selectedModule.lessons.find(l => l.lesson_id === lessonId);
                if (currentLesson) {
                    currentLessonStepIndex = 0; // Start from the first step
                    renderLessonStep();
                    showSection(lessonViewerSection);
                } else {
                    showToast("Lesson not found.", "error");
                }
            } else {
                showToast("Module not found.", "error");
            }
        });
    });
}

/**
 * Renders the current step of the lesson.
 */
function renderLessonStep() {
    if (!currentLesson || !lessonTitle || !lessonDescription || !lessonStepTitle || !lessonStepCounter || !lessonContentDisplay || !scramble3DViewer) {
        console.error("[ERROR] Missing elements for rendering lesson step.");
        return;
    }

    lessonTitle.textContent = currentLesson.title;
    lessonDescription.textContent = currentLesson.description;

    const currentStep = currentLesson.steps[currentLessonStepIndex];
    if (!currentStep) {
        console.error("[ERROR] Current lesson step is undefined.");
        return;
    }

    lessonStepTitle.textContent = currentStep.title;
    lessonStepCounter.textContent = `Step ${currentLessonStepIndex + 1} of ${currentLesson.steps.length}`;

    // Render Markdown content
    lessonContentDisplay.innerHTML = md.render(currentStep.content);

    // Handle 3D cube visualization placeholders
    const contentHtml = lessonContentDisplay.innerHTML;
    const scramblePlaceholderRegex = /\[VISUALIZE_SCRAMBLE:\s*(.*?)\]/g;
    const algorithmPlaceholderRegex = /\[VISUALIZE_ALGORITHM:\s*(.*?)\]/g;

    let match;
    let hasCubeVisualization = false;

    // Prioritize algorithm if present, then scramble
    if (currentStep.algorithm) {
        scramble3DViewer.alg = currentStep.algorithm;
        scramble3DViewer.scramble = ''; // Clear scramble if algorithm is present
        scramble3DViewer.play(); // Auto-play algorithm
        playPreviewBtn.style.display = 'none';
        pausePreviewBtn.style.display = 'inline-block';
        lessonSolveCubeBtn.style.display = 'inline-block'; // Show solve button for algorithms
        scramble3DViewerContainer.classList.remove('hidden');
        hasCubeVisualization = true;
    } else if (currentStep.scramble) {
        scramble3DViewer.scramble = currentStep.scramble;
        scramble3DViewer.alg = ''; // Clear algorithm if scramble is present
        scramble3DViewer.reset(); // Reset to initial scramble
        playPreviewBtn.style.display = 'inline-block';
        pausePreviewBtn.style.display = 'none';
        lessonSolveCubeBtn.style.display = 'none'; // Hide solve button for just scramble
        scramble3DViewerContainer.classList.remove('hidden');
        hasCubeVisualization = true;
    } else {
        // Check for placeholders in markdown content if no direct scramble/algorithm fields
        if ((match = scramblePlaceholderRegex.exec(contentHtml)) !== null) {
            scramble3DViewer.scramble = match[1].trim();
            scramble3DViewer.alg = '';
            scramble3DViewer.reset();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
            lessonSolveCubeBtn.style.display = 'none';
            scramble3DViewerContainer.classList.remove('hidden');
            hasCubeVisualization = true;
        } else if ((match = algorithmPlaceholderRegex.exec(contentHtml)) !== null) {
            scramble3DViewer.alg = match[1].trim();
            scramble3DViewer.scramble = '';
            scramble3DViewer.play();
            playPreviewBtn.style.display = 'none';
            pausePreviewBtn.style.display = 'inline-block';
            lessonSolveCubeBtn.style.display = 'inline-block';
            scramble3DViewerContainer.classList.remove('hidden');
            hasCubeVisualization = true;
        } else {
            scramble3DViewerContainer.classList.add('hidden'); // Hide cube if no visualization needed
        }
    }

    // Manage navigation buttons
    prevLessonStepBtn.style.display = currentLessonStepIndex > 0 ? 'inline-block' : 'none';
    nextLessonStepBtn.style.display = currentLessonStepIndex < currentLesson.steps.length - 1 ? 'inline-block' : 'none';
    completeLessonBtn.style.display = currentLessonStepIndex === currentLesson.steps.length - 1 ? 'inline-block' : 'none';

    // Handle Quiz Section
    quizSection.classList.add('hidden');
    quizFeedback.textContent = '';
    if (currentStep.quiz_question && currentStep.quiz_options && currentStep.quiz_answer) {
        quizSection.classList.remove('hidden');
        quizQuestion.textContent = currentStep.quiz_question;
        quizOptions.innerHTML = '';
        currentStep.quiz_options.forEach((option, index) => {
            const radioId = `quizOption${index}`;
            const optionDiv = document.createElement('div');
            optionDiv.className = "flex items-center";
            optionDiv.innerHTML = `
                <input type="radio" id="${radioId}" name="quizOption" value="${option}" class="form-radio text-blue-500">
                <label for="${radioId}" class="ml-2 text-gray-300">${option}</label>
            `;
            quizOptions.appendChild(optionDiv);
        });
    }
}

/**
 * Handles the submission of a quiz answer.
 */
function handleSubmitQuiz() {
    const selectedOption = quizOptions.querySelector('input[name="quizOption"]:checked');
    if (!selectedOption) {
        showToast("Please select an answer, Sir Sevindu.", "info");
        return;
    }

    const currentStep = currentLesson.steps[currentLessonStepIndex];
    if (selectedOption.value === currentStep.quiz_answer) {
        quizFeedback.textContent = "Correct! Well done, Sir Sevindu.";
        quizFeedback.className = "mt-2 text-center font-semibold text-green-400";
        speakAsJarvis("Correct! Well done, Sir Sevindu.");
        // Automatically move to next step after a short delay for correct answers
        setTimeout(() => {
            if (currentLessonStepIndex < currentLesson.steps.length - 1) {
                currentLessonStepIndex++;
                renderLessonStep();
            } else {
                handleCompleteLesson();
            }
        }, 1500);
    } else {
        quizFeedback.textContent = `Incorrect. The correct answer was "${currentStep.quiz_answer}".`;
        quizFeedback.className = "mt-2 text-center font-semibold text-red-400";
        speakAsJarvis(`Incorrect, Sir Sevindu. The correct answer was "${currentStep.quiz_answer}".`);
    }
}

/**
 * Handles completing a lesson.
 */
function handleCompleteLesson() {
    if (!currentLesson) return;
    speakAsJarvis(`Congratulations, Sir Sevindu! You have completed the lesson: "${currentLesson.title}".`);
    lessonCompletionMessage.textContent = `Lesson "${currentLesson.title}" Completed!`;
    lessonCompletionMessage.classList.remove('hidden');
    completeLessonBtn.style.display = 'none';
    nextLessonStepBtn.style.display = 'none';
    prevLessonStepBtn.style.display = 'none';

    // Optionally, record lesson completion in Firestore
    // For now, just show message. Full tracking would be more complex.
    setTimeout(() => {
        showSection(courseDetailSection); // Go back to course detail
        lessonCompletionMessage.classList.add('hidden'); // Hide message for next time
    }, 3000);
}


// --- Event Listeners and Setup ---

/**
 * Assigns DOM elements and sets up event listeners.
 */
function setupEventListeners() {
    console.log("[DEBUG] Setting up DOM element references and event listeners.");

    // Global Spinner
    globalLoadingSpinner = document.getElementById('globalLoadingSpinner');

    // Course Hub
    lessonHubSection = document.getElementById('lessonHubSection');
    courseList = document.getElementById('courseList');
    generateNewCourseCard = document.getElementById('generateNewCourseCard');
    noCoursesMessage = document.getElementById('noCoursesMessage');

    // Course Detail
    courseDetailSection = document.getElementById('courseDetailSection');
    backToCoursesBtn = document.getElementById('backToCoursesBtn');
    courseTitle = document.getElementById('courseTitle');
    courseDescription = document.getElementById('courseDescription');
    moduleList = document.getElementById('moduleList');

    // Lesson Viewer
    lessonViewerSection = document.getElementById('lessonViewerSection');
    backToCourseDetailBtn = document.getElementById('backToCourseDetailBtn');
    lessonTitle = document.getElementById('lessonTitle');
    lessonDescription = document.getElementById('lessonDescription');
    lessonStepTitle = document.getElementById('lessonStepTitle');
    lessonStepCounter = document.getElementById('lessonStepCounter');
    lessonContentDisplay = document.getElementById('lessonContentDisplay');
    scramble3DViewer = document.getElementById('scramble3DViewer');
    scramble3DViewerContainer = document.getElementById('scramble3DViewerContainer');

    playPreviewBtn = document.getElementById('playPreviewBtn');
    pausePreviewBtn = document.getElementById('pausePreviewBtn');
    resetPreviewBtn = document.getElementById('resetPreviewBtn');
    lessonSolveCubeBtn = document.getElementById('lessonSolveCubeBtn');

    prevLessonStepBtn = document.getElementById('prevLessonStepBtn');
    nextLessonStepBtn = document.getElementById('nextLessonStepBtn');
    completeLessonBtn = document.getElementById('completeLessonBtn');
    lessonCompletionMessage = document.getElementById('lessonCompletionMessage');

    // Lesson Editing
    editLessonBtn = document.getElementById('editLessonBtn');
    editLessonModal = document.getElementById('editLessonModal');
    closeEditLessonModal = document.getElementById('closeEditLessonModal');
    editStepTitle = document.getElementById('editStepTitle');
    editStepContent = document.getElementById('editStepContent');
    editStepScramble = document.getElementById('editStepScramble');
    editStepAlgorithm = document.getElementById('editStepAlgorithm');
    saveLessonEditsBtn = document.getElementById('saveLessonEditsBtn');

    // Quiz Elements
    quizSection = document.getElementById('quizSection');
    quizQuestion = document.getElementById('quizQuestion');
    quizOptions = document.getElementById('quizOptions');
    submitQuizBtn = document.getElementById('submitQuizBtn');
    quizFeedback = document.getElementById('quizFeedback');

    // AI Chat
    aiChatWindow = document.getElementById('aiChatWindow');
    closeChatBtn = document.getElementById('closeChatBtn');
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    sendChatBtn = document.getElementById('sendChatBtn');

    // Lesson History
    lessonHistorySection = document.getElementById('lessonHistorySection');
    historyLoadingSpinner = document.getElementById('historyLoadingSpinner');
    noLessonsMessage = document.getElementById('noLessonsMessage');
    lessonHistoryList = document.getElementById('lessonHistoryList');


    // Event Listeners
    if (backToCoursesBtn) backToCoursesBtn.addEventListener('click', () => {
        showSection(lessonHubSection);
        currentCourse = null;
    });

    if (backToCourseDetailBtn) backToCourseDetailBtn.addEventListener('click', () => {
        showSection(courseDetailSection);
        renderCourseDetail(currentCourse); // Re-render course detail to ensure state is fresh
        currentLesson = null;
        currentModule = null;
    });

    if (prevLessonStepBtn) prevLessonStepBtn.addEventListener('click', () => {
        if (currentLessonStepIndex > 0) {
            currentLessonStepIndex--;
            renderLessonStep();
        }
    });

    if (nextLessonStepBtn) nextLessonStepBtn.addEventListener('click', () => {
        if (currentLessonStepIndex < currentLesson.steps.length - 1) {
            currentLessonStepIndex++;
            renderLessonStep();
        } else {
            handleCompleteLesson();
        }
    });

    if (completeLessonBtn) completeLessonBtn.addEventListener('click', handleCompleteLesson);

    // 3D Viewer Controls
    if (playPreviewBtn) playPreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.play();
            playPreviewBtn.style.display = 'none';
            pausePreviewBtn.style.display = 'inline-block';
        }
    });
    if (pausePreviewBtn) pausePreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.pause();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        }
    });
    if (resetPreviewBtn) resetPreviewBtn.addEventListener('click', () => {
        if (scramble3DViewer) {
            scramble3DViewer.reset();
            playPreviewBtn.style.display = 'inline-block';
            pausePreviewBtn.style.display = 'none';
        }
    });
    if (lessonSolveCubeBtn) lessonSolveCubeBtn.addEventListener('click', () => {
        if (scramble3DViewer && currentLesson && currentLesson.steps[currentLessonStepIndex] && currentLesson.steps[currentLessonStepIndex].algorithm) {
            // This button now applies the algorithm to solve, not just play
            scramble3DViewer.alg = currentLesson.steps[currentLessonStepIndex].algorithm;
            scramble3DViewer.play();
            playPreviewBtn.style.display = 'none';
            pausePreviewBtn.style.display = 'inline-block';
        } else {
            speakAsJarvis("Pardon me, Sir Sevindu. This step does not have a specific algorithm to demonstrate the solve.");
        }
    });

    // Quiz Event Listener
    if (submitQuizBtn) submitQuizBtn.addEventListener('click', handleSubmitQuiz);

    // AI Chat Event Listeners
    if (sendChatBtn) sendChatBtn.addEventListener('click', async () => {
        const userQuery = chatInput.value;
        if (userQuery.trim() === "") return;

        // Display user message
        const userMessageDiv = document.createElement('div');
        userMessageDiv.className = 'chat-message user-message';
        userMessageDiv.textContent = userQuery;
        chatMessages.appendChild(userMessageDiv);
        chatInput.value = ''; // Clear input
        chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom

        // Prepare lesson context for AI
        const lessonContext = {
            lessonTitle: currentLesson ? currentLesson.title : 'N/A',
            stepTitle: currentLesson ? currentLesson.steps[currentLessonStepIndex].title : 'N/A',
            stepContent: currentLesson ? currentLesson.steps[currentLessonStepIndex].content : 'N/A',
            scramble: currentLesson && currentLesson.steps[currentLessonStepIndex].scramble ? currentLesson.steps[currentLessonStepIndex].scramble : 'N/A',
            algorithm: currentLesson && currentLesson.steps[currentLessonStepIndex].algorithm ? currentLesson.steps[currentLessonStepIndex].algorithm : 'N/A'
        };

        const aiResponse = await getAiChatResponse(lessonContext, userQuery);
        if (aiResponse) {
            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.className = 'chat-message ai-message';
            aiMessageDiv.textContent = aiResponse;
            chatMessages.appendChild(aiMessageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
        }
    });

    if (chatInput) chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatBtn.click();
        }
    });

    // Chat button from index.html (if this page is loaded directly, it won't exist)
    const openChatBtn = document.getElementById('openChatBtn'); // This is from index.html
    if (openChatBtn) {
        openChatBtn.addEventListener('click', () => {
            aiChatWindow.classList.toggle('hidden');
            aiChatWindow.dataset.wasOpen = aiChatWindow.classList.contains('hidden') ? 'false' : 'true';
            if (!aiChatWindow.classList.contains('hidden')) {
                chatInput.focus();
            }
        });
    } else {
        // If on lessons page directly, add a button to open chat, or make it always visible
        // For now, let's assume it's always visible on lessons page if not explicitly hidden.
        // Or, we can add a dedicated button on lessons.html for chat.
        // For this iteration, I'll make it always visible within lessonViewerSection
        // and manage its visibility with showSection.
    }

    if (closeChatBtn) closeChatBtn.addEventListener('click', () => {
        aiChatWindow.classList.add('hidden');
        aiChatWindow.dataset.wasOpen = 'false';
    });

    // Lesson Editing Event Listeners
    if (editLessonBtn) editLessonBtn.addEventListener('click', () => {
        if (!currentLesson || !currentLesson.steps[currentLessonStepIndex]) {
            showToast("No lesson step selected to edit.", "info");
            return;
        }
        const currentStep = currentLesson.steps[currentLessonStepIndex];
        editStepTitle.value = currentStep.title || '';
        editStepContent.value = currentStep.content || '';
        editStepScramble.value = currentStep.scramble || '';
        editStepAlgorithm.value = currentStep.algorithm || '';
        editLessonModal.classList.remove('hidden');
    });

    if (closeEditLessonModal) closeEditLessonModal.addEventListener('click', () => {
        editLessonModal.classList.add('hidden');
    });

    if (saveLessonEditsBtn) saveLessonEditsBtn.addEventListener('click', async () => {
        if (!currentLesson || !currentLesson.steps[currentLessonStepIndex] || !currentCourse || !currentModule) {
            showToast("Error: Cannot save edits. Lesson context missing.", "error");
            return;
        }

        const updatedStep = {
            ...currentLesson.steps[currentLessonStepIndex], // Keep existing properties
            title: editStepTitle.value,
            content: editStepContent.value,
            scramble: editStepScramble.value.trim() || null, // Use null for empty strings
            algorithm: editStepAlgorithm.value.trim() || null // Use null for empty strings
        };

        // Create a copy of the current lesson to modify its steps
        const updatedLesson = { ...currentLesson };
        updatedLesson.steps[currentLessonStepIndex] = updatedStep;

        // Update the lesson in Firestore
        const success = await updateLesson(currentCourse.id, currentModule.module_id, updatedLesson.lesson_id, updatedLesson);
        if (success) {
            // Update local currentLesson object to reflect changes
            currentLesson = updatedLesson;
            renderLessonStep(); // Re-render the current step with new content
            editLessonModal.classList.add('hidden');
        }
    });

    // Initialize Markdown-it
    md = window.markdownit();
}

/**
 * Determines which section to show initially based on user state or last activity.
 */
async function loadInitialView() {
    showGlobalLoadingSpinner(true);
    const courses = await fetchCourses();
    renderCourseList(courses);
    showSection(lessonHubSection); // Always start at the course hub
    showGlobalLoadingSpinner(false);
}


/**
 * Initializes the lessons page by setting up DOM elements and Firebase.
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] lessons.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");
    setupEventListeners(); // Assign DOM elements and add listeners
    initializeFirebaseAndAuth(); // Initialize Firebase and authentication
});
