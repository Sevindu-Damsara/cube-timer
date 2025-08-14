# api/gemini-insight.py inside your Vercel project's 'api' directory
# This function specifies Python dependencies for your Vercel Cloud Function.
# This function generates AI insight and now AI lessons using Gemini API

import os
import requests
import json
import uuid  # Import uuid for generating unique lesson IDs
import re    # Import regex module
from flask import Flask, request, jsonify
from flask_cors import CORS  # Required for handling CORS in Flask functions

# Initialize the Flask app for Vercel.
app = Flask(__name__)
CORS(app)  # Enable CORS for all origins for development

# Retrieve Gemini API key from environment variables
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY environment variable is not set")

GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1/models"

@app.route('/api/gemini-insight', methods=['POST', 'OPTIONS'])
def gemini_insight_handler():
    """HTTP endpoint that generates AI insight or AI lessons using Gemini API."""
    print("DEBUG: === gemini_insight_handler received a request. ===")

    if request.method == 'OPTIONS':
        print("DEBUG: Handling OPTIONS (preflight) request.")
        return '', 204

    try:
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
            return generate_insight(request_json)

    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"CRITICAL ERROR: An unexpected error occurred: {str(e)}\n{error_trace}")
        return jsonify({"error": f"Server error: {str(e)}"}), 500

def handle_lesson_chat(request_json):
    """Handle chat messages for the lesson builder."""
    try:
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

        # Format chat history for Gemini
        formatted_chat = []
        
        # Add system message that defines the AI's role
        system_message = {
            "role": "system",
            "parts": [{
                "text": f"""You are Jarvis, an expert AI cubing coach specializing in teaching {cube_type} cube techniques to {skill_level} level cubers.

Your expertise includes:
- Breaking down complex cubing concepts into digestible steps
- Providing clear, actionable instructions
- Adapting teaching style to the student's skill level
- Using standard cubing notation when relevant
- Creating personalized practice plans

Guidelines:
1. Be friendly and encouraging
2. Ask clarifying questions when needed
3. Use examples to illustrate concepts
4. Break down complex moves into simpler steps
5. Only generate a full course when explicitly requested"""
            }]
        }
        formatted_chat.append(system_message)
        
        # Add the chat history
        for msg in chat_history:
            if isinstance(msg, dict) and msg.get('parts'):
                role = msg.get('role', 'user')
                text = msg['parts'][0] if isinstance(msg['parts'][0], str) else msg['parts'][0].get('text', '')
                formatted_chat.append({"role": role, "parts": [{"text": text}]})

        # Check for explicit course generation commands
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

        gemini_payload = {
            "contents": formatted_chat,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2048,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        # Add debug logging for payload
        print(f"DEBUG: Sending payload to Gemini: {json.dumps(gemini_payload, indent=2)}")
        
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
    except Exception as e:
        print(f"CRITICAL ERROR in handle_lesson_chat: {e}")
        return jsonify({"error": f"Server error in chat handler: {str(e)}"}), 500

def generate_insight(request_json):
    """Generate insights for a solve."""
    try:
        scramble = request_json.get('scramble')
        time_ms = request_json.get('time_ms')
        user_performance_history = request_json.get('userPerformanceHistory', [])
        cube_type = request_json.get('cubeType', '3x3')
        user_level = request_json.get('userLevel', 'beginner')

        if not scramble or time_ms is None:
            print("ERROR: Missing required fields for insight generation.")
            return jsonify({"error": "Missing required fields"}), 400

        prompt = f"""
        As an AI cubing coach named Jarvis, provide a concise, encouraging, and actionable insight for a {user_level} level cuber solving a {cube_type} cube.
        
        Scramble: {scramble}
        Time: {time_ms / 1000:.2f} seconds
        
        Analyze:
        1. The scramble complexity
        2. The solve time relative to the cuber's level
        3. One specific area for improvement
        
        Format the response as a JSON object with these fields:
        - scrambleAnalysis (brief analysis of scramble features)
        - personalizedTip (one actionable improvement tip)
        - targetedPracticeFocus (specific drill or practice suggestion)
        """

        headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY
        }
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 1024,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        response = requests.post(
            f"{GEMINI_API_BASE_URL}/gemini-2.5-flash-lite:generateContent",
            headers=headers,
            json=payload,
            timeout=30
        )
        response.raise_for_status()

        result = response.json()
        if result.get('candidates') and result['candidates'][0].get('content'):
            insight_text = result['candidates'][0]['content']['parts'][0]['text']
            try:
                insight = json.loads(insight_text)
                return jsonify(insight), 200
            except json.JSONDecodeError:
                print(f"ERROR: Failed to parse Gemini response as JSON: {insight_text}")
                return jsonify({"error": "Invalid response format from AI service"}), 500
        else:
            print(f"ERROR: Invalid response structure from Gemini API: {result}")
            return jsonify({"error": "Invalid response from AI service"}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to get response from AI service: {e}"}), 500
    except Exception as e:
        print(f"CRITICAL ERROR in generate_insight: {e}")
        return jsonify({"error": f"Server error in insight generator: {str(e)}"}), 500


def handle_generate_course(request_json):
    """Generates a structured cubing course based on user preferences."""
    try:
        print("DEBUG: === handle_generate_course received a request. ===")

        chat_history = request_json.get('chatHistory', [])
        cube_type = request_json.get('cubeType', '3x3')
        skill_level = request_json.get('skillLevel', 'beginner')
        learning_style = request_json.get('learningStyle', 'conceptual')
        focus_area = request_json.get('focusArea', 'general')

        prompt = f"""
        Generate a structured {cube_type} cube course for a {skill_level} level student.
        Learning Style: {learning_style}
        Focus Area: {focus_area}

        Structure the course with:
        1. Progressive modules that build upon each other
        2. Clear explanations and examples
        3. Practice exercises with specific scrambles
        4. Interactive elements (quizzes, checkpoints)

        Format the response as a JSON object with these fields:
        {{
            "course_id": "unique-identifier",
            "title": "course title",
            "description": "course overview",
            "cubeType": "{cube_type}",
            "level": "{skill_level}",
            "modules": [
                {{
                    "module_id": "unique-identifier",
                    "module_title": "module title",
                    "lessons": [
                        {{
                            "lesson_id": "unique-identifier",
                            "lesson_title": "lesson title",
                            "lesson_type": "theory|practice|quiz",
                            "content": "lesson material",
                            "scrambles": ["scramble1", "scramble2"],
                            "algorithms": ["algorithm1", "algorithm2"],
                            "quiz_questions": [
                                {{
                                    "question": "question text",
                                    "options": ["option1", "option2", "option3"],
                                    "answer": "correct option"
                                }}
                            ]
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
            "contents": [{
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 4096,
                "topP": 0.8,
                "topK": 40
            }
        }

        response = requests.post(
            f"{GEMINI_API_BASE_URL}/gemini-2.5-flash-lite:generateContent",
            headers=headers,
            json=payload,
            timeout=60  # Longer timeout for course generation
        )
        response.raise_for_status()

        result = response.json()
        if result.get('candidates') and result['candidates'][0].get('content'):
            course_content = result['candidates'][0]['content']['parts'][0]['text']
            try:
                course = json.loads(course_content)
                # Add UUIDs if not present
                if 'course_id' not in course or not course['course_id']:
                    course['course_id'] = str(uuid.uuid4())
                for module in course.get('modules', []):
                    if 'module_id' not in module or not module['module_id']:
                        module['module_id'] = str(uuid.uuid4())
                    for lesson in module.get('lessons', []):
                        if 'lesson_id' not in lesson or not lesson['lesson_id']:
                            lesson['lesson_id'] = str(uuid.uuid4())
                return jsonify(course), 200
            except json.JSONDecodeError:
                print(f"ERROR: Failed to parse course content as JSON: {course_content}")
                return jsonify({"error": "Invalid course format from AI service"}), 500
        else:
            print(f"ERROR: Invalid response structure from Gemini API: {result}")
            return jsonify({"error": "Invalid response from AI service"}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to get response from AI service: {e}"}), 500
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"CRITICAL ERROR in handle_generate_course: {str(e)}\n{error_trace}")
        return jsonify({"error": f"Server error in course generator: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True)
