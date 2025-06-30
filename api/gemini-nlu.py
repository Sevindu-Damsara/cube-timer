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
        print(f"DEBUG: Processing transcript: '{user_transcript}'")

        # Your Gemini API Key - This should be set as an environment variable in Vercel.
        # For development, you might hardcode it here temporarily, but REMOVE for production.
        gemini_api_key = os.environ.get("GEMINI_API_KEY") 
        if not gemini_api_key:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API Key is not set."}), 500

        # Define the set of canonical commands the front-end understands, including new settings commands.
        canonical_commands = [
            "start_timer",
            "stop_timer",
            "new_scramble",
            "reset_timer",
            "open_settings",
            "close_settings",
            "get_insight",
            "toggle_inspection",
            "toggle_sound_effects",
            "set_cube_type", # Requires a value
            "set_theme",     # Requires a value
            "toggle_3d_cube_view",
            "unknown" # Fallback for commands not understood
        ]
        
        # Define valid values for parameters, important for Gemini's output
        valid_cube_types = ["3x3", "2x2", "4x4", "pyraminx"]
        valid_themes = ["dark", "light", "vibrant"]

        # Construct the prompt for Gemini.
        # We explicitly ask for a JSON response with a 'canonicalCommand' and optionally 'commandValue'.
        prompt = f"""
        Analyze the following user command and determine its primary intent.
        Map the user's intent to one of the following canonical commands:
        {", ".join(canonical_commands)}.
        
        If the command is 'set_cube_type', identify the cube type from {", ".join(valid_cube_types)}.
        If the command is 'set_theme', identify the theme from {", ".join(valid_themes)}.
        If a value is identified, return it in the 'commandValue' field.
        If the intent does not clearly match any of the canonical commands, return "unknown" for 'canonicalCommand'.

        User command: "{user_transcript}"

        Respond ONLY with a JSON object.
        Example 1: {{"canonicalCommand": "start_timer"}}
        Example 2: {{"canonicalCommand": "set_cube_type", "commandValue": "2x2"}}
        Example 3: {{"canonicalCommand": "set_theme", "commandValue": "light"}}
        Example 4: {{"canonicalCommand": "unknown"}}
        """

        gemini_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': gemini_api_key # Pass API key via header
        }
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt}
                    ]
                }
            ],
            # Use responseSchema to ensure structured output
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "canonicalCommand": { "type": "STRING", "enum": canonical_commands },
                        "commandValue": { "type": "STRING" } # Allow any string for commandValue, validation is client-side
                    },
                    "required": ["canonicalCommand"] # Ensure canonicalCommand is always present
                }
            }
        }

        print("DEBUG: Sending request to Gemini API.")
        gemini_response = requests.post(gemini_url, headers=headers, json=payload, timeout=30)
        gemini_response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

        gemini_result = gemini_response.json()
        print(f"DEBUG: Raw Gemini response: {json.dumps(gemini_result, indent=2)}")

        # Extract the canonical command and optional value from Gemini's structured response
        if gemini_result and gemini_result.get('candidates') and len(gemini_result['candidates']) > 0:
            if gemini_result['candidates'][0].get('content') and gemini_result['candidates'][0]['content'].get('parts'):
                try:
                    # Gemini's structured response comes as a string, parse it
                    gemini_content_str = gemini_result['candidates'][0]['content']['parts'][0]['text']
                    parsed_gemini_content = json.loads(gemini_content_str)
                    
                    canonical_command = parsed_gemini_content.get('canonicalCommand')
                    command_value = parsed_gemini_content.get('commandValue') # Get optional value

                    if canonical_command in canonical_commands:
                        print(f"DEBUG: Canonical command identified: {canonical_command}, Value: {command_value}")
                        return jsonify({"canonicalCommand": canonical_command, "commandValue": command_value}), 200
                    else:
                        print(f"WARN: Gemini returned an unrecognised canonical command: {canonical_command}. Falling back to 'unknown'.")
                        return jsonify({"canonicalCommand": "unknown"}), 200
                except json.JSONDecodeError as e:
                    print(f"ERROR: Failed to decode Gemini's JSON response: {e}. Raw: {gemini_content_str}")
                    return jsonify({"canonicalCommand": "unknown", "error": "AI response malformed."}), 200
                except Exception as e:
                    print(f"ERROR: Unexpected error parsing Gemini response: {e}")
                    return jsonify({"canonicalCommand": "unknown", "error": "Error processing AI response."}), 200
        else:
            print("WARN: Gemini response did not contain expected 'candidates' or 'content'.")
            return jsonify({"canonicalCommand": "unknown", "error": "AI response structure unexpected."}), 200

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
