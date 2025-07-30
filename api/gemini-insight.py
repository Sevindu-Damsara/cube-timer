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
  databaseURL: "https://ubically-timer-default-rtdb.firebaseio.com",
  projectId: "ubically-timer",
  storageBucket: "ubically-timer.firebasestorage.app",
  messagingSenderId: "103608149129",
  appId: "1:103608149129:web:545d1d6a364177242e20b3",
  measurementId: "G-G6J0F9P1QG"
};

let app;
let db;
let auth;
let userId = "anonymous"; // Default anonymous user ID
let isAuthReady = false; // Flag to indicate Firebase Auth is ready

// Initialize Firebase
async function initializeFirebaseAndAuth() {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        console.log("[DEBUG] Firebase services initialized.");

        // Sign in anonymously first, then try custom token if available
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
            console.log("[DEBUG] Signed in with custom token.");
        } else {
            await signInAnonymously(auth);
            console.log("[DEBUG] Signed in anonymously.");
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                console.log("Authentication state changed. User is present. UID:", userId);
            } else {
                userId = "anonymous";
                console.log("Authentication state changed. No user is signed in.");
            }
            isAuthReady = true;
            console.log("Authentication is ready. Loading initial view.");
            loadInitialView(); // Load UI after auth is ready
        });
    } catch (error) {
        console.error("Error initializing Firebase or authenticating:", error);
        showToast("Failed to initialize app. Please try again.", "error");
    }
}

console.log("[DEBUG] lessons.js: Jarvis systems online. Initializing lesson protocols.");

// UI Elements
const lessonHub = document.getElementById('lessonHub');
const courseCreationSection = document.getElementById('courseCreationSection');
const chatContainer = document.getElementById('chatContainer');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatButton = document.getElementById('sendChatButton');
const createNewCourseButton = document.getElementById('createNewCourseButton');
const courseList = document.getElementById('courseList');
const globalLoadingSpinner = document.getElementById('globalLoadingSpinner');
const toastContainer = document.getElementById('toastContainer');
const backToHubButton = document.getElementById('backToHubButton');
const currentLessonView = document.getElementById('currentLessonView');
const lessonTitleElement = document.getElementById('lessonTitle');
const lessonContentElement = document.getElementById('lessonContent');
const nextLessonButton = document.getElementById('nextLessonButton');
const prevLessonButton = document.getElementById('prevLessonButton');

let currentCourse = null;
let currentModuleIndex = 0;
let currentLessonIndex = 0;
let synth = null; // Tone.js Synth instance

// Client-side state for conversational parameters
let conversationParams = {
    skill_level: null,
    focus_area: null,
    learning_style: null
};

// Function to show/hide sections
function showSection(section) {
    lessonHub.classList.add('hidden');
    courseCreationSection.classList.add('hidden');
    currentLessonView.classList.add('hidden');

    section.classList.remove('hidden');
    console.log("Switching view to:", section.id);
}

// Show/hide global loading spinner
function showGlobalLoadingSpinner(show) {
    if (show) {
        globalLoadingSpinner.classList.remove('hidden');
    } else {
        globalLoadingSpinner.classList.add('hidden');
    }
}

// Show toast messages
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 p-3 rounded-lg shadow-lg text-white ${type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'} z-50`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Add message to chat display
function addMessageToChat(message, sender) {
    const messageElement = document.createElement('div');
    messageElement.className = `p-2 my-1 rounded-lg max-w-[80%] ${sender === 'user' ? 'bg-blue-500 text-white self-end ml-auto' : 'bg-gray-200 text-gray-800 self-start mr-auto'}`;
    messageElement.textContent = message;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll to bottom
}

// Setup event listeners for UI elements
function setupEventListeners() {
    console.log("[DEBUG] DOM elements assigned.");

    createNewCourseButton.addEventListener('click', () => {
        showSection(courseCreationSection);
        addMessageToChat("Greetings, Sir Sevindu. I am ready to design a new cubing course. Please describe your requirements, including cube type, skill level, and any specific topics of interest.", 'jarvis');
        // Reset conversation parameters when starting a new course creation
        conversationParams = { skill_level: null, focus_area: null, learning_style: null };
        chatMessages.innerHTML = ''; // Clear previous chat
        
        // Start Tone.js AudioContext on first user gesture
        if (Tone.context.state !== 'running') {
            Tone.start().then(() => {
                console.log("[DEBUG] Tone.js AudioContext resumed on user gesture.");
            }).catch(e => {
                console.warn("Failed to resume AudioContext:", e.message);
            });
        }
    });

    sendChatButton.addEventListener('click', processCourseChatInput);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            processCourseChatInput();
        }
    });

    backToHubButton.addEventListener('click', () => {
        showSection(lessonHub);
        currentCourse = null; // Clear current course context
    });

    nextLessonButton.addEventListener('click', showNextLesson);
    prevLessonButton.addEventListener('click', showPreviousLesson);

    console.log("[DEBUG] Event listeners configured.");
}

// Function to process chat input for course creation
async function processCourseChatInput() {
    const inputMessage = chatInput.value.trim();
    if (!inputMessage) return;

    addMessageToChat(inputMessage, 'user');
    chatInput.value = '';
    showGlobalLoadingSpinner(true);

    // Update client-side conversation parameters based on user input
    // This is a simplified extraction; a more complex regex or AI parsing could be used
    const lowerInput = inputMessage.toLowerCase();
    if (lowerInput.includes("beginner")) conversationParams.skill_level = "beginner";
    else if (lowerInput.includes("intermediate")) conversationParams.skill_level = "intermediate";
    else if (lowerInput.includes("advanced")) conversationParams.skill_level = "advanced";

    if (lowerInput.includes("f2l")) conversationParams.focus_area = "F2L";
    else if (lowerInput.includes("oll")) conversationParams.focus_area = "OLL";
    else if (lowerInput.includes("pll")) conversationParams.focus_area = "PLL";
    else if (lowerInput.includes("cross")) conversationParams.focus_area = "Cross";

    if (lowerInput.includes("theoretical")) conversationParams.learning_style = "theoretical";
    else if (lowerInput.includes("practice") || lowerInput.includes("hands-on")) conversationParams.learning_style = "hands-on practice";
    else if (lowerInput.includes("quiz") || lowerInput.includes("quizzes")) conversationParams.learning_style = "interactive quiz";

    console.log("[DEBUG] Current conversationParams (client-side):", conversationParams);

    // Prepare chat history for backend (only user messages for context, not internal state)
    const currentChatHistory = Array.from(chatMessages.children).map(el => {
        return {
            role: el.classList.contains('self-end') ? 'user' : 'model',
            parts: [{ text: el.textContent }]
        };
    });

    try {
        // Step 1: Call backend for chat response and action
        const chatPayload = {
            type: 'lesson_chat',
            chatHistory: currentChatHistory,
            // Pass current parameters for backend to use in its decision logic
            skillLevel: conversationParams.skill_level,
            focusArea: conversationParams.focus_area,
            learningStyle: conversationParams.learning_style
        };
        console.log("[DEBUG] Sending chatPayload to backend:", chatPayload);

        const chatResponse = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chatPayload)
        });

        if (!chatResponse.ok) {
            const errorData = await chatResponse.json();
            throw new Error(`Server responded with status ${chatResponse.status}: ${JSON.stringify(errorData)}`);
        }

        const chatData = await chatResponse.json();
        console.log("[DEBUG] Backend chatData response:", chatData);

        addMessageToChat(chatData.message, 'jarvis'); // Display Jarvis's message

        if (chatData.action === 'generate_course') {
            // Step 2: If backend signals 'generate_course', make a separate call for actual course generation
            console.log("[DEBUG] Backend requested course generation. Initiating generate_course API call.");
            await generateNewCourse(conversationParams); // Pass collected parameters
        } else if (chatData.action === 'continue_chat') {
            console.log("[DEBUG] Backend requested continued chat. Awaiting next user input.");
            // No further action needed, just wait for user's next input
        }

    } catch (error) {
        console.error("Error processing course chat:", error);
        showToast(`My apologies, Sir. I encountered an error: ${error.message}`, 'error');
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

// Function to handle the actual course generation API call
async function generateNewCourse(params) {
    showGlobalLoadingSpinner(true);
    try {
        const generatePayload = {
            type: 'generate_course',
            cubeType: '3x3', // Default, can be made dynamic
            skillLevel: params.skill_level,
            focusArea: params.focus_area,
            learningStyle: params.learning_style,
            // Pass the full chat history for context if backend needs it for deeper understanding
            chatHistory: Array.from(chatMessages.children).map(el => {
                return {
                    role: el.classList.contains('self-end') ? 'user' : 'model',
                    parts: [{ text: el.textContent }]
                };
            })
        };
        console.log("[DEBUG] Sending generatePayload to backend:", generatePayload);

        const response = await fetch('/api/gemini-insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(generatePayload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Server responded with status ${response.status}: ${JSON.stringify(errorData)}`);
        }

        const courseData = await response.json();
        console.log("[DEBUG] Generated Course Data:", courseData);
        await saveCourseToFirestore(courseData);
        showToast("Course generated successfully, Sir Sevindu!", "success");
        loadCourseList(); // Refresh course list in hub
        showSection(lessonHub); // Return to hub
    } catch (error) {
        console.error("Error generating course:", error);
        showToast(`Failed to generate course: ${error.message}`, "error");
    } finally {
        showGlobalLoadingSpinner(false);
    }
}


// Firebase Firestore Operations
async function saveCourseToFirestore(courseData) {
    if (!db || !userId || !isAuthReady) {
        console.error("Firestore not initialized or user not authenticated.");
        showToast("App not ready. Please wait for authentication.", "error");
        return;
    }

    try {
        const courseRef = doc(db, `artifacts/${appId}/users/${userId}/courses`, courseData.course_id);
        await setDoc(courseRef, courseData);
        console.log("Course saved to Firestore:", courseData.course_id);
    } catch (e) {
        console.error("Error saving course to Firestore:", e);
        showToast("Error saving course.", "error");
    }
}

async function loadCourseList() {
    if (!db || !userId || !isAuthReady) {
        console.warn("Firestore not initialized or user not authenticated. Cannot load course list.");
        return;
    }

    showGlobalLoadingSpinner(true);
    try {
        const coursesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/courses`);
        const q = query(coursesCollectionRef); // No orderBy to avoid index issues

        const querySnapshot = await getDocs(q);
        courseList.innerHTML = ''; // Clear existing list
        let docCount = 0;
        querySnapshot.forEach((doc) => {
            docCount++;
            const course = doc.data();
            const courseItem = document.createElement('div');
            courseItem.className = 'bg-white p-4 rounded-lg shadow-md mb-2 cursor-pointer hover:bg-gray-100';
            courseItem.innerHTML = `
                <h3 class="font-bold text-lg">${course.title || 'Untitled Course'}</h3>
                <p class="text-gray-600 text-sm">${course.description || 'No description available.'}</p>
                <p class="text-gray-500 text-xs mt-1">Level: ${course.level || 'N/A'} | Cube: ${course.cubeType || 'N/A'}</p>
            `;
            courseItem.addEventListener('click', () => loadCourse(course));
            courseList.appendChild(courseItem);
        });
        console.log(`Received course snapshot with ${docCount} documents.`);
        if (docCount === 0) {
            courseList.innerHTML = '<p class="text-gray-500 text-center py-4">No courses found. Create a new one!</p>';
        }
    } catch (e) {
        console.error("Error loading course list:", e);
        showToast("Error loading courses.", "error");
    } finally {
        showGlobalLoadingSpinner(false);
    }
}

function loadCourse(course) {
    currentCourse = course;
    currentModuleIndex = 0;
    currentLessonIndex = 0;
    showSection(currentLessonView);
    displayCurrentLesson();
}

function displayCurrentLesson() {
    if (!currentCourse || !currentCourse.modules || currentCourse.modules.length === 0) {
        lessonTitleElement.textContent = "No Lessons Available";
        lessonContentElement.innerHTML = "<p>This course does not contain any modules or lessons.</p>";
        nextLessonButton.classList.add('hidden');
        prevLessonButton.classList.add('hidden');
        return;
    }

    const currentModule = currentCourse.modules[currentModuleIndex];
    if (!currentModule || !currentModule.lessons || currentModule.lessons.length === 0) {
        lessonTitleElement.textContent = "No Lessons in this Module";
        lessonContentElement.innerHTML = "<p>This module does not contain any lessons.</p>";
        nextLessonButton.classList.add('hidden');
        prevLessonButton.classList.add('hidden');
        return;
    }

    const currentLesson = currentModule.lessons[currentLessonIndex];
    if (!currentLesson) {
        lessonTitleElement.textContent = "Lesson Not Found";
        lessonContentElement.innerHTML = "<p>The requested lesson could not be found.</p>";
        nextLessonButton.classList.add('hidden');
        prevLessonButton.classList.add('hidden');
        return;
    }

    lessonTitleElement.textContent = `${currentModule.module_title}: ${currentLesson.lesson_title}`;
    let contentHtml = `<div class="prose max-w-none">${marked.parse(currentLesson.content || 'No content provided.')}</div>`;

    // Add specific content based on lesson type
    if (currentLesson.lesson_type === 'algorithm_drill' && currentLesson.algorithms && currentLesson.algorithms.length > 0) {
        contentHtml += '<h4 class="font-semibold mt-4">Algorithms:</h4><ul>';
        currentLesson.algorithms.forEach(algo => {
            contentHtml += `<li class="font-mono bg-gray-100 p-1 rounded-md my-1">${algo}</li>`;
        });
        contentHtml += '</ul>';
    } else if (currentLesson.lesson_type === 'scramble_practice' && currentLesson.scrambles && currentLesson.scrambles.length > 0) {
        contentHtml += '<h4 class="font-semibold mt-4">Scrambles:</h4><ul>';
        currentLesson.scrambles.forEach(scramble => {
            contentHtml += `<li class="font-mono bg-gray-100 p-1 rounded-md my-1">${scramble}</li>`;
        });
        contentHtml += '</ul>';
    } else if (currentLesson.lesson_type === 'interactive_quiz' && currentLesson.quiz_questions && currentLesson.quiz_questions.length > 0) {
        contentHtml += '<h4 class="font-semibold mt-4">Quiz:</h4>';
        currentLesson.quiz_questions.forEach((q, qIndex) => {
            contentHtml += `<div class="mb-4">
                <p class="font-medium">Q${qIndex + 1}: ${q.question}</p>
                <div class="options mt-1">`;
            q.options.forEach((option, oIndex) => {
                contentHtml += `<label class="block">
                    <input type="radio" name="question${qIndex}" value="${option}" class="mr-2">
                    ${option}
                </label>`;
            });
            contentHtml += `</div>
                <button class="check-answer-btn bg-blue-500 text-white px-3 py-1 rounded-md mt-2 text-sm" data-q-index="${qIndex}" data-answer="${Array.isArray(q.answer) ? q.answer.join('|') : q.answer}">Check Answer</button>
                <div class="feedback mt-1 text-sm"></div>
            </div>`;
        });
    }

    lessonContentElement.innerHTML = contentHtml;

    // Add event listeners for quiz buttons
    document.querySelectorAll('.check-answer-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const qIndex = event.target.dataset.qIndex;
            const correctAnswer = event.target.dataset.answer;
            const selectedOption = document.querySelector(`input[name="question${qIndex}"]:checked`);
            const feedbackElement = event.target.nextElementSibling; // The div.feedback after the button

            if (selectedOption) {
                const isCorrect = Array.isArray(correctAnswer.split('|')) ? correctAnswer.split('|').includes(selectedOption.value) : selectedOption.value === correctAnswer;
                if (isCorrect) {
                    feedbackElement.textContent = "Correct!";
                    feedbackElement.className = "feedback mt-1 text-sm text-green-600";
                    playSuccessSound();
                } else {
                    feedbackElement.textContent = `Incorrect. The correct answer was: ${correctAnswer.replace(/\|/g, ' or ')}.`;
                    feedbackElement.className = "feedback mt-1 text-sm text-red-600";
                    playErrorSound();
                }
            } else {
                feedbackElement.textContent = "Please select an option.";
                feedbackElement.className = "feedback mt-1 text-sm text-yellow-600";
            }
        });
    });


    // Update navigation button visibility
    const hasNext = (currentLessonIndex < currentModule.lessons.length - 1) || (currentModuleIndex < currentCourse.modules.length - 1);
    const hasPrev = (currentLessonIndex > 0) || (currentModuleIndex > 0);

    nextLessonButton.classList.toggle('hidden', !hasNext);
    prevLessonButton.classList.toggle('hidden', !hasPrev);
}

function showNextLesson() {
    const currentModule = currentCourse.modules[currentModuleIndex];
    if (currentLessonIndex < currentModule.lessons.length - 1) {
        currentLessonIndex++;
    } else if (currentModuleIndex < currentCourse.modules.length - 1) {
        currentModuleIndex++;
        currentLessonIndex = 0; // Reset lesson index for new module
    } else {
        showToast("You have completed the course, Sir Sevindu!", "success");
        return;
    }
    displayCurrentLesson();
}

function showPreviousLesson() {
    if (currentLessonIndex > 0) {
        currentLessonIndex--;
    } else if (currentModuleIndex > 0) {
        currentModuleIndex--;
        // Set to last lesson of previous module
        currentLessonIndex = currentCourse.modules[currentModuleIndex].lessons.length - 1;
    } else {
        showToast("You are at the beginning of the course, Sir Sevindu.", "info");
        return;
    }
    displayCurrentLesson();
}

// Tone.js sound functions
function playSuccessSound() {
    if (synth && Tone.context.state === 'running') {
        synth.triggerAttackRelease("C5", "8n"); // C5 note, 8th note duration
    }
}

function playErrorSound() {
    if (synth && Tone.context.state === 'running') {
        synth.triggerAttackRelease("C3", "8n"); // C3 note, 8th note duration
    }
}


/**
 * Loads the initial view based on authentication status.
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
    try {
        synth = new Tone.Synth().toDestination();
        // Do NOT call Tone.start() here. It will be called on first user interaction.
        console.log("[DEBUG] Tone.js Synth initialized (but not yet started).");
    } catch (e) {
        console.warn("[WARN] Tone.js initialization failed:", e.message);
        showToast("Audio playback may not work. Please interact with the page.", "info");
    }
});
