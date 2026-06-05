@echo off
REM `nestbrain` CLI Windows wrapper bundled with NestBrain.
REM Lives at <install-dir>\resources\cli\nestbrain.bat. Resolves the
REM bundled JS via a relative path so PATH-installed `nestbrain` works
REM regardless of where the user installed NestBrain.
node "%~dp0..\web\apps\web\nestbrain.bundle.cjs" %*
