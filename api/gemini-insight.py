# api/gemini-insight.py inside your Vercel project's 'api' directory
# This function specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight, AI lessons, and AI courses using Gemini API.

import os
import requests
import json
import uuid # Import uuid for generating unique IDs

from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

# Retrieve Gemini API key from environment variables for security.
# In Vercel, set this as an environment variable (e.g., GEMINI_API_KEY).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Model name for text generation
MODEL_NAME = "gemini-2.0-flash"

# =====================================================================================================
# --- AI Response Schema Definitions (Crucial for structured output) ---
# =====================================================================================================

# Schema for conversational chat responses (simple message with action signal)
LESSON_CHAT_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "message": {"type": "STRING", "description": "The conversational message from Jarvis."},
        "action": {
            "type": "STRING",
            "enum": ["generate_course", "continue_chat"], # Changed to generate_course
            "description": "Indicates the next action for the frontend: 'generate_course' to trigger course creation, 'continue_chat' to continue conversation."
        }
    },
    "required": ["message", "action"]
}

# Schema for a single lesson object (to be nested within modules)
LESSON_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "lesson_id": {"type": "STRING", "description": "Unique UUID for the lesson."},
        "lesson_title": {"type": "STRING", "description": "Descriptive title for the lesson."},
        "lesson_type": {
            "type": "STRING",
            "enum": ["theory_and_scramble_practice", "algorithm_drill", "interactive_quiz", "conceptual_deep_dive"], # Expanded types
            "description": "Type of lesson for dynamic frontend rendering."
        },
        "content": {"type": "STRING", "description": "Rich text/Markdown for theoretical explanations and instructions."},
        "scrambles": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Optional: Array of WCA-notation scrambles for practice."
        },
        "algorithms": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Optional: Array of algorithm strings (e.g., R U R' U')."
        },
        "visual_aid_references": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Optional: References to dynamic visuals (e.g., 'F2L_CASE_1_ANIMATION'). Frontend will interpret."
        },
        "quiz_questions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "question": {"type": "STRING"},
                    "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "answer": {"type": "STRING"}
                },
                "required": ["question", "options", "answer"]
            },
            "description": "Optional: Interactive questions to test understanding."
        },
        "ai_chat_prompts": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Optional: Contextual prompts for the in-lesson AI tutor."
        }
    },
    "required": ["lesson_id", "lesson_title", "lesson_type", "content"]
}

# Schema for a module object
MODULE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "module_id": {"type": "STRING", "description": "Unique UUID for the module."},
        "module_title": {"type": "STRING", "description": "Title of the module."},
        "module_description": {"type": "STRING", "description": "Brief description of the module's content."},
        "lessons": {
            "type": "ARRAY",
            "items": LESSON_SCHEMA,
            "minItems": 1,
            "description": "Array of lessons within this module."
        }
    },
    "required": ["module_id", "module_title", "module_description", "lessons"]
}

# Comprehensive schema for the full course generation
COURSE_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "course_id": {"type": "STRING", "description": "Unique UUID for the course."},
        "course_title": {"type": "STRING", "description": "Descriptive title for the entire course."},
        "course_description": {"type": "STRING", "description": "A brief overview of the course content."},
        "prerequisites": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": "Optional: List of prerequisites for the course."
        },
        "estimated_completion_time": {"type": "STRING", "description": "Estimated time to complete the course (e.g., '20 hours')."},
        "modules": {
            "type": "ARRAY",
            "items": MODULE_SCHEMA,
            "minItems": 1,
            "description": "Array of modules, each containing lessons."
        }
    },
    "required": ["course_id", "course_title", "course_description", "modules"]
}

# Schema for performance recommendations
PERFORMANCE_RECOMMENDATION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "recommendations": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "type": {
                        "type": "STRING",
                        "enum": ["suggest_course", "revisit_lesson", "custom_challenge", "personalized_tip"]
                    },
                    "course_id": {"type": "STRING", "nullable": True},
                    "lesson_id": {"type": "STRING", "nullable": True},
                    "description": {"type": "STRING", "nullable": True},
                    "scramble_pattern": {"type": "STRING", "nullable": True},
                    "tip_text": {"type": "STRING", "nullable": True}
                },
                "required": ["type"]
            }
        }
    },
    "required": ["recommendations"]
}

# =====================================================================================================
# --- API Endpoints ---
# =====================================================================================================

@app.route('/api/lesson-chat', methods=['POST', 'OPTIONS'])
def lesson_chat_handler():
    """HTTP endpoint for in-lesson AI conversational chat."""
    print("DEBUG: lesson_chat_handler received a request.")

    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request for lesson-chat.")
        return '', 204

    try:
        request_json = request.get_json(silent=True)
        if request_json is None:
            raise ValueError("Request body is not valid JSON.")

        chat_history = request_json.get('chatHistory', [])
        cube_type = request_json.get('cubeType', '3x3')
        user_level = request_json.get('userLevel', 'beginner')
        # Optional: current_lesson_context for highly contextual chat
        current_lesson_context = request_json.get('currentLessonContext', {})

        print(f"DEBUG: Incoming chat_history for lesson-chat: {json.dumps(chat_history, indent=2)}")

        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        # System instruction for conversational turn
        system_instruction_text = (
            "<instruction>You are Jarvis, an advanced AI cubing instructor and assistant. Your core function is to engage in a sophisticated, multi-turn dialogue with Sir Sevindu. "
            "If the user is initiating a new lesson request, your Primary Directive is to meticulously gather precise information required to generate an exceptionally personalized and highly actionable multi-step cubing course. DO NOT generate the full course at this stage. Your singular focus is on information elicitation. "
            "ONLY ask clarifying, probing questions or provide brief, encouraging, and context-building remarks. Your responses MUST be conversational, respectful, and reflective of your persona as Jarvis. "
            "Mandatory Questioning Protocol for New Course Requests: You MUST ask a minimum of 3 to 5 distinct, highly relevant, and probing clarifying questions before you even consider signaling readiness for course generation. These questions must build upon the previous turn and demonstrate a deep understanding of cubing pedagogy. "
            "Questioning Categories: Focus on Scope (foundational vs. specific cases), Current Understanding (familiar concepts, difficulties, current method), Learning Preferences (conceptual, visual, hands-on), and Desired Outcome (speed, consistency, deeper understanding). "
            "Crucial Action Signal for New Course Requests: When you are unequivocally confident that you possess sufficient, granular detail for a comprehensive course, AND Sir Sevindu has provided a clear positive affirmation (e.g., 'yes', 'confirm', 'proceed') to your *explicit* question about generating the course, then you MUST set the 'action' field in your JSON response to 'generate_course'. Otherwise, set 'action' to 'continue_chat'. "
            "Example 'generate_course' response when ready and confirmed: `{\"message\": \"Excellent, Sir Sevindu. Your personalized course is now being compiled.\", \"action\": \"generate_course\"}`. "
            "Example 'continue_chat' response: `{\"message\": \"To refine your course, could you elaborate on...\", \"action\": \"continue_chat\"}`. "
            "If the user is asking a question *within an existing lesson context*, your role is to provide immediate clarification, alternative explanations, or interactive problem-solving assistance related *only* to that specific lesson's content. In this case, the 'action' should always be 'continue_chat' as the lesson is already generated. "
            "Always ensure your response is valid JSON with both 'message' and 'action' fields."
            "</instruction>\n\n"
        )

        # Prepare contents for API call
        contents_for_api = []
        # The system instruction should ideally be part of the model's configuration
        # or prepended to the first user message. For multi-turn, it's often prepended.
        # We'll prepend it to the first user message in the history or as the first message if history is empty.
        
        # Deep copy chat_history to avoid modifying the original list reference
        modified_chat_history = json.loads(json.dumps(chat_history))

        if not modified_chat_history:
            # If chat history is empty, start with the system instruction as a user message
            contents_for_api.append({"role": "user", "parts": [{"text": system_instruction_text}]})
        else:
            # Prepend system instruction to the first user message in the history
            first_user_message_found = False
            for turn in modified_chat_history:
                if turn.get("role") == "user" and turn.get("parts") and turn["parts"][0].get("text"):
                    turn["parts"][0]["text"] = system_instruction_text + turn["parts"][0]["text"]
                    first_user_message_found = True
                    break
            
            contents_for_api.extend(modified_chat_history)
            if not first_user_message_found: # Fallback if no user message found in history
                 contents_for_api.insert(0, {"role": "user", "parts": [{"text": system_instruction_text}]})


        payload = {
            "contents": contents_for_api,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": LESSON_CHAT_RESPONSE_SCHEMA
            }
        }
        print(f"DEBUG: Payload for lesson_chat: {json.dumps(payload, indent=2)}")

        api_url = f"{GEMINI_API_BASE_URL}/{MODEL_NAME}:generateContent?key={GEMINI_API_KEY}"
        response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload), timeout=60)
        
        if not response.ok:
            print(f"ERROR: Gemini API response status: {response.status_code}")
            print(f"ERROR: Gemini API response text: {response.text}")
        response.raise_for_status()
        
        gemini_response = response.json()

        if gemini_response and 'candidates' in gemini_response and gemini_response['candidates']:
            response_text = gemini_response['candidates'][0]['content']['parts'][0]['text']
            print(f"DEBUG: Raw AI message text for lesson_chat: '{response_text}'")
            try:
                ai_response_json = json.loads(response_text)
                if "message" not in ai_response_json or "action" not in ai_response_json:
                    raise ValueError("AI response missing 'message' or 'action' field.")
                
                return jsonify(ai_response_json)
            except json.JSONDecodeError:
                print(f"WARNING: AI did not return valid JSON for lesson_chat. Raw: '{response_text}'")
                message_content = response_text
                action_type = "continue_chat"
                if "generate course" in message_content.lower() and ("yes" in message_content.lower() or "confirm" in message_content.lower() or "proceed" in message_content.lower()):
                    action_type = "generate_course"
                return jsonify({"message": message_content, "action": action_type})
            except ValueError as ve:
                print(f"WARNING: AI response validation error: {ve}. Raw: '{response_text}'")
                return jsonify({"message": f"My apologies, Sir Sevindu. I received an incomplete response. Please try again. ({ve})", "action": "continue_chat"})
        else:
            print(f"ERROR: Unexpected Gemini API response structure for lesson_chat: {gemini_response}")
            return jsonify({"error": "AI did not return a valid conversational response."}), 500

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        if response is not None and response.text:
            print(f"ERROR: API detailed error response: {response.text}")
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


@app.route('/api/generate-course', methods=['POST', 'OPTIONS'])
def generate_course_handler():
    """HTTP endpoint that generates a full AI-powered cubing course."""
    print("DEBUG: generate_course_handler received a request.")

    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request for generate-course.")
        return '', 204

    try:
        request_json = request.get_json(silent=True)
        if request_json is None:
            raise ValueError("Request body is not valid JSON.")

        # The full chat history leading to the course generation request
        chat_history = request_json.get('chatHistory', [])
        cube_type = request_json.get('cubeType', '3x3')
        skill_level = request_json.get('skillLevel', 'Beginner')
        learning_style = request_json.get('learningStyle', 'Conceptual')
        focus_area = request_json.get('focusArea', 'General') # New parameter

        print(f"DEBUG: Generating course for Cube Type: {cube_type}, Skill Level: {skill_level}, Learning Style: {learning_style}, Focus Area: {focus_area}")

        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        # System instruction for comprehensive course generation
        system_instruction_text = (
            f"<instruction>You are Jarvis, a world-class Rubik's Cube instructor and AI assistant. Your task is to generate a highly personalized, actionable, and pedagogically sound multi-module cubing course based on the preceding conversation, focusing on a {cube_type} cube, for a {skill_level} level user with a {learning_style} learning style, and a focus on {focus_area}. "
            "The course must strictly adhere to the provided JSON schema. Ensure all required fields are present and data types match. "
            "Each lesson within the modules should provide accurate scrambles and algorithms in standard notation, and comprehensive explanations in Markdown format for the 'content' field. "
            "Ensure unique UUIDs for 'course_id', 'module_id', and 'lesson_id'. "
            "For 'visual_aid_references', use descriptive strings like 'F2L_CASE_1_ANIMATION' or 'OLL_ALGORITHM_VISUAL' that the frontend can interpret. Do not generate actual URLs. "
            "Ensure a minimum of 1 module and 1 lesson per module. Strive for a logical progression of topics."
            "</instruction>\n\n"
        )
        
        # Prepend system instruction to the first user message in the history
        # This ensures the instruction is always present at the start of the generation context
        contents_for_api = []
        modified_chat_history = json.loads(json.dumps(chat_history)) # Deep copy

        if not modified_chat_history:
            contents_for_api.append({"role": "user", "parts": [{"text": system_instruction_text + f"Generate a course for a {cube_type} cube, {skill_level} level, {learning_style} style, focusing on {focus_area}."}]})
        else:
            first_user_message_found = False
            for turn in modified_chat_history:
                if turn.get("role") == "user" and turn.get("parts") and turn["parts"][0].get("text"):
                    turn["parts"][0]["text"] = system_instruction_text + turn["parts"][0]["text"]
                    first_user_message_found = True
                    break
            contents_for_api.extend(modified_chat_history)
            if not first_user_message_found:
                contents_for_api.insert(0, {"role": "user", "parts": [{"text": system_instruction_text + f"Generate a course for a {cube_type} cube, {skill_level} level, {learning_style} style, focusing on {focus_area}."}]})

        # Generate UUIDs for the course, modules, and lessons
        # It's better to let the AI generate a structured response and then validate/fill missing UUIDs
        # or ensure the prompt is strong enough for AI to generate them.
        # For now, we rely on AI to generate, and validate/add if missing.

        payload = {
            "contents": contents_for_api,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": COURSE_RESPONSE_SCHEMA
            }
        }
        print(f"DEBUG: Payload for generate_course: {json.dumps(payload, indent=2)}")

        api_url = f"{GEMINI_API_BASE_URL}/{MODEL_NAME}:generateContent?key={GEMINI_API_KEY}"
        response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload), timeout=300) # Increased timeout for course generation
        
        if not response.ok:
            print(f"ERROR: Gemini API response status: {response.status_code}")
            print(f"ERROR: Gemini API response text: {response.text}")
        response.raise_for_status()
        
        gemini_response = response.json()

        if gemini_response and 'candidates' in gemini_response and gemini_response['candidates']:
            course_data_json_str = gemini_response['candidates'][0]['content']['parts'][0]['text']
            print(f"DEBUG: Raw AI course data text: '{course_data_json_str}'")
            try:
                course_data = json.loads(course_data_json_str)

                # Basic validation and UUID generation if missing
                if not course_data.get('course_id'):
                    course_data['course_id'] = str(uuid.uuid4())
                
                if 'modules' in course_data:
                    for module in course_data['modules']:
                        if not module.get('module_id'):
                            module['module_id'] = str(uuid.uuid4())
                        if 'lessons' in module:
                            for lesson in module['lessons']:
                                if not lesson.get('lesson_id'):
                                    lesson['lesson_id'] = str(uuid.uuid4())
                
                return jsonify(course_data)
            except json.JSONDecodeError:
                print(f"ERROR: AI did not return valid JSON for course generation. Raw: '{course_data_json_str}'")
                return jsonify({"error": "AI failed to generate a valid course. Please try again or refine your request."}), 500
            except Exception as e:
                print(f"ERROR: Error processing generated course data: {e}")
                return jsonify({"error": f"Failed to process generated course data: {str(e)}"}), 500
        else:
            print(f"ERROR: Unexpected Gemini API response structure for course generation: {gemini_response}")
            return jsonify({"error": "AI did not return a valid structured course."}), 500

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        if response is not None and response.text:
            print(f"ERROR: API detailed error response: {response.text}")
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


@app.route('/api/evaluate-performance', methods=['POST', 'OPTIONS'])
def evaluate_performance_handler():
    """HTTP endpoint that evaluates user performance and provides recommendations."""
    print("DEBUG: evaluate_performance_handler received a request.")

    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request for evaluate-performance.")
        return '', 204

    try:
        request_json = request.get_json(silent=True)
        if request_json is None:
            raise ValueError("Request body is not valid JSON.")

        user_id = request_json.get('userId')
        solve_history = request_json.get('solveHistory', []) # Array of solve objects
        lesson_completion_data = request_json.get('lessonCompletionData', {}) # Object with lesson progress

        if not user_id:
            return jsonify({"error": "User ID is required for performance evaluation."}), 400

        print(f"DEBUG: Evaluating performance for user: {user_id}")

        if not GEMINI_API_KEY:
            print("ERROR: GEMINI_API_KEY environment variable not set.")
            return jsonify({"error": "Server configuration error: Gemini API key is missing."}), 500

        system_instruction_text = (
            "<instruction>You are Jarvis, an advanced AI cubing performance analyst. Your task is to meticulously analyze the provided user's solve history and lesson completion data. "
            "Identify patterns, strengths, weaknesses, and areas for improvement. Based on this analysis, generate highly specific and actionable recommendations for the user's next steps in their cubing journey. "
            "The recommendations must strictly adhere to the provided JSON schema. Ensure all required fields are present and data types match. "
            "Provide a diverse set of recommendations, including suggesting new courses, revisiting specific lessons, proposing custom practice challenges, and offering personalized tips."
            "</instruction>\n\n"
        )

        user_prompt = (
            f"Analyze the following user data and provide recommendations:\n\n"
            f"User ID: {user_id}\n"
            f"Solve History: {json.dumps(solve_history, indent=2)}\n"
            f"Lesson Completion Data: {json.dumps(lesson_completion_data, indent=2)}\n\n"
            "What are the most effective next steps for this user to improve their cubing skills?"
        )

        payload = {
            "contents": [
                {"role": "user", "parts": [{"text": system_instruction_text + user_prompt}]}
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": PERFORMANCE_RECOMMENDATION_SCHEMA
            }
        }
        print(f"DEBUG: Payload for evaluate_performance: {json.dumps(payload, indent=2)}")

        api_url = f"{GEMINI_API_BASE_URL}/{MODEL_NAME}:generateContent?key={GEMINI_API_KEY}"
        response = requests.post(api_url, headers={'Content-Type': 'application/json'}, data=json.dumps(payload), timeout=90)
        
        if not response.ok:
            print(f"ERROR: Gemini API response status: {response.status_code}")
            print(f"ERROR: Gemini API response text: {response.text}")
        response.raise_for_status()
        
        gemini_response = response.json()

        if gemini_response and 'candidates' in gemini_response and gemini_response['candidates']:
            recommendations_json_str = gemini_response['candidates'][0]['content']['parts'][0]['text']
            print(f"DEBUG: Raw AI recommendations text: '{recommendations_json_str}'")
            try:
                recommendations_data = json.loads(recommendations_json_str)
                return jsonify(recommendations_data)
            except json.JSONDecodeError:
                print(f"ERROR: AI did not return valid JSON for performance evaluation. Raw: '{recommendations_json_str}'")
                return jsonify({"error": "AI failed to generate valid recommendations. Please try again."}), 500
        else:
            print(f"ERROR: Unexpected Gemini API response structure for performance evaluation: {gemini_response}")
            return jsonify({"error": "AI did not return valid structured recommendations."}), 500

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        if response is not None and response.text:
            print(f"ERROR: API detailed error response: {response.text}")
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

@app.route('/api/update-lesson-content', methods=['POST', 'OPTIONS'])
def update_lesson_content_handler():
    """HTTP endpoint to update specific lesson content in Firestore."""
    print("DEBUG: update_lesson_content_handler received a request.")

    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request for update-lesson-content.")
        return '', 204

    try:
        request_json = request.get_json(silent=True)
        if request_json is None:
            raise ValueError("Request body is not valid JSON.")

        user_id = request_json.get('userId')
        course_id = request_json.get('courseId')
        module_id = request_json.get('moduleId')
        lesson_id = request_json.get('lessonId')
        updated_content = request_json.get('updatedContent') # Expecting Markdown string

        if not all([user_id, course_id, module_id, lesson_id, updated_content is not None]):
            return jsonify({"error": "Missing required fields for updating lesson content."}), 400

        # In a real scenario, this would interact with Firestore to update the document.
        # For this backend, we'll simulate success. The actual Firestore update logic
        # will be handled on the frontend (lessons.js) as it has direct Firestore access.
        # This endpoint primarily serves as a placeholder if future AI processing or
        # complex validation were needed before saving to DB.
        
        print(f"DEBUG: Simulated update for lesson {lesson_id} in module {module_id} of course {course_id} for user {user_id}. Content length: {len(updated_content)}.")
        
        # Return a success response. The actual Firestore update will occur on the client.
        return jsonify({"message": "Lesson content update request received and processed.", "status": "success"}), 200

    except Exception as e:
        import traceback
        print(f"CRITICAL ERROR: An unexpected server-side error occurred during update-lesson-content: {e}\n{traceback.format_exc()}")
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {str(e)}."}), 500

# The original gemini_insight_handler is now removed as its functionalities
# have been refactored into dedicated endpoints.
