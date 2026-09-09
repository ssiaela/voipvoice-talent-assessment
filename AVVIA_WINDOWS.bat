@echo off
cd /d "%~dp0"
if not exist ".env" (
  echo.
  echo Configurazione mancante: .env
  echo Copia .env.example in .env e imposta VV_INITIAL_PASSWORD.
  echo.
  pause
  exit /b 1
)
python server.py
pause
