@echo off
rem stetwise-review <file.md>: open a file in Stetwise, wait for the review, print the instructions.
rem Runs the app's own executable as a script host, so nothing else has to be installed.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0Stetwise.exe" "%~dp0resources\app.asar.unpacked\electron\review-cli.cjs" %*
exit /b %ERRORLEVEL%
