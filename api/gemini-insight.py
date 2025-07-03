# api/gemini-insight.py inside your Vercel project's 'api' directory
# This file specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight using Gemini API.

import os
import requests
import json
from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions
# Removed kociemba and pycuber as optimal solution generation is being removed for all cube types.
# import kociemba
# import pycuber as pc

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

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

        # Determine the type of request
        request_type = request_json.get('type')

        if request_type == 'get_insight':
            # Extract data for insight generation
            scramble = request_json.get('scramble')
            cube_type = request_json.get('cubeType')
            solve_time_ms = request_json.get('solveTimeMs')
            penalty = request_json.get('penalty')
            user_level = request_json.get('userLevel')

            if not all([scramble, cube_type, solve_time_ms is not None, user_level]):
                print("ERROR: Missing required fields for get_insight.")
                return jsonify({"error": "Missing scramble, cubeType, solveTimeMs, or userLevel for insight generation."}), 400

            # Construct the prompt for Gemini to generate insights
            # The prompt is now structured to request the new "targetedPracticeFocus"
            # and explicitly excludes optimal solution for all cube types.
            prompt = f"""
            You are an expert Rubik's Cube coach and AI assistant. Provide a concise analysis for a {cube_type} solve.

            Here are the details of the solve:
            - Cube Type: {cube_type}
            - Scramble: {scramble}
            - Solve Time: {solve_time_ms} milliseconds
            - Penalty: {penalty if penalty else 'None'}
            - User Level: {user_level}

            Based on this information, provide the following:
            1.  **Insight:** A brief, encouraging, and general comment on the solve.
            2.  **Scramble Analysis:** A very brief analysis of the scramble for a {cube_type} cube. Do not attempt to solve it or provide specific solution steps. Comment on any noticeable features or general challenges.
            3.  **Personalized Tip:** A specific, actionable tip tailored to the user's '{user_level}' level for a {cube_type} cube, focusing on general areas of improvement (e.g., lookahead, finger tricks, specific F2L cases, center building, edge pairing).
            4.  **Targeted Practice Focus:** Suggest a specific technique, common algorithm (mention by name, e.g., "OLL Case X"), or a type of drill that the user should focus on next to improve, relevant to the {cube_type} cube. Do not provide optimal solutions.

            Format your response as a JSON object with the following keys:
            {{
                "insight": "...",
                "scrambleAnalysis": "...",
                "personalizedTip": "...",
                "targetedPracticeFocus": "..."
            }}
            """

            # Call Gemini API
            gemini_api_key = os.environ.get("GEMINI_API_KEY")
            if not gemini_api_key:
                print("ERROR: GEMINI_API_KEY environment variable not set.")
                return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"
            headers = {'Content-Type': 'application/json'}
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }

            print("DEBUG: Sending request to Gemini API.")
            gemini_response = requests.post(api_url, headers=headers, data=json.dumps(payload))
            gemini_response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

            gemini_result = gemini_response.json()
            print(f"DEBUG: Received response from Gemini: {gemini_result}")

            # Extract the text content from the Gemini response
            if gemini_result and gemini_result.get('candidates'):
                response_text = gemini_result['candidates'][0]['content']['parts'][0]['text']
                # Attempt to parse the JSON string from Gemini
                try:
                    insight_data = json.loads(response_text)
                    # Ensure all expected keys are present, provide defaults if not
                    response_payload = {
                        "insight": insight_data.get("insight", "Could not generate general insight."),
                        "scrambleAnalysis": insight_data.get("scrambleAnalysis", "Could not generate scramble analysis."),
                        "personalizedTip": insight_data.get("personalizedTip", "Could not generate personalized tip."),
                        "targetedPracticeFocus": insight_data.get("targetedPracticeFocus", "Could not generate targeted practice focus.")
                    }
                    return jsonify(response_payload)
                except json.JSONDecodeError as e:
                    print(f"ERROR: Failed to decode JSON from Gemini response: {e}. Raw response: {response_text}")
                    return jsonify({"error": f"Failed to parse AI insight: Invalid JSON format from AI. Details: {e}"}), 500
            else:
                print("ERROR: No candidates found in Gemini response.")
                return jsonify({"error": "No AI insight generated."}), 500

        elif request_type == 'get_algorithm':
            query = request_json.get('query')
            if not query:
                print("ERROR: Missing 'query' for get_algorithm.")
                return jsonify({"error": "Missing 'query' for algorithm generation."}), 400

            prompt = f"""
            You are an expert Rubik's Cube AI assistant. Provide a concise algorithm or explanation for the following query.
            Query: "{query}"

            If the query is for a specific algorithm (e.g., "T-Perm", "OLL Case 21"), provide the standard algorithm.
            If the query is for a concept (e.g., "What is F2L?", "How to solve 4x4 centers"), provide a brief explanation.
            Do not provide optimal solutions for full cube solves.

            Format your response as a JSON object with either an "algorithm" or "explanation" key:
            {{ "algorithm": "..." }} OR {{ "explanation": "..." }}
            """

            # Call Gemini API
            gemini_api_key = os.environ.get("GEMINI_API_KEY")
            if not gemini_api_key:
                print("ERROR: GEMINI_API_KEY environment variable not set.")
                return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"
            headers = {'Content-Type': 'application/json'}
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }

            print("DEBUG: Sending request to Gemini API for algorithm/explanation.")
            gemini_response = requests.post(api_url, headers=headers, data=json.dumps(payload))
            gemini_response.raise_for_status()

            gemini_result = gemini_response.json()
            print(f"DEBUG: Received response from Gemini: {gemini_result}")

            if gemini_result and gemini_result.get('candidates'):
                response_text = gemini_result['candidates'][0]['content']['parts'][0]['text']
                try:
                    algorithm_data = json.loads(response_text)
                    if "algorithm" in algorithm_data:
                        return jsonify({"algorithm": algorithm_data["algorithm"]})
                    elif "explanation" in algorithm_data:
                        return jsonify({"explanation": algorithm_data["explanation"]})
                    else:
                        print("ERROR: Gemini response for algorithm/explanation missing expected keys.")
                        return jsonify({"error": "AI did not provide a valid algorithm or explanation."}), 500
                except json.JSONDecodeError as e:
                    print(f"ERROR: Failed to decode JSON from Gemini response for algorithm/explanation: {e}. Raw response: {response_text}")
                    return jsonify({"error": f"Failed to parse AI response: Invalid JSON format from AI. Details: {e}"}), 500
            else:
                print("ERROR: No candidates found in Gemini response for algorithm/explanation.")
                return jsonify({"error": "No AI response generated for algorithm/explanation."}), 500

        else:
            print(f"ERROR: Unknown request type: {request_type}")
            return jsonify({"error": f"Unknown request type: {request_type}"}), 400

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
