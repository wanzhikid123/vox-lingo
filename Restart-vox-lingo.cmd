@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-vox-lingo.ps1" -Restart %*
if errorlevel 1 pause
