from playwright.sync_api import sync_playwright, expect
import os

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Get the absolute path to the index.html file
    index_file_path = os.path.abspath('index.html')

    # Go to the local index.html file
    page.goto(f'file://{index_file_path}')

    # Wait for the page to load
    expect(page.locator('#startStopBtn')).to_be_visible()

    # Start and stop the timer to create a solve
    page.locator('#startStopBtn').click()
    page.wait_for_timeout(1000) # wait for 1 second
    page.locator('#startStopBtn').click()

    # Wait for the solve to be saved
    page.wait_for_timeout(2000)

    # Get the absolute path to the history.html file
    history_file_path = os.path.abspath('history.html')

    # Go to the local history.html file
    page.goto(f'file://{history_file_path}')
    page.wait_for_load_state('networkidle')

    # Wait for the loading spinner to be hidden, which indicates data has loaded
    expect(page.locator('#historyLoadingSpinner')).to_be_hidden(timeout=10000)

    # Wait for the solve history to be rendered
    expect(page.locator('.solve-history-item').first).to_be_visible(timeout=10000)

    # Click the "Get Insight" button on the first solve
    page.locator('.insight-button').first.click()

    # Wait for the AI Insight modal to appear
    expect(page.locator('#aiInsightModal')).to_be_visible()

    # Wait for the insight to be generated and displayed
    expect(page.locator('#personalizedTipDisplay')).to_be_visible(timeout=30000)

    # Take a screenshot of the modal
    page.screenshot(path="jules-scratch/verification/insight_modal.png")

    browser.close()

with sync_playwright() as playwright:
    run_verification(playwright)
