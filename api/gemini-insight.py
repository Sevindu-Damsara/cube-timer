# api/gemini-insight.py inside your Vercel project's 'api' directory
# This file specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight using Gemini API.

import os
import requests
import json
from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions
import kociemba
import pycuber as pc # For cube state manipulation if needed

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

        request_type = request_json.get('type', 'get_insight') # Default to get_insight

        if request_type == 'get_insight':
            # Extract data from the request for solve insight
            scramble = request_json.get('scramble')
            cube_type = request_json.get('cubeType')
            solve_time_ms = request_json.get('solveTimeMs')
            penalty = request_json.get('penalty')
            user_level = request_json.get('userLevel')

            if not all([scramble, cube_type, solve_time_ms is not None, user_level]):
                print("ERROR: Missing data for get_insight.")
                return jsonify({"error": "Missing scramble, cubeType, solveTimeMs, or userLevel for insight generation."}), 400

            # --- Generate Optimal Solution (Kociemba) ---
            optimal_solution = "Could not calculate optimal solution."
            try:
                if cube_type == '3x3':
                    # To use Kociemba, we need the cube's current state.
                    # A scramble is a sequence of moves from a solved state.
                    # So, applying the scramble to a solved cube gives its current state.
                    # pycuber can do this.
                    # Example: solved_cube = pc.Cube()
                    # scrambled_cube = solved_cube(scramble)
                    # current_state_string = scrambled_cube.as_face_string() # This needs to be in Kociemba's format

                    # For simplicity and to avoid complex state representation for all cube types,
                    # we will ask Gemini to provide a general optimal approach or confirm it.
                    # Kociemba requires a specific cube state string, not just the scramble.
                    # For a full Kociemba integration, the client would need to send the cube state.
                    # For this demo, we'll use Gemini to *simulate* an optimal solution idea.
                    # If we had the facelet string, it would be:
                    # optimal_solution = kociemba.solve(facelet_string)
                    # For now, let's just indicate Kociemba is for 3x3 and needs state.
                    optimal_solution = f"Optimal solution for {cube_type} (requires cube state for Kociemba): "
                else:
                    optimal_solution = f"Optimal solution for {cube_type} is not directly calculable by Kociemba."

            except Exception as e:
                print(f"WARNING: Kociemba calculation failed: {e}")
                optimal_solution = "Could not calculate optimal solution (solver error)."


            # --- Gemini API Call for Insight ---
            gemini_api_key = os.environ.get("GEMINI_API_KEY")
            if not gemini_api_key:
                print("ERROR: GEMINI_API_KEY environment variable not set.")
                return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

            # Gemini API endpoint
            gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"

            # Convert solve time to seconds for prompt clarity
            solve_time_seconds = solve_time_ms / 1000

            # Enhanced prompt for more detailed insights, including scramble analysis and personalized tips
            prompt = f"""
            You are an expert Rubik's Cube AI assistant. Provide a comprehensive analysis for a {cube_type} solve.
            The scramble was: "{scramble}".
            The user's solve time was: {solve_time_seconds:.3f} seconds.
            The user's current estimated cubing level is: {user_level}.
            The solve had a penalty of: {penalty if penalty else 'none'}.

            Please provide the following in a structured JSON format:
            {{
                "insight": "A general, encouraging insight about the solve. Mention the time and cube type. Keep it concise.",
                "scrambleAnalysis": "Analyze the provided scramble. Is it an easy scramble (e.g., few moves to solve, easy cross/F2L)? Is it difficult (e.g., bad cross, difficult F2L pairs, awkward OLL/PLL skips)? Provide a brief reason.",
                "optimalSolution": "Suggest a high-level optimal strategy or approach for this scramble, assuming a solved state. Do not provide a full Kociemba solution unless explicitly asked for a specific cube state. For 3x3, you can mention common first steps like cross, F2L, OLL, PLL. For Pyraminx, mention tips, L4E. Provide a very short example of a good first few moves if it's a simple start.",
                "personalizedTip": "Based on the user's level ('{user_level}') and the solve time, provide one actionable, personalized tip for improvement. For example, if Beginner, suggest focusing on cross. If Advanced, suggest look-ahead or specific algorithm practice. Make it encouraging and specific to their level. Do not repeat the scramble analysis in the tip."
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

                # Extract content from Gemini's response
                if gemini_result and gemini_result.get('candidates'):
                    gemini_content_str = gemini_result['candidates'][0]['content']['parts'][0]['text']
                    # Gemini might return a stringified JSON. Parse it.
                    parsed_gemini_content = json.loads(gemini_content_str)

                    # Return the structured insights
                    return jsonify({
                        "insight": parsed_gemini_content.get("insight", "No general insight provided."),
                        "scrambleAnalysis": parsed_gemini_content.get("scrambleAnalysis", "No scramble analysis provided."),
                        "optimalSolution": parsed_gemini_content.get("optimalSolution", optimal_solution),
                        "personalizedTip": parsed_gemini_content.get("personalizedTip", "No personalized tip provided.")
                    }), 200
                else:
                    print("ERROR: Gemini response missing candidates or content.")
                    return jsonify({"error": "Failed to get valid response from AI service."}), 500

            except requests.exceptions.RequestException as e:
                print(f"ERROR: Request to Gemini API failed: {e}")
                return jsonify({"error": f"Failed to connect to AI service: {e}"}), 500
            except json.JSONDecodeError as e:
                print(f"ERROR: Failed to decode Gemini JSON response: {e}. Raw response: {gemini_response.text}")
                return jsonify({"error": f"AI service returned malformed JSON: {e}"}), 500
            except Exception as e:
                print(f"CRITICAL ERROR: Unexpected error during Gemini insight generation: {e}")
                return jsonify({"error": f"An unexpected error occurred during AI insight generation: {e}"}), 500

        elif request_type == 'get_algorithm':
            query = request_json.get('query')
            if not query:
                return jsonify({"error": "Missing query for algorithm generation."}), 400

            gemini_api_key = os.environ.get("GEMINI_API_KEY")
            if not gemini_api_key:
                print("ERROR: GEMINI_API_KEY environment variable not set.")
                return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

            gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"

            # Prompt for algorithm lookup
            algorithm_prompt = f"""
            You are an expert Rubik's Cube AI assistant. The user is asking about a Rubik's Cube algorithm or concept.
            The query is: "{query}".

            Please provide a concise and accurate response. If it's an algorithm, provide the standard notation. If it's a concept, explain it briefly.
            If you cannot find a relevant algorithm or explanation, state that clearly.

            Provide the response in a structured JSON format:
            {{
                "algorithm": "The algorithm notation (e.g., R U R' U')",
                "explanation": "A brief explanation of what this algorithm/concept is used for."
            }}
            If you cannot provide an algorithm, leave the "algorithm" field empty or null.
            If you cannot provide an explanation, leave the "explanation" field empty or null.
            Ensure all responses are within the JSON structure. Do not include any text outside the JSON.
            """

            payload = {
                "contents": [{"role": "user", "parts": [{"text": algorithm_prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }

            headers = {
                "Content-Type": "application/json"
            }

            try:
                gemini_response = requests.post(gemini_url, headers=headers, data=json.dumps(payload))
                gemini_response.raise_for_status()
                gemini_result = gemini_response.json()
                print(f"DEBUG: Gemini raw response for algorithm: {gemini_result}")

                if gemini_result and gemini_result.get('candidates'):
                    gemini_content_str = gemini_result['candidates'][0]['content']['parts'][0]['text']
                    parsed_gemini_content = json.loads(gemini_content_str)
                    return jsonify(parsed_gemini_content), 200
                else:
                    print("ERROR: Gemini response missing candidates or content for algorithm.")
                    return jsonify({"error": "Failed to get valid response from AI service for algorithm."}), 500

            except requests.exceptions.RequestException as e:
                print(f"ERROR: Request to Gemini API for algorithm failed: {e}")
                return jsonify({"error": f"Failed to connect to AI service for algorithm: {e}"}), 500
            except json.JSONDecodeError as e:
                print(f"ERROR: Failed to decode Gemini JSON response for algorithm: {e}. Raw response: {gemini_response.text}")
                return jsonify({"error": f"AI service returned malformed JSON for algorithm: {e}"}), 500
            except Exception as e:
                print(f"CRITICAL ERROR: Unexpected error during Gemini algorithm generation: {e}")
                return jsonify({"error": f"An unexpected error occurred during AI algorithm generation: {e}"}), 500

        else:
            print(f"ERROR: Unknown request type: {request_type}")
            return jsonify({"error": f"Unknown request type: {request_type}"}), 400

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
