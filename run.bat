@echo off
echo Starting AuraDICOM Server...
if not exist venv (
    echo Python virtual environment not found. Please wait until installation finishes.
    pause
    exit /b
)
call venv\Scripts\activate
python server.py
pause
