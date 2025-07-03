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

# Gemini API configuration
# Ensure GEMINI_API_KEY is set in your Vercel project's environment variables
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

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
        scramble = request_json.get('scramble')
        cube_type = request_json.get('cubeType')
        solve_time_ms = request_json.get('solveTimeMs')
        penalty = request_json.get('penalty')
        user_level = request_json.get('userLevel')

        if not all([scramble, cube_type, solve_time_ms is not None, user_level]):
            print("ERROR: Missing required fields in request.")
            return jsonify({"error": "Missing required fields: scramble, cubeType, solveTimeMs, userLevel."}), 400

        # --- Generate Optimal Solution using Kociemba (for 3x3) ---
        optimal_solution = "Not applicable for this cube type or could not be calculated."
        if cube_type == '3x3':
            try:
                # Kociemba expects a specific scramble format (e.g., "U F' D2 L2...")
                # pycuber can help normalize this.
                mycube = pc.Cube()
                mycube(scramble) # Apply the scramble to a virtual cube
                
                # Get the cube's facelet string for Kociemba
                # Kociemba's input format: UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB
                # pycuber's facelet string is compatible.
                facelet_string = mycube.as_facelet_string()
                
                print(f"DEBUG: Kociemba input facelet string: {facelet_string}")
                
                # Solve using Kociemba's algorithm
                solution_moves = kociemba.solve(facelet_string)
                
                # Further processing for phase breakdown
                # This is a simplified breakdown. A true phase breakdown would require
                # more complex logic or a specialized library.
                # For now, we'll just present the full optimal solution.
                
                optimal_solution = f"Optimal Solution (Kociemba): {solution_moves} (length: {len(solution_moves.split())} moves)"
                
            except Exception as e:
                print(f"WARNING: Kociemba solve failed for scramble '{scramble}': {e}")
                optimal_solution = "Could not calculate optimal solution for this scramble."
        else:
            print(f"DEBUG: Kociemba not used for cube type: {cube_type}")

        # --- Call Gemini API for personalized insight and tips ---
        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        headers = {
            'Content-Type': 'application/json'
        }
        
        # Craft a more detailed prompt for Gemini
        prompt_text = f"""
        You are an expert Rubik's Cube coach and AI assistant named Jarvis.
        The user, Sir Sevindu, has just completed a {cube_type} solve.
        Scramble: {scramble}
        Solve Time: {solve_time_ms / 1000:.2f} seconds
        Penalty: {penalty if penalty else 'None'}
        User's Estimated Level: {user_level}

        Please provide a concise and encouraging analysis of this solve, focusing on actionable tips for improvement.
        Your response should be structured as a JSON object with two fields:
        1.  `optimalSolution`: A string describing the theoretical optimal solution (if available, otherwise state 'Not available'). For 3x3, incorporate the Kociemba solution provided. If a Kociemba solution is available, break it down into common phases (Cross, F2L, OLL, PLL) if possible, or explain it's the full optimal sequence.
        2.  `personalizedTip`: A string with a personalized, encouraging tip based on the solve time, user level, and general cubing principles. Suggest specific areas to focus on (e.g., F2L efficiency, look-ahead, finger tricks, specific algorithm practice).

        Example for 3x3 with Kociemba:
        {{
            "optimalSolution": "Cross: R' D F, F2L: U R U' R' ..., OLL: ..., PLL: ... (Total: X moves)",
            "personalizedTip": "Sir Sevindu, your solve demonstrates good foundational understanding. To improve, focus on reducing pauses between F2L pairs. Practice recognizing cases faster."
        }}

        Example for other cubes or if Kociemba fails:
        {{
            "optimalSolution": "Not available for this cube type or could not be calculated.",
            "personalizedTip": "Excellent effort, Sir Sevindu! For {cube_type} solves, consistent practice with finger tricks can significantly reduce your time. Consider drilling basic algorithms."
        }}

        Ensure the tone is always respectful and formal, addressing the user as "Sir Sevindu".
        """

        # Define the response schema for structured output
        generation_config = {
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "OBJECT",
                "properties": {
                    "optimalSolution": {"type": "STRING"},
                    "personalizedTip": {"type": "STRING"}
                },
                "propertyOrdering": ["optimalSolution", "personalizedTip"]
            }
        }

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt_text}]}],
            "generationConfig": generation_config
        }

        # Substitute the Kociemba solution into the prompt if available
        if cube_type == '3x3' and "Kociemba" in optimal_solution:
            payload["contents"][0]["parts"][0]["text"] = payload["contents"][0]["parts"][0]["text"].replace(
                "Optimal Solution (Kociemba): {solution_moves} (length: {len(solution_moves.split())} moves)",
                optimal_solution # Insert the actual Kociemba solution here
            )
            # Add a hint to Gemini to break it down if possible
            payload["contents"][0]["parts"][0]["text"] += "\nIf possible, break down the optimal solution into Cross, F2L, OLL, and PLL phases."


        # Gemini API URL
        gemini_api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

        print(f"DEBUG: Calling Gemini API at: {gemini_api_url}")
        gemini_response = requests.post(gemini_api_url, headers=headers, data=json.dumps(payload), timeout=30)
        gemini_response.raise_for_status() # Raise an HTTPError for bad responses (4xx or 5xx)

        gemini_result = gemini_response.json()
        print(f"DEBUG: Raw Gemini response: {gemini_result}")

        # Parse the structured JSON from Gemini
        if gemini_result and gemini_result.get('candidates') and gemini_result['candidates'][0].get('content') and gemini_result['candidates'][0]['content'].get('parts'):
            response_text = gemini_result['candidates'][0]['content']['parts'][0]['text']
            # Gemini returns a string that is a JSON object, so we need to parse it
            parsed_insight = json.loads(response_text)
            
            # Ensure optimalSolution from Kociemba is prioritized if Gemini didn't provide a better one
            final_optimal_solution = parsed_insight.get('optimalSolution', optimal_solution)
            if cube_type == '3x3' and "Kociemba" in optimal_solution and "optimalSolution" in parsed_insight and "not available" in parsed_insight["optimalSolution"].lower():
                 final_optimal_solution = optimal_solution # Use Kociemba if Gemini says not available

            return jsonify({
                "insight": "Analysis complete, Sir Sevindu.", # General message
                "optimalSolution": final_optimal_solution,
                "personalizedTip": parsed_insight.get('personalizedTip', "I am unable to provide a personalized tip at this moment, Sir Sevindu.")
            }), 200
        else:
            print("ERROR: Unexpected Gemini response structure or empty content.")
            return jsonify({"error": "Failed to get a valid insight from AI. Unexpected response structure."}), 500

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
        # This occurs if the incoming request JSON is malformed or Gemini's response is malformed.
        raw_body = request.get_data(as_text=True)
        print(f"ERROR: JSON decoding error: {json_err}. Raw request body: '{raw_body}' or Gemini response was malformed.")
        return jsonify({"error": f"Invalid JSON format. Details: {json_err}"}), 400
    except Exception as e:
        # Catch any other unexpected errors and log them with a traceback.
        import traceback
        print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

