// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
console.log("[DEBUG] Firebase imports for settings.js completed.");

// =====================================================================================================
// --- IMPORTANT: Firebase Configuration for Hosting (Duplicate for self-containment) ---
// These are duplicated from script.js to ensure settings.js can function independently.
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
// =====================================================================================================

let app;
let db;
let auth;
let userId = null;
let isAuthReady = false; // Flag to indicate if Firebase auth state has been determined
let isUserAuthenticated = false; // True if user is signed in via Email/Google, false for guests/signed out

// Settings variables (local state for this page)
let enableInspection = true;
let enableSoundEffects = true;
let cubeType = '3x3';
let currentTheme = 'dark';
let show3DCubeView = false;

// DOM elements
let settingsUsernameInput;
let saveUsernameBtn;
let usernameUpdateMessage;
let inspectionToggle;
let soundEffectsToggle;
let cubeTypeSelect;
let themeSelect;
let cubeViewToggle;

// Global variable for initial auth token (provided by Canvas environment)
const __initial_auth_token = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;

// --- Local Storage Functions for Guest Mode ---
const LOCAL_STORAGE_PREFIX = `${appId}_guest_`;

/**
 * Loads user settings from local storage.
 */
function loadLocalUserSettings() {
    console.log("[DEBUG] settings.js: Loading user settings from local storage.");
    try {
        const storedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (storedSettings) {
            const settings = JSON.parse(storedSettings);
            enableInspection = settings.enableInspection !== undefined ? settings.enableInspection : true;
            enableSoundEffects = settings.enableSoundEffects !== undefined ? settings.enableSoundEffects : true;
            cubeType = settings.cubeType || '3x3';
            currentTheme = settings.theme || 'dark';
            show3DCubeView = settings.show33DCubeView !== undefined ? settings.show3DCubeView : false; // Load new setting
            console.log("[DEBUG] settings.js: User settings loaded from local storage:", settings);
        } else {
            console.log("[DEBUG] settings.js: No user settings found in local storage, using defaults.");
            saveLocalUserSettings(); // Save defaults for next time
        }
    } catch (e) {
        console.error("[ERROR] settings.js: Error loading settings from local storage:", e);
    }
    applySettingsToUI();
}

/**
 * Saves current user settings to local storage.
 */
function saveLocalUserSettings() {
    console.log("[DEBUG] settings.js: Saving user settings to local storage.");
    try {
        const settingsToSave = {
            enableInspection: enableInspection,
            enableSoundEffects: enableSoundEffects,
            cubeType: cubeType,
            theme: currentTheme,
            show3DCubeView: show3DCubeView, // Save new setting
            lastUpdated: Date.now()
        };
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}settings`, JSON.stringify(settingsToSave));
        console.log("[DEBUG] settings.js: User settings saved to local storage.");
    } catch (e) {
        console.error("[ERROR] settings.js: Error saving settings to local storage:", e);
    }
}

/**
 * Loads username from local storage.
 */
function loadLocalUsername() {
    console.log("[DEBUG] settings.js: Loading username from local storage.");
    return localStorage.getItem(`${LOCAL_STORAGE_PREFIX}username`) || ''; // Return empty string if not found
}

/**
 * Saves username to local storage.
 */
function saveLocalUsername(username) {
    console.log("[DEBUG] settings.js: Saving username to local storage.");
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}username`, username);
}

/**
 * Loads user settings. Uses Firestore for authenticated users, Local Storage for guests.
 */
async function loadUserSettings() {
    console.log("[DEBUG] settings.js: Entering loadUserSettings.");
    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] settings.js: Authenticated and Firestore ready. Attempting to load settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        try {
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                const settings = docSnap.data();
                enableInspection = settings.enableInspection !== undefined ? settings.enableInspection : true;
                enableSoundEffects = settings.enableSoundEffects !== undefined ? settings.soundEffects : true;
                cubeType = settings.cubeType || '3x3';
                currentTheme = settings.theme || 'dark';
                show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : false; // Load new setting
                console.log("[DEBUG] settings.js: User settings loaded from Firestore:", settings);
            } else {
                console.log("[DEBUG] settings.js: No user settings found in Firestore, using defaults and saving.");
                saveUserSettings(); // Save default settings to Firestore
            }
        }
        catch (e) {
            console.error("[ERROR] settings.js: Error loading user settings from Firestore: ", e);
            if (e.code === 'permission-denied') {
                console.warn("[WARN] settings.js: Firestore permission denied for settings. Falling back to local storage for settings.");
                // Fallback to local if permissions fail
                loadLocalUserSettings();
            }
        }
    } else { // Guest user
        console.log("[DEBUG] settings.js: Guest user. Loading settings from local storage.");
        loadLocalUserSettings(); // Load from local storage
    }
    applySettingsToUI();
    console.log("[DEBUG] settings.js: Exiting loadUserSettings.");
}

/**
 * Saves current user settings. Uses Firestore for authenticated users, Local Storage for guests.
 */
async function saveUserSettings() {
    console.log("[DEBUG] settings.js: Entering saveUserSettings.");
    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] settings.js: Authenticated and Firestore ready. Attempting to save settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        const settingsToSave = {
            enableInspection: enableInspection,
            enableSoundEffects: enableSoundEffects,
            cubeType: cubeType,
            theme: currentTheme,
            show3DCubeView: show3DCubeView, // Save new setting
            lastUpdated: Date.now()
        };
        try {
            console.log("[DEBUG] settings.js: Attempting to set doc in Firestore:", settingsToSave);
            await setDoc(userSettingsRef, settingsToSave, { merge: true });
            console.log("[DEBUG] settings.js: User settings saved to Firestore.");
        } catch (e) {
            console.error("[ERROR] settings.js: Error saving user settings to Firestore: ", e);
            // Fallback to local save if Firestore fails
            saveLocalUserSettings();
            console.warn("[WARN] settings.js: Firestore failed to save settings, saved to local storage (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] settings.js: Guest user. Saving settings to local storage.");
        saveLocalUserSettings(); // Save to local storage
    }
    console.log("[DEBUG] settings.js: Exiting saveUserSettings.");
}

/**
 * Updates the username in Firestore for authenticated users, or local storage for guests.
 */
async function updateUsername() {
    console.log("[DEBUG] settings.js: Entering updateUsername.");
    const newUsername = settingsUsernameInput.value.trim();
    if (!newUsername) {
        if (usernameUpdateMessage) {
            usernameUpdateMessage.textContent = "Username cannot be empty.";
            usernameUpdateMessage.style.color = "#ef4444"; // Red for error
            usernameUpdateMessage.style.display = 'block';
        }
        console.warn("[WARN] settings.js: New username is empty.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Authenticated user
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        try {
            console.log(`[DEBUG] settings.js: Attempting to update username in Firestore to: ${newUsername}`);
            await updateDoc(userProfileRef, { username: newUsername });
            if (usernameUpdateMessage) {
                usernameUpdateMessage.textContent = "Username updated successfully!";
                usernameUpdateMessage.style.color = "#22c55e"; // Green for success
                usernameUpdateMessage.style.display = 'block';
            }
            console.log("[DEBUG] settings.js: Username updated successfully in Firestore.");

            // Update the displayed username immediately (if any, though on this page it's just the input)
            if (settingsUsernameInput) settingsUsernameInput.value = newUsername;

            setTimeout(() => {
                if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
                console.log("[DEBUG] settings.js: Username update message hidden.");
            }, 3000); // Hide message after 3 seconds

        } catch (e) {
            console.error("[ERROR] settings.js: Error updating username in Firestore: ", e);
            if (usernameUpdateMessage) {
                usernameUpdateMessage.textContent = `Failed to update username: ${e.message}`;
                usernameUpdateMessage.style.color = "#ef4444"; // Red for error
                usernameUpdateMessage.style.display = 'block';
            }
            // Fallback to local save if Firestore fails
            saveLocalUsername(newUsername);
            if (settingsUsernameInput) settingsUsernameInput.value = newUsername;
            console.warn("[WARN] settings.js: Firestore failed to update username, saved to local storage (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] settings.js: Guest user. Updating username in local storage.");
        saveLocalUsername(newUsername);
        if (usernameUpdateMessage) {
            usernameUpdateMessage.textContent = "Username updated locally (not saved online).";
            usernameUpdateMessage.style.color = "#fbbf24"; // Amber for warning
            usernameUpdateMessage.style.display = 'block';
        }
        if (settingsUsernameInput) settingsUsernameInput.value = newUsername;
        setTimeout(() => {
            if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
            console.log("[DEBUG] settings.js: Username update message hidden.");
        }, 3000);
    }
    console.log("[DEBUG] settings.js: Exiting updateUsername.");
}

/**
 * Applies loaded/default settings to the UI elements on the settings page.
 */
function applySettingsToUI() {
    console.log("[DEBUG] settings.js: Entering applySettingsToUI.");
    if (inspectionToggle) inspectionToggle.checked = enableInspection;
    if (soundEffectsToggle) soundEffectsToggle.checked = enableSoundEffects;
    if (cubeTypeSelect) cubeTypeSelect.value = cubeType;
    if (themeSelect) themeSelect.value = currentTheme;
    if (cubeViewToggle) cubeViewToggle.checked = show3DCubeView;

    document.body.className = `theme-${currentTheme}`; // Apply theme class to body
    console.log("[DEBUG] settings.js: UI settings applied.");
    console.log("[DEBUG] settings.js: Exiting applySettingsToUI.");
}

/**
 * Sets up all event listeners for buttons and input changes on the settings page.
 */
function setupEventListeners() {
    console.log("[DEBUG] settings.js: Assigning event listeners.");

    // Assign DOM elements
    settingsUsernameInput = document.getElementById('settingsUsernameInput');
    saveUsernameBtn = document.getElementById('saveUsernameBtn');
    usernameUpdateMessage = document.getElementById('usernameUpdateMessage');
    inspectionToggle = document.getElementById('inspectionToggle');
    soundEffectsToggle = document.getElementById('soundEffectsToggle');
    cubeTypeSelect = document.getElementById('cubeTypeSelect');
    themeSelect = document.getElementById('themeSelect');
    cubeViewToggle = document.getElementById('cubeViewToggle');

    // Add event listeners
    if (saveUsernameBtn) saveUsernameBtn.addEventListener('click', updateUsername); else console.error("[ERROR] settings.js: saveUsernameBtn not found!");

    if (inspectionToggle) inspectionToggle.addEventListener('change', (e) => {
        enableInspection = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] settings.js: inspectionToggle not found!");

    if (soundEffectsToggle) soundEffectsToggle.addEventListener('change', (e) => {
        enableSoundEffects = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] settings.js: soundEffectsToggle not found!");

    if (cubeTypeSelect) cubeTypeSelect.addEventListener('change', (e) => {
        cubeType = e.target.value;
        saveUserSettings();
    }); else console.error("[ERROR] settings.js: cubeTypeSelect not found!");

    if (themeSelect) themeSelect.addEventListener('change', (e) => {
        currentTheme = e.target.value;
        document.body.className = `theme-${currentTheme}`; // Apply theme immediately
        saveUserSettings();
    }); else console.error("[ERROR] settings.js: themeSelect not found!");

    if (cubeViewToggle) cubeViewToggle.addEventListener('change', (e) => {
        show3DCubeView = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] settings.js: cubeViewToggle not found!");
}

/**
 * Initializes Firebase and loads user data for the settings page.
 */
async function initializeSettingsPage() {
    console.log("[DEBUG] settings.js: Initializing Firebase and loading data.");

    if (!app) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] settings.js: Firebase initialized.");

            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    userId = user.uid;
                    isUserAuthenticated = !user.isAnonymous; // True if signed in via email/google
                    isAuthReady = true;
                    console.log(`[DEBUG] settings.js: User authenticated: ${userId}. Authenticated status: ${isUserAuthenticated}`);
                } else {
                    // Sign in anonymously if no user, to get a UID for consistent pathing
                    try {
                        if (__initial_auth_token) {
                            const userCredential = await signInWithCustomToken(auth, __initial_auth_token);
                            userId = userCredential.user.uid;
                            isUserAuthenticated = false; // Still considered guest for persistence purposes
                            console.log(`[DEBUG] settings.js: Signed in with custom token. User ID: ${userId}`);
                        } else {
                            const userCredential = await signInAnonymously(auth);
                            userId = userCredential.user.uid;
                            isUserAuthenticated = false; // Anonymous user is a guest
                            console.log(`[DEBUG] settings.js: Signed in anonymously. User ID: ${userId}`);
                        }
                    } catch (e) {
                        console.error("[ERROR] settings.js: Anonymous sign-in failed:", e);
                        userId = `guest-${crypto.randomUUID()}`; // Fallback to local UUID
                        isUserAuthenticated = false;
                    }
                    isAuthReady = true;
                }
                await loadUserSettings(); // Load settings after auth state is known
                // Pre-fill username input after settings are loaded and auth is ready
                if (isUserAuthenticated && auth.currentUser && db && userId) {
                    const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
                    try {
                        const docSnap = await getDoc(userProfileRef);
                        if (docSnap.exists() && docSnap.data().username && settingsUsernameInput) {
                            settingsUsernameInput.value = docSnap.data().username;
                        } else if (settingsUsernameInput) {
                            settingsUsernameInput.value = ''; // Clear if no username found
                        }
                    } catch (e) {
                        console.error("[ERROR] settings.js: Error loading username for settings pre-fill:", e);
                        if (settingsUsernameInput) settingsUsernameInput.value = '';
                    }
                } else if (settingsUsernameInput) {
                    settingsUsernameInput.value = loadLocalUsername(); // Load from local storage for guests
                }
            });
        } catch (e) {
            console.error("[ERROR] settings.js: Firebase initialization failed:", e);
            isAuthReady = true; // Mark auth ready even if it failed, to proceed with local storage
            userId = `guest-${crypto.randomUUID()}`;
            isUserAuthenticated = false;
            await loadUserSettings();
            if (settingsUsernameInput) settingsUsernameInput.value = loadLocalUsername(); // Load from local storage for guests
        }
    } else {
        isAuthReady = true;
        await loadUserSettings();
        if (settingsUsernameInput) settingsUsernameInput.value = loadLocalUsername(); // Load from local storage for guests
    }
}

// --- Event Listeners for settings.html ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] settings.js: DOMContentLoaded triggered. Assigning DOM elements and initializing.");
    setupEventListeners(); // Assign DOM elements and add listeners
    initializeSettingsPage();
});
