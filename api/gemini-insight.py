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
# For local testing, you might set it directly or use a .env file.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "") # Keep empty for Canvas runtime

# Base URL for Gemini API
GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

def call_gemini_api(prompt_text, model="gemini-2.0-flash", response_schema=None):
    """
    Makes a call to the Gemini API with the given prompt and optional schema.
    """
    # API key is handled by Canvas runtime for gemini-2.0-flash, no need to check here.

    headers = {
        "Content-Type": "application/json"
    }
    url = f"{GEMINI_API_BASE_URL}/{model}:generateContent?key={GEMINI_API_KEY}"
    
    payload = {
        "contents": [{"parts": [{"text": prompt_text}]}]
    }

    if response_schema:
        payload["generationConfig"] = {
            "responseMimeType": "application/json",
            "responseSchema": response_schema
        }

    print(f"DEBUG: Calling Gemini API for model: {model} with URL: {url}")
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=180) # Increased timeout
        response.raise_for_status() # Raise an exception for HTTP errors
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"ERROR: Gemini API detailed error response: {e.response.text}")
        raise

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
            raw_body = request.get_data(as_text=True)
            print(f"ERROR: No JSON received or invalid JSON. Raw body: '{raw_body}'")
            return jsonify({"error": "Invalid JSON format in request body or empty body."}), 400

        action_type = request_json.get('actionType')
        print(f"DEBUG: Received actionType: {action_type}")

        if action_type == 'generateLesson':
            scramble = request_json.get('scramble')
            solve_time = request_json.get('solveTime') # Not directly used in prompt, but good context
            user_skill_level = request_json.get('userSkillLevel', 'intermediate')
            lesson_topic = request_json.get('lessonTopic', 'CFOP F2L basics')
            cube_type = request_json.get('cubeType', '3x3')

            if not scramble:
                return jsonify({"error": "Scramble is required for lesson generation."}), 400

            prompt = f"""
            As an expert Rubik's Cube instructor for a {cube_type} cube, generate a detailed lesson based on the user's recent solve or a specific topic.
            The user's skill level is '{user_skill_level}'.
            The lesson should be comprehensive, cover a specific topic related to cubing (e.g., F2L, OLL, PLL, specific algorithms, technique improvement), and be structured into multiple steps.
            The lesson should be highly visual, providing clear instructions and specific examples.
            The lesson content should be in Markdown format.
            Include placeholders for 3D cube visualizations where relevant (e.g., `[VISUALIZE_SCRAMBLE: <scramble_string>]`, `[VISUALIZE_ALGORITHM: <algorithm_string>]`).
            Each step should clearly explain a concept or a part of a technique.
            Ensure algorithms are provided in standard WCA notation (e.g., R U R' U').
            If a step involves a specific sequence of moves, provide it as an 'algorithm' field. If it's a starting position, provide a 'scramble' field.

            Consider the scramble: {scramble}.
            Target lesson topic: '{lesson_topic}'.
            """
            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "lesson_id": {"type": "STRING"},
                    "title": {"type": "STRING"},
                    "description": {"type": "STRING"},
                    "topic": {"type": "STRING"},
                    "difficulty": {"type": "STRING"},
                    "steps": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "step_number": {"type": "INTEGER"},
                                "title": {"type": "STRING"},
                                "content": {"type": "STRING"}, # Markdown content
                                "scramble": {"type": "STRING", "nullable": True},
                                "algorithm": {"type": "STRING", "nullable": True},
                                "quiz_question": {"type": "STRING", "nullable": True},
                                "quiz_options": {"type": "ARRAY", "items": {"type": "STRING"}, "nullable": True},
                                "quiz_answer": {"type": "STRING", "nullable": True}
                            },
                            "required": ["step_number", "title", "content"]
                        }
                    },
                    "ai_chat_prompts": {"type": "ARRAY", "items": {"type": "STRING"}}
                },
                "required": ["lesson_id", "title", "description", "topic", "difficulty", "steps", "ai_chat_prompts"]
            }

            print("DEBUG: Generating lesson with Gemini API.")
            gemini_response = call_gemini_api(prompt, response_schema=response_schema)
            print(f"DEBUG: Gemini API raw response: {json.dumps(gemini_response, indent=2)}")

            if gemini_response and gemini_response.get('candidates'):
                response_part = gemini_response['candidates'][0]['content']['parts'][0]['text']
                try:
                    lesson_data = json.loads(response_part)
                    if 'lesson_id' not in lesson_data:
                        lesson_data['lesson_id'] = str(uuid.uuid4())
                    print("DEBUG: Successfully parsed lesson data.")
                    return jsonify(lesson_data), 200
                except json.JSONDecodeError as e:
                    print(f"ERROR: Failed to decode JSON from Gemini response: {e}")
                    print(f"Raw Gemini response text part: {response_part}")
                    return jsonify({"error": "Failed to parse AI response as JSON. Raw response part: " + response_part}), 500
            else:
                print("ERROR: Gemini API response did not contain expected content.")
                return jsonify({"error": "Failed to generate lesson from AI. No content found."}), 500

        elif action_type == 'generateCourse':
            cube_type = request_json.get('cubeType', '3x3')
            skill_level = request_json.get('skillLevel', 'Beginner')
            learning_style = request_json.get('learningStyle', 'Algorithmic')

            prompt = f"""
            As an expert Rubik's Cube instructor, generate a comprehensive learning course on the {cube_type} cube for a {skill_level} learner with an '{learning_style}' learning style.
            The course should be structured into multiple modules, and each module should contain several detailed lessons.
            Each lesson should follow the detailed structure for 'generateLesson' described previously (including Markdown content, `[VISUALIZE_...]` placeholders, and optional scrambles, algorithms, quizzes, and AI chat prompts).
            Ensure the course progresses logically from foundational concepts to more advanced techniques appropriate for the skill level.
            Generate at least 3 modules, with at least 2 lessons per module, and at least 3 steps per lesson.

            """
            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "course_id": {"type": "STRING"},
                    "course_title": {"type": "STRING"},
                    "course_description": {"type": "STRING"},
                    "target_skill_level": {"type": "STRING"},
                    "modules": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "module_id": {"type": "STRING"},
                                "module_title": {"type": "STRING"},
                                "module_description": {"type": "STRING"},
                                "lessons": {
                                    "type": "ARRAY",
                                    "items": {
                                        "type": "OBJECT",
                                        "properties": {
                                            "lesson_id": {"type": "STRING"},
                                            "title": {"type": "STRING"},
                                            "description": {"type": "STRING"},
                                            "topic": {"type": "STRING"},
                                            "difficulty": {"type": "STRING"},
                                            "steps": {
                                                "type": "ARRAY",
                                                "items": {
                                                    "type": "OBJECT",
                                                    "properties": {
                                                        "step_number": {"type": "INTEGER"},
                                                        "title": {"type": "STRING"},
                                                        "content": {"type": "STRING"},
                                                        "scramble": {"type": "STRING", "nullable": True},
                                                        "algorithm": {"type": "STRING", "nullable": True},
                                                        "quiz_question": {"type": "STRING", "nullable": True},
                                                        "quiz_options": {"type": "ARRAY", "items": {"type": "STRING"}, "nullable": True},
                                                        "quiz_answer": {"type": "STRING", "nullable": True}
                                                    },
                                                    "required": ["step_number", "title", "content"]
                                                }
                                            },
                                            "ai_chat_prompts": {"type": "ARRAY", "items": {"type": "STRING"}}
                                        },
                                        "required": ["lesson_id", "title", "description", "topic", "difficulty", "steps", "ai_chat_prompts"]
                                    }
                                }
                            },
                            "required": ["module_id", "module_title", "module_description", "lessons"]
                        }
                    }
                },
                "required": ["course_id", "course_title", "course_description", "target_skill_level", "modules"]
            }

            print("DEBUG: Generating course with Gemini API.")
            gemini_response = call_gemini_api(prompt, response_schema=response_schema)
            print(f"DEBUG: Gemini API raw response: {json.dumps(gemini_response, indent=2)}")

            if gemini_response and gemini_response.get('candidates'):
                response_part = gemini_response['candidates'][0]['content']['parts'][0]['text']
                try:
                    course_data = json.loads(response_part)
                    if 'course_id' not in course_data:
                        course_data['course_id'] = str(uuid.uuid4())
                    for module in course_data.get('modules', []):
                        if 'module_id' not in module:
                            module['module_id'] = str(uuid.uuid4())
                        for lesson in module.get('lessons', []):
                            if 'lesson_id' not in lesson:
                                lesson['lesson_id'] = str(uuid.uuid4())
                    print("DEBUG: Successfully parsed course data.")
                    return jsonify(course_data), 200
                except json.JSONDecodeError as e:
                    print(f"ERROR: Failed to decode JSON from Gemini response: {e}")
                    print(f"Raw Gemini response text part: {response_part}")
                    return jsonify({"error": "Failed to parse AI response as JSON. Raw response part: " + response_part}), 500
            else:
                print("ERROR: Gemini API response did not contain expected content.")
                return jsonify({"error": "Failed to generate course from AI. No content found."}), 500

        elif action_type == 'aiChat':
            lesson_context = request_json.get('lessonContext')
            user_query = request_json.get('userQuery')

            if not user_query:
                return jsonify({"error": "User query is required for AI chat."}), 400

            chat_prompt = f"""
            You are Jarvis, an expert Rubik's Cube tutor. Provide concise, helpful, and contextual assistance to the user.
            The current lesson context is:
            Lesson Title: {lesson_context.get('lessonTitle', 'N/A')}
            Current Step Title: {lesson_context.get('stepTitle', 'N/A')}
            Current Step Content (Markdown): {lesson_context.get('stepContent', 'N/A')}
            Optional Scramble: {lesson_context.get('scramble', 'N/A')}
            Optional Algorithm: {lesson_context.get('algorithm', 'N/A')}

            User's question: "{user_query}"

            Based on the above context, answer the user's question. Keep your response focused on cubing concepts, techniques, or clarifications related to the lesson.
            """
            print("DEBUG: Handling AI chat with Gemini API.")
            gemini_response = call_gemini_api(chat_prompt)
            print(f"DEBUG: Gemini API raw response for chat: {json.dumps(gemini_response, indent=2)}")


            if gemini_response and gemini_response.get('candidates'):
                response_text = gemini_response['candidates'][0]['content']['parts'][0]['text']
                print(f"DEBUG: AI chat response generated: {response_text}")
                return jsonify({"response": response_text}), 200
            else:
                print("ERROR: Gemini API response for chat did not contain expected content.")
                return jsonify({"error": "Failed to get AI chat response."}), 500

        elif action_type == 'evaluatePerformance':
            solve_history = request_json.get('solveHistory', [])
            lesson_completion_data = request_json.get('lessonCompletionData', [])
            user_skill_level = request_json.get('userSkillLevel', 'intermediate')

            prompt = f"""
            As an expert Rubik's Cube analyst, evaluate the user's performance based on their solve history and lesson completion data.
            Provide personalized insights, identify areas for improvement, and suggest specific lessons or courses to focus on next.
            The user's current skill level is '{user_skill_level}'.

            Solve History: {json.dumps(solve_history)}
            Lesson Completion Data: {json.dumps(lesson_completion_data)}

            Return the response as a JSON object with the following structure:
            {{
                "analysis": "Detailed analysis of strengths and weaknesses.",
                "recommendations": [
                    "Suggestion 1 (e.g., 'Revisit F2L Case 3')",
                    "Suggestion 2 (e.g., 'Practice OLL algorithms')",
                    "Suggestion 3 (e.g., 'Consider the Advanced CFOP Course')"
                ],
                "next_course_suggestion": "Optional suggestion for the next course based on progression."
            }}
            """
            response_schema = {
                "type": "OBJECT",
                "properties": {
                    "analysis": {"type": "STRING"},
                    "recommendations": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "next_course_suggestion": {"type": "STRING", "nullable": True}
                },
                "required": ["analysis", "recommendations"]
            }

            print("DEBUG: Evaluating performance with Gemini API.")
            gemini_response = call_gemini_api(prompt, response_schema=response_schema)
            print(f"DEBUG: Gemini API raw response for performance: {json.dumps(gemini_response, indent=2)}")

            if gemini_response and gemini_response.get('candidates'):
                response_part = gemini_response['candidates'][0]['content']['parts'][0]['text']
                try:
                    performance_data = json.loads(response_part)
                    print("DEBUG: Successfully parsed performance data.")
                    return jsonify(performance_data), 200
                except json.JSONDecodeError as e:
                    print(f"ERROR: Failed to decode JSON from Gemini response: {e}")
                    print(f"Raw Gemini response text part: {response_part}")
                    return jsonify({"error": "Failed to parse AI response as JSON for performance evaluation. Raw response: " + response_part}), 500
            else:
                print("ERROR: Gemini API response for performance evaluation did not contain expected content.")
                return jsonify({"error": "Failed to evaluate performance."}), 500

        else:
            return jsonify({"error": "Invalid actionType specified."}), 400

    except requests.exceptions.ConnectionError as conn_err:
        print(f"ERROR: Connection error during Gemini API call: {conn_err}")
        return jsonify({"error": "Unable to connect to AI service. Please check your internet connection or try again later."}), 503
    except requests.exceptions.Timeout as timeout_err:
        print(f"ERROR: Timeout error during Gemini API call: {timeout_err}")
        return jsonify({"error": "AI service request timed out. The request took too long to get a response."}), 504
    except requests.exceptions.RequestException as req_err:
        print(f"ERROR: General request error during Gemini API call: {req_err}")
        # Log the specific error message from the API response body if available
        if hasattr(req_err, 'response') and req_err.response is not None:
            print(f"ERROR: API detailed error response: {req_err.response.text}")
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
        return jsonify({"error": f"An unexpected internal server error occurred. Details: {e}"}), 500
