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
            return jsonify({"error": "No JSON body received."}), 400

        # Extract data from the request.
        scramble = request_json.get('scramble')
        cube_type = request_json.get('cubeType', '3x3')
        solve_time_ms = request_json.get('solveTimeMs')
        penalty = request_json.get('penalty')
        user_level = request_json.get('userLevel')

        # Basic validation for required fields
        if not scramble:
            print("ERROR: Missing 'scramble' in request.")
            return jsonify({"error": "Missing 'scramble' in request."}), 400

        # Construct prompt for the Gemini API
        # We are asking for multiple pieces of information in a structured JSON format.
        # The prompt is carefully crafted to guide Gemini's response.
        solve_time_str = f"{solve_time_ms / 1000:.2f} seconds" if solve_time_ms is not None else "an unknown time"
        if penalty == '+2':
            solve_time_str += " with a +2 penalty"
        elif penalty == 'DNF':
            solve_time_str = "DNF (Did Not Finish)"

        # The core prompt asking for structured data
        prompt = f"""
        You are Jarvis, a highly intelligent AI assistant providing expert analysis for Rubik's Cube solves.
        A user, Sir, Sevindu, has just completed a {cube_type} solve with the following scramble: "{scramble}".
        The solve time was {solve_time_str}. The user's cubing level is estimated to be "{user_level}".

        Please provide a concise and helpful analysis for this solve. Your response should contain three distinct parts:
        1.  **General Insight**: A brief, encouraging general analysis of the solve, considering the scramble and outcome.
        2.  **Optimal Solution (Simulated)**: A plausible, step-by-step example of an optimal or very efficient solution for this exact scramble. Do not state that it's a "simulated" solution, present it as a clear set of moves. Keep it concise, e.g., "R U R' F' L F L' U' R U' R'". For a 3x3, aim for approximately 15-25 moves. For Pyraminx, 8-12 moves. For 2x2, 6-10 moves. For 4x4, 30-45 moves.
        3.  **Personalized Tip**: A single, actionable tip tailored to the user's "{user_level}" cubing level and the specifics of this solve ({solve_time_str}, {penalty if penalty else 'no penalty'}). For a DNF, suggest focusing on fundamental execution. For slower times, suggest improving look-ahead or specific stages. For faster times, suggest advanced techniques.

        Format your entire response as a JSON object with the following keys:
        {{
            "insight": "Your general insight here.",
            "optimalSolution": "Move sequence here (e.g., R U R' F' L F L' U' R U' R').",
            "personalizedTip": "Your personalized tip here."
        }}
        Ensure the 'optimalSolution' is a string of standard cubing notation moves.
        """

        gemini_api_key = os.environ.get('GEMINI_API_KEY')
        if not gemini_api_key:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server-side AI key not configured."}), 500

        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }
        
        print("DEBUG: Sending request to Gemini API.")
        response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload))
        response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

        gemini_response = response.json()
        print(f"DEBUG: Raw Gemini API response: {json.dumps(gemini_response, indent=2)}")

        # Extract the content from Gemini's response
        if gemini_response and gemini_response.get('candidates') and gemini_response['candidates'][0].get('content') and gemini_response['candidates'][0]['content'].get('parts'):
            # Gemini's structured response comes as a string representation of JSON
            response_text = gemini_response['candidates'][0]['content']['parts'][0]['text']
            # Attempt to parse the inner JSON string
            try:
                parsed_insight = json.loads(response_text)
                return jsonify(parsed_insight), 200
            except json.JSONDecodeError as e:
                print(f"ERROR: Failed to parse Gemini's inner JSON response: {e}. Raw response text: '{response_text}'")
                return jsonify({"error": "AI response was malformed, please try again."}), 500
        else:
            print(f"ERROR: Unexpected Gemini API response structure: {gemini_response}")
            return jsonify({"error": "Failed to get AI insight due to unexpected response structure."}), 500

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

