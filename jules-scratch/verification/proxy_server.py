from flask import Flask, request, jsonify
import os

app = Flask(__name__, static_folder=os.path.join(os.getcwd()), static_url_path='')

@app.route('/api/gemini-insight', methods=['POST'])
def proxy_gemini_insight():
    data = request.get_json()
    if data.get('type') == 'lesson_chat':
        # First, the chat will ask for confirmation
        # This now immediately triggers the course generation for the test.
        return jsonify({
            "action": "generate_course",
            "message": "I will now generate the course."
        })
    elif data.get('type') == 'generate_course':
        # This returns the specific course needed for verification.
        course = {
            "title": "Comprehensive Test Course",
            "description": "A course to test all features.",
            "cubeType": "3x3x3",
            "level": "beginner",
            "modules": [
                {
                    "module_title": "Module 1: Previews",
                    "lessons": [
                        {
                            "lesson_title": "Lesson 1.1: Inline Player",
                            "steps": [
                                {
                                    "content": "Here is an algorithm: [ALGORITHM: R U R' U']"
                                }
                            ]
                        }
                    ]
                },
                {
                    "module_title": "Module 2: Quizzes",
                    "lessons": [
                        {
                            "lesson_title": "Lesson 2.1: Simple Quiz",
                            "steps": [
                                {
                                    "content": "Time for a quiz!",
                                    "quiz": [
                                        {
                                            "question": "What color is opposite to White?",
                                            "options": ["Blue", "Green", "Yellow", "Red"],
                                            "answer": "Yellow"
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }
        return jsonify(course)

@app.route('/<path:path>')
def serve_static(path):
    # This ensures files like lessons.html, style.css, etc., are served from the root.
    return app.send_static_file(path)

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    # The verification script will pass the port, but default to 8000
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    app.run(host='0.0.0.0', port=args.port)
