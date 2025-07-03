# api/gemini-nlu.py inside your Vercel project's 'api' directory
# This function is responsible for using Gemini to interpret natural language voice commands
# and returning a simplified, canonical action.

import os
import requests
import json
from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

# Gemini API configuration
# Ensure GEMINI_API_KEY is set in your Vercel project's environment variables
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

@app.route('/api/gemini-nlu', methods=['POST', 'OPTIONS'])
def gemini_nlu_handler():
    """HTTP endpoint that uses Gemini to interpret natural language voice commands.
    It expects a 'transcript' in the JSON body and returns a 'canonicalCommand' and optionally 'commandValue'.
    Handles both preflight (OPTIONS) and actual (POST) requests.
    """
    print("DEBUG: gemini_nlu_handler received a request.")

    # Handle CORS preflight (OPTIONS) request
    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request for NLU.")
        return '', 204

    try:
        request_json = request.get_json(silent=True)
        print(f"DEBUG: Received NLU request JSON: {request_json}")

        if not request_json or 'transcript' not in request_json:
            print("ERROR: Invalid JSON body. Missing 'transcript'.")
            return jsonify({"error": "Invalid request: 'transcript' field is required."}), 400

        user_transcript = request_json['transcript']

        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        headers = {
            'Content-Type': 'application/json'
        }

        # Enhanced prompt for Gemini to understand more commands, including settings and stats
        prompt_text = f"""
        You are Jarvis, an AI assistant for a Rubik's Cube timer application.
        Your task is to interpret user voice commands and convert them into a canonical, simplified action.
        Respond with a JSON object containing `canonicalCommand` and, if applicable, `commandValue`.

        Here are the supported commands and their canonical forms:

        -   **Timer Control:**
            -   "start timer", "begin solve", "start" -> `start_timer`
            -   "stop timer", "end solve", "stop" -> `stop_timer`
            -   "new scramble", "generate new scramble" -> `new_scramble`
            -   "reset timer", "clear timer" -> `reset_timer`

        -   **Settings Control:**
            -   "open settings", "go to settings" -> `open_settings`
            -   "close settings", "exit settings" -> `close_settings`
            -   "enable inspection", "turn on inspection" -> `toggle_inspection` (value implied true)
            -   "disable inspection", "turn off inspection" -> `toggle_inspection` (value implied false)
            -   "enable sound effects", "turn on sound" -> `toggle_sound_effects` (value implied true)
            -   "disable sound effects", "turn off sound" -> `toggle_sound_effects` (value implied false)
            -   "set cube type to [2x2/3x3/4x4/pyraminx]", "change cube to [2x2/3x3/4x4/pyraminx]" -> `set_cube_type` with `commandValue` (e.g., "3x3")
            -   "set theme to [dark/light/vibrant]", "change theme to [dark/light/vibrant]" -> `set_theme` with `commandValue` (e.g., "light")
            -   "show 3D cube", "enable 3D view" -> `toggle_3d_cube_view` (value implied true)
            -   "hide 3D cube", "disable 3D view" -> `toggle_3d_cube_view` (value implied false)

        -   **Statistics Queries:**
            -   "what's my best time", "show best time" -> `get_best_time`
            -   "what's my average of five", "show Ao5" -> `get_ao5`
            -   "what's my average of twelve", "show Ao12" -> `get_ao12`

        -   **Insight:**
            -   "get insight", "analyze my solve" -> `get_insight`

        -   **Fallback:**
            -   If no clear command is recognized, use `unknown`.

        User Transcript: "{user_transcript}"

        Your JSON response:
        """

        # Define the response schema for structured output
        generation_config = {
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "OBJECT",
                "properties": {
                    "canonicalCommand": {"type": "STRING"},
                    "commandValue": {"type": "STRING", "nullable": True}
                },
                "propertyOrdering": ["canonicalCommand", "commandValue"]
            }
        }

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
            "generationConfig": generation_config
        }

        gemini_api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

        print(f"DEBUG: Calling Gemini API at: {gemini_api_url}")
        gemini_response = requests.post(gemini_api_url, headers=headers, data=json.dumps(payload), timeout=15)
        gemini_response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

        gemini_result = gemini_response.json()
        print(f"DEBUG: Raw Gemini response: {gemini_result}")

        if gemini_result and gemini_result.get('candidates') and gemini_result['candidates'][0].get('content') and gemini_result['candidates'][0]['content'].get('parts'):
            response_text = gemini_result['candidates'][0]['content']['parts'][0]['text']
            # Gemini returns a string that is a JSON object, so we need to parse it
            parsed_command = json.loads(response_text)
            
            canonical_command = parsed_command.get('canonicalCommand', 'unknown')
            command_value = parsed_command.get('commandValue')

            # Handle implicit boolean values for toggles
            if canonical_command in ['toggle_inspection', 'toggle_sound_effects', 'toggle_3d_cube_view']:
                # The prompt implies the value, but if Gemini doesn't return it,
                # we can infer based on the phrasing if needed.
                # For now, the JS side will handle the toggle logic.
                pass 

            print(f"DEBUG: Canonical command: {canonical_command}, Value: {command_value}")
            return jsonify({"canonicalCommand": canonical_command, "commandValue": command_value}), 200
        else:
            print("ERROR: Unexpected Gemini response structure or empty content.")
            return jsonify({"error": "Failed to interpret command. Unexpected response structure."}), 500

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        return jsonify({"error": f"An unknown error occurred during the AI service request: {req_err}"}), 500
    except json.JSONDecodeError as json_err:
        raw_body = request.get_data(as_text=True)
        print(f"ERROR: JSON decoding error: {json_err}. Raw request body: '{raw_body}' or Gemini response was malformed.")
        return jsonify({"error": f"Invalid JSON format. Details: {json_err}"}), 400
    except Exception as e:
        import traceback
        print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

