# api/gemini-insight.py inside your Vercel project's 'api' directory
# This function specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight and now AI lessons using Gemini API.

import os
import requests
import json
import uuid # Import uuid for generating unique lesson IDs
import re   # Import regex module
import time # Import time for sleep function

from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

# Retrieve Gemini API key from environment variables for security.
# In Vercel, set this as an environment variable (e.g., GEMINI_API_KEY).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Constants for exponential backoff
MAX_RETRIES = 5
INITIAL_RETRY_DELAY = 1 # seconds

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

        if not request_json:
            print("ERROR: Invalid JSON body.")
            return jsonify({"error": "Invalid JSON body or empty request."}), 400

        request_type = request_json.get('type')

        if request_type == 'lesson_chat':
            return handle_lesson_chat(request_json)
        elif request_type == 'generate_course':
            return handle_generate_course(request_json)
        else:
            # Fallback to existing insight generation if no specific type is provided
            return generate_insight(request_json)

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Network error: Could not connect to the AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        # Log the specific error message from the API response body if available
        # 'response' variable might not be defined in all error paths, so check its existence
        if 'response' in locals() and response is not None and hasattr(response, 'text') and response.text:
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

def generate_insight(request_json):
    """Generates AI insight based on scramble, time, and user performance."""
    scramble = request_json.get('scramble')
    time_ms = request_json.get('time_ms')
    user_performance_history = request_json.get('userPerformanceHistory', [])
    cube_type = request_json.get('cubeType', '3x3')
    user_level = request_json.get('userLevel', 'beginner')

    if not scramble or time_ms is None:
        print("ERROR: Missing 'scramble' or 'time_ms' for insight generation.")
        return jsonify({"error": "Missing 'scramble' or 'time_ms' in request for insight generation."}), 400

    prompt = f"""
    You are an AI cubing coach named Jarvis. Provide a concise, encouraging, and actionable insight for a {user_level} level cuber solving a {cube_type} cube.
    The scramble was: {scramble}
    The solve time was: {time_ms / 1000:.2f} seconds.
    
    Based on this, provide:
    1.  **Scramble Analysis:** A very brief analysis of the provided scramble, highlighting any obvious features or challenges (e.g., "easy cross," "tricky F2L pair"). Keep this to one sentence.
    2.  **Personalized Tip:** A single, actionable tip for improvement based on the solve time and the user's level. Focus on one specific area (e.g., "focus on look-ahead," "practice F2L recognition," "improve finger tricks").
    3.  **Targeted Practice Focus:** Suggest one specific type of practice or drill.

    Format your response as a JSON object with the keys `scrambleAnalysis`, `personalizedTip`, and `targetedPracticeFocus`.
    Example:
    {{
        "scrambleAnalysis": "This scramble presented a straightforward cross solution.",
        "personalizedTip": "Consider improving your cross efficiency by planning more moves during inspection.",
        "targetedPracticeFocus": "Practice cross solutions from various angles without looking."
    }}
    """

    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "scrambleAnalysis": {"type": "STRING"},
                    "personalizedTip": {"type": "STRING"},
                    "targetedPracticeFocus": {"type": "STRING"}
                },
                "required": ["scrambleAnalysis", "personalizedTip", "targetedPracticeFocus"]
            }
        }
    }
    
    # Clean the base URL before use
    clean_base_url = re.sub(r'\[(.*?)\]\((.*?)\)', r'\1', GEMINI_API_BASE_URL)
    clean_base_url = clean_base_url.replace('[', '').replace(']', '').replace('(', '').replace(')', '')

    retries = 0
    while retries < MAX_RETRIES:
        try:
            gemini_response = requests.post(f"{clean_base_url}/gemini-2.0-flash:generateContent", headers=headers, json=payload, timeout=30)
            gemini_response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
            
            response_data = gemini_response.json()
            print(f"DEBUG: Gemini API response: {response_data}")

            if response_data and response_data.get('candidates'):
                json_text = response_data['candidates'][0]['content']['parts'][0]['text']
                insight = json.loads(json_text)
                return jsonify(insight), 200
            else:
                print(f"ERROR: Gemini API response missing candidates or content: {response_data}")
                return jsonify({"error": "AI service did not return a valid insight."}), 500

        except requests.exceptions.RequestException as e:
            retries += 1
            if retries < MAX_RETRIES:
                retry_delay = INITIAL_RETRY_DELAY * (2 ** (retries - 1))
                print(f"WARNING: Request to Gemini API failed: {e}. Retrying in {retry_delay} seconds (Attempt {retries}/{MAX_RETRIES}).")
                time.sleep(retry_delay)
            else:
                print(f"ERROR: Request to Gemini API failed after {MAX_RETRIES} retries: {e}")
                return jsonify({"error": f"Failed to get insight from AI service after multiple retries: {e}"}), 500
        except json.JSONDecodeError as e:
            print(f"ERROR: Failed to parse Gemini API response as JSON: {e}")
            print(f"Raw response text: {gemini_response.text}")
            return jsonify({"error": f"AI service returned invalid JSON: {e}"}), 500
        except Exception as e:
            print(f"CRITICAL ERROR: Unexpected error in generate_insight: {e}")
            return jsonify({"error": f"An unexpected error occurred during insight generation: {e}"}), 500

def handle_lesson_chat(request_json):
    """Handles conversational chat for lesson creation or in-lesson queries."""
    chat_history = request_json.get('chatHistory', [])
    cube_type = request_json.get('cubeType', '3x3')
    user_level = request_json.get('userLevel', 'beginner') # This is likely a default, not confirmed from chat
    current_lesson_context = request_json.get('currentLessonContext', {})

    # Extract the most recent user message to check for explicit commands
    latest_user_message = ""
    if chat_history:
        for msg in reversed(chat_history):
            if msg['role'] == 'user':
                latest_user_message = msg['parts'][0]['text'].lower()
                break

    # Define explicit generation commands
    explicit_generate_commands = ["generate course", "create course", "make the course", "generate the course now"]
    should_generate_explicitly = any(cmd in latest_user_message for cmd in explicit_generate_commands)

    # --- NEW LOGIC FOR ENFORCING CLARIFICATION ---
    # If no explicit command, force continue_chat and ask for details
    if not should_generate_explicitly:
        response_payload = {
            'action': "continue_chat",
            'message': "My apologies, Sir Sevindu. To design the most suitable course, I require a few more details. Could you please specify your current skill level for this topic (e.g., beginner, intermediate, advanced), any particular aspects you wish to focus on, and your preferred learning style (e.g., theoretical, hands-on practice, or interactive quizzes)? Once I have this information, please explicitly state 'generate the course' to proceed."
        }
        return jsonify(response_payload), 200
    # --- END NEW LOGIC ---

    # If an explicit generate command IS present, proceed to ask the AI for its response
    # Construct the prompt for the AI
    system_instruction = f"""
    You are Jarvis, an AI assistant for a Rubik's Cube learning application.
    Your primary function is to converse with Sir Sevindu about creating and understanding cubing lessons.
    Maintain a formal, respectful, and helpful tone, similar to your persona in the Iron Man movies.
    
    When discussing course creation:
    - If Sir Sevindu provides a general topic (e.g., "F2L", "OLL") or a partial request, **you MUST ask clarifying questions** to gather all necessary details.
      **Specifically, you MUST ask for:**
      1.  **Skill Level:** "What is your current skill level for this topic (e.g., beginner, intermediate, advanced)?"
      2.  **Specific Focus (if applicable):** "Are there any particular aspects within F2L you'd like to emphasize (e.g., recognizing cases, efficient insertions, look-ahead)?"
      3.  **Learning Style Preference:** "Do you prefer a more theoretical approach, hands-on practice with scrambles, or interactive quizzes?"
      **CRITICAL RULE: You MUST NOT return `action: "generate_course"` unless ALL of the following conditions are met:**
      1.  Sir Sevindu's **MOST RECENT message** contains an explicit command to generate the course (e.g., "generate the course now", "create it", "make the course").
      2.  You have successfully gathered and confirmed the **Skill Level**, **Specific Focus**, and **Learning Style Preference** during the conversation.
      3.  You have a clear understanding of the **Cube Type** (defaulting to '3x3' if not specified).
      **If ANY of these conditions are NOT met, you MUST return `action: "continue_chat"` and your `message` MUST be a clarifying question or a statement indicating what information is still needed.**

    When discussing an ongoing lesson (if currentLessonContext is provided):
    - Answer questions related to the lesson content, algorithms, scrambles, or concepts.
    - Do not try to generate a new course or change the lesson. Focus on explaining the current topic.

    Keep responses concise and directly address Sir Sevindu's query.
    """

    # Prepare chat history for Gemini API
    # Gemini API expects alternating 'user' and 'model' roles.
    # The first message should always be 'user'.
    formatted_chat_history = []
    if chat_history:
        for msg in chat_history:
            formatted_chat_history.append({"role": msg['role'], "parts": [{"text": msg['parts'][0]['text']}]})
    
    # Add current lesson context if available for in-lesson chat
    if current_lesson_context:
        context_text = f"\n\nCurrent Lesson Context:\nTitle: {current_lesson_context.get('lessonTitle')}\nType: {current_lesson_context.get('lessonType')}\nContent Snippet: {current_lesson_context.get('content', '')[:200]}..."
        # Add context to the last user message or as a new user message
        if formatted_chat_history and formatted_chat_history[-1]['role'] == 'user':
            formatted_chat_history[-1]['parts'][0]['text'] += context_text
        else:
            formatted_chat_history.append({"role": "user", "parts": [{"text": context_text}]})


    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }
    payload = {
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "contents": formatted_chat_history,
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "message": {"type": "STRING"},
                    "action": {"type": "STRING", "enum": ["generate_course", "continue_chat"]}
                },
                "required": ["message"]
            }
        }
    }

    retries = 0
    while retries < MAX_RETRIES:
        try:
            # Clean the base URL before use
            clean_base_url = re.sub(r'\[(.*?)\]\((.*?)\)', r'\1', GEMINI_API_BASE_URL)
            clean_base_url = clean_base_url.replace('[', '').replace(']', '').replace('(', '').replace(')', '')

            gemini_response = requests.post(f"{clean_base_url}/gemini-1.5-flash-latest:generateContent", headers=headers, json=payload, timeout=60) # Increased timeout
            gemini_response.raise_for_status()
            
            response_data = gemini_response.json()
            print(f"DEBUG: Gemini API chat response: {response_data}")

            if response_data and response_data.get('candidates'):
                json_text = response_data['candidates'][0]['content']['parts'][0]['text']
                parsed_response = json.loads(json_text)

                return jsonify(parsed_response), 200
            else:
                print(f"ERROR: Gemini API chat response missing candidates or content: {response_data}")
                return jsonify({"error": "AI service did not return a valid chat response."}), 500

        except requests.exceptions.RequestException as e:
            retries += 1
            if retries < MAX_RETRIES:
                retry_delay = INITIAL_RETRY_DELAY * (2 ** (retries - 1))
                print(f"WARNING: Request to Gemini API for chat failed: {e}. Retrying in {retry_delay} seconds (Attempt {retries}/{MAX_RETRIES}).")
                time.sleep(retry_delay)
            else:
                print(f"ERROR: Request to Gemini API for chat failed after {MAX_RETRIES} retries: {e}")
                return jsonify({"error": f"Failed to get chat response from AI service after multiple retries: {e}"}), 500
        except json.JSONDecodeError as e:
            print(f"ERROR: Failed to parse Gemini API chat response as JSON: {e}")
            print(f"Raw response text: {gemini_response.text}")
            return jsonify({"error": f"AI service returned invalid JSON for chat: {e}"}), 500
        except Exception as e:
            print(f"CRITICAL ERROR: Unexpected error in handle_lesson_chat: {e}")
            return jsonify({"error": f"An unexpected error occurred during lesson chat: {e}"}), 500


def handle_generate_course(request_json):
    """Generates a structured cubing course based on user preferences."""
    # Ensure messages_for_api is initialized at the very beginning
    messages_for_api = [] 

    chat_history = request_json.get('chatHistory', [])
    cube_type = request_json.get('cubeType', '3x3')
    skill_level = request_json.get('skillLevel', 'beginner')
    learning_style = request_json.get('learningStyle', 'conceptual')
    focus_area = request_json.get('focusArea', 'general')

    # Use the last user message from chat_history as the primary prompt for course generation
    user_prompt_for_course = ""
    for msg in reversed(chat_history):
        if msg['role'] == 'user':
            user_prompt_for_course = msg['parts'][0]['text']
            break
    
    if not user_prompt_for_course:
        user_prompt_for_course = f"Generate a course for a {skill_level} level cuber focusing on {focus_area} for a {cube_type} cube."


    system_instruction = f"""
    You are Jarvis, an AI assistant. Your task is to generate a comprehensive Rubik's Cube course for Sir Sevindu.
    Your response MUST be a single, complete, and valid JSON object. DO NOT include any text, markdown formatting (like ```json), or conversational elements outside of the JSON object itself.
    """

    # The detailed JSON schema is now part of the main prompt text.
    # This guides the model to produce the desired string output.
    prompt_text = f"""
    Based on the following user preferences and chat history, design a complete cubing course.
    Cube Type: {cube_type}
    Skill Level: {skill_level}
    Learning Style: {learning_style}
    Focus Area: {focus_area}
    Sir Sevindu's specific request: "{user_prompt_for_course}"

    Generate a course with 3-5 modules. Each module should have 2-4 lessons.
    Each lesson should have a 'lesson_type' (e.g., 'theory', 'algorithm_drill', 'scramble_practice', 'interactive_quiz', 'conceptual').

    For each lesson:
    - lesson_id: A unique UUID.
    - lesson_title: A concise title.
    - lesson_type: One of 'theory', 'algorithm_drill', 'scramble_practice', 'interactive_quiz', 'conceptual'.
    - content: Markdown formatted text for theory/conceptual lessons.
    - scrambles: (Optional, for scramble_practice) An ARRAY of 1-3 WCA-formatted scrambles. If only one scramble, still use an array.
    - algorithms: (Optional, for algorithm_drill) An ARRAY of 1-3 standard algorithms (e.g., "R U R' U'"). If only one, still use an array.
    - quiz_questions: (Optional, for interactive_quiz) An ARRAY of 2-3 quiz questions. Each question must have:
        - question: The question text.
        - options: An ARRAY of 3-4 possible answers. If only one, still use an array.
        - answer: The correct answer(s) (string for single choice, ARRAY of strings for multiple choice).

    Ensure the course progresses logically from foundational concepts to more advanced techniques relevant to the skill level and focus area.
    Provide a title (for the course), description (for the course), cubeType (e.g., "3x3"), and level (e.g., "beginner") at the top level of the JSON.

    The course title should be descriptive and directly incorporate the focus area and skill level. For example: "{focus_area} {skill_level.capitalize()} Course", "Advanced OLL Techniques", "3x3 Speedcubing Fundamentals". DO NOT include personal names or phrases like 'Guide to' in the course title.

    Return the course structure as a single JSON object. DO NOT OMIT ANY ARRAY FIELDS, EVEN IF EMPTY OR SINGLE ITEM.
    Example JSON structure:
    {{
        "course_id": "unique-course-uuid",
        "title": "F2L Beginner Course",
        "description": "Learn the fundamentals of solving the First Two Layers (F2L) for a 3x3 Rubik's Cube.",
        "cubeType": "3x3",
        "level": "beginner",
        "modules": [
            {{
                "module_id": "unique-module-uuid-1",
                "module_title": "Module 1: F2L Introduction",
                "lessons": [
                    {{
                        "lesson_id": "unique-lesson-uuid-1",
                        "lesson_title": "Understanding F2L Pairs",
                        "lesson_type": "theory",
                        "content": "## What is F2L?\\nF2L stands for First Two Layers. It's an intuitive method...",
                        "scrambles": [],
                        "algorithms": [],
                        "quiz_questions": []
                    }},
                    {{
                        "lesson_id": "unique-lesson-uuid-2",
                        "lesson_title": "Basic F2L Cases: Slotting Pairs",
                        "lesson_type": "algorithm_drill",
                        "content": "Practice inserting F2L pairs efficiently.",
                        "scrambles": [],
                        "algorithms": ["U R U' R'", "U' L' U L"],
                        "quiz_questions": []
                    }}
                ]
            }}
        ]
    }}
    """

    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }
    payload = {
        "systemInstruction": {"parts": [{"text": system_instruction}]}, # System instruction moved here
        "contents": [{"role": "user", "parts": [{"text": prompt_text}]}], # Only the prompt_text as a single user message
        "generationConfig": {
            "responseMimeType": "application/json", # Request application/json output
            "responseSchema": { # Define the full schema here
                "type": "OBJECT",
                "properties": {
                    "course_id": {"type": "STRING"},
                    "title": {"type": "STRING"},
                    "description": {"type": "STRING"},
                    "cubeType": {"type": "STRING"},
                    "level": {"type": "STRING"},
                    "modules": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "module_id": {"type": "STRING"},
                                "module_title": {"type": "STRING"},
                                "lessons": {
                                    "type": "ARRAY",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "lesson_id": {"type": "STRING"},
                                            "lesson_title": {"type": "STRING"},
                                            "lesson_type": {"type": "STRING"},
                                            "content": {"type": "STRING"},
                                            "scrambles": {"type": "ARRAY", "items": {"type": "STRING"}, "nullable": True},
                                            "algorithms": {"type": "ARRAY", "items": {"type": "STRING"}, "nullable": True},
                                            "quiz_questions": {
                                                "type": "ARRAY",
                                                "items": {
                                                    "type": "OBJECT",
                                                    "properties": {
                                                        "question": {"type": "STRING"},
                                                        "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                                                        "answer": {"oneOf": [{"type": "STRING"}, {"type": "ARRAY", "items": {"type": "STRING"}}]}
                                                    },
                                                    "required": ["question", "options", "answer"]
                                                },
                                                "nullable": True
                                            }
                                        },
                                        "required": ["lesson_id", "lesson_title", "lesson_type", "content"]
                                    }
                                }
                            },
                            "required": ["module_id", "module_title", "lessons"]
                        }
                    }
                },
                "required": ["course_id", "title", "description", "cubeType", "level", "modules"]
            }
        }
    }

    retries = 0
    while retries < MAX_RETRIES:
        try:
            # Clean the base URL before use
            clean_base_url = re.sub(r'\[(.*?)\]\((.*?)\)', r'\1', GEMINI_API_BASE_URL)
            clean_base_url = clean_base_url.replace('[', '').replace(']', '').replace('(', '').replace(')', '')

            gemini_response = requests.post(
                f"{clean_base_url}/gemini-1.5-flash-latest:generateContent",
                headers=headers,
                json=payload,
                timeout=120 
            )
            gemini_response.raise_for_status() 
            
            response_data = gemini_response.json()
            print(f"DEBUG: Gemini API raw response for course generation: {response_data}")

            if response_data and response_data.get('candidates'):
                ai_response_text = response_data['candidates'][0]['content']['parts'][0]['text']
                
                # Since responseMimeType is application/json, expect direct JSON
                generated_course = json.loads(ai_response_text)
                
                # Add UUIDs if not present (this part is from original code)
                if 'course_id' not in generated_course or not generated_course['course_id']:
                    generated_course['course_id'] = str(uuid.uuid4())
                for module in generated_course.get('modules', []):
                    if 'module_id' not in module or not module['module_id']:
                        module['module_id'] = str(uuid.uuid4())
                    for lesson in module.get('lessons', []):
                        if 'lesson_id' not in lesson or not lesson['lesson_id']:
                            lesson['lesson_id'] = str(uuid.uuid4())
                        # Ensure steps have UUIDs if present
                        for step in lesson.get('steps', []):
                            if 'step_id' not in step or not step['step_id']:
                                step['step_id'] = str(uuid.uuid4())
                
                return jsonify(generated_course), 200
            else:
                print(f"ERROR: Gemini API response missing candidates or content: {response_data}")
                return jsonify({"error": "AI service did not return a valid course structure."}), 500

        except requests.exceptions.RequestException as e:
            retries += 1
            if retries < MAX_RETRIES:
                retry_delay = INITIAL_RETRY_DELAY * (2 ** (retries - 1))
                print(f"WARNING: Request to Gemini API for course generation failed: {e}. Retrying in {retry_delay} seconds (Attempt {retries}/{MAX_RETRIES}).")
                time.sleep(retry_delay)
            else:
                print(f"ERROR: Request to Gemini API for course generation failed after {MAX_RETRIES} retries: {e}")
                return jsonify({"error": f"Failed to generate course from AI service after multiple retries: {e}"}), 500
        except json.JSONDecodeError as e:
            print(f"ERROR: Failed to parse Gemini API's text response as JSON: {e}")
            print(f"Raw AI text response that failed parsing: {ai_response_text}") 
            return jsonify({"error": "AI service returned malformed JSON for course. Please try again or rephrase."}), 500
        except Exception as e:
            print(f"CRITICAL ERROR: Unexpected error in handle_generate_course: {e}")
            return jsonify({"error": f"An unexpected error occurred during course generation: {e}"}), 500

if __name__ == '__main__':
    # This block is for local development and will not run on Vercel.
    # On Vercel, the 'app' object is directly used by the Vercel server.
    # It's good practice to keep this for local testing.
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
