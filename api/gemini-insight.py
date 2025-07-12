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
            # Prompt for conversational turn - streamlined and concise
            system_instruction = f"""
            You are Jarvis, an advanced AI cubing instructor. Your goal is to gather information to create a personalized multi-step cubing lesson for Sir Sevindu (or his friend).

            **Directive:** Do NOT generate the lesson yet. ONLY ask clarifying questions or provide brief remarks. Your responses MUST be conversational and focused on eliciting details.

            **Context:** Cube type: {cube_type}, User skill level: {user_level}.

            **Strategy:** Be inquisitive. You MUST ask 3-5 distinct, relevant probing questions before signaling readiness. Build on previous turns.

            **Question Areas:** Focus on:
            1.  **Scope:** Foundational intro, specific cases, advanced techniques, or comprehensive overview?
            2.  **Current Understanding:** Familiar concepts, difficulties, current method?
            3.  **Learning Preferences:** Conceptual, visual (scrambles), or hands-on (algorithms)?
            4.  **Desired Outcome:** Speed, consistency, deeper understanding, or method transition?

            **Readiness Signal:** ONLY when you have sufficient, granular detail for an *exceptional* lesson, end your message with: `[LESSON_PLAN_PROPOSAL_READY]` followed by a confirmation question.
            Example: "I believe I have gathered all necessary information to construct a highly personalized lesson on [Specific Topic]. Shall I proceed, Sir Sevindu? [LESSON_PLAN_PROPOSAL_READY]"

            **Tone:** Formal, respectful, intelligent, helpful.
            **Output:** JSON object with a single 'message' field.
            """

            # Construct the full prompt for the current turn
            # System instruction as the first part, then unpack chat_history
            contents = [
                {"role": "system", "parts": [{"text": system_instruction.format(cube_type=cube_type, user_level=user_level)}]},
                *chat_history # Unpack existing chat history
            ]

            print(f"DEBUG: Payload for lesson_chat: {json.dumps(payload, indent=2)}") # Log the full payload

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
                response_text = gemini_response['candidates'][0]['content']['parts'][0]['text']
                print(f"DEBUG: Raw AI message text for lesson_chat: '{response_text}'")
                try:
                    ai_message_json = json.loads(response_text)
                    ai_message = ai_message_json.get('message', "My apologies, Sir Sevindu. I could not formulate a response.")
                except json.JSONDecodeError:
                    # Fallback if AI doesn't return valid JSON despite schema
                    print(f"WARNING: AI did not return valid JSON for lesson_chat. Falling back to raw text. Raw: '{response_text}'")
                    ai_message = response_text # Use raw text as message
                    # Ensure the marker is still handled if present in raw text
                    if "[LESSON_PLAN_PROPOSAL_READY]" in ai_message:
                         ai_message = ai_message.replace("[LESSON_PLAN_PROPOSAL_READY]", '').strip() + " [LESSON_PLAN_PROPOSAL_READY]"

                return jsonify({"message": ai_message})
            else:
                print(f"ERROR: Unexpected Gemini API response structure for lesson_chat: {gemini_response}")
                return jsonify({"error": "AI did not return a valid conversational response."}), 500

        elif request_type == "generate_final_lesson":
            print("DEBUG: Handling generate_final_lesson request.")
            # Prompt for final lesson generation - streamlined and concise
            system_instruction = f"""
            You are Jarvis, a world-class Rubik's Cube instructor and AI assistant. Your task is to generate an **exceptionally personalized, highly actionable, and pedagogically sound multi-step cubing lesson** based on the preceding detailed conversation, the user's specified cube type, and their skill level.

            **Conversation History (Crucial Context):**
            Refer to the preceding conversation history provided as separate turns in the 'contents' array for all nuances of the user's learning objectives, challenges, and preferences.

            **User Context:**
            * Cube Type: {cube_type}
            * Skill Level: {user_level}

            **Lesson Generation Requirements:**
            1.  **Overall Structure:** `lessonData` object with `id`, `lessonTitle`, and `steps` array (3-10 steps).
            2.  **`id`:** Unique UUID.
            3.  **`lessonTitle`:** Concise, descriptive, engaging title from conversation context.
            4.  **`steps` Array - Per-Step Detail:** Each step MUST have `title`, `description`, `explanation`.
                * `title`: Specific, clear.
                * `description`: Detailed pedagogical explanation.
                * `scramble` (Optional): Valid, precise scramble for the state/case. Null if not applicable.
                * `algorithm` (Optional): Correct, efficient algorithm in standard cubing notation. Null if not applicable.
                * `explanation`: Rich, actionable tips, common mistakes, context, underlying logic.
            5.  **Pedagogical Flow:** Logical, progressive, adapted to `user_level`. Prioritize user preferences (e.g., "more visual").
            6.  **Tone:** Formal, precise, encouraging.

            **Output Format:** JSON object with a `lessonData` field, strictly adhering to the `FINAL_LESSON_RESPONSE_SCHEMA`.
            """

            # Construct the full prompt for the current turn
            # System instruction as the first part, then unpack chat_history
            contents = [
                {"role": "system", "parts": [{"text": system_instruction.format(cube_type=cube_type, user_level=user_level)}]},
                *chat_history # Unpack existing chat history
            ]

            print(f"DEBUG: Payload for generate_final_lesson: {json.dumps(payload, indent=2)}") # Log the full payload

            payload = {
                "contents": contents,
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": FINAL_LESSON_RESPONSE_SCHEMA
                }
            }

            api_url = f"{GEMINI_API_BASE_URL}/{model_name}:generateContent?key={GEMINI_API_KEY}"
            response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload), timeout=180) # Increased timeout for lesson generation
            response.raise_for_status()
            gemini_response = response.json()

            if gemini_response and 'candidates' in gemini_response and gemini_response['candidates']:
                lesson_data_json_str = gemini_response['candidates'][0]['content']['parts'][0]['text']
                print(f"DEBUG: Raw AI lesson data text: '{lesson_data_json_str}'")
                try:
                    lesson_data = json.loads(lesson_data_json_str)

                    # Validate the generated lesson data against the schema
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
                except json.JSONDecodeError:
                    print(f"ERROR: AI did not return valid JSON for final lesson. Raw: '{lesson_data_json_str}'")
                    return jsonify({"error": "AI failed to generate a valid lesson. Please try again or refine your request."}), 500
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
