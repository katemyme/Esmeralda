@echo off
rem Atajo para cmd o doble clic: ejecuta probar.ps1 sin depender de la politica de ejecucion.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0probar.ps1" %*
