# api/gemini-insight.py inside your Vercel project's 'api' directory
# This file specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight using Gemini API.

import os
import requests
import json
from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions
import kociemba
import pycuber as pc

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

        # Extract data from the request
        scramble = request_json.get('scramble', 'unknown scramble')
        print(f"DEBUG: Scramble received in request: '{scramble}'")
        cube_type = request_json.get('cubeType', '3x3')
        solve_time_ms = request_json.get('solveTimeMs')
        penalty = request_json.get('penalty', 'none')
        user_level = request_json.get('userLevel', 'General Cubist')

        # Convert solve_time_ms to a human-readable format for the prompt
        solve_time_formatted = "N/A"
        if solve_time_ms is not None:
            minutes = int(solve_time_ms / 60000)
            seconds = int((solve_time_ms % 60000) / 1000)
            milliseconds = int(solve_time_ms % 1000)
            solve_time_formatted = f"{minutes:02}:{seconds:02}.{milliseconds:03}"

        print(f"DEBUG: Insight request details - Scramble: {scramble}, Type: {cube_type}, Time: {solve_time_formatted}, Penalty: {penalty}, Level: {user_level}")

        # Your Gemini API Key - This should be set as an environment variable in Vercel.
        # For development, you might hardcode it here temporarily, but REMOVE for production.
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API Key is not set."}), 500

        # Construct the prompt for Gemini.
        # Instruct Gemini to generate a general insight, an optimal solution, and a personalized tip.
        # Explicitly ask for a JSON response structure.
        # MODIFIED: Removed instructions for "Sir Sevindu" in the generated text content.
        prompt = f"""
        You are an advanced AI assistant named Jarvis, specialized in Rubik's Cube analysis.
        Provide a concise general insight, an optimal solution if applicable, and a personalized tip for the following Rubik's Cube solve.
        The user's cubing level is designated as {user_level}. The cube type used was {cube_type}.
        The scramble for this solve was: {scramble}.
        The recorded solve time was: {solve_time_formatted}.
        Any penalty applied was: {penalty}.

        Important instructions for your response:
        1.  **General Insight:** Provide a brief, overall observation about the solve (e.g., "A solid solve," "Room for improvement in F2L"). Keep this under 30 words.
        2.  **Optimal Solution:** If an optimal solution for the provided scramble is known or can be generated, provide it. Otherwise, state that it is 'Not available'.
        3.  **Personalized Tip:** Offer one specific, actionable recommendation tailored to the user's current skill level ({user_level}) and the characteristics of this particular solve (e.g., "Consider practicing cross solutions," "Focus on look-ahead during OLL"). This should be a single, clear recommendation, under 40 words.
        4.  **Tone:** Maintain a formal, respectful, and helpful tone throughout the generated text. Do not include specific salutations or direct addresses like "Sir Sevindu" within the 'insight', 'optimalSolution', or 'personalizedTip' fields.

        Respond ONLY with a JSON object in the following exact format:
        {{
          "insight": "General insight text.",
          "optimalSolution": "Optimal solution algorithm (e.g., F U R U' R' F') or 'Not available'.",
          "personalizedTip": "Personalized tip text."
        }}
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
                        "insight": { "type": "STRING" },
                        "optimalSolution": { "type": "STRING" },
                        "personalizedTip": { "type": "STRING" }
                    },
                    "required": ["insight", "optimalSolution", "personalizedTip"]
                }
            }
        }

        print("DEBUG: Sending request to Gemini API.")
        gemini_response = requests.post(gemini_url, headers=headers, json=payload, timeout=30)
        gemini_response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

        gemini_result = gemini_response.json()
        print(f"DEBUG: Raw Gemini response: {json.dumps(gemini_result, indent=2)}")

        # Extract content from Gemini's structured response
        if gemini_result.get('candidates') and len(gemini_result['candidates']) > 0:
            if gemini_result['candidates'][0].get('content') and gemini_result['candidates'][0]['content'].get('parts'):
                try:
                    # The content is a stringified JSON, so parse it
                    gemini_content_str = gemini_result['candidates'][0]['content']['parts'][0]['text']
                    parsed_gemini_content = json.loads(gemini_content_str)
                    
                    insight = parsed_gemini_content.get('insight', 'No insight generated.')
                    optimal_solution = parsed_gemini_content.get('optimalSolution', 'Not available.')
                    personalized_tip = parsed_gemini_content.get('personalizedTip', 'No personalized tip generated.')

                    # If Gemini did not provide an optimal solution, try to generate one locally
                    if optimal_solution.strip().lower() == 'not available':
                        try:
                            # Validate scramble format for kociemba
                            original_scramble = scramble.strip()
                            print(f"DEBUG: Original scramble received: '{original_scramble}'")
                            # Transform scramble to kociemba format if needed
                            # For example, remove unwanted characters, normalize spacing
                            transformed_scramble = original_scramble.replace('\n', ' ').replace('\r', ' ').strip()
                            # Remove multiple spaces
                            import re
                            transformed_scramble = re.sub(r'\s+', ' ', transformed_scramble)
                            print(f"DEBUG: Transformed scramble for local solver: '{transformed_scramble}'")
                            # Validate transformed scramble
                            if not transformed_scramble or any(c not in "URFDLBMESxyz' 0123456789 " for c in transformed_scramble):
                                print(f"WARNING: Scramble format may be invalid for local solver: '{transformed_scramble}'")
                                optimal_solution = "Not available (invalid scramble format for local solver)"
                            else:
                                print(f"DEBUG: Valid scramble for local solver: '{transformed_scramble}'")
                                try:
                                    # Use pycuber to create a cube and apply scramble
                                    cube = pc.Cube()
                                    try:
                                        scramble_moves = pc.Formula(transformed_scramble)
                                        print(f"DEBUG: Parsed scramble moves: {scramble_moves}")
                                    except Exception as e:
                                        print(f"ERROR: Failed to parse scramble moves: {e}")
                                        raise e
                                    cube(scramble_moves)
                                    # Get cube state string for kociemba
                                    cube_state = cube.to_kociemba()
                                    print(f"DEBUG: Cube state string for kociemba: {cube_state} (length: {len(cube_state)})")
                                    if len(cube_state) != 54:
                                        raise ValueError(f"Invalid cube state length: {len(cube_state)}")
                                    local_solution = kociemba.solve(cube_state)
                                    optimal_solution = local_solution
                                    print(f"DEBUG: Local optimal solution generated: {local_solution}")
                                except Exception as e:
                                    print(f"ERROR: Exception in local solver: {e}")
                                    optimal_solution = f"Not available (local solver error: {e})"
                        except Exception as e:
                            print(f"ERROR: Failed to generate local optimal solution: {e}")

                    return jsonify({
                        "insight": insight,
                        "optimalSolution": optimal_solution,
                        "personalizedTip": personalized_tip
                    }), 200

                except json.JSONDecodeError as e:
                    print(f"ERROR: JSON decoding error on Gemini response: {e}. Raw response: '{gemini_content_str}'")
                    return jsonify({"error": f"AI response malformed: {e}"}), 500
                except Exception as e:
                    print(f"ERROR: Unexpected error processing Gemini response: {e}")
                    return jsonify({"error": f"An unexpected error occurred processing AI response: {e}"}), 500
            else:
                print("WARN: Gemini response 'content' or 'parts' missing.")
                return jsonify({"error": "AI response content missing."}), 500
        else:
            print("WARN: Gemini response 'candidates' missing or empty.")
            return jsonify({"error": "AI response candidates missing or empty."}), 500

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
