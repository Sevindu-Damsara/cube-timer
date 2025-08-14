# api/gemini-insight.py inside your Vercel project's 'api' directory
# This function specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight and now AI lessons using Gemini API.

import os
import requests
import json
import uuid # Import uuid for generating unique lesson IDs
import re   # Import regex module
# import time # Removed: time is no longer needed for sleep function

from flask import Flask, request, jsonify
from flask_cors import CORS # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app) # Enable CORS for all origins for development. Restrict for production if necessary.

# Retrieve Gemini API key from environment variables for security.
# In Vercel, set this as an environment variable (e.g., GEMINI_API_KEY).
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Constants for exponential backoff (no longer used for retries, but kept for reference if needed)
# MAX_RETRIES = 5
# INITIAL_RETRY_DELAY = 1 # seconds

@app.route('/api/gemini-insight', methods=['POST', 'OPTIONS'])
def gemini_insight_handler():
    """HTTP endpoint that generates AI insight or AI lessons using Gemini API.
    Handles both preflight (OPTIONS) and actual (POST) requests.
    """
    print("DEBUG: === gemini_insight_handler received a request. ===") # Prominent log at entry

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
    except requests.exceptions.RequestException as e:
        print(f"ERROR: General request error during Gemini API call: {e}")
        # 'response' variable might not be defined in all error paths, so check its existence
        if 'response' in locals() and response is not None and hasattr(response, 'text') and response.text:
            print(f"ERROR: API detailed error response: {response.text}")
        else:
            print("ERROR: No detailed response text available from Gemini API.")
        return jsonify({"error": f"An unknown error occurred during the AI service request: {e}"}), 500
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
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to get insight from AI service: {e}"}), 500
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse Gemini API response as JSON: {e}")
        if 'gemini_response' in locals() and gemini_response is not None:
            print(f"Raw response text: {gemini_response.text}")
        else:
            print("No gemini_response object available to show raw response text.")
        return jsonify({"error": f"AI service returned invalid JSON: {e}"}), 500
    except Exception as e:
        print(f"CRITICAL ERROR: Unexpected error in generate_insight: {e}")
        return jsonify({"error": f"An unexpected error occurred during insight generation: {e}"}), 500

def handle_lesson_chat(request_json):
    """Handles conversational chat for lesson creation or in-lesson queries."""

    chat_history = request_json.get('chatHistory', [])
    cube_type = request_json.get('cubeType', '3x3')
    skill_level = request_json.get('skillLevel', 'beginner')

    # Extract the most recent user message to check for explicit commands
    latest_user_message = ""
    if chat_history and isinstance(chat_history, list) and len(chat_history) > 0:
        for msg in reversed(chat_history):
            if isinstance(msg, dict) and msg.get('role') == 'user' and \
               isinstance(msg.get('parts'), list) and len(msg['parts']) > 0:
                if isinstance(msg['parts'][0], dict):
                    latest_user_message = msg['parts'][0].get('text', '').lower()
                elif isinstance(msg['parts'][0], str):
                    latest_user_message = msg['parts'][0].lower()
                break

    # Format chat history for Gemini API
    formatted_chat = []
    for msg in chat_history:
        if isinstance(msg, dict) and msg.get('parts'):
            role = msg.get('role', 'user')
            text = msg['parts'][0] if isinstance(msg['parts'][0], str) else msg['parts'][0].get('text', '')
            formatted_chat.append({"role": role, "parts": [{"text": text}]})

    # Prepare the system instruction
    system_instruction = {
        "role": "system",
        "parts": [{
            "text": f"You are Jarvis, an AI cubing coach. You're helping create a {cube_type} cube course for a {skill_level} level cuber. Be friendly and conversational. Ask clarifying questions if needed. Only generate a course when explicitly asked."
        }]
    }

    # Add system instruction at the start
    formatted_chat.insert(0, system_instruction)

    explicit_generate_commands = ["generate course", "create course", "make the course", "generate the course now"]
    should_generate_explicitly = any(cmd in latest_user_message for cmd in explicit_generate_commands)

    if should_generate_explicitly:
        response_payload = {
            'action': "generate_course",
            'message': "Understood, Sir Sevindu. I am now generating your personalized cubing course. This may take a moment."
        }
        print(f"DEBUG: handle_lesson_chat - Returning generate_course action: {response_payload}")
        return jsonify(response_payload), 200

    # Make the API call to Gemini
    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }

    try:
        gemini_payload = {
            "contents": formatted_chat,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 512,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        gemini_response = requests.post(
            f"{GEMINI_API_BASE_URL}/gemini-2.5-flash-lite:generateContent",
            headers=headers,
            json=gemini_payload,
            timeout=30
        )
        gemini_response.raise_for_status()
        
        response_data = gemini_response.json()
        if response_data.get('candidates') and response_data['candidates'][0].get('content'):
            ai_message = response_data['candidates'][0]['content']['parts'][0]['text']
            return jsonify({
                'message': ai_message
            }), 200
        else:
            print(f"ERROR: Invalid response format from Gemini API: {response_data}")
            return jsonify({"error": "Failed to get a valid response from the AI service"}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Failed to get response from Gemini API: {e}")
        return jsonify({"error": f"Failed to get response from AI service: {e}"}), 500
        if msg.get('role') == 'system':
            system_instruction = msg.get('parts', [{}])[0].get('text', '')
        else:
            user_messages.append(msg)

    # Build the messages list for Gemini API
    messages_for_gemini = []
    if system_instruction:
        messages_for_gemini.append({"role": "system", "content": system_instruction})
    # Add user history as a system message for context if available
    if user_history:
        user_history_str = json.dumps(user_history)
        messages_for_gemini.append({
            "role": "system",
            "content": f"The following is the user's cubing history and progress: {user_history_str}"
        })
    for msg in user_messages:
        role = msg.get('role', 'user')
        text = msg.get('parts', [{}])[0].get('text', '')
        messages_for_gemini.append({"role": role, "content": text})

    headers = {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
    }
    payload = {
        "messages": messages_for_gemini,
        "temperature": 0.7,
        "maxOutputTokens": 512,
        "topP": 0.8,
        "topK": 40,
        "candidateCount": 1
    }

    try:
        # Convert messages to the correct format for gemini-2.5-flash-lite
        formatted_contents = []
        for msg in messages_for_gemini:
            formatted_contents.append({
                "role": msg["role"],
                "parts": [{"text": msg["content"]}]
            })
        
        gemini_payload = {
            "contents": formatted_contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 512,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        gemini_response = requests.post(
            f"{GEMINI_API_BASE_URL}/gemini-2.5-flash-lite:generateContent",
            headers=headers,
            json=gemini_payload,
            timeout=30
        )
        gemini_response.raise_for_status()
        response_data = gemini_response.json()
        print(f"DEBUG: Gemini API response for lesson chat: {response_data}")

        if response_data.get('candidates') and response_data['candidates'][0].get('content'):
            ai_message = response_data['candidates'][0]['content']['parts'][0]['text']
            response_payload = {
                'action': "continue_chat",
                'message': ai_message
            }
            return jsonify(response_payload), 200
        else:
            print("ERROR: Gemini API response missing candidates or content.")
            return jsonify({"error": "AI service did not return a valid response."}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to get response from AI service: {e}"}), 500


def handle_generate_course(request_json):
    """Generates a structured cubing course based on user preferences."""
    print("DEBUG: === handle_generate_course received a request. ===")

    chat_history = request_json.get('chatHistory', [])
    # Parameters should ideally be passed explicitly from frontend after handle_lesson_chat confirms them
    # For robustness, try to extract them again if not explicitly provided in request_json
    cube_type = request_json.get('cubeType', '3x3')
    skill_level = request_json.get('skillLevel')
    learning_style = request_json.get('learningStyle')
    focus_area = request_json.get('focusArea')

    # Re-extract from chat history as a fallback/confirmation for handle_generate_course
    # This ensures handle_generate_course has the latest confirmed parameters
    extracted_skill_level = None
    extracted_focus_area = None
    extracted_learning_style = None

    for msg in chat_history:
        if msg.get('role') == 'user':
            text = msg.get('parts', [{}])[0].get('text', '').lower()
            if re.search(r'\b(beginner|begginer|biginner)\b', text):
                extracted_skill_level = "beginner"
            elif re.search(r'\b(intermediate|intermidiate)\b', text):
                extracted_skill_level = "intermediate"
            elif re.search(r'\b(advanced|advance)\b', text):
                extracted_skill_level = "advanced"
            
            if re.search(r'\bf2l\b', text):
                extracted_focus_area = "F2L"
            elif re.search(r'\boll\b', text):
                extracted_focus_area = "OLL"
            elif re.search(r'\bpll\b', text):
                extracted_focus_area = "PLL"
            elif re.search(r'\bcross\b', text):
                extracted_focus_area = "Cross"
            
            if re.search(r'\b(theoretical|concept(ual)?)\b', text):
                extracted_learning_style = "theoretical"
            elif re.search(r'\b(hands[- ]?on|practical|practice|practce)\b', text):
                extracted_learning_style = "hands-on practice"
            elif re.search(r'\b(interactive )?quiz(zes)?\b', text):
                extracted_learning_style = "interactive quiz"

    # Use extracted parameters if available, otherwise fall back to defaults or request_json
    skill_level = skill_level or extracted_skill_level or 'beginner'
    learning_style = learning_style or extracted_learning_style or 'conceptual'
    focus_area = focus_area or extracted_focus_area or 'general'

    print(f"DEBUG: handle_generate_course - Final parameters for generation: skill_level={skill_level}, focus_area={focus_area}, learning_style={learning_style}, cube_type={cube_type}")

    user_prompt_for_course = f"Generate a course for a {skill_level} level cuber focusing on {focus_area} for a {cube_type} cube with a {learning_style} learning style."


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

    try:
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
        print(f"ERROR: Request to Gemini API for course generation failed: {e}")
        return jsonify({"error": f"Failed to generate course from AI service: {e}"}), 500
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse Gemini API's text response as JSON: {e}")
        if 'ai_response_text' in locals():
            print(f"Raw AI text response that failed parsing: {ai_response_text}") 
        else:
            print("No ai_response_text variable available to show raw response text.")
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
