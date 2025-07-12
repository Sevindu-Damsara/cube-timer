# api/gemini-insight.py inside your Vercel project's 'api' directory
# This function specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight and now AI lessons using Gemini API.

import os
import requests
import json
import uuid # Import uuid for generating unique lesson IDs

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
        if request_json is None:
            raise ValueError("Request body is not valid JSON.")

        request_type = request_json.get('type')
        chat_history = request_json.get('chatHistory', [])
        cube_type = request_json.get('cubeType', '3x3')
        user_level = request_json.get('userLevel', 'beginner')

        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        model_name = "gemini-2.0-flash" # Using gemini-2.0-flash for text generation

        # --- Prompt Engineering and Response Schema Definitions ---

        # Schema for conversational chat responses (simple message)
        LESSON_CHAT_RESPONSE_SCHEMA = {
            "type": "OBJECT",
            "properties": {
                "message": {"type": "STRING"}
            },
            "required": ["message"]
        }

        # Schema for the final structured lesson
        FINAL_LESSON_RESPONSE_SCHEMA = {
            "type": "OBJECT",
            "properties": {
                "lessonData": {
                    "type": "OBJECT",
                    "properties": {
                        "id": {"type": "STRING", "description": "Unique UUID for the lesson."},
                        "lessonTitle": {"type": "STRING", "description": "Descriptive title for the lesson."},
                        "steps": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "title": {"type": "STRING", "description": "Concise title for this step."},
                                    "description": {"type": "STRING", "description": "Detailed explanation of the step's concept."},
                                    "scramble": {"type": "STRING", "nullable": True, "description": "Optional: A scramble leading to the state for this step."},
                                    "algorithm": {"type": "STRING", "nullable": True, "description": "Optional: The algorithm for this step in standard notation."},
                                    "explanation": {"type": "STRING", "description": "Further tips, common mistakes, or strategic advice for this step."}
                                },
                                "required": ["title", "description", "explanation"]
                            },
                            "minItems": 3, # Ensure at least 3 steps for a meaningful lesson
                            "maxItems": 10 # Limit to 10 steps for manageability
                        }
                    },
                    "required": ["id", "lessonTitle", "steps"]
                }
            },
            "required": ["lessonData"]
        }

        if request_type == "lesson_chat":
            print("DEBUG: Handling lesson_chat request.")
            # Prompt for conversational turn
            system_instruction = """
            You are Jarvis, an expert Rubik's Cube instructor and AI assistant. Your primary goal is to engage in a multi-turn conversation with the user to gather enough information to generate a highly personalized and actionable multi-step cubing lesson.

            **Crucial Instruction:** DO NOT generate the full lesson yet. ONLY ask clarifying questions, provide brief encouraging remarks, or confirm understanding. Your responses MUST be conversational and focused on eliciting details about the user's learning goals, current understanding, specific challenges, and preferred learning style.

            **Context:**
            - User's current cube type: {cube_type}
            - User's estimated skill level (based on best time): {user_level}

            **Guidelines for Conversation:**
            1.  **Initial Query:** If the user's first message is broad (e.g., "teach me F2L"), ask follow-up questions to narrow down the scope (e.g., "Are you looking for a beginner's introduction, advanced cases, or specific techniques?").
            2.  **Specificity:** Encourage the user to be specific. If they mention a concept, ask what aspects they find difficult.
            3.  **Prior Knowledge:** Ask about their existing knowledge or what they have already tried.
            4.  **Learning Style:** Inquire if they prefer more theory, practical examples, or a mix.
            5.  **Readiness Signal:** When you believe you have sufficient information to generate a comprehensive lesson, end your conversational message with the exact phrase: `[LESSON_PLAN_PROPOSAL_READY]` followed by a question asking for confirmation to generate the lesson. Example: "I believe I have sufficient information to generate your personalized lesson. Shall I proceed, Sir Sevindu? [LESSON_PLAN_PROPOSAL_READY]"
            6.  **Tone:** Maintain a formal, respectful, and helpful tone, characteristic of Jarvis.
            7.  **Output Format:** Your response must be a JSON object with a 'message' field.
            """

            # Construct the full prompt for the current turn
            # The last message in chat_history is the user's current input
            current_user_message = chat_history[-1]['parts'][0]['text'] if chat_history and chat_history[-1]['role'] == 'user' else ""

            # The model expects the full conversation history for context
            # We add the system instruction as the first message
            contents = [{"role": "user", "parts": [{"text": system_instruction.format(cube_type=cube_type, user_level=user_level)}]},
                        *chat_history] # Unpack existing chat history

            payload = {
                "contents": contents,
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": LESSON_CHAT_RESPONSE_SCHEMA
                }
            }

            api_url = f"{GEMINI_API_BASE_URL}/{model_name}:generateContent?key={GEMINI_API_KEY}"
            response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload), timeout=60)
            response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
            gemini_response = response.json()

            if gemini_response and 'candidates' in gemini_response and gemini_response['candidates']:
                # The response is structured as per LESSON_CHAT_RESPONSE_SCHEMA
                ai_message_json = json.loads(gemini_response['candidates'][0]['content']['parts'][0]['text'])
                ai_message = ai_message_json.get('message', "My apologies, Sir Sevindu. I could not formulate a response.")
                return jsonify({"message": ai_message})
            else:
                print(f"ERROR: Unexpected Gemini API response structure for lesson_chat: {gemini_response}")
                return jsonify({"error": "AI did not return a valid conversational response."}), 500

        elif request_type == "generate_final_lesson":
            print("DEBUG: Handling generate_final_lesson request.")
            # Prompt for final lesson generation
            system_instruction = """
            You are Jarvis, an expert Rubik's Cube instructor and AI assistant. Based on the following conversation history, the user's cube type, and their skill level, generate a highly personalized, actionable, and multi-step cubing lesson.

            **Conversation History (for context):**
            {chat_history_summary}

            **User Context:**
            - Cube Type: {cube_type}
            - Skill Level: {user_level}

            **Lesson Generation Guidelines:**
            1.  **Structure:** The lesson MUST be structured as a JSON object with a `lessonData` field, which contains `id`, `lessonTitle`, and an array of `steps`.
            2.  **`id`:** Generate a unique UUID for the `lessonData.id` field.
            3.  **`lessonTitle`:** Create a concise and descriptive title for the entire lesson based on the conversation.
            4.  **`steps` Array:**
                * The lesson MUST contain between 3 and 10 steps.
                * Each step MUST be an object with `title`, `description`, and `explanation` fields.
                * `title`: A brief, clear title for the individual step (e.g., "F2L: Slot 1 Introduction", "OLL Case 21 Recognition").
                * `description`: A detailed explanation of the concept or technique for this step.
                * `scramble` (Optional): If the step involves demonstrating a specific state or setup, provide a valid scramble for the `{cube_type}` that leads to that state. If not applicable, omit this field or set to `null`.
                * `algorithm` (Optional): If the step teaches a specific algorithm, provide the moves in standard notation. If not applicable, omit this field or set to `null`.
                * `explanation`: Provide additional tips, common mistakes to avoid, finger tricks, or deeper insights related to this step.
            5.  **Content for Broad Topics:** If the conversation indicates a broad topic (e.g., "all F2L algs"), break it down into logical sub-modules or cases, ensuring a progressive learning path. For example, for "F2L", cover basic insertion, then specific cases, then advanced techniques.
            6.  **Scramble Validity:** Ensure any `scramble` provided is a valid sequence of moves for the specified `{cube_type}`. For Pyraminx, include tip moves (r, l, u, b) if relevant.
            7.  **Algorithm Clarity:** Algorithms should be precise and use standard cubing notation.
            8.  **Pedagogical Soundness:** Ensure the lesson flows logically and is appropriate for the user's stated skill level.
            9.  **Tone:** Maintain a formal, respectful, and instructional tone.
            """

            # Convert chat_history to a more readable summary for the AI, or pass as-is
            # For this complex prompt, passing the full chat_history as 'contents' is better
            # The system instruction will set the context for the model
            contents = [{"role": "user", "parts": [{"text": system_instruction.format(
                chat_history_summary=json.dumps(chat_history), # Pass full history for AI to parse
                cube_type=cube_type,
                user_level=user_level
            )}]}
            ] # Only the system instruction is needed here, as the chat_history_summary provides context

            payload = {
                "contents": contents,
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": FINAL_LESSON_RESPONSE_SCHEMA
                }
            }

            api_url = f"{GEMINI_API_BASE_URL}/{model_name}:generateContent?key={GEMINI_API_KEY}"
            response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload), timeout=120) # Increased timeout for lesson generation
            response.raise_for_status()
            gemini_response = response.json()

            if gemini_response and 'candidates' in gemini_response and gemini_response['candidates']:
                # The response is structured as per FINAL_LESSON_RESPONSE_SCHEMA
                lesson_data_json_str = gemini_response['candidates'][0]['content']['parts'][0]['text']
                lesson_data = json.loads(lesson_data_json_str)

                # Validate the generated lesson data against the schema
                # (Simplified validation for brevity, full validation would be more extensive)
                if not all(k in lesson_data.get('lessonData', {}) for k in ['id', 'lessonTitle', 'steps']):
                    raise ValueError("Generated lesson data is missing required fields.")
                if not isinstance(lesson_data['lessonData']['steps'], list) or not (3 <= len(lesson_data['lessonData']['steps']) <= 10):
                    raise ValueError("Generated lesson steps array is invalid or out of bounds (3-10 steps required).")

                # Ensure lessonId is a UUID
                if not lesson_data['lessonData']['id']:
                    lesson_data['lessonData']['id'] = str(uuid.uuid4()) # Generate if AI somehow missed it
                else:
                    try:
                        uuid.UUID(lesson_data['lessonData']['id']) # Validate if it's a valid UUID
                    except ValueError:
                        lesson_data['lessonData']['id'] = str(uuid.uuid4()) # Regenerate if invalid

                return jsonify(lesson_data) # Return the full structured lesson
            else:
                print(f"ERROR: Unexpected Gemini API response structure for final lesson: {gemini_response}")
                return jsonify({"error": "AI did not return a valid structured lesson."}), 500

        else:
            return jsonify({"error": "Invalid request type provided."}), 400

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
    except ValueError as val_err:
        print(f"ERROR: Data validation error: {val_err}")
        return jsonify({"error": f"Invalid data received or generated: {val_err}"}), 400
    except Exception as e:
        import traceback
        print(f"CRITICAL ERROR: An unexpected server-side error occurred: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

# To run this with Vercel, ensure you have a 'requirements.txt' in the same 'api' directory:
# Flask
# requests
# flask-cors
