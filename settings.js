// Firebase imports - These are provided globally by the Canvas environment
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
let db; // Firestore instance
let auth; // Auth instance
let userId = null; // Will be Firebase UID or a local UUID for guests
let isAuthReady = false; // Flag to indicate if Firebase auth state has been determined
let isUserAuthenticated = false; // True if user is signed in via Email/Google, false for guests/signed out

// Settings variables
let enableInspection = true;
let enableSoundEffects = true;
let cubeType = '3x3';
let currentTheme = 'dark'; // Default theme
let show3DCubeView = false; // Default to text scramble view
console.log("[DEBUG] Initial settings variables set.");

// DOM element variables
let inspectionToggle;
let soundEffectsToggle;
let cubeTypeSelect;
let themeSelect;
let cubeViewToggle;
let settingsUsernameInput;
let saveUsernameBtn;
let usernameUpdateMessage;
let sidebarToggleBtn;
let sidebarElement;
let mainLayoutElement;

// --- Local Storage Functions for Guest Mode ---
const LOCAL_STORAGE_PREFIX = `${appId}_guest_`;

/**
 * Loads user settings from local storage.
 */
function loadLocalUserSettings() {
    console.log("[DEBUG] Loading user settings from local storage.");
    try {
        const storedSettings = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}settings`);
        if (storedSettings) {
            const settings = JSON.parse(storedSettings);
            enableInspection = settings.enableInspection !== undefined ? settings.enableInspection : true;
            enableSoundEffects = settings.soundEffects !== undefined ? settings.soundEffects : true;
            cubeType = settings.cubeType || '3x3';
            currentTheme = settings.theme || 'dark';
            show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : false;
            console.log("[DEBUG] User settings loaded from local storage:", settings);
        } else {
            console.log("[DEBUG] No user settings found in local storage, using defaults.");
            saveLocalUserSettings(); // Save defaults for next time
        }
    } catch (e) {
        console.error("[ERROR] Error loading settings from local storage:", e);
    }
    applySettingsToUI();
}

/**
 * Saves current user settings to local storage.
 */
function saveLocalUserSettings() {
    console.log("[DEBUG] Saving user settings to local storage.");
    try {
        const settingsToSave = {
            enableInspection: enableInspection,
            enableSoundEffects: enableSoundEffects,
            cubeType: cubeType,
            theme: currentTheme,
            show3DCubeView: show3DCubeView,
            lastUpdated: Date.now()
        };
        localStorage.setItem(`${LOCAL_STORAGE_PREFIX}settings`, JSON.stringify(settingsToSave));
        console.log("[DEBUG] User settings saved to local storage.");
    } catch (e) {
        console.error("[ERROR] Error saving settings to local storage:", e);
    }
}

/**
 * Loads username from local storage.
 */
function loadLocalUsername() {
    console.log("[DEBUG] Loading username from local storage.");
    return localStorage.getItem(`${LOCAL_STORAGE_PREFIX}username`) || 'Guest';
}

/**
 * Saves username to local storage.
 */
function saveLocalUsername(username) {
    console.log("[DEBUG] Saving username to local storage.");
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}username`, username);
}

// --- Core Settings Logic ---

/**
 * Applies loaded/default settings to the UI elements.
 */
function applySettingsToUI() {
    console.log("[DEBUG] Entering applySettingsToUI for settings page.");
    if (!inspectionToggle || !soundEffectsToggle || !cubeTypeSelect || !themeSelect || !cubeViewToggle) {
        console.warn("[WARN] applySettingsToUI called before settings UI elements are initialized. Skipping apply.");
        return;
    }

    if (inspectionToggle) inspectionToggle.checked = enableInspection;
    if (soundEffectsToggle) soundEffectsToggle.checked = enableSoundEffects;
    if (cubeTypeSelect) cubeTypeSelect.value = cubeType;
    if (themeSelect) themeSelect.value = currentTheme;
    if (cubeViewToggle) cubeViewToggle.checked = show3DCubeView;

    document.body.className = `theme-${currentTheme} main-layout-settings`; // Apply theme class and page layout class

    console.log("[DEBUG] UI settings applied.");
    console.log("[DEBUG] Exiting applySettingsToUI.");
}

/**
 * Updates the username in Firestore for authenticated users, or local storage for guests.
 */
async function updateUsername() {
    console.log("[DEBUG] Entering updateUsername.");
    const newUsername = settingsUsernameInput.value.trim();
    if (!newUsername) {
        if (usernameUpdateMessage) {
            usernameUpdateMessage.textContent = "Username cannot be empty.";
            usernameUpdateMessage.style.color = "#ef4444"; // Red for error
            usernameUpdateMessage.style.display = 'block';
        }
        console.warn("[WARN] New username is empty.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Authenticated user
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        try {
            console.log(`[DEBUG] Attempting to update username in Firestore to: ${newUsername}`);
            await updateDoc(userProfileRef, { username: newUsername });
            if (usernameUpdateMessage) {
                usernameUpdateMessage.textContent = "Username updated successfully!";
                usernameUpdateMessage.style.color = "#22c55e"; // Green for success
                usernameUpdateMessage.style.display = 'block';
            }
            console.log("[DEBUG] Username updated successfully in Firestore.");

            // Update the displayed username on the main page if it's open (optional, requires communication)
            // For now, just update the message.

            setTimeout(() => {
                if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
                console.log("[DEBUG] Username update message hidden.");
            }, 3000); // Hide message after 3 seconds

        } catch (e) {
            console.error("[ERROR] Error updating username in Firestore: ", e);
            if (usernameUpdateMessage) {
                usernameUpdateMessage.textContent = `Failed to update username: ${e.message}`;
                usernameUpdateMessage.style.color = "#ef4444"; // Red for error
                usernameUpdateMessage.style.display = 'block';
            }
            // Fallback to local save if Firestore fails
            saveLocalUsername(newUsername);
            console.warn("[WARN] Firestore failed to update username, saved to local storage (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] updateUsername: Guest user. Updating username in local storage.");
        saveLocalUsername(newUsername);
        if (usernameUpdateMessage) {
            usernameUpdateMessage.textContent = "Username updated locally (not saved online).";
            usernameUpdateMessage.style.color = "#fbbf24"; // Amber for warning
            usernameUpdateMessage.style.display = 'block';
        }
        setTimeout(() => {
            if (usernameUpdateMessage) usernameUpdateMessage.style.display = 'none';
            console.log("[DEBUG] Username update message hidden.");
        }, 3000);
    }
    console.log("[DEBUG] Exiting updateUsername.");
}

/**
 * Loads user settings from Firestore for authenticated users.
 */
async function loadUserSettings() {
    console.log("[DEBUG] Entering loadUserSettings for settings page.");
    if (!inspectionToggle || !soundEffectsToggle || !cubeTypeSelect || !themeSelect || !cubeViewToggle) {
        console.warn("[WARN] loadUserSettings called before settings UI elements are initialized. Skipping load.");
        return;
    }

    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] loadUserSettings: Authenticated and Firestore ready. Attempting to load settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        try {
            const docSnap = await getDoc(userSettingsRef);
            if (docSnap.exists()) {
                const settings = docSnap.data();
                enableInspection = settings.enableInspection !== undefined ? settings.enableInspection : true;
                enableSoundEffects = settings.soundEffects !== undefined ? settings.soundEffects : true;
                cubeType = settings.cubeType || '3x3';
                currentTheme = settings.theme || 'dark';
                show3DCubeView = settings.show3DCubeView !== undefined ? settings.show3DCubeView : false;
                console.log("[DEBUG] User settings loaded from Firestore:", settings);
            } else {
                console.log("[DEBUG] No user settings found in Firestore, using defaults and saving.");
                saveUserSettings(); // Save default settings to Firestore
            }
        } catch (e) {
            console.error("[ERROR] Error loading user settings from Firestore: ", e);
             if (e.code === 'permission-denied') {
                console.warn("[WARN] Firestore permission denied for settings. Falling back to local storage for settings.");
                // Fallback to local if permissions fail
                loadLocalUserSettings();
            }
        }
    } else { // Guest user (handled by loadLocalUserSettings)
         console.log("[DEBUG] loadUserSettings: Not authenticated, using local storage settings.");
         loadLocalUserSettings();
    }
    applySettingsToUI();
    console.log("[DEBUG] Exiting loadUserSettings.");
}

/**
 * Saves current user settings. Uses Firestore for authenticated users, Local Storage for guests.
 */
async function saveUserSettings() {
    console.log("[DEBUG] Entering saveUserSettings.");
    if (isUserAuthenticated && db && userId) { // Authenticated user
        console.log("[DEBUG] saveUserSettings: Authenticated and Firestore ready. Attempting to save settings.");
        const userSettingsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/preferences`);
        const settingsToSave = {
            enableInspection: enableInspection,
            enableSoundEffects: enableSoundEffects,
            cubeType: cubeType,
            theme: currentTheme,
            show3DCubeView: show3DCubeView,
            lastUpdated: Date.now()
        };
        try {
            console.log("[DEBUG] Attempting to set doc in Firestore:", settingsToSave);
            await setDoc(userSettingsRef, settingsToSave, { merge: true });
            console.log("[DEBUG] User settings saved to Firestore.");
        } catch (e) {
            console.error("[ERROR] Error saving user settings to Firestore: ", e);
            // Fallback to local save if Firestore fails
            saveLocalUserSettings();
            console.warn("[WARN] Firestore failed to save settings, saved to local storage (non-persistent).");
        }
    } else { // Guest user
        console.log("[DEBUG] saveUserSettings: Guest user. Saving settings to local storage.");
        saveLocalUserSettings(); // Save to local storage
    }
    console.log("[DEBUG] Exiting saveUserSettings.");
}

// --- Sidebar Toggle Logic ---

function toggleSidebar() {
    console.log("[DEBUG] Toggling sidebar.");
    if (sidebarElement && mainLayoutElement) {
        const isCollapsed = sidebarElement.classList.toggle('collapsed');
        mainLayoutElement.classList.toggle('sidebar-collapsed', isCollapsed);
         // Update button icon
         const icon = sidebarToggleBtn.querySelector('i');
         if (icon) {
             icon.classList.remove(isCollapsed ? 'fa-chevron-left' : 'fa-chevron-right');
             icon.classList.add(isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left');
         }
        // Save state to local storage
        localStorage.setItem('sidebarCollapsed', isCollapsed);
        console.log(`[DEBUG] Sidebar is now ${isCollapsed ? 'collapsed' : 'expanded'}. State saved.`);
    }
}

function loadSidebarState() {
    console.log("[DEBUG] Loading sidebar state.");
    if (sidebarElement && mainLayoutElement) {
        const savedState = localStorage.getItem('sidebarCollapsed');
        const isCollapsed = savedState === 'true'; // Default to false if not saved
        if (isCollapsed) {
            sidebarElement.classList.add('collapsed');
            mainLayoutElement.classList.add('sidebar-collapsed');
             // Update button icon
            const icon = sidebarToggleBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-left');
                icon.classList.add('fa-chevron-right');
            }
            console.log("[DEBUG] Sidebar loaded as collapsed.");
        } else {
             // Ensure it's not collapsed if state is false or not set
            sidebarElement.classList.remove('collapsed');
            mainLayoutElement.classList.remove('sidebar-collapsed');
             // Update button icon
            const icon = sidebarToggleBtn.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-left');
            }
             console.log("[DEBUG] Sidebar loaded as expanded.");
        }
    }
}

// --- Initialization ---

/**
 * Initializes Firebase and loads user data/settings for the settings page.
 */
async function initializeSettingsPage() {
    console.log("[DEBUG] settings.js: Initializing Firebase and loading data.");

    // Initialize Firebase if not already
    if (!app) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            console.log("[DEBUG] settings.js: Firebase initialized.");

            // Sign in anonymously if no existing user, or get current user
            onAuthStateChanged(auth, async (user) => {
                 console.log("[DEBUG] settings.js: onAuthStateChanged triggered. User:", user ? user.uid : "null");
                if (user && !user.isAnonymous) { // User is explicitly signed in (Email/Google)
                    userId = user.uid;
                    isUserAuthenticated = true; // Set flag
                    isAuthReady = true;
                    console.log(`[DEBUG] settings.js: User authenticated: ${userId}`);
                    await loadUserSettings(); // Load settings from Firestore
                    // Load username for authenticated user
                    const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
                    getDoc(userProfileRef).then(docSnap => {
                        if (docSnap.exists() && docSnap.data().username && settingsUsernameInput) {
                            settingsUsernameInput.value = docSnap.data().username;
                        } else if (settingsUsernameInput) {
                            settingsUsernameInput.value = ''; // Clear if no username found
                        }
                    }).catch(e => {
                        console.error("Error loading username for settings:", e);
                        if (settingsUsernameInput) settingsUsernameInput.value = '';
                    });

                } else { // User is signed out or anonymous
                    console.log("[DEBUG] settings.js: Not authenticated. Operating as guest.");
                    userId = `guest-${crypto.randomUUID()}`; // Use a new local UUID for guest session
                    isUserAuthenticated = false; // Set flag
                    isAuthReady = true;
                    loadLocalUserSettings(); // Load settings from local storage
                    // Load username from local storage for guest
                    if (settingsUsernameInput) settingsUsernameInput.value = loadLocalUsername();
                }
            });
        } catch (e) {
            console.error("[ERROR] settings.js: Firebase initialization failed:", e);
            // Fallback to local storage for settings if Firebase fails
            isAuthReady = true; // Mark auth ready even if it failed, to proceed with local storage
            userId = `guest-${crypto.randomUUID()}`; // Fallback guest ID
            isUserAuthenticated = false;
            loadLocalUserSettings();
            if (settingsUsernameInput) settingsUsernameInput.value = loadLocalUsername();
        }
    } else {
        // Firebase already initialized
        isAuthReady = true;
        const user = auth.currentUser;
         if (user && !user.isAnonymous) {
            userId = user.uid;
            isUserAuthenticated = true;
            await loadUserSettings();
             const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
             getDoc(userProfileRef).then(docSnap => {
                 if (docSnap.exists() && docSnap.data().username && settingsUsernameInput) {
                     settingsUsernameInput.value = docSnap.data().username;
                 } else if (settingsUsernameInput) {
                     settingsUsernameInput.value = '';
                 }
             }).catch(e => {
                 console.error("Error loading username for settings:", e);
                 if (settingsUsernameInput) settingsUsernameInput.value = '';
             });
        } else {
            userId = `guest-${crypto.randomUUID()}`; // Ensure guest ID is set
            isUserAuthenticated = false;
            loadLocalUserSettings();
            if (settingsUsernameInput) settingsUsernameInput.value = loadLocalUsername();
        }
    }
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
    console.log("[DEBUG] settings.js: DOMContentLoaded triggered. Assigning DOM elements and event listeners.");

    // Assign DOM elements
    inspectionToggle = document.getElementById('inspectionToggle');
    soundEffectsToggle = document.getElementById('soundEffectsToggle');
    cubeTypeSelect = document.getElementById('cubeTypeSelect');
    themeSelect = document.getElementById('themeSelect');
    cubeViewToggle = document.getElementById('cubeViewToggle');
    settingsUsernameInput = document.getElementById('settingsUsernameInput');
    saveUsernameBtn = document.getElementById('saveUsernameBtn');
    usernameUpdateMessage = document.getElementById('usernameUpdateMessage');
    sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
    sidebarElement = document.getElementById('sidebar');
    mainLayoutElement = document.querySelector('.main-layout');

    // Add event listeners
    if (inspectionToggle) inspectionToggle.addEventListener('change', (e) => {
        enableInspection = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] inspectionToggle not found!");

    if (soundEffectsToggle) soundEffectsToggle.addEventListener('change', (e) => {
        enableSoundEffects = e.target.checked;
        saveUserSettings();
    }); else console.error("[ERROR] soundEffectsToggle not found!");

    if (cubeTypeSelect) cubeTypeSelect.addEventListener('change', (e) => {
        cubeType = e.target.value;
        saveUserSettings();
        // Note: Scramble generation and timer reset happen on index.html
        // We just save the preference here.
    }); else console.error("[ERROR] cubeTypeSelect not found!");

    if (themeSelect) themeSelect.addEventListener('change', (e) => {
        currentTheme = e.target.value;
        document.body.className = `theme-${currentTheme} main-layout-settings`; // Apply theme class
        saveUserSettings();
    }); else console.error("[ERROR] themeSelect not found!");

    if (cubeViewToggle) cubeViewToggle.addEventListener('change', (e) => {
        show3DCubeView = e.target.checked;
        saveUserSettings();
        // Note: 3D view toggle on the timer happens on index.html
        // We just save the preference here.
    }); else console.error("[ERROR] cubeViewToggle not found!");

    if (saveUsernameBtn) saveUsernameBtn.addEventListener('click', updateUsername); else console.error("[ERROR] saveUsernameBtn not found!");

    // Sidebar toggle listener
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar); else console.error("[ERROR] sidebarToggleBtn not found!");

    // Initialize Firebase and load data/settings
    initializeSettingsPage();

    // Load sidebar state on page load
    loadSidebarState();

    console.log("[DEBUG] settings.js: DOMContentLoaded complete.");
});
