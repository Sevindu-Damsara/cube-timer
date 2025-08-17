import os
import json
import time
import subprocess
from playwright.sync_api import sync_playwright, expect
import firebase_admin
from firebase_admin import credentials, firestore

# --- Firebase Admin SDK Setup ---
def initialize_firebase():
    """Initializes the Firebase Admin SDK using environment variables."""
    if not firebase_admin._apps:
        creds_json_str = os.environ.get('FIREBASE_SERVICE_ACCOUNT')
        if not creds_json_str:
            raise ValueError("FIREBASE_SERVICE_ACCOUNT environment variable not set. This script requires admin credentials.")
        creds_dict = json.loads(creds_json_str)
        cred = credentials.Certificate(creds_dict)
        firebase_admin.initialize_app(cred, {
            'projectId': creds_dict.get('project_id'),
        })
    return firestore.client()

# --- Test Data and Firestore Manipulation ---
TEST_USER_ID = "verification_test_user_12345"
TEST_COURSE_DATA = {
    "title": "Comprehensive Test Course",
    "description": "A course to test all features.",
    "cubeType": "3x3x3",
    "level": "beginner",
    "modules": [
        {
            "module_title": "Module 1: Previews",
            "lessons": [
                {
                    "lesson_title": "Lesson 1.1: Inline Player",
                    "steps": [{"content": "Here is an algorithm: [ALGORITHM: R U R' U']"}]
                }
            ]
        },
        {
            "module_title": "Module 2: Quizzes",
            "lessons": [
                {
                    "lesson_title": "Lesson 2.1: Simple Quiz",
                    "steps": [{
                        "content": "Time for a quiz!",
                        "quiz": [{
                            "question": "What color is opposite to White?",
                            "options": ["Blue", "Green", "Yellow", "Red"],
                            "answer": "Yellow"
                        }]
                    }]
                }
            ]
        }
    ]
}

def get_course_ref(db):
    """Gets the Firestore collection reference for the test user's courses."""
    app_id = 'my-production-speedcube-timer' # This must match the frontend config
    return db.collection(f'artifacts/{app_id}/users/{TEST_USER_ID}/courses')

def setup_test_data(db):
    """Deletes old data and creates a new test course."""
    print("Setting up test data in Firestore...")
    courses_ref = get_course_ref(db)
    docs = courses_ref.stream()
    for doc in docs:
        print(f"Deleting old test course: {doc.id}")
        doc.reference.delete()

    update_time, doc_ref = courses_ref.add(TEST_COURSE_DATA)
    print(f"Added new test course with ID: {doc_ref.id}")
    return doc_ref.id

def teardown_test_data(db):
    """Deletes all courses for the test user."""
    print("Tearing down test data in Firestore...")
    try:
        courses_ref = get_course_ref(db)
        docs = courses_ref.stream()
        for doc in docs:
            doc.reference.delete()
        print("Test data deleted successfully.")
    except Exception as e:
        print(f"Error during teardown: {e}")

# --- Main Verification Logic ---
def run_verification():
    """
    Runs a full end-to-end test by directly manipulating Firestore and
    modifying the frontend JS to ensure a predictable test environment.
    """
    original_js_content = None
    js_file_path = 'lessons.js'
    db = None

    try:
        # 1. Initialize Firebase
        db = initialize_firebase()

        # 2. Setup Firestore data
        course_id = setup_test_data(db)

        # 3. Modify lessons.js to force the test user ID
        with open(js_file_path, 'r') as f:
            original_js_content = f.read()

        # Find the function and replace its body to bypass auth
        # This is more robust than a simple string replacement.
        # We are effectively disabling the real auth and forcing our test user.
        js_to_find = "async function initializeFirebaseAndAuth() {"
        js_replacement_body = f"""
async function initializeFirebaseAndAuth() {{
    console.log("[DEBUG] Bypassing Firebase Auth for verification script.");
    userId = "{TEST_USER_ID}";
    isAuthReady = true;
    isUserAuthenticated = true;
    db = getFirestore(initializeApp(firebaseConfig)); // Make sure db is initialized
    console.log("[DEBUG] Auth ready, calling loadInitialView() with test user.");
    await loadInitialView();
}}
"""
        modified_js_content = original_js_content.replace(
            "async function initializeFirebaseAndAuth()",
            "async function initializeFirebaseAndAuth_Original()" # Rename original
        )
        modified_js_content += js_replacement_body

        with open(js_file_path, 'w') as f:
            f.write(modified_js_content)
        print(f"Temporarily modified {js_file_path} to force user ID.")

        # 4. Run Playwright tests
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_default_timeout(20000)

            print("Navigating to lessons page (server is pre-running)...")
            page.goto('http://localhost:8000/lessons.html')

            print("Verifying course card appeared in the hub...")
            course_card_locator = page.locator(f'.course-card:has(button[data-id="{course_id}"])')
            expect(course_card_locator).to_be_visible()

            print("Starting the test course...")
            course_card_locator.locator('button:has-text("Start Course")').click()

            print("Verifying lesson viewer is visible...")
            expect(page.locator('#lessonViewer')).to_be_visible()
            expect(page.locator('#currentCourseTitle')).to_have_text('Comprehensive Test Course')

            print("Verifying inline algorithm preview...")
            lesson_content = page.locator('#lessonContent')
            expect(lesson_content.locator('twisty-player')).to_be_visible()
            expect(lesson_content).not_to_contain_text('[ALGORITHM:')

            print("Navigating to the quiz lesson...")
            page.locator('.lesson-item:has-text("Lesson 2.1: Simple Quiz")').click()

            print("Verifying quiz area is visible...")
            quiz_area = page.locator('#quizArea')
            expect(quiz_area).to_be_visible()
            expect(quiz_area.locator('.question-item')).to_have_count(1)

            print("Taking final screenshot...")
            page.screenshot(path='jules-scratch/verification/verify_all_features.png')
            print("--- VERIFICATION SUCCEEDED! ---")

            browser.close()

    finally:
        # --- Teardown ---
        if original_js_content:
            print(f"Restoring original {js_file_path}...")
            with open(js_file_path, 'w') as f:
                f.write(original_js_content)
            print("File restored.")

        if db:
            teardown_test_data(db)

if __name__ == '__main__':
    # This script assumes a server is already running on port 8000
    # and that FIREBASE_SERVICE_ACCOUNT env var is set.
    run_verification()
