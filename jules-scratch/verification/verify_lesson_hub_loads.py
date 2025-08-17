import os
import subprocess
import threading
import time
from playwright.sync_api import sync_playwright, expect

def run_server():
    # Run the flask server as a subprocess
    server_process = subprocess.Popen(['python', 'jules-scratch/verification/proxy_server.py'])
    # Wait a bit for the server to start
    time.sleep(2)
    return server_process

def run_verification():
    server_process = run_server()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto('http://localhost:8000/lessons.html')

            print("Navigated to lessons.html")

            # Wait for the lesson hub to be visible
            print("Waiting for lesson hub to appear...")
            page.wait_for_selector('#lessonHub', timeout=10000)
            print("Lesson hub appeared")

            # Assert that the lesson viewer is hidden
            expect(page.locator('#lessonViewer')).to_be_hidden()

            # Take a screenshot
            print("Taking screenshot...")
            page.screenshot(path='jules-scratch/verification/verification_hub.png')
            print("Screenshot taken")

        finally:
            browser.close()
            server_process.terminate()

if __name__ == '__main__':
    run_verification()
