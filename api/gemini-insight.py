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
        # Note: 'response' variable might not be defined in all error paths.
        # This part assumes 'response' would be from gemini_response.
        # A more robust solution might pass gemini_response to the exception handler
        # or capture it higher up. For this fix, assuming typical flow.
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

    try:
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
        
        gemini_response = requests.post(f"{GEMINI_API_BASE_URL}/gemini-2.0-flash:generateContent", headers=headers, json=payload, timeout=30)
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
        print(f"Raw response text: {gemini_response.text}")
        return jsonify({"error": f"AI service returned invalid JSON: {e}"}), 500
    except Exception as e:
        print(f"CRITICAL ERROR: Unexpected error in generate_insight: {e}")
        return jsonify({"error": f"An unexpected error occurred during insight generation: {e}"}), 500

def handle_lesson_chat(request_json):
    """Handles conversational chat for lesson creation or in-lesson queries."""
    chat_history = request_json.get('chatHistory', [])
    cube_type = request_json.get('cubeType', '3x3')
    user_level = request_json.get('userLevel', 'beginner')
    current_lesson_context = request_json.get('currentLessonContext', {})

    system_instruction = f"""
    You are Jarvis, an AI assistant for a Rubik's Cube learning application.
    Your primary function is to converse with Sir Sevindu about creating and understanding cubing lessons.
    Maintain a formal, respectful, and helpful tone, similar to your persona in the Iron Man movies.
    
    When discussing course creation:
    - If Sir Sevindu has already provided cube type and skill level, acknowledge them and ask for further preferences (e.g., "Given your current settings for a {cube_type} cube and your {user_level} level, what specific areas would you like to focus on?").
    - If the user indicates they want to generate a course, respond with a confirmation message and set the 'action' to 'generate_course'.
    - If the user asks general questions about cubing or lessons, provide helpful information.

    When discussing an ongoing lesson (if currentLessonContext is provided):
    - Answer questions related to the lesson content, algorithms, scrambles, or concepts.
    - Do not try to generate a new course or change the lesson. Focus on explaining the current topic. Keep responses concise and directly address Sir Sevindu's query.
    """
    
    # Prepare chat history for Gemini API, ensuring 'system' role is first
    formatted_chat_history = [{"role": "system", "parts": [{"text": system_instruction}]}]
    if chat_history:
        for msg in chat_history:
            formatted_chat_history.append({"role": msg['role'], "parts": [{"text": msg['parts'][0]['text']}]})

    # Add current lesson context if available. It should be appended to the latest user input.
    if current_lesson_context and formatted_chat_history and formatted_chat_history[-1]['role'] == 'user':
        context_text = f"\n\nCurrent Lesson Context:\nTitle: {current_lesson_context.get('lessonTitle', 'N/A')}\nType: {current_lesson_context.get('lessonType', 'N/A')}\nContent Snippet: {current_lesson_context.get('content', '')[:200]}..."
        formatted_chat_history[-1]['parts'][0]['text'] += context_text

    ai_response_text = None # Initialize to None for error handling

    try:
        headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY
        }
        payload = {
            "contents": formatted_chat_history,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "message": {"type": "STRING"},
                        "action": {"type": "STRING"} # The AI is supposed to return this action
                    },
                    "required": ["message"]
                }
            }
        }
        
        # Use gemini-1.5-flash-latest for conversational chat
        model_name = "gemini-1.5-flash-latest"

        gemini_response = requests.post(
            f"{GEMINI_API_BASE_URL}/{model_name}:generateContent",
            headers=headers,
            json=payload,
            timeout=60 # Increased timeout for potentially longer AI responses
        )
        gemini_response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        
        response_data = gemini_response.json()
        print(f"DEBUG: Gemini API raw response for chat: {response_data}")

        if response_data and response_data.get('candidates'):
            # The AI is supposed to return a JSON string as its text content if responseMimeType is set.
            ai_response_text = response_data['candidates'][0]['content']['parts'][0]['text']
            # Attempt to parse the AI's response text as JSON
            ai_response_json = json.loads(ai_response_text)
            
            # Extract message and action from the parsed JSON
            message = ai_response_json.get('message', "No message provided by AI.")
            action = ai_response_json.get('action') # This will be None if not present

            print(f"DEBUG: Parsed AI response message: {message}, action: {action}")
            
            # The frontend expects a JSON object with `message` and `action`.
            response_payload = {"message": message}
            if action:
                response_payload["action"] = action

            return jsonify(response_payload), 200
        else:
            print(f"ERROR: Gemini API response missing candidates or content: {response_data}")
            return jsonify({"error": "AI service did not return a valid response."}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to get response from AI service: {e}"}), 500
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse Gemini API's text response as JSON: {e}")
        print(f"Raw AI text response that failed parsing: {ai_response_text}") # Log the raw text
        return jsonify({"error": "AI service returned malformed JSON. Please try again or rephrase."}), 500
    except Exception as e:
        print(f"CRITICAL ERROR: Unexpected error in handle_lesson_chat: {e}")
        return jsonify({"error": f"An unexpected error occurred during chat processing: {e}"}), 500


def handle_generate_course(request_json):
    """Initiates the course generation process by sending a specific request to the serverless function."""
    chat_history = request_json.get('chatHistory', [])
    cube_type = request_json.get('cubeType', '3x3')
    user_level = request_json.get('skillLevel', 'beginner') # Note: 'skillLevel' from frontend payload

    system_instruction = f"""
    You are Jarvis, an AI assistant. Your task is to generate a comprehensive, structured Rubik's Cube course tailored for a {user_level} level cuber learning the {cube_type} cube.
    Based on the preceding chat history and any explicit user requests, generate a complete course structure.
    
    The course should be returned as a JSON object adhering to the following schema:
    {{
        "title": "Generated Course Title",
        "description": "Brief description of the course.",
        "cubeType": "{cube_type}",
        "level": "{user_level}",
        "modules": [
            {{
                "title": "Module Title 1",
                "description": "Description of Module 1.",
                "lessons": [
                    {{
                        "title": "Lesson Title 1.1",
                        "description": "Description of Lesson 1.1.",
                        "lessonType": "text", // Can be 'text', 'scramble', 'quiz'
                        "content": "Full markdown content for Lesson 1.1, including explanations, examples, and markdown formatting. For scrambles, embed them as <scramble>R U R' U'</scramble>. For quizzes, embed questions as <question id='q1'>What is F2L?</question><options><option>First 2 Layers</option><option>Last Layer</option></options><answer>First 2 Layers</answer>.",
                        "steps": [ // Break down content into manageable steps
                            {{
                                "title": "Step 1.1.1",
                                "content": "Markdown content for this step. Use <scramble>...</scramble> or <question>...</question> for interactive parts.",
                                "completed": false // Default to false
                            }}
                        ]
                    }}
                ]
            }}
        ]
    }}
    
    Ensure ALL markdown content for lessons and steps is fully included within the `content` field. Do not truncate.
    Make sure to include appropriate `lessonType` for each lesson (e.g., 'text', 'scramble', 'quiz').
    For 'scramble' lessons, embed actual scramble strings using the `<scramble>R U R' U'</scramble>` tag within the `content` of the steps.
    For 'quiz' lessons, embed questions, options, and answers using `<question id='qN'>...</question><options><option>...</option><option>...</option></options><answer>...</answer>` tags within the `content` of the steps.
    Generate a complete, coherent course. Do not ask for further clarification.
    """

    # Prepare chat history for Gemini API, ensuring 'system' role is first
    formatted_chat_history = [{"role": "system", "parts": [{"text": system_instruction}]}]
    if chat_history:
        for msg in chat_history:
            formatted_chat_history.append({"role": msg['role'], "parts": [{"text": msg['parts'][0]['text']}]})

    ai_response_text = None # Initialize to None for error handling

    try:
        headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY
        }
        payload = {
            "contents": formatted_chat_history,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "title": {"type": "STRING"},
                        "description": {"type": "STRING"},
                        "cubeType": {"type": "STRING"},
                        "level": {"type": "STRING"},
                        "modules": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "title": {"type": "STRING"},
                                    "description": {"type": "STRING"},
                                    "lessons": {
                                        "type": "ARRAY",
                                        "items": {
                                            "type": "OBJECT",
                                            "properties": {
                                                "title": {"type": "STRING"},
                                                "description": {"type": "STRING"},
                                                "lessonType": {"type": "STRING"},
                                                "content": {"type": "STRING"},
                                                "steps": {
                                                    "type": "ARRAY",
                                                    "items": {
                                                        "type": "OBJECT",
                                                        "properties": {
                                                            "title": {"type": "STRING"},
                                                            "content": {"type": "STRING"},
                                                            "completed": {"type": "BOOLEAN"}
                                                        },
                                                        "required": ["title", "content", "completed"]
                                                    }
                                                }
                                            },
                                            "required": ["title", "description", "lessonType", "content", "steps"]
                                        }
                                    }
                                },
                                "required": ["title", "description", "lessons"]
                            }
                        }
                    },
                    "required": ["title", "description", "cubeType", "level", "modules"]
                }
            }
        }
        
        # Use a model suitable for complex content generation
        model_name = "gemini-1.5-flash-latest" # Consider 'gemini-1.5-pro-latest' for more complex generation if needed

        gemini_response = requests.post(
            f"{GEMINI_API_BASE_URL}/{model_name}:generateContent",
            headers=headers,
            json=payload,
            timeout=120 # Increased timeout for course generation
        )
        gemini_response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        
        response_data = gemini_response.json()
        print(f"DEBUG: Gemini API raw response for course generation: {response_data}")

        if response_data and response_data.get('candidates'):
            ai_response_text = response_data['candidates'][0]['content']['parts'][0]['text']
            # Attempt to parse the AI's response text as JSON
            generated_course = json.loads(ai_response_text)
            
            # The frontend expects the course object directly
            return jsonify(generated_course), 200
        else:
            print(f"ERROR: Gemini API response missing candidates or content: {response_data}")
            return jsonify({"error": "AI service did not return a valid course structure."}), 500

    except requests.exceptions.RequestException as e:
        print(f"ERROR: Request to Gemini API failed: {e}")
        return jsonify({"error": f"Failed to generate course from AI service: {e}"}), 500
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse Gemini API's text response as JSON: {e}")
        print(f"Raw AI text response that failed parsing: {ai_response_text}") # Log the raw text
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
