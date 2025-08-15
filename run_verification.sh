#!/bin/bash
export GEMINI_API_KEY="AIzaSyCBYZ_uAs8tVseR1sgC0PDz34U5vLMrCxA"
python api/gemini-insight.py --port 8080 &
sleep 5
python jules-scratch/verification/verify.py
