# api/gemini-nlu.py inside your Vercel project's 'api' directory
# This function is responsible for using Gemini to interpret natural language voice commands
# and returning a simplified, canonical action.

import os
import requests
import json
import re
from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

@app.route('/api/gemini-nlu', methods=['POST', 'OPTIONS'])
def gemini_nlu_handler():
    """HTTP endpoint that uses Gemini to interpret natural language voice commands.
    It expects a 'transcript' in the JSON body and returns a 'canonicalCommand' and optionally 'commandValue' or 'query'.
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

        user_transcript = request_json.get('transcript', '')

        gemini_api_key = "AIzaSyC3GRortpcNP5HvIL9673UWkEhJvokYF2o" # This is a placeholder, will be replaced by env var
        if not gemini_api_key:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

        headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': gemini_api_key
        }
        # Corrected the URL from /v1/ to /v1beta/ based on server logs
        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent"

        system_prompt = """
        You are Jarvis, an AI assistant for a Rubik's Cube timer application.
        Your task is to interpret a user's voice command transcript and classify it.

        Determine if the transcript is a specific command for the application or a general question.

        If it's a **specific command**, identify the `canonicalCommand` and any `commandValue`.
        Possible commands and their values:
        - "set cube type [2x2, 3x3, 4x4, pyraminx]": canonicalCommand: 'set_cube_type', commandValue: '2x2' or '3x3' etc.
        - "analyze my solve" / "get insight": canonicalCommand: 'analyze_solve'
        - "toggle sound effects": canonicalCommand: 'toggle_sound_effects'
        - "toggle inspection": canonicalCommand: 'toggle_inspection'
        - "set theme [dark, light, vibrant]": canonicalCommand: 'set_theme', commandValue: 'dark' or 'light' etc.
        - "show history": canonicalCommand: 'show_history'
        - "show stats": canonicalCommand: 'show_stats'
        - "generate new scramble": canonicalCommand: 'generate_scramble'
        - "start timer": canonicalCommand: 'start_timer'
        - "stop timer": canonicalCommand: 'stop_timer'
        - "reset timer": canonicalCommand: 'reset_timer'

        If it's a **general question** about cubing (e.g., algorithms, history, concepts) or about the features and usage of *this* Rubik's Cube timer web application, set `canonicalCommand` to 'general_query' and extract the `query` itself.

        Respond with a JSON object. Ensure the `confidence` score is between 0 and 1.

        Example Command Response:
        {
            "canonicalCommand": "set_cube_type",
            "commandValue": "3x3",
            "confidence": 1.0
        }

        Example General Question Response:
        {
            "canonicalCommand": "general_query",
            "query": "What is F2L?",
            "confidence": 0.9
        }

        Example Question about the app:
        {
            "canonicalCommand": "general_query",
            "query": "How do I change the theme?",
            "confidence": 0.95
        }

        Example Unknown Command Response:
        {
            "canonicalCommand": "unknown",
            "commandValue": null,
            "confidence": 0.5
        }
        """

        # Drastically simplified payload to increase robustness.
        # Ask for a plain text response that is a JSON string.
        simple_prompt = f"""
        Analyze the following user command and respond with ONLY a valid JSON object in the format specified below. Do not include any other text, explanation, or markdown formatting.

        User command: "{user_transcript}"

        JSON format:
        {{
          "canonicalCommand": "...",
          "commandValue": "...",
          "query": "...",
          "confidence": 0.0
        }}
        """
        payload = {
            "contents": [{"role": "user", "parts": [{"text": simple_prompt}]}]
        }

        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": gemini_api_key
        }

        gemini_response = requests.post(gemini_url, headers=headers, data=json.dumps(payload))
        gemini_response.raise_for_status() # Raise an exception for HTTP errors
        gemini_result = gemini_response.json()
        print(f"DEBUG: Gemini raw response: {gemini_result}")

        if gemini_result and gemini_result.get('candidates'):
            candidate = gemini_result['candidates'][0]
            if candidate and candidate.get('content') and candidate['content'].get('parts'):
                gemini_content_str = candidate['content']['parts'][0].get('text')
                if gemini_content_str:
                    # Use regex to find the JSON block within the markdown code block
                    json_match = re.search(r'\{.*\}', gemini_content_str, re.DOTALL)
                    if not json_match:
                        print(f"ERROR: No JSON object found in the AI response: {gemini_content_str}")
                        return jsonify({"error": "AI service did not return a valid JSON object."}), 500

                    json_str_to_parse = json_match.group(0)

                    try:
                        parsed_content = json.loads(json_str_to_parse)
                        return jsonify(parsed_content), 200
                    except json.JSONDecodeError as e:
                        print(f"ERROR: Failed to decode extracted JSON string: {e}. Extracted string: '{json_str_to_parse}'")
                        return jsonify({"error": f"AI service returned malformed JSON content after extraction: {e}"}), 500
                else:
                    print("ERROR: Gemini content part 'text' is missing or empty.")
                    return jsonify({"error": "AI service response content is empty."}), 500
            else:
                print("ERROR: Gemini candidate 'content' or 'parts' is missing or malformed.")
                return jsonify({"error": "AI service response candidate content is malformed."}), 500
        else:
            print("ERROR: Gemini response missing 'candidates' or malformed.")
            return jsonify({"error": "AI service response is malformed or missing candidates."}), 500

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        return jsonify({"error": f"An unknown error occurred during the AI service request (v3): {req_err}"}), 500
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
