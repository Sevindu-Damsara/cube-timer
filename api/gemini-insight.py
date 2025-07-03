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

        # Determine the type of request
        request_type = request_json.get('type')

        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: GEMINI_API_KEY is not set."}), 500

        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_api_key}"

        if request_type == "general_query":
            query = request_json.get('query', 'Tell me about Rubik\'s Cube.')
            print(f"DEBUG: Handling general query: {query}")

            prompt = f"""
            You are Jarvis, an AI assistant for a Rubik's Cube timer application.
            The user has asked a general question about cubing or related topics.
            Please provide a concise and helpful answer to the following query:
            "{query}"

            Keep your answer factual and directly address the query.
            Format your response as a JSON object with a single key:
            {{
                "answer": "Your concise answer here."
            }}
            """
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }
            try:
                gemini_response = requests.post(gemini_url, headers=headers, data=json.dumps(payload))
                gemini_response.raise_for_status()
                gemini_result = gemini_response.json()
                print(f"DEBUG: Gemini raw response for general query: {gemini_result}")

                if isinstance(gemini_result, dict) and gemini_result.get('candidates'):
                    candidate = gemini_result['candidates'][0]
                    if isinstance(candidate, dict) and candidate.get('content'):
                        content_parts = candidate['content'].get('parts')
                        if content_parts and isinstance(content_parts, list) and len(content_parts) > 0:
                            gemini_content_str = content_parts[0].get('text')
                            if gemini_content_str:
                                try:
                                    parsed_content = json.loads(gemini_content_str)
                                    return jsonify(parsed_content), 200
                                except json.JSONDecodeError as e:
                                    print(f"ERROR: Failed to decode Gemini JSON content string for general query: {e}. Raw content string: '{gemini_content_str}'")
                                    return jsonify({"error": f"AI service returned malformed JSON content for general query: {e}"}), 500
                            else:
                                print("ERROR: Gemini content part 'text' for general query is missing or empty.")
                                return jsonify({"error": "AI service response content is empty for general query."}), 500
                        else:
                            print("ERROR: Gemini content 'parts' for general query is missing, not a list, or empty.")
                            return jsonify({"error": "AI service response parts are malformed or empty for general query."}), 500
                    else:
                        print("ERROR: Gemini candidate 'content' for general query is missing or not a dictionary.")
                        return jsonify({"error": "AI service response candidate content is malformed for general query."}), 500
                else:
                    print("ERROR: Gemini response for general query missing 'candidates' or not a dictionary.")
                    return jsonify({"error": "AI service response for general query is malformed or missing candidates."}), 500
            except Exception as e:
                import traceback
                print(f"CRITICAL ERROR: An unexpected server-side error occurred during general query: {e}\\n{traceback.format_exc()}")
                return jsonify({"error": f"An unexpected internal server error occurred during general query. Details: {str(e)}."}), 500

        elif request_type == "get_insight":
            # Extract data for insight generation
            scramble = request_json.get('scramble', 'R U R\' U\' F\' L\' U\' L\'') # Default scramble for safety
            cube_type = request_json.get('cubeType', '3x3')
            solve_time_ms = request_json.get('solveTimeMs', 0)
            penalty = request_json.get('penalty', None)
            user_level = request_json.get('userLevel', 'Beginner')

            # Generate optimal solution using Kociemba (for 3x3 only)
            optimal_solution = "Optimal solution generation is only supported for 3x3 cubes."
            if cube_type == '3x3':
                try:
                    cube = pc.Cube()
                    cube(scramble) # Apply the scramble to the cube
                    # FIX: Use kociemba.solve with the cube's Kociemba string representation
                    optimal_solution = kociemba.solve(cube.to_kociemba_string())
                    print(f"DEBUG: Kociemba optimal solution generated: {optimal_solution}")
                except Exception as e:
                    print(f"ERROR: Kociemba solve failed for scramble '{scramble}': {e}")
                    optimal_solution = f"Could not generate optimal solution for this scramble. Error: {e}"

            # Construct prompt for Gemini for insight
            prompt = f"""
            You are Jarvis, an AI assistant providing insights for Rubik's Cube solvers.
            The user completed a {cube_type} solve with the scramble "{scramble}".
            Their solve time was {solve_time_ms / 1000:.3f} seconds.
            The user's current estimated skill level is "{user_level}".
            
            For a 3x3 cube, the optimal solution for this scramble is: "{optimal_solution}".

            Please provide a concise and encouraging insight for the user, including:
            1.  A brief analysis of the scramble (e.g., "easy cross", "complex F2L").
            2.  The full optimal solution for 3x3 cubes if available (from the provided "optimal_solution" variable). For other cube types, state that optimal solution generation is not supported.
            3.  A detailed personalized tip based on their skill level and solve time, offering actionable advice for improvement.

            Format your response as a JSON object with the following keys:
            {{
                "insight": "Overall brief insight message.",
                "scrambleAnalysis": "Analysis of the scramble characteristics.",
                "optimalSolution": "The full optimal solution string for 3x3, or a message indicating it's not supported for other cube types.",
                "personalizedTip": "A detailed tip tailored to the user's skill level, providing actionable advice."
            }}
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

                # Robustly parse the Gemini result
                if isinstance(gemini_result, dict) and gemini_result.get('candidates'):
                    candidate = gemini_result['candidates'][0]
                    if isinstance(candidate, dict) and candidate.get('content'):
                        content_parts = candidate['content'].get('parts')
                        if content_parts and isinstance(content_parts, list) and len(content_parts) > 0:
                            gemini_content_str = content_parts[0].get('text')
                            if gemini_content_str:
                                try:
                                    parsed_content = json.loads(gemini_content_str)
                                    return jsonify(parsed_content), 200
                                except json.JSONDecodeError as e:
                                    print(f"ERROR: Failed to decode Gemini JSON content string: {e}. Raw content string: '{gemini_content_str}'")
                                    return jsonify({"error": f"AI service returned malformed JSON content: {e}"}), 500
                            else:
                                print("ERROR: Gemini content part 'text' is missing or empty.")
                                return jsonify({"error": "AI service response content is empty."}), 500
                        else:
                            print("ERROR: Gemini content 'parts' is missing, not a list, or empty.")
                            return jsonify({"error": "AI service response parts are malformed or empty."}), 500
                    else:
                        print("ERROR: Gemini candidate 'content' is missing or not a dictionary.")
                        return jsonify({"error": "AI service response candidate content is malformed."}), 500
                else:
                    print("ERROR: Gemini response missing 'candidates' or not a dictionary.")
                    return jsonify({"error": "AI service response is malformed or missing candidates."}), 500

            except requests.exceptions.RequestException as e:
                print(f"ERROR: Request to Gemini API failed: {e}")
                return jsonify({"error": f"Failed to connect to AI service: {e}"}), 500
            except json.JSONDecodeError as e:
                print(f"ERROR: Failed to decode Gemini JSON response: {e}. Raw response: {gemini_response.text}")
                return jsonify({"error": f"AI service returned malformed JSON: {e}"}), 500
            except Exception as e:
                import traceback
                print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\\n{traceback.format_exc()}")
                return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500
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
        print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

# To run this with Vercel, ensure you have a 'requirements.txt' in the same 'api' directory:
# Flask==3.*
# requests==2.*
# flask-cors==4.*
# kociemba
# pycuber
