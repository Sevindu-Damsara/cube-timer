# api/gemini-insight.py inside your Vercel project's 'api' directory
# This function specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight and now AI lessons using Gemini API.

import os
import requests
import json
import uuid # NEW: Import uuid for generating unique lesson IDs

from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

# Retrieve Gemini API key from environment variables for security.
# In Vercel, set this as an environment variable (e.g., GEMINI_API_KEY).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

@app.route('/api/gemini-insight', methods=['POST', 'OPTIONS'])
def gemini_insight_handler():
    """HTTP endpoint that generates AI insight or AI lessons using Gemini API.
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
            return jsonify({"error": "Invalid request: JSON body is required."}), 400

        # Validate API Key
        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        request_type = request_json.get('type')

        if request_type == 'get_insight':
            # Existing logic for generating solve insights
            scramble = request_json.get('scramble')
            cube_type = request_json.get('cubeType')
            solve_time_ms = request_json.get('solveTimeMs')
            penalty = request_json.get('penalty')
            user_level = request_json.get('userLevel')

            if not all([scramble, cube_type, solve_time_ms is not None, user_level]):
                print("ERROR: Missing required fields for get_insight.")
                return jsonify({"error": "Missing 'scramble', 'cubeType', 'solveTimeMs', or 'userLevel' for insight generation."}), 400

            # Convert solve time to seconds and format for prompt
            solve_time_seconds = solve_time_ms / 1000.0
            formatted_solve_time = f"{int(solve_time_seconds // 60):02d}:{int(solve_time_seconds % 60):02d}.{int((solve_time_seconds * 1000) % 1000):03d}"
            if penalty:
                formatted_solve_time += f" ({penalty})"

            prompt = (
                f"You are an expert Rubik's Cube coach and AI assistant. Provide a concise, actionable, and encouraging insight "
                f"for a {cube_type} cube solve. The scramble was: '{scramble}'. "
                f"The user's solve time was {formatted_solve_time}. The user's estimated skill level is '{user_level}'.\n\n"
                "Provide the response in a JSON object with the following keys:\n"
                "- 'insight': A general, encouraging comment on the solve.\n"
                "- 'scrambleAnalysis': A brief analysis of the provided scramble, highlighting any interesting features or challenges (e.g., 'easy cross', 'tricky F2L pair').\n"
                "- 'personalizedTip': A specific, actionable tip tailored to the user's skill level and solve time to help them improve.\n"
                "- 'targetedPracticeFocus': Suggest a specific area or algorithm set for the user to practice based on their level and the solve context.\n"
                "Example JSON format: {\"insight\": \"Great job!\", \"scrambleAnalysis\": \"Easy cross.\", \"personalizedTip\": \"Focus on F2L recognition.\", \"targetedPracticeFocus\": \"F2L cases\"}"
            )

            # Define the response schema for insight generation
            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "insight": {"type": "STRING"},
                    "scrambleAnalysis": {"type": "STRING"},
                    "personalizedTip": {"type": "STRING"},
                    "targetedPracticeFocus": {"type": "STRING"}
                },
                "required": ["insight", "scrambleAnalysis", "personalizedTip", "targetedPracticeFocus"]
            }

            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": response_schema
                }
            }

            model_url = f"{GEMINI_API_BASE_URL}/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
            print(f"DEBUG: Calling Gemini API for insight: {model_url}")
            gemini_response = requests.post(model_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload))
            gemini_response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)

            gemini_result = gemini_response.json()
            print(f"DEBUG: Raw Gemini insight response: {json.dumps(gemini_result, indent=2)}")

            # Extract the JSON string from the response and parse it
            if gemini_result.get('candidates') and gemini_result['candidates'][0].get('content') and \
               gemini_result['candidates'][0]['content'].get('parts') and \
               gemini_result['candidates'][0]['content']['parts'][0].get('text'):
                response_text = gemini_result['candidates'][0]['content']['parts'][0].get('text')
                # The model is configured to return JSON, so we parse it directly
                insight_data = json.loads(response_text)
                return jsonify(insight_data)
            else:
                print("ERROR: Unexpected Gemini insight response structure.")
                return jsonify({"error": "Failed to parse AI insight response. Unexpected structure."}), 500

        elif request_type == 'lesson_chat':
            # NEW: Logic for conversational lesson generation
            chat_history = request_json.get('chatHistory', [])
            cube_type = request_json.get('cubeType')
            user_level = request_json.get('userLevel')
            initial_topic = request_json.get('initialTopic')

            if not all([chat_history, cube_type, user_level, initial_topic]):
                print("ERROR: Missing required fields for lesson_chat.")
                return jsonify({"error": "Missing 'chatHistory', 'cubeType', 'userLevel', or 'initialTopic' for lesson conversation."}), 400

            # The prompt for the conversational model
            # This model needs to decide whether to continue chatting or generate the lesson
            # Prepend the instructional prompt to the chat history
            instructional_prompt = {
                "role": "user",
                "parts": [{
                    "text": (
                        f"You are Jarvis, an expert Rubik's Cube instructor and AI assistant. "
                        f"You are currently having a conversation with Sir Sevindu to understand his learning needs for a lesson on '{initial_topic}' "
                        f"for a {cube_type} cube, considering his skill level is '{user_level}'.\n"
                        f"Your goal is to gather enough information to generate a highly personalized and actionable multi-step lesson. "
                        f"Do NOT generate the lesson until you have sufficient detail from Sir Sevindu.\n"
                        f"If you have enough information, respond with a JSON object of type 'lesson_ready' containing the full lesson data. "
                        f"Otherwise, respond with a JSON object of type 'chat_response' containing a clarifying question or conversational remark.\n\n"
                        f"Lesson structure if 'lesson_ready':\n"
                        f"{{ \"type\": \"lesson_ready\", \"lessonData\": {{ \"lessonId\": \"<UUID>\", \"lessonTitle\": \"<Title>\", \"steps\": [{{ \"title\": \"<Step Title>\", \"description\": \"<Description>\", \"scramble\": \"<Optional Scramble>\", \"algorithm\": \"<Optional Algorithm>\", \"explanation\": \"<Explanation>\" }}] }} }}\n"
                        f"Chat response structure if 'chat_response':\n"
                        f"{{ \"type\": \"chat_response\", \"message\": \"<Your conversational message>\" }}\n\n"
                        f"Ensure scrambles are valid for {cube_type} (e.g., for Pyraminx, include tip moves like r, l, u, b).\n"
                        f"The lesson should have 3 to 7 steps.\n"
                        f"Consider the full chat history to avoid asking redundant questions and to build context."
                    )
                }]
            }

            # Construct the full contents for the Gemini API call
            # The chat_history from the frontend is already in the correct format (array of {role, parts} objects)
            # We prepend our instructional prompt to it.
            full_contents = [instructional_prompt] + chat_history

            payload = {
                "contents": full_contents, # Use the correctly structured full_contents
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": {
                        "type": "OBJECT",
                        "oneOf": [ # Use oneOf to allow for two distinct response structures
                            {
                                "type": "OBJECT",
                                "properties": {
                                    "type": {"type": "STRING", "enum": ["chat_response"]},
                                    "message": {"type": "STRING"}
                                },
                                "required": ["type", "message"]
                            },
                            {
                                "type": "OBJECT",
                                "properties": {
                                    "type": {"type": "STRING", "enum": ["lesson_ready"]},
                                    "lessonData": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "lessonId": {"type": "STRING"},
                                            "lessonTitle": {"type": "STRING"},
                                            "steps": {
                                                "type": "ARRAY",
                                                "items": {
                                                    "type": "OBJECT",
                                                    "properties": {
                                                        "title": {"type": "STRING"},
                                                        "description": {"type": "STRING"},
                                                        "scramble": {"type": "STRING", "nullable": True},
                                                        "algorithm": {"type": "STRING", "nullable": True},
                                                        "explanation": {"type": "STRING"}
                                                    },
                                                    "required": ["title", "description", "explanation"]
                                                },
                                                "minItems": 3, # Ensure at least 3 steps
                                                "maxItems": 7  # Ensure at most 7 steps
                                            }
                                        },
                                        "required": ["lessonId", "lessonTitle", "steps"]
                                    }
                                },
                                "required": ["type", "lessonData"]
                            }
                        ]
                    }
                }
            }

            model_url = f"{GEMINI_API_BASE_URL}/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
            print(f"DEBUG: Calling Gemini API for lesson chat: {model_url}")
            gemini_response = requests.post(model_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload))
            gemini_response.raise_for_status()

            gemini_result = gemini_response.json()
            print(f"DEBUG: Raw Gemini lesson chat response: {json.dumps(gemini_result, indent=2)}")

            if gemini_result.get('candidates') and gemini_result['candidates'][0].get('content') and \
               gemini_result['candidates'][0]['content'].get('parts') and \
               gemini_result['candidates'][0]['content']['parts'][0].get('text'):
                response_text = gemini_result['candidates'][0]['content']['parts'][0].get('text')
                parsed_response = json.loads(response_text)

                if parsed_response.get('type') == 'lesson_ready':
                    # Ensure lessonId is present, generate if missing (should be from AI now)
                    if 'lessonId' not in parsed_response['lessonData']:
                        parsed_response['lessonData']['lessonId'] = str(uuid.uuid4())
                    return jsonify(parsed_response)
                elif parsed_response.get('type') == 'chat_response':
                    return jsonify(parsed_response)
                else:
                    print("ERROR: Unexpected AI response type in lesson chat.")
                    return jsonify({"error": "AI returned an unexpected response type during lesson conversation."}), 500
            else:
                print("ERROR: Unexpected Gemini lesson chat response structure.")
                return jsonify({"error": "Failed to parse AI lesson chat response. Unexpected structure."}), 500

        elif request_type == 'get_algorithm':
            # Existing logic for getting algorithms/explanations
            query = request_json.get('query')
            if not query:
                return jsonify({"error": "Missing 'query' for algorithm/explanation."}), 400

            prompt = (
                f"Provide a concise algorithm or explanation for the Rubik's Cube concept: '{query}'. "
                f"If it's an algorithm, provide the moves. If it's a concept, explain it clearly. "
                f"Format your response as a JSON object with either an 'algorithm' key or an 'explanation' key. "
                f"Example: {{ \"algorithm\": \"R U R' U' R' F R2 U' R' U' R U R' F'\" }} "
                f"Or: {{ \"explanation\": \"F2L stands for First Two Layers...\" }}"
            )
            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "algorithm": {"type": "STRING", "nullable": True},
                    "explanation": {"type": "STRING", "nullable": True}
                },
                "minProperties": 1,
                "maxProperties": 1
            }
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": response_schema
                }
            }
            model_url = f"{GEMINI_API_BASE_URL}/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
            gemini_response = requests.post(model_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload))
            gemini_response.raise_for_status()

            gemini_result = gemini_response.json()
            if gemini_result.get('candidates') and gemini_result['candidates'][0].get('content') and \
               gemini_result['candidates'][0]['content'].get('parts') and \
               gemini_result['candidates'][0]['content']['parts'][0].get('text'):
                response_text = gemini_result['candidates'][0]['content']['parts'][0].get('text')
                algorithm_data = json.loads(response_text)
                return jsonify(algorithm_data)
            else:
                return jsonify({"error": "Failed to parse AI algorithm/explanation response."}), 500

        elif request_type == 'get_answer':
            # Existing logic for general questions
            query = request_json.get('query')
            if not query:
                return jsonify({"error": "Missing 'query' for general answer."}), 400

            prompt = (
                f"Answer the following question about Rubik's Cubes or cubing in general: '{query}'. "
                f"Provide a concise and informative answer. "
                f"Format your response as a JSON object with an 'answer' key. "
                f"Example: {{ \"answer\": \"The Rubik's Cube was invented by Ernő Rubik...\" }}"
            )
            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "answer": {"type": "STRING"}
                },
                "required": ["answer"]
            }
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": response_schema
                }
            }
            model_url = f"{GEMINI_API_BASE_URL}/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
            gemini_response = requests.post(model_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload))
            gemini_response.raise_for_status()

            gemini_result = gemini_response.json()
            if gemini_result.get('candidates') and gemini_result['candidates'][0].get('content') and \
               gemini_result['candidates'][0]['content'].get('parts') and \
               gemini_result['candidates'][0]['content']['parts'][0].get('text'):
                response_text = gemini_result['candidates'][0]['content']['parts'][0].get('text')
                answer_data = json.loads(response_text)
                return jsonify(answer_data)
            else:
                return jsonify({"error": "Failed to parse AI general answer response."}), 500

        else:
            print(f"ERROR: Unknown request type: {request_type}")
            return jsonify({"error": "Invalid request type specified."}), 400

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
