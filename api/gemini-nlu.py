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

        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"

        # Enhanced prompt for NLU to include algorithm lookup and more settings
        prompt = f"""
        You are Jarvis, an AI assistant for a Rubik's Cube timer application.
        The user has spoken the following: "{user_transcript}".
        Your task is to interpret this natural language command and return a canonical, machine-readable command.

        Here are the possible canonical commands and their expected values:

        1.  "start_timer": To start the timer.
        2.  "stop_timer": To stop the timer.
        3.  "new_scramble": To generate a new scramble.
        4.  "reset_timer": To reset the timer to zero.
        5.  "open_settings": To open the settings modal.
        6.  "close_settings": To close the settings modal.
        7.  "get_insight": To get an AI insight for the last solve.
        8.  "toggle_inspection": To toggle inspection time on or off.
        9.  "toggle_sound_effects": To toggle sound effects on or off.
        10. "set_cube_type": To change the cube type. Value should be '3x3', '2x2', '4x4', or 'pyraminx'. Be robust to variations like 'four by four', 'two by two', 'three by three', 'pyraminx'.
        11. "set_theme": To change the application theme. Value should be 'dark', 'light', or 'vibrant'.
        12. "toggle_3d_cube_view": To toggle the 3D cube visualization on or off.
        13. "get_best_time": To inquire about the user's best solve time.
        14. "get_ao5": To inquire about the user's average of 5 solves.
        15. "get_ao12": To inquire about the user's average of 12 solves.
        16. "get_algorithm_or_explanation": To get an algorithm or explanation for a specific cubing term. The value should be the specific term or algorithm name (e.g., "T-perm", "OLL", "F2L", "cross", "PLL").

        If the command is unclear or not recognized, return "unknown".
        Be flexible with phrasing. For example, "start the timer" or "begin" should map to "start_timer". "What's my best time" or "best time" should map to "get_best_time".

        Provide the response in a structured JSON format:
        {{
            "canonicalCommand": "the determined canonical command",
            "commandValue": "the extracted value, if applicable, otherwise null",
            "confidence": "a confidence score from 0.0 to 1.0 (1.0 being very confident)"
        }}
        Ensure all responses are within the JSON structure. Do not include any text outside the JSON.
        """

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }

        headers = {
            "Content-Type": "application/json"
        }

        try:
            gemini_response = requests.post(gemini_url, headers=headers, data=json.dumps(payload))
            gemini_response.raise_for_status() # Raise an exception for HTTP errors
            gemini_result = gemini_response.json()
            print(f"DEBUG: Gemini raw response: {gemini_result}")

            if gemini_result and gemini_result.get('candidates'):
                gemini_content_str = gemini_result['candidates'][0]['content']['parts'][0]['text']
                # Attempt to parse the content string as JSON
                parsed_content = json.loads(gemini_content_str)
                return jsonify(parsed_content), 200
            else:
                print("ERROR: Gemini response missing candidates or content.")
                return jsonify({"canonicalCommand": "unknown", "commandValue": None, "confidence": 0.0}), 200

        except requests.exceptions.RequestException as e:
            print(f"ERROR: Request to Gemini API failed: {e}")
            return jsonify({"error": f"Failed to connect to AI service: {e}"}), 500
        except json.JSONDecodeError as e:
            print(f"ERROR: Failed to decode Gemini JSON response: {e}. Raw response: {gemini_response.text}")
            return jsonify({"error": f"AI service returned malformed JSON: {e}"}), 500
        except Exception as e:
            print(f"CRITICAL ERROR: Unexpected error during Gemini NLU: {e}")
            return jsonify({"error": f"An unexpected error occurred during AI NLU: {e}"}), 500

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
        print(f"ERROR: JSON decoding error on incoming request: {json_err}. Raw request body: '{raw_body}'")
        return jsonify({"error": f"Invalid JSON format in your request. Details: {json_err}"}), 400
    except Exception as e:
        import traceback
        print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

# To run this with Vercel, ensure you have a 'requirements.txt' in the same 'api' directory:
# Flask==3.*
# requests==2.*
# flask-cors==4.*
# kociemba
# pycuber
