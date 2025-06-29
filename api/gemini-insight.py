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
    # Handle preflight (OPTIONS) request
    if request.method == 'OPTIONS':
        # Vercel's Flask functions handle CORS preflight headers automatically when Flask-CORS is used.
        # Just return a simple response.
        return '', 204

    # Handle POST request
    request_json = request.get_json(silent=True)
    if not request_json or 'scramble' not in request_json or 'cubeType' not in request_json:
        return jsonify({"error": "Missing 'scramble' or 'cubeType' in request body."}), 400

    scramble = request_json['scramble']
    cube_type = request_json['cubeType']

    # Retrieve the Gemini API key from environment variables
    # This environment variable MUST be set in Vercel project settings.
    # Name it exactly: `GEMINI_API_KEY`
    gemini_api_key = os.environ.get('GEMINI_API_KEY')

    if not gemini_api_key:
        print("ERROR: GEMINI_API_KEY environment variable not set.")
        return jsonify({"error": "Server configuration error: Gemini API key not found."}), 500

    # Define the prompt for the Gemini model
    prompt = f"Analyze the {cube_type} scramble: '{scramble}'. Provide a detailed observation (2-3 sentences) focused on the initial cross or first F2L pair. The observation should identify a specific beneficial feature as if visually inspecting the cube, such as an already solved or easily solvable cross edge/corner, or an intuitive first F2L pair. For example: \"You might notice the White-Orange edge is already placed, requiring only an F2 move to join the cross.\" or \"Observe that the Green-Red edge and corner are paired up and ready for insertion.\" Deliver the insight directly, using simple and clear language, without conversational intros or concluding remarks. Focus solely on a valuable setup observation."

    # Gemini API endpoint and model
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"

    # Construct the payload for the API request
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

    try:
        # Make the request to the Gemini API
        response = requests.post(api_url, headers={"Content-Type": "application/json"}, data=json.dumps(payload))
        response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)
        
        gemini_result = response.json()
        
        if gemini_result.get('candidates') and len(gemini_result['candidates']) > 0 and \
           gemini_result['candidates'][0].get('content') and \
           gemini_result['candidates'][0]['content'].get('parts') and \
           len(gemini_result['candidates'][0]['content']['parts']) > 0:
            insight_text = gemini_result['candidates'][0]['content']['parts'][0]['text']
            return jsonify({"insight": insight_text}), 200
        else:
            print(f"ERROR: Unexpected Gemini API response structure: {gemini_result}")
            return jsonify({"error": "Failed to generate insight: Unexpected API response."}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to connect to AI service: {e}"}), 500
    except Exception as e:
        print(f"ERROR: An unexpected error occurred: {e}")
        return jsonify({"error": f"An internal server error occurred: {e}"}), 500

# This is for local development with `flask run` or Gunicorn, not directly used by Vercel's build step.
# if __name__ == '__main__':
#     app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))

