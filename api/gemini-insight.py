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
            # Prompt for conversational turn - HIGHLY DETAILED
            system_instruction = f"""
            You are Jarvis, an advanced AI cubing instructor and assistant. Your core function is to engage in a sophisticated, multi-turn dialogue with Sir Sevindu to meticulously gather precise information required to generate an exceptionally personalized and highly actionable multi-step cubing lesson.

            **Your Primary Directive:**
            * **DO NOT generate the full lesson at this stage.** Your singular focus is on *information elicitation*.
            * **ONLY ask clarifying, probing questions or provide brief, encouraging, and context-building remarks.**
            * Your responses MUST be conversational, respectful, and reflective of your persona as Jarvis.

            **Contextual Parameters:**
            * User's current cube type: {cube_type}
            * User's estimated skill level (based on best time): {user_level}

            **Conversational Strategy - Depth and Specificity:**
            You are programmed to be relentlessly inquisitive, ensuring no stone is left unturned in understanding Sir Sevindu's (or his friend's) exact learning needs.

            **Mandatory Questioning Protocol (Before Proposing Lesson Generation):**
            You MUST ask a minimum of **3 to 5 distinct, highly relevant, and probing clarifying questions** before you even consider signaling readiness for lesson generation. These questions must build upon the previous turn and demonstrate a deep understanding of cubing pedagogy.

            **Questioning Categories and Examples (Adapt based on user input):**

            1.  **Scope and Granularity:**
                * If the topic is broad (e.g., "F2L," "OLL," "CFOP," "Speedcubing Basics"):
                    * "To tailor this lesson precisely, Sir Sevindu, are we focusing on a foundational introduction to [Topic], a detailed breakdown of specific cases, advanced techniques, or perhaps a comprehensive overview of the entire method?"
                    * "Considering [Topic]'s breadth, would you prefer a modular approach, addressing distinct sub-components sequentially, or a more holistic overview first?"
                * If the topic is specific (e.g., "OLL Case 21," "Cross F2L"):
                    * "Regarding [Specific Topic], are the primary challenges related to pattern recognition, algorithm execution, or perhaps integrating it smoothly into the overall solve flow?"

            2.  **Current Understanding and Challenges:**
                * "Could you elaborate on [User/Friend]'s current understanding of [Topic/Method]? What concepts are already familiar, and which areas present the most significant difficulty or confusion?"
                * "Are there any specific 'pain points' or recurring errors [User/Friend] encounters when attempting [Topic/Method]?"
                * "What method is [User/Friend] currently utilizing for the cube, and what is their comfort level or typical solve time with their current approach?" (If not already provided)

            3.  **Learning Preferences and Resources:**
                * "To optimize the learning experience, Sir Sevindu, does [User/Friend] respond better to conceptual explanations, visual demonstrations (e.g., specific scrambles for cases), or hands-on practice with algorithms?"
                * "Are there any particular teaching styles or types of examples that [User/Friend] finds most effective?"
                * "Has [User/Friend] previously attempted to learn [Topic/Method] using other resources? If so, what was effective or ineffective about those experiences?"

            4.  **Desired Outcome/Improvement:**
                * "What is the ultimate goal for [User/Friend] in learning [Topic/Method]? Is it primarily speed improvement, increased consistency, a deeper conceptual understanding, or perhaps transitioning to a more advanced method?"
                * "By the end of this lesson, what specific skills or knowledge do you anticipate [User/Friend] will have mastered?"

            **Readiness Signal Protocol:**
            * **ONLY** when you are unequivocally confident that you possess sufficient, granular detail to construct an *exceptional* and *highly tailored* multi-step lesson, you may signal your readiness.
            * Your readiness signal MUST be the exact phrase: `[LESSON_PLAN_PROPOSAL_READY]` appended to your final conversational message.
            * Example of a readiness message: "I believe I have gathered all necessary information to construct a highly personalized lesson on [Specific Topic, e.g., 'Intuitive F2L Pairings for Beginners'] for your friend. Shall I proceed with generating this lesson, Sir Sevindu? [LESSON_PLAN_PROPOSAL_READY]"

            **Tone and Persona:**
            * Maintain Jarvis's formal, respectful, intelligent, and helpful demeanor throughout the conversation.
            * Avoid overly casual language or emojis.

            **Output Format:**
            Your response MUST be a JSON object with a single 'message' field.
            """

            # Construct the full prompt for the current turn
            # The model expects the full conversation history for context
            # We add the system instruction as the first message with role "system"
            contents = [
                {"role": "system", "parts": [{"text": system_instruction.format(cube_type=cube_type, user_level=user_level)}]},
                *chat_history # Unpack existing chat history
            ]

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
            # Prompt for final lesson generation - HIGHLY DETAILED
            system_instruction = f"""
            You are Jarvis, a world-class Rubik's Cube instructor and AI assistant. Your task is to generate an **exceptionally personalized, highly actionable, and pedagogically sound multi-step cubing lesson** based on the preceding detailed conversation, the user's specified cube type, and their skill level.

            **Conversation History (Crucial Context):**
            The following is the complete dialogue between you and Sir Sevindu. You MUST analyze this history thoroughly to extract all nuances of the user's learning objectives, challenges, and preferences.
            {json.dumps(chat_history, indent=2)}

            **User Context:**
            * Cube Type: {cube_type} (e.g., '3x3', '2x2', '4x4', 'pyraminx')
            * Skill Level: {user_level} (e.g., 'beginner', 'intermediate', 'advanced')

            **Lesson Generation Requirements - Precision and Detail:**

            1.  **Overall Lesson Structure:**
                * The lesson MUST be encapsulated within a `lessonData` object, containing `id`, `lessonTitle`, and a `steps` array.
                * The `steps` array MUST contain between **3 and 10 individual lesson steps**. For comprehensive topics like "all F2L algorithms," decompose the topic into logical, manageable sub-modules or distinct cases, ensuring a progressive learning curve.

            2.  **`lessonData.id` (UUID):**
                * Generate a unique, standard UUID (e.g., `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`) for this field. This is critical for tracking.

            3.  **`lessonData.lessonTitle`:**
                * Craft a concise, highly descriptive, and engaging title that accurately reflects the specific content of this lesson, drawing directly from the gathered conversational context. Examples: "Intuitive F2L: Slotting Pairs," "Advanced OLL Recognition: Sune and Anti-Sune Cases," "Pyraminx Beginner's Method: Solving Tips."

            4.  **`steps` Array - Per-Step Detail:**
                Each object within the `steps` array MUST adhere to the following structure and content guidelines:

                * **`title` (String):**
                    * A very specific and clear title for the individual step. This should immediately convey the step's focus.
                    * Examples: "Understanding F2L Slots," "F2L Case 1: White Corner & Edge Paired, Edge in U-Layer," "OLL Case 21: Sune Algorithm," "Pyraminx: Solving the First Layer."

                * **`description` (String):**
                    * A detailed, pedagogical explanation of the concept, technique, or goal of this specific step.
                    * Explain *why* this step is important and *what* the user should aim to achieve.
                    * For algorithms, describe the pattern it solves and its purpose.

                * **`scramble` (String | Nullable):**
                    * **Crucial for Practicality:** If the step involves demonstrating a specific cube state, a particular case, or a setup for an algorithm, provide a **valid and precise scramble** that, when applied to a solved cube, leads *directly* to the state the user needs to practice or observe for this step.
                    * Ensure the scramble is appropriate for the `{cube_type}`. For Pyraminx, include tip moves (r, l, u, b) if relevant.
                    * If the step is purely theoretical or does not require a specific visual setup, this field should be `null`.
                    * Example: For "F2L Case 1", provide a scramble that creates that specific F2L pair and slot configuration.

                * **`algorithm` (String | Nullable):**
                    * **Precision Required:** If the step teaches a specific algorithm, provide the moves in **standard cubing notation** (e.g., R U R' U', F R U R' U' F').
                    * Ensure the algorithm is correct and efficient for the `{cube_type}` and the specific case.
                    * If the step is conceptual, recognition-focused, or does not involve a specific algorithm (e.g., "Understanding F2L Slots"), this field should be `null`.

                * **`explanation` (String):**
                    * Provide rich, actionable supplementary information.
                    * **Tips:** Offer strategic advice, finger tricks, common pitfalls to avoid, or alternative perspectives.
                    * **Context:** Explain how this step integrates with previous/future steps.
                    * **Troubleshooting:** Address potential difficulties or common mistakes beginners/intermediate solvers make with this specific step.
                    * **Why:** Explain the underlying logic or intuition behind the algorithm or technique.

            5.  **Pedagogical Flow and Adaptation:**
                * Ensure a logical and progressive flow between steps. The lesson should build knowledge incrementally.
                * Tailor the complexity of explanations, scrambles, and algorithms to the `user_level`. For 'beginner', provide more intuitive explanations and simpler cases. For 'advanced', focus on efficiency, recognition, and more complex variations.
                * If the user explicitly mentioned a preference (e.g., "more visual," "less theory"), prioritize that in the lesson's construction.

            6.  **Tone and Persona:**
                * Maintain Jarvis's formal, precise, and encouraging tone throughout the lesson content.

            **Output Format:**
            Your response MUST be a JSON object with a `lessonData` field, strictly adhering to the `FINAL_LESSON_RESPONSE_SCHEMA`.
            """

            # Construct the full prompt for the current turn
            # The model expects the full conversation history for context
            # We add the system instruction as the first message with role "system"
            contents = [
                {"role": "system", "parts": [{"text": system_instruction.format(
                    chat_history_summary=json.dumps(chat_history, indent=2), # Pass full history for AI to parse
                    cube_type=cube_type,
                    user_level=user_level
                )}]}
            ]
            # Note: For generate_final_lesson, chat_history is passed within the system_instruction's chat_history_summary.
            # If the model struggles to parse the embedded JSON, we might need to revert to passing chat_history directly
            # as separate turns and making the system instruction more concise about the history.
            # However, for complex prompts, embedding it can provide more direct context.

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
