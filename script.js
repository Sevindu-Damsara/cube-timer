// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, collection, query, addDoc, deleteDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global variables for Firebase and user data
let app;
let db;
let auth;
let userId; // Will store the authenticated user's ID or a random ID for anonymous users
let userSettings = {}; // Stores user-specific settings (e.g., sound volume, wake word)
let userSolves = []; // Stores user's solve times
let firestoreUnsubscribe = null; // To store the unsubscribe function for Firestore listener

// Global variables for timer and UI state
let timer;
let startTime;
let running = false;
let inspectionTime = 15; // Default inspection time in seconds
let inspectionTimerId;
let inspectionCountdown = inspectionTime;
let scramble = '';
let domElementsReady = false; // Flag to ensure DOM is loaded before accessing elements
let authReady = false; // Flag to ensure Firebase Auth is initialized and user is signed in

// DOM Elements - Declared globally for easy access
let timerDisplay;
let scrambleDisplay;
let startStopButton;
let resetButton;
let settingsButton;
let ao5Display, ao12Display, bestTimeDisplay, totalSolvesDisplay;
let solvesList;
let settingsModalOverlay, settingsModalContent;
let inspectionTimeInput, soundVolumeInput, wakeWordInput, themeSelect;
let saveSettingsButton, cancelSettingsButton;
let messageBoxOverlay, messageBoxContent, messageBoxTitle, messageBoxMessage, messageBoxConfirmButton, messageBoxCancelButton;
let twistyPlayer;
let themeToggle;

// Web Speech API variables
let recognition;
let wakeWord = "Jarvis"; // Default wake word
let wakeWordDetected = false;
let isListeningForWakeWord = false;
let isListeningForCommand = false;
let speechSynthesisUtterance;
let speechRecognitionAttempts = 0;
const MAX_SPEECH_RECOGNITION_ATTEMPTS = 5;
const SPEECH_RECOGNITION_RETRY_DELAY_MS = 3000; // 3 seconds

// Tone.js for audio feedback
let dingSound, countdownBeep, startSound, stopSound;

/**
 * Initializes Tone.js audio context and loads sounds.
 * This should be called after a user gesture to bypass browser autoplay policies.
 */
async function initializeAudio() {
    console.log("[DEBUG] Initializing audio context and loading sounds.");
    try {
        await Tone.start(); // Start Tone.js audio context
        console.log("Tone.js audio context started.");

        // Create audio players for sound effects
        dingSound = new Tone.Player("https://cdn.jsdelivr.net/gh/Tonejs/Tone.js/examples/assets/audio/ding.mp3").toDestination();
        countdownBeep = new Tone.Player("https://cdn.jsdelivr.net/gh/Tonejs/Tone.js/examples/assets/audio/beep.mp3").toDestination();
        startSound = new Tone.Player("https://cdn.jsdelivr.net/gh/Tonejs/Tone.js/examples/assets/audio/start.mp3").toDestination();
        stopSound = new Tone.Player("https://cdn.jsdelivr.net/gh/Tonejs/Tone.js/examples/assets/audio/stop.mp3").toDestination();

        // Adjust volume based on user settings
        updateSoundVolume(userSettings.soundVolume || 0.5); // Default to 0.5 if not set

        console.log("[DEBUG] Audio assets loaded and volume set.");
    } catch (error) {
        console.error("Error initializing audio:", error);
        showToast("Error initializing audio. Please ensure browser permissions.", "error");
    }
}

/**
 * Updates the volume of all loaded sound effects.
 * @param {number} volume - The volume level (0.0 to 1.0).
 */
function updateSoundVolume(volume) {
    const dbVolume = Tone.gainToDb(volume); // Convert linear volume to decibels
    if (dingSound) dingSound.volume.value = dbVolume;
    if (countdownBeep) countdownBeep.volume.value = dbVolume;
    if (startSound) startSound.volume.value = dbVolume;
    if (stopSound) stopSound.volume.value = dbVolume;
    console.log(`[DEBUG] Sound volume updated to: ${volume} (dB: ${dbVolume})`);
}

/**
 * Plays a specified sound.
 * @param {Tone.Player} soundPlayer - The Tone.js Player object to play.
 */
function playSound(soundPlayer) {
    if (soundPlayer && Tone.context.state === 'running') {
        soundPlayer.start();
    }
}

/**
 * Formats time in milliseconds to a human-readable string (MM:SS.mmm).
 * @param {number} milliseconds - The time in milliseconds.
 * @returns {string} Formatted time string.
 */
function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const ms = milliseconds % 1000;

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Generates a random 3x3 Rubik's Cube scramble.
 * @returns {string} The scramble string.
 */
function generateScramble() {
    const moves = ["R", "L", "F", "B", "U", "D"];
    const modifiers = ["", "'", "2"];
    let newScramble = [];
    let lastMoveAxis = -1; // 0: R/L, 1: F/B, 2: U/D

    for (let i = 0; i < 20; i++) { // Typically 20-25 moves for 3x3
        let moveIndex;
        let moveAxis;
        do {
            moveIndex = Math.floor(Math.random() * moves.length);
            moveAxis = Math.floor(moveIndex / 2); // 0 for R/L, 1 for F/B, 2 for U/D
        } while (moveAxis === lastMoveAxis); // Prevent moves on the same axis consecutively

        const modifier = modifiers[Math.floor(Math.random() * modifiers.length)];
        newScramble.push(moves[moveIndex] + modifier);
        lastMoveAxis = moveAxis;
    }
    const generatedScramble = newScramble.join(" ");
    scrambleDisplay.textContent = generatedScramble;
    updateTwistyPlayer(generatedScramble);
    console.log("[DEBUG] Generated scramble:", generatedScramble);
    return generatedScramble;
}

/**
 * Updates the Twisty Player with the current scramble.
 * @param {string} scrambleText - The scramble string to display.
 */
function updateTwistyPlayer(scrambleText) {
    if (twistyPlayer) {
        twistyPlayer.alg = scrambleText;
        twistyPlayer.experimentalSetupAlg = scrambleText; // For initial setup
        twistyPlayer.puzzle = "3x3x3"; // Ensure puzzle type is set
        twistyPlayer.hint = "auto"; // Show hints for optimal solving
        twistyPlayer.camera = "auto"; // Adjust camera automatically
        twistyPlayer.tempo = 3; // Adjust speed of animation
        twistyPlayer.backView = "top-right";
        twistyPlayer.prefersColorScheme = userSettings.theme === 'light' ? 'light' : 'dark';
        console.log("[DEBUG] Twisty Player updated with scramble:", scrambleText);
    }
}

/**
 * Starts the inspection timer.
 */
function startInspection() {
    console.log("[DEBUG] Starting inspection timer.");
    inspectionCountdown = userSettings.inspectionTime || 15;
    timerDisplay.textContent = `Inspection: ${inspectionCountdown.toString().padStart(2, '0')}`;
    startStopButton.textContent = 'Ready!';
    startStopButton.disabled = false; // Enable button for inspection
    resetButton.disabled = false; // Enable reset during inspection

    inspectionTimerId = setInterval(() => {
        inspectionCountdown--;
        if (inspectionCountdown >= 0) {
            timerDisplay.textContent = `Inspection: ${inspectionCountdown.toString().padStart(2, '0')}`;
            if (inspectionCountdown <= 3 && inspectionCountdown > 0) {
                playSound(countdownBeep); // Play beep for last 3 seconds
            } else if (inspectionCountdown === 0) {
                playSound(dingSound); // Play ding at 0
            }
        } else {
            clearInterval(inspectionTimerId);
            timerDisplay.textContent = `+2 Penalty!`; // Indicate penalty
            playSound(dingSound); // Play ding for penalty
            // Automatically start timer after penalty if not manually started
            startTimer(true); // Pass true to indicate +2 penalty
        }
    }, 1000);
}

/**
 * Starts the main solve timer.
 * @param {boolean} addTwoPenalty - True if a +2 penalty should be applied immediately.
 */
function startTimer(addTwoPenalty = false) {
    console.log("[DEBUG] Starting main timer.");
    clearInterval(inspectionTimerId); // Clear inspection timer
    running = true;
    startTime = Date.now();
    if (addTwoPenalty) {
        startTime -= 2000; // Apply +2 penalty by adjusting start time
        showToast("+2 Penalty applied!", "info");
    }
    startStopButton.textContent = 'Stop';
    startStopButton.disabled = false;
    resetButton.disabled = true; // Disable reset while timer is running
    playSound(startSound);

    timer = setInterval(() => {
        const elapsedTime = Date.now() - startTime;
        timerDisplay.textContent = formatTime(elapsedTime);
    }, 10); // Update every 10ms for smooth display
}

/**
 * Stops the timer, records the solve, and updates statistics.
 */
async function stopTimer() {
    console.log("[DEBUG] Stopping timer.");
    clearInterval(timer);
    running = false;
    const solveTime = Date.now() - startTime;
    startStopButton.textContent = 'Start';
    startStopButton.disabled = false;
    resetButton.disabled = false;
    playSound(stopSound);

    const newSolve = {
        time: solveTime,
        scramble: scramble,
        date: serverTimestamp() // Use server timestamp for consistency
    };

    userSolves.push(newSolve);
    await saveSolveToFirestore(newSolve); // Save to Firestore
    updateStatistics();
    renderSolvesList();
    scramble = generateScramble(); // Generate new scramble for next solve
}

/**
 * Resets the timer and generates a new scramble.
 */
function resetTimer() {
    console.log("[DEBUG] Resetting timer.");
    clearInterval(timer);
    clearInterval(inspectionTimerId);
    running = false;
    timerDisplay.textContent = '00:00.000';
    startStopButton.textContent = 'Start';
    startStopButton.disabled = false;
    resetButton.disabled = false;
    inspectionCountdown = userSettings.inspectionTime || 15; // Reset inspection countdown
    scramble = generateScramble(); // Generate new scramble
    console.log("[DEBUG] Timer reset complete.");
}

/**
 * Updates all displayed statistics (Ao5, Ao12, Best Time, Total Solves).
 */
function updateStatistics() {
    if (userSolves.length === 0) {
        ao5Display.textContent = 'N/A';
        ao12Display.textContent = 'N/A';
        bestTimeDisplay.textContent = 'N/A';
        totalSolvesDisplay.textContent = '0';
        return;
    }

    // Sort solves by time for best time calculation
    const sortedSolves = [...userSolves].sort((a, b) => a.time - b.time);
    bestTimeDisplay.textContent = formatTime(sortedSolves[0].time);
    totalSolvesDisplay.textContent = userSolves.length.toString();

    // Calculate Ao5 (Average of 5)
    if (userSolves.length >= 5) {
        const lastFive = userSolves.slice(-5).map(s => s.time).sort((a, b) => a - b);
        // Remove fastest and slowest, then average the middle three
        const ao5 = (lastFive[1] + lastFive[2] + lastFive[3]) / 3;
        ao5Display.textContent = formatTime(ao5);
    } else {
        ao5Display.textContent = 'N/A';
    }

    // Calculate Ao12 (Average of 12)
    if (userSolves.length >= 12) {
        const lastTwelve = userSolves.slice(-12).map(s => s.time).sort((a, b) => a - b);
        // Remove fastest and slowest two, then average the middle eight
        const ao12 = lastTwelve.slice(2, -2).reduce((sum, time) => sum + time, 0) / 8;
        ao12Display.textContent = formatTime(ao12);
    } else {
        ao12Display.textContent = 'N/A';
    }
    console.log("[DEBUG] Statistics updated.");
}

/**
 * Renders the list of recorded solves in the UI.
 */
function renderSolvesList() {
    solvesList.innerHTML = ''; // Clear existing list
    userSolves.slice().reverse().forEach((solve, index) => { // Display most recent first
        const li = document.createElement('li');
        // Use a unique ID for each solve item for deletion, ideally from Firestore doc ID
        const solveId = solve.id || `local-${Date.now()}-${index}`; // Fallback for local solves
        li.setAttribute('data-id', solveId);
        li.innerHTML = `
            <span>${userSolves.length - index}. ${formatTime(solve.time)}</span>
            <button class="delete-solve-button" aria-label="Delete solve" data-id="${solveId}">
                &times;
            </button>
        `;
        solvesList.appendChild(li);
    });
    console.log("[DEBUG] Solves list rendered.");
}

/**
 * Displays a custom message box.
 * @param {string} title - The title of the message box.
 * @param {string} message - The message content.
 * @param {boolean} showCancel - Whether to show a cancel button.
 * @returns {Promise<boolean>} A promise that resolves to true if confirmed, false if cancelled.
 */
function showMessageBox(title, message, showCancel = false) {
    return new Promise(resolve => {
        messageBoxTitle.textContent = title;
        messageBoxMessage.textContent = message;
        messageBoxCancelButton.style.display = showCancel ? 'inline-block' : 'none';

        const confirmHandler = () => {
            messageBoxOverlay.classList.remove('show');
            messageBoxConfirmButton.removeEventListener('click', confirmHandler);
            messageBoxCancelButton.removeEventListener('click', cancelHandler);
            resolve(true);
        };

        const cancelHandler = () => {
            messageBoxOverlay.classList.remove('show');
            messageBoxConfirmButton.removeEventListener('click', confirmHandler);
            messageBoxCancelButton.removeEventListener('click', cancelHandler);
            resolve(false);
        };

        messageBoxConfirmButton.addEventListener('click', confirmHandler);
        messageBoxCancelButton.addEventListener('click', cancelHandler);

        messageBoxOverlay.classList.add('show');
    });
}

/**
 * Displays a toast notification.
 * @param {string} message - The message to display.
 * @param {'success'|'error'|'info'} type - The type of toast (for styling/icon).
 * @param {number} duration - How long the toast should be visible in ms.
 */
function showToast(message, type = 'info', duration = 3000) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        console.error("Toast container not found.");
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${getToastIcon(type)}</span>
        <span class="toast-message">${message}</span>
    `;

    toastContainer.appendChild(toast);

    // Trigger reflow to ensure transition plays
    void toast.offsetWidth;

    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide'); // Add hide class for exit animation
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, duration);
}

/**
 * Returns an icon string based on toast type.
 * @param {string} type - 'success', 'error', or 'info'.
 * @returns {string} HTML entity or SVG for the icon.
 */
function getToastIcon(type) {
    switch (type) {
        case 'success': return '&#10003;'; // Checkmark
        case 'error': return '&#10007;'; // X mark
        case 'info': return '&#8505;'; // Info icon
        default: return '';
    }
}

/**
 * Initializes Firebase, authenticates the user, and sets up Firestore listeners.
 */
async function initializeFirebase() {
    console.log("[DEBUG] Initializing Firebase...");
    try {
        // __firebase_config and __app_id are global variables provided by the Canvas environment
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

        if (Object.keys(firebaseConfig).length === 0) {
            console.warn("[WARN] Firebase config not found. Running in standalone mode without persistence.");
            authReady = true; // Allow app to run without Firebase
            return;
        }

        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Sign in with custom token if available, otherwise anonymously
        // __initial_auth_token is provided by the Canvas environment
        if (typeof __initial_auth_token !== 'undefined') {
            await signInWithCustomToken(auth, __initial_auth_token);
            console.log("[DEBUG] Signed in with custom token.");
        } else {
            await signInAnonymously(auth);
            console.log("[DEBUG] Signed in anonymously.");
        }

        // Listen for auth state changes
        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                console.log("[DEBUG] Auth state changed. User ID:", userId);
                authReady = true;
                // Once authenticated, attempt to initialize user data and settings
                initializeUserDataAndSettings();
            } else {
                userId = null;
                authReady = false;
                console.log("[DEBUG] User is signed out or not authenticated.");
                // Optionally clear user data if signed out
                userSettings = {};
                userSolves = [];
                updateStatistics();
                renderSolvesList();
                if (firestoreUnsubscribe) {
                    firestoreUnsubscribe(); // Unsubscribe from old listener
                    firestoreUnsubscribe = null;
                }
            }
        });

        console.log("[DEBUG] Firebase initialized and auth listener set up.");
    } catch (error) {
        console.error("[ERROR] Firebase initialization failed:", error);
        showToast("Error initializing Firebase. Data persistence may not work.", "error");
        authReady = true; // Still allow app to run, but without persistence
    }
}

/**
 * Initializes user data and settings from Firestore.
 * This function is called once DOM is ready AND auth is ready.
 */
async function initializeUserDataAndSettings() {
    if (!domElementsReady || !authReady || !userId) {
        console.log("[DEBUG] Waiting for DOM or Auth to be ready before initializing user data.");
        return;
    }
    console.log("[DEBUG] Initializing user data and settings for user:", userId);

    // Setup Firestore listener for settings
    const settingsDocRef = doc(db, `artifacts/${__app_id}/users/${userId}/settings/user_settings`);
    firestoreUnsubscribe = onSnapshot(settingsDocRef, (docSnap) => {
        if (docSnap.exists()) {
            userSettings = docSnap.data();
            console.log("[DEBUG] User settings loaded:", userSettings);
            applySettingsToUI();
        } else {
            console.log("[DEBUG] No user settings found, using defaults.");
            userSettings = {
                inspectionTime: 15,
                soundVolume: 0.5,
                wakeWord: "Jarvis",
                theme: "dark"
            };
            // Save default settings to Firestore if they don't exist
            saveSettingsToFirestore(userSettings);
        }
        // Ensure audio is initialized and volume is set after settings are loaded
        if (Tone.context.state !== 'running') {
            initializeAudio();
        } else {
            updateSoundVolume(userSettings.soundVolume);
        }
        updateTwistyPlayer(scramble); // Update theme for twisty player
    }, (error) => {
        console.error("[ERROR] Error fetching user settings:", error);
        showToast("Error loading settings.", "error");
    });

    // Setup Firestore listener for solves
    const solvesCollectionRef = collection(db, `artifacts/${__app_id}/users/${userId}/solves`);
    const q = query(solvesCollectionRef); // No orderBy to avoid index issues
    onSnapshot(q, (snapshot) => {
        userSolves = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            userSolves.push({ id: doc.id, ...data });
        });
        // Sort solves by date client-side
        userSolves.sort((a, b) => (a.date?.toMillis() || 0) - (b.date?.toMillis() || 0));
        console.log("[DEBUG] User solves loaded:", userSolves);
        updateStatistics();
        renderSolvesList();
    }, (error) => {
        console.error("[ERROR] Error fetching user solves:", error);
        showToast("Error loading solves.", "error");
    });
}

/**
 * Applies loaded user settings to the UI elements.
 */
function applySettingsToUI() {
    if (inspectionTimeInput) inspectionTimeInput.value = userSettings.inspectionTime || 15;
    if (soundVolumeInput) soundVolumeInput.value = userSettings.soundVolume || 0.5;
    if (wakeWordInput) wakeWordInput.value = userSettings.wakeWord || "Jarvis";
    if (themeSelect) themeSelect.value = userSettings.theme || "dark";

    // Apply theme
    document.body.classList.toggle('light-theme', userSettings.theme === 'light');
    if (twistyPlayer) {
        twistyPlayer.prefersColorScheme = userSettings.theme === 'light' ? 'light' : 'dark';
    }

    // Update global wake word
    wakeWord = userSettings.wakeWord || "Jarvis";
    updateSoundVolume(userSettings.soundVolume || 0.5); // Ensure volume is applied
    console.log("[DEBUG] Settings applied to UI.");
}

/**
 * Saves user settings to Firestore.
 * @param {object} settings - The settings object to save.
 */
async function saveSettingsToFirestore(settings) {
    if (!db || !userId) {
        console.warn("[WARN] Firestore not initialized or user not authenticated. Cannot save settings.");
        showToast("Cannot save settings: Not connected to database.", "error");
        return;
    }
    try {
        const settingsDocRef = doc(db, `artifacts/${__app_id}/users/${userId}/settings/user_settings`);
        await setDoc(settingsDocRef, settings, { merge: true });
        userSettings = { ...userSettings, ...settings }; // Update local state
        applySettingsToUI(); // Re-apply to ensure UI reflects saved state
        showToast("Settings saved successfully!", "success");
        console.log("[DEBUG] Settings saved to Firestore:", settings);
    } catch (error) {
        console.error("[ERROR] Error saving settings to Firestore:", error);
        showToast("Error saving settings.", "error");
    }
}

/**
 * Saves a new solve time to Firestore.
 * @param {object} solveData - The solve object to save.
 */
async function saveSolveToFirestore(solveData) {
    if (!db || !userId) {
        console.warn("[WARN] Firestore not initialized or user not authenticated. Cannot save solve.");
        showToast("Cannot save solve: Not connected to database.", "error");
        return;
    }
    try {
        const solvesCollectionRef = collection(db, `artifacts/${__app_id}/users/${userId}/solves`);
        const docRef = await addDoc(solvesCollectionRef, solveData);
        // Update the local solve object with the Firestore document ID
        // This is important for deletion later
        const index = userSolves.findIndex(s => s === solveData);
        if (index !== -1) {
            userSolves[index].id = docRef.id;
        }
        showToast("Solve recorded!", "success");
        console.log("[DEBUG] Solve saved to Firestore with ID:", docRef.id);
    } catch (error) {
        console.error("[ERROR] Error saving solve to Firestore:", error);
        showToast("Error recording solve.", "error");
    }
}

/**
 * Deletes a solve from Firestore.
 * @param {string} solveId - The ID of the solve document to delete.
 */
async function deleteSolveFromFirestore(solveId) {
    if (!db || !userId) {
        console.warn("[WARN] Firestore not initialized or user not authenticated. Cannot delete solve.");
        showToast("Cannot delete solve: Not connected to database.", "error");
        return;
    }
    try {
        const confirmDelete = await showMessageBox(
            "Confirm Deletion",
            "Are you sure you want to delete this solve?",
            true
        );
        if (confirmDelete) {
            const solveDocRef = doc(db, `artifacts/${__app_id}/users/${userId}/solves`, solveId);
            await deleteDoc(solveDocRef);
            // Firestore listener will automatically update userSolves and UI
            showToast("Solve deleted.", "info");
            console.log("[DEBUG] Solve deleted from Firestore:", solveId);
        }
    } catch (error) {
        console.error("[ERROR] Error deleting solve from Firestore:", error);
        showToast("Error deleting solve.", "error");
    }
}

/**
 * Initializes Web Speech API for wake word detection and command recognition.
 */
function initializeSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        console.warn("Web Speech API not supported by this browser.");
        showToast("Speech recognition not supported.", "info", 5000);
        return;
    }

    recognition = new webkitSpeechRecognition();
    recognition.continuous = true; // Keep listening
    recognition.interimResults = false; // Only return final results
    recognition.lang = 'en-US';

    speechSynthesisUtterance = new SpeechSynthesisUtterance();
    speechSynthesisUtterance.lang = 'en-US';

    recognition.onstart = () => {
        isListeningForWakeWord = true;
        isListeningForCommand = false; // Reset command listening state
        speechRecognitionAttempts = 0; // Reset attempts on successful start
        console.log("[DEBUG] SpeechRecognition started. Listening for wake word...");
    };

    recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim().toLowerCase();
        console.log("[DEBUG] Speech result:", transcript);

        if (isListeningForWakeWord) {
            if (transcript.includes(wakeWord.toLowerCase())) {
                console.log(`[DEBUG] Wake word "${wakeWord}" detected!`);
                wakeWordDetected = true;
                isListeningForWakeWord = false; // Stop listening for wake word
                isListeningForCommand = true; // Start listening for command
                speak(`At your service, Sir Sevindu. What is your command?`);
                // Briefly stop and restart recognition to change mode if needed,
                // or just process commands in the next onresult.
                // For simplicity, we'll just set a flag and handle commands in the next recognition cycle.
                // Alternatively, recognition.stop() and then start a new one with different settings.
                // For continuous, we just rely on flags.
            }
        } else if (isListeningForCommand) {
            handleVoiceCommand(transcript);
            isListeningForCommand = false; // Process one command then go back to wake word
            wakeWordDetected = false; // Reset wake word detection
            attemptRestartRecognition(); // Go back to wake word listening
        }
    };

    recognition.onerror = (event) => {
        console.error("[ERROR] SpeechRecognition error:", event.error);
        showToast(`Speech error: ${event.error}.`, "error");
        isListeningForWakeWord = false;
        isListeningForCommand = false;
        wakeWordDetected = false; // Reset wake word detection

        // Attempt to restart recognition after an error, with a delay and retry limit
        if (speechRecognitionAttempts < MAX_SPEECH_RECOGNITION_ATTEMPTS) {
            speechRecognitionAttempts++;
            console.log(`[DEBUG] Attempting to restart SpeechRecognition (attempt ${speechRecognitionAttempts}/${MAX_SPEECH_RECOGNITION_ATTEMPTS})...`);
            setTimeout(attemptRestartRecognition, SPEECH_RECOGNITION_RETRY_DELAY_MS);
        } else {
            console.error("[ERROR] Max SpeechRecognition retry attempts reached. Giving up.");
            showToast("Speech recognition failed after multiple attempts. Please check microphone.", "error", 7000);
        }
    };

    recognition.onend = () => {
        console.log("[DEBUG] SpeechRecognition ended.");
        // If it ended unexpectedly and we are not intentionally stopping it, try to restart
        if (!isListeningForWakeWord && !isListeningForCommand && speechRecognitionAttempts < MAX_SPEECH_RECOGNITION_ATTEMPTS) {
            console.log("[DEBUG] Recognition ended unexpectedly, attempting restart...");
            speechRecognitionAttempts++;
            setTimeout(attemptRestartRecognition, SPEECH_RECOGNITION_RETRY_DELAY_MS);
        }
    };

    // Initial start attempt
    attemptRestartRecognition();
}

/**
 * Attempts to start or restart speech recognition.
 * Handles cases where recognition might already be active.
 */
function attemptRestartRecognition() {
    if (recognition && !isListeningForWakeWord && !isListeningForCommand) {
        try {
            recognition.start();
        } catch (e) {
            console.warn("[WARN] recognition.start() call failed, likely already running or permission issue:", e);
            // If it's already running, onstart will handle the state.
            // If it's a permission issue, onerror will catch it.
        }
    }
}

/**
 * Handles recognized voice commands.
 * @param {string} command - The transcribed voice command.
 */
function handleVoiceCommand(command) {
    console.log("[DEBUG] Handling voice command:", command);
    if (command.includes("start timer") || command.includes("begin solve")) {
        if (!running) {
            if (userSettings.inspectionTime > 0) {
                startInspection();
                speak("Inspection time started.");
            } else {
                startTimer();
                speak("Timer started.");
            }
        } else {
            speak("The timer is already running, Sir Sevindu.");
        }
    } else if (command.includes("stop timer") || command.includes("finish solve")) {
        if (running) {
            stopTimer();
            speak("Timer stopped. Solve recorded.");
        } else {
            speak("The timer is not running, Sir Sevindu.");
        }
    } else if (command.includes("reset timer") || command.includes("new scramble")) {
        resetTimer();
        speak("Timer reset. New scramble generated.");
    } else if (command.includes("open settings")) {
        showSettingsModal();
        speak("Opening settings, Sir Sevindu.");
    } else if (command.includes("close settings")) {
        hideSettingsModal();
        speak("Closing settings.");
    } else if (command.includes("what is my best time")) {
        const bestTime = userSolves.length > 0 ? formatTime(userSolves.sort((a, b) => a.time - b.time)[0].time) : "not available yet";
        speak(`Your best time is ${bestTime}, Sir Sevindu.`);
    } else if (command.includes("how many solves")) {
        speak(`You have recorded ${userSolves.length} solves, Sir Sevindu.`);
    } else if (command.includes("tell me the scramble")) {
        speak(`The current scramble is ${scramble.split('').join('. ')}. Good luck, Sir Sevindu.`);
    } else if (command.includes("change theme to light")) {
        if (userSettings.theme !== 'light') {
            saveSettingsToFirestore({ theme: 'light' });
            speak("Theme changed to light.");
        } else {
            speak("The theme is already light, Sir Sevindu.");
        }
    } else if (command.includes("change theme to dark")) {
        if (userSettings.theme !== 'dark') {
            saveSettingsToFirestore({ theme: 'dark' });
            speak("Theme changed to dark.");
        } else {
            speak("The theme is already dark, Sir Sevindu.");
        }
    } else {
        speak("I did not understand that command, Sir Sevindu. Please try again.");
    }
}

/**
 * Speaks the given text using Web Speech Synthesis API.
 * @param {string} text - The text to speak.
 */
function speak(text) {
    if ('speechSynthesis' in window) {
        speechSynthesisUtterance.text = text;
        window.speechSynthesis.speak(speechSynthesisUtterance);
        console.log("[DEBUG] Speaking:", text);
    } else {
        console.warn("Speech Synthesis API not supported.");
    }
}

/**
 * Shows the settings modal.
 */
function showSettingsModal() {
    // Populate modal inputs with current settings
    inspectionTimeInput.value = userSettings.inspectionTime || 15;
    soundVolumeInput.value = userSettings.soundVolume || 0.5;
    wakeWordInput.value = userSettings.wakeWord || "Jarvis";
    themeSelect.value = userSettings.theme || "dark";
    settingsModalOverlay.classList.add('show');
    console.log("[DEBUG] Settings modal shown.");
}

/**
 * Hides the settings modal.
 */
function hideSettingsModal() {
    settingsModalOverlay.classList.remove('show');
    console.log("[DEBUG] Settings modal hidden.");
}

/**
 * Attaches all event listeners to DOM elements.
 */
function setupEventListeners() {
    console.log("[DEBUG] Setting up event listeners.");

    // Get DOM elements
    timerDisplay = document.getElementById('timer-display');
    scrambleDisplay = document.getElementById('scramble-display');
    startStopButton = document.getElementById('start-stop-button');
    resetButton = document.getElementById('reset-button');
    settingsButton = document.getElementById('settings-button');
    ao5Display = document.getElementById('ao5-display');
    ao12Display = document.getElementById('ao12-display');
    bestTimeDisplay = document.getElementById('best-time-display');
    totalSolvesDisplay = document.getElementById('total-solves-display');
    solvesList = document.getElementById('solves-list');
    settingsModalOverlay = document.getElementById('settings-modal-overlay');
    settingsModalContent = document.getElementById('settings-modal-content');
    inspectionTimeInput = document.getElementById('inspection-time-input');
    soundVolumeInput = document.getElementById('sound-volume-input');
    wakeWordInput = document.getElementById('wake-word-input');
    themeSelect = document.getElementById('theme-select');
    saveSettingsButton = document.getElementById('save-settings-button');
    cancelSettingsButton = document.getElementById('cancel-settings-button');
    messageBoxOverlay = document.getElementById('message-box-overlay');
    messageBoxContent = document.getElementById('message-box-content');
    messageBoxTitle = document.getElementById('message-box-title');
    messageBoxMessage = document.getElementById('message-box-message');
    messageBoxConfirmButton = document.getElementById('message-box-confirm-button');
    messageBoxCancelButton = document.getElementById('message-box-cancel-button');
    twistyPlayer = document.getElementById('twisty-player');
    themeToggle = document.getElementById('theme-toggle');


    // Event Listeners
    startStopButton.addEventListener('click', () => {
        if (running) {
            stopTimer();
        } else {
            if (userSettings.inspectionTime > 0) {
                startInspection();
            } else {
                startTimer();
            }
        }
    });

    resetButton.addEventListener('click', resetTimer);
    settingsButton.addEventListener('click', showSettingsModal);

    // Close settings modal
    settingsModalOverlay.addEventListener('click', (e) => {
        if (e.target === settingsModalOverlay) {
            hideSettingsModal();
        }
    });
    settingsModalContent.querySelector('.close-button').addEventListener('click', hideSettingsModal);
    cancelSettingsButton.addEventListener('click', hideSettingsModal);

    // Save settings
    saveSettingsButton.addEventListener('click', () => {
        const newSettings = {
            inspectionTime: parseInt(inspectionTimeInput.value),
            soundVolume: parseFloat(soundVolumeInput.value),
            wakeWord: wakeWordInput.value.trim(),
            theme: themeSelect.value
        };
        saveSettingsToFirestore(newSettings);
        hideSettingsModal();
    });

    // Delegate event for deleting solves
    solvesList.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-solve-button')) {
            const solveId = e.target.dataset.id;
            if (solveId) {
                deleteSolveFromFirestore(solveId);
            }
        }
    });

    // Theme toggle via settings, but also a direct toggle for convenience
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const newTheme = document.body.classList.contains('light-theme') ? 'dark' : 'light';
            saveSettingsToFirestore({ theme: newTheme });
        });
    }

    // Initialize Twisty Player
    updateTwistyPlayer(scramble);

    // Initialize speech recognition after DOM is ready and user has interacted (implicit by loading app)
    initializeSpeechRecognition();
}

// Ensure DOM is fully loaded before accessing elements
window.onload = function () {
    console.log("[DEBUG] window.onload triggered.");
    // Set flag that DOM elements are ready
    domElementsReady = true;

    // CRITICAL FIX: Ensure DOM elements are assigned BEFORE they are used.
    setupEventListeners(); // Attaches all event listeners to DOM elements and assigns global variables

    // Now that DOM elements are assigned, generate scramble and update displays
    scramble = generateScramble(); // Generates initial scramble and updates displays

    // Attempt to initialize user data and settings now that DOM is ready.
    // This function itself checks if Firebase Auth is also ready.
    initializeUserDataAndSettings();

    // Start continuous listening for wake word if Web Speech API is supported
    if (recognition) {
        try {
            console.log("[DEBUG] Initial SpeechRecognition.start() called for continuous wake word listening via attemptRestartRecognition.");
            attemptRestartRecognition(); // Use the controlled restart for initial start
        } catch (e) {
            console.error("[ERROR] Initial recognition.start() failed:", e);
            // This can happen if microphone is not available or permissions are denied initially.
            // The onerror will likely catch this and log/handle it.
        }
    } else {
        console.warn("[WARN] Web Speech API not supported, cannot start continuous listening.");
    }

    console.log("[DEBUG] window.onload complete. Application should now be fully initialized.");
};

// Initialize Firebase immediately, it doesn't depend on DOM
initializeFirebase();
