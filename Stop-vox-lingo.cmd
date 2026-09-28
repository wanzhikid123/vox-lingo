@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop-vox-lingo.ps1" %*
if errorlevel 1 pause
