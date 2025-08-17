from flask import Flask, request, jsonify
import os

app = Flask(__name__, static_folder=os.getcwd(), static_url_path='')

@app.route('/api/gemini-insight', methods=['POST'])
def proxy_gemini_insight():
    data = request.get_json()
    if data.get('type') == 'lesson_chat':
        # First, the chat will ask for confirmation
        return jsonify({
            "action": "generate_course",
            "message": "I will now generate the course."
        })
    elif data.get('type') == 'generate_course':
        course = {
            "title": "Beginner's 3x3x3 Course",
            "description": "A course for absolute beginners.",
            "cubeType": "3x3x3",
            "level": "beginner",
            "modules": [
                {
                    "module_title": "Introduction",
                    "lessons": [
                        {
                            "lesson_title": "The Basics",
                            "steps": [
                                {
                                    "content": "Welcome to the world of cubing!\n\nThis is a multi-line lesson to test the new feature.\n\nHere is an algorithm to practice: [ALGORITHM: R U R' U']"
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
    return app.send_static_file(path)

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    app.run(port=8000)
