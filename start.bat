@echo off
setlocal
if "%ADMIN_ID%"=="" set /p ADMIN_ID=Enter admin ID: 
if "%ADMIN_PASSWORD%"=="" set /p ADMIN_PASSWORD=Enter admin password: 
set PORT=3000
node server.js
pause
