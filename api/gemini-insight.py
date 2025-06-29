# api/gemini-insight.py inside your Vercel project's 'api' directory

import os
import requests
import json
from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
# Vercel functions expect a Flask or FastAPI app for Python.
app = Flask(__name__)
# Enable CORS for all origins for development.
# For production, restrict this to your Vercel frontend URL:
# CORS(app, resources={r"/api/*": {"origins": "https://your-app-name.vercel.app"}})
CORS(app)

@app.route('/api/gemini-insight', methods=['POST', 'OPTIONS'])
def gemini_insight_handler():
    """HTTP endpoint that generates AI insight using Gemini API.
    Handles both preflight (OPTIONS) and actual (POST) requests.
    """
    # Log that a request has been received. This will appear in Vercel logs.
    print("DEBUG: gemini_insight_handler received a request.")

    # Handle CORS preflight (OPTIONS) request. Vercel routes these automatically.
    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request.")
        return '', 204

    try:
        # Attempt to parse the incoming JSON request body.
        request_json = request.get_json(silent=True)
        print(f"DEBUG: Received request JSON: {request_json}")

        # Validate the incoming JSON payload.
        if not request_json:
            print("ERROR: No JSON body received.")
            return jsonify({"error": "No JSON body received. Please send a JSON payload."}), 400
        if 'scramble' not in request_json:
            print("ERROR: Missing 'scramble' in request body.")
            return jsonify({"error": "Missing 'scramble' in request body. Ensure 'scramble' key is present."}), 400
        if 'cubeType' not in request_json:
            print("ERROR: Missing 'cubeType' in request body.")
            return jsonify({"error": "Missing 'cubeType' in request body. Ensure 'cubeType' key is present."}), 400

        scramble = request_json['scramble']
        cube_type = request_json['cubeType']
        print(f"DEBUG: Extracted Scramble: '{scramble}', Cube Type: '{cube_type}'")

        # Retrieve the Gemini API key from environment variables.
        # This environment variable MUST be set in Vercel project settings under "Environment Variables".
        # Ensure it is named exactly: `GEMINI_API_KEY`
        gemini_api_key = os.environ.get('GEMINI_API_KEY')

        if not gemini_api_key:
            # This is a common cause for 500 errors. Detailed message helps diagnosis.
            print("ERROR: GEMINI_API_KEY environment variable not set. Function cannot proceed.")
            return jsonify({"error": "Server configuration error: Gemini API key not found. Please ensure GEMINI_API_KEY is set in Vercel project environment variables."}), 500

        # Construct the prompt for the Gemini model.
        prompt = f"Analyze the {cube_type} scramble: '{scramble}'. Provide a detailed observation (2-3 sentences) focused on the initial cross or first F2L pair. The observation should identify a specific beneficial feature as if visually inspecting the cube, such as an already solved or easily solvable cross edge/corner, or an intuitive first F2L pair. For example: \"You might notice the White-Orange edge is already placed, requiring only an F2 move to join the cross.\" or \"Observe that the Green-Red edge and corner are paired up and ready for insertion.\" Deliver the insight directly, using simple and clear language, without conversational intros or concluding remarks. Focus solely on a valuable setup observation."
        print(f"DEBUG: Gemini prompt successfully generated. Length: {len(prompt)} characters.")

        # Define the Gemini API endpoint and payload.
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt}
                    ]
                }
            ]
        }
        print(f"DEBUG: Preparing to call Gemini API at: {api_url.split('?key=')[0]}...") # Avoid logging full API key

        # Make the request to the Gemini API.
        response = requests.post(api_url, headers={"Content-Type": "application/json"}, data=json.dumps(payload))
        print(f"DEBUG: Gemini API raw response status code: {response.status_code}")
        
        # Raise an HTTPError for bad responses (4xx or 5xx) from Gemini.
        response.raise_for_status() 
        
        # Parse the JSON response from Gemini.
        gemini_result = response.json()
        print(f"DEBUG: Gemini API response JSON (partial): {json.dumps(gemini_result, indent=2)[:500]}...") # Log first 500 chars to avoid very long logs
        
        # Extract the insight text from the Gemini response.
        if gemini_result.get('candidates') and len(gemini_result['candidates']) > 0 and \
           gemini_result['candidates'][0].get('content') and \
           gemini_result['candidates'][0]['content'].get('parts') and \
           len(gemini_result['candidates'][0]['content']['parts']) > 0:
            insight_text = gemini_result['candidates'][0]['content']['parts'][0]['text']
            print(f"DEBUG: Insight extracted successfully. First 50 chars: {insight_text[:50]}...")
            return jsonify({"insight": insight_text}), 200
        else:
            # Handle cases where the Gemini response structure is unexpected or content is missing.
            error_message = f"Failed to generate insight: Unexpected Gemini API response structure. Full response: {json.dumps(gemini_result)}"
            print(f"ERROR: {error_message}")
            return jsonify({"error": error_message}), 500

    # Catch specific request-related errors for better diagnosis.
    except requests.exceptions.HTTPError as http_err:
        print(f"ERROR: HTTP error during Gemini API call: {http_err}. Response text: {http_err.response.text}")
        return jsonify({"error": f"Error from Gemini API ({http_err.response.status_code}): {http_err.response.text}"}), http_err.response.status_code
    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503 # Service Unavailable
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504 # Gateway Timeout
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        return jsonify({"error": f"An unknown error occurred during the AI service request: {req_err}"}), 500
    except json.JSONDecodeError as json_err:
        # This occurs if the incoming request JSON is malformed.
        raw_body = request.get_data(as_text=True)
        print(f"ERROR: JSON decoding error on incoming request: {json_err}. Raw request body: '{raw_body}'")
        return jsonify({"error": f"Invalid JSON format in your request. Details: {json_err}"}), 400
    except Exception as e:
        # Catch any other unexpected errors and log them with a traceback.
        import traceback
        print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

