# In api/gemini-insight.py
import os
import requests
import json
import uuid
from flask import Flask, request, jsonify
from flask_cors import CORS

# It is good practice to initialize the Flask app for Vercel.
app = Flask(__name__)
# This will enable CORS for all domains. For production, you might want to restrict this.
CORS(app)

# It is recommended to retrieve the Gemini API key from environment variables for security.
# On Vercel, you can set this in the project settings.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key={GEMINI_API_KEY}"

# --- Main Handler ---
@app.route('/api/gemini-insight', methods=['POST', 'OPTIONS'])
def handler():
    """
    This is the main endpoint. It routes requests based on the 'type' field in the JSON payload.
    It also handles CORS preflight requests.
    """
    if request.method == 'OPTIONS':
        # This is a preflight request. Respond with CORS headers.
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)
        
    try:
        payload = request.get_json()
        if not payload:
            return jsonify({"error": "Invalid JSON payload"}), 400

        request_type = payload.get('type')
        print(f"DEBUG: Received request of type: {request_type}")

        if request_type == 'generate_insight':
            return generate_solve_insight(payload)
        elif request_type == 'generate_course':
            return generate_course_structure(payload)
        elif request_type == 'lesson_chat':
            return handle_lesson_chat(payload)
        else:
            return jsonify({"error": f"Unknown request type: {request_type}"}), 400

    except Exception as e:
        import traceback
        print(f"CRITICAL ERROR in handler: {e}\n{traceback.format_exc()}")
        return jsonify({"error": "An unexpected server-side error occurred."}), 500

# --- Insight Generation Logic (for timer page) ---
def generate_solve_insight(request_json):
    """
    Generates AI insight based on scramble, time, and user performance.
    This is the original, complete function for the timer page.
    """
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

    try:
        gemini_payload = {
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
        
        response = requests.post(GEMINI_API_URL, json=gemini_payload, timeout=30)
        response.raise_for_status() 
        
        response_data = response.json()
        print(f"DEBUG: Gemini API insight response: {response_data}")

        if response_data and response_data.get('candidates'):
            json_text = response_data['candidates'][0]['content']['parts'][0]['text']
            insight = json.loads(json_text)
            return jsonify(insight), 200
        else:
            print(f"ERROR: Gemini API insight response missing content: {response_data}")
            return jsonify({"error": "AI service did not return a valid insight."}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API for insight failed: {e}")
        return jsonify({"error": f"Failed to get insight from AI service: {e}"}), 500
    except Exception as e:
        print(f"CRITICAL ERROR: Unexpected error in generate_solve_insight: {e}")
        return jsonify({"error": f"An unexpected error occurred during insight generation: {e}"}), 500


# --- Course Generation Logic (for lessons page) ---
def generate_course_structure(payload):
    """
    Generates a structured cubing course using a detailed prompt and schema.
    """
    chat_history = payload.get('chatHistory', [])
    if not chat_history:
        return jsonify({"error": "Chat history is required to generate a course."}), 400

    user_request = chat_history[-1]['parts'][0]['text']

    system_prompt = f"""
    You are Jarvis, an AI cubing instructor. Your task is to design a comprehensive Rubik's Cube course for Sir Sevindu based on his request.

    **User's Request:** "{user_request}"

    **Instructions:**
    1.  Analyze the user's request to determine the `cubeType`, `level`, `title`, and `description` for the course.
    2.  Design a course with 2-4 logical modules. Each module must have 2-4 lessons.
    3.  Each lesson must have 1-5 steps. A step is the smallest unit of learning.
    4.  For each step, provide `content` in Markdown.
    5.  Optionally, a step can include an `algorithm`, a `scramble`, or a `quiz`. Do not include more than one of these per step.
    6.  Quizzes must be an array of questions, each with `options` and a correct `answer`. The answer can be a string or an array of strings for multi-select questions.
    7.  Adhere strictly to the provided JSON schema. All IDs must be unique. `course_id` is not needed.

    **Output Format:**
    Return ONLY a single, valid JSON object that conforms to the schema. Do not include any text or markdown before or after the JSON object.
    """

    course_schema = {
        "type": "OBJECT",
        "properties": {
            "title": {"type": "STRING", "description": "A concise and engaging title for the course."},
            "description": {"type": "STRING", "description": "A brief, one-sentence summary of the course."},
            "cubeType": {"type": "STRING", "description": "The type of cube, e.g., '3x3x3', '2x2x2', 'pyraminx'."},
            "level": {"type": "STRING", "enum": ["beginner", "intermediate", "advanced", "expert"]},
            "modules": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "moduleId": {"type": "STRING", "description": "A unique identifier for the module."},
                        "moduleTitle": {"type": "STRING"},
                        "lessons": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "lessonId": {"type": "STRING"},
                                    "lessonTitle": {"type": "STRING"},
                                    "steps": {
                                        "type": "ARRAY",
                                        "items": {
                                            "type": "OBJECT",
                                            "properties": {
                                                "stepId": {"type": "STRING"},
                                                "content": {"type": "STRING", "description": "The main instructional content in Markdown."},
                                                "algorithm": {"type": "STRING", "nullable": True},
                                                "scramble": {"type": "STRING", "nullable": True},
                                                "quiz": {
                                                    "type": "ARRAY",
                                                    "nullable": True,
                                                    "items": {
                                                        "type": "OBJECT",
                                                        "properties": {
                                                            "question": {"type": "STRING"},
                                                            "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                                                            "answer": {"oneOf": [{"type": "STRING"}, {"type": "ARRAY", "items": {"type": "STRING"}}]}
                                                        },
                                                        "required": ["question", "options", "answer"]
                                                    }
                                                }
                                            },
                                            "required": ["stepId", "content"]
                                        }
                                    }
                                },
                                "required": ["lessonId", "lessonTitle", "steps"]
                            }
                        }
                    },
                    "required": ["moduleId", "moduleTitle", "lessons"]
                }
            }
        },
        "required": ["title", "description", "cubeType", "level", "modules"]
    }

    gemini_payload = {
        "contents": [{"role": "user", "parts": [{"text": system_prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": course_schema
        }
    }

    try:
        response = requests.post(GEMINI_API_URL, json=gemini_payload, timeout=90)
        response.raise_for_status()
        
        response_data = response.json()
        print("DEBUG: Received successful response from Gemini for course generation.")

        if response_data and response_data.get('candidates'):
            json_text = response_data['candidates'][0]['content']['parts'][0]['text']
            course_data = json.loads(json_text)
            
            # Post-process to add unique IDs if the AI missed them
            for module in course_data.get('modules', []):
                if 'moduleId' not in module or not module['moduleId']: module['moduleId'] = str(uuid.uuid4())
                for lesson in module.get('lessons', []):
                    if 'lessonId' not in lesson or not lesson['lessonId']: lesson['lessonId'] = str(uuid.uuid4())
                    for step in lesson.get('steps', []):
                        if 'stepId' not in step or not step['stepId']: step['stepId'] = str(uuid.uuid4())

            return jsonify(course_data), 200
        else:
            print(f"ERROR: Gemini course response missing content: {response_data}")
            return jsonify({"error": "AI service returned an empty course response."}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API for course failed: {e}")
        return jsonify({"error": f"Failed to communicate with AI service for course generation: {e}"}), 502
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse Gemini course response as JSON: {e}")
        print(f"Raw response text: {response.text}")
        return jsonify({"error": "AI service returned malformed data for course."}), 500

# --- In-Lesson Chat Logic ---
def handle_lesson_chat(payload):
    """
    Handles conversational chat for in-lesson queries.
    """
    chat_history = payload.get('chatHistory', [])
    context = payload.get('currentLessonContext', {})
    user_query = chat_history[-1]['parts'][0]['text'] if chat_history else ""

    prompt = f"""
    You are Jarvis, an AI cubing assistant. Sir Sevindu has a question about a lesson.

    **Lesson Context:**
    - Title: {context.get('lessonTitle', 'N/A')}
    - Content: {context.get('content', 'N/A')[:500]}...
    - Algorithm: {context.get('algorithm', 'None')}
    - Scramble: {context.get('scramble', 'None')}

    **Sir Sevindu's Question:** "{user_query}"

    Based on the context and the question, provide a clear, concise, and helpful answer.
    Maintain your formal and respectful persona.
    
    Format your response as a JSON object with a single key "message".
    """

    chat_schema = {
        "type": "OBJECT",
        "properties": {
            "message": {"type": "STRING"}
        },
        "required": ["message"]
    }

    gemini_payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": chat_schema
        }
    }

    try:
        response = requests.post(GEMINI_API_URL, json=gemini_payload, timeout=60)
        response.raise_for_status()
        
        response_data = response.json()
        print(f"DEBUG: Gemini API chat response: {response_data}")

        if response_data and response_data.get('candidates'):
            json_text = response_data['candidates'][0]['content']['parts'][0]['text']
            parsed_response = json.loads(json_text)
            return jsonify(parsed_response), 200
        else:
            print(f"ERROR: Gemini API chat response missing content: {response_data}")
            return jsonify({"error": "AI service did not return a valid chat response."}), 500
            
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API for chat failed: {e}")
        return jsonify({"error": f"Failed to get chat response from AI service: {e}"}), 500
    except Exception as e:
        print(f"CRITICAL ERROR: Unexpected error in handle_lesson_chat: {e}")
        return jsonify({"error": f"An unexpected error occurred during lesson chat: {e}"}), 500
