@echo off
REM Unificador QR - Lanzador de aplicación
REM Este archivo levanta un servidor estático en puerto 8000 y abre la app en el navegador

setlocal enabledelayedexpansion

REM Obtener la ruta del script
cd /d "%~dp0"

REM Verificar si existe dist
if not exist "dist" (
    echo.
    echo [ERROR] La carpeta 'dist' no existe.
    echo Por favor, ejecuta: npm install && npm run build
    echo.
    pause
    exit /b 1
)

REM Verificar si Python está disponible
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Python no está instalado o no está en el PATH.
    echo Por favor, instala Python desde https://www.python.org/
    echo.
    pause
    exit /b 1
)

REM Cambiar a la carpeta dist
cd dist

REM Iniciar servidor en puerto 8000
echo.
echo [*] Unificador QR
echo [*] Levantando servidor en http://localhost:8000
echo [*] Presiona Ctrl+C para detener
echo.

REM Abrir navegador
timeout /t 2 >nul
start http://localhost:8000

REM Ejecutar servidor
python -m http.server 8000

pause
