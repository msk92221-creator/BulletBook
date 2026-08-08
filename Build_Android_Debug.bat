@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "BB_ANDROID=%~dp0android"
set "BB_APK=%BB_ANDROID%\app\build\outputs\apk\debug\app-debug.apk"

if not exist "%BB_ANDROID%\gradlew.bat" (
  echo [ERROR] The android project was not found.
  echo Extract the complete ZIP file and run this file again.
  pause
  exit /b 1
)

if not defined ANDROID_HOME (
  if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)
if not defined ANDROID_SDK_ROOT (
  if defined ANDROID_HOME set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
)

if not defined ANDROID_HOME (
  echo [ERROR] Android SDK was not found.
  echo Open Android Studio, install Android SDK Platform 36,
  echo and then run this file again.
  pause
  exit /b 1
)

if not exist "%ANDROID_HOME%\platforms\android-36\android.jar" (
  echo [ERROR] Android SDK Platform 36 is not installed.
  echo Android Studio: Tools ^> SDK Manager ^> Android 16 API 36
  pause
  exit /b 1
)

if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
  set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
)
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"

where java >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Java was not found.
  echo Install or open Android Studio once, and then run this file again.
  pause
  exit /b 1
)

if not exist "%BB_ANDROID%\capacitor-cordova-android-plugins\cordova.variables.gradle" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] The first Android build requires Node.js LTS.
    echo Install Node.js LTS from https://nodejs.org/ and run this file again.
    pause
    exit /b 1
  )
  echo [INFO] Preparing the Android project for the first build...
  call npm ci
  if errorlevel 1 goto :failed
  call npm run android:sync
  if errorlevel 1 goto :failed
)

set "GRADLE_USER_HOME=%~dp0.android-gradle-cache"
cd /d "%BB_ANDROID%"
call gradlew.bat assembleDebug
if errorlevel 1 goto :failed

echo.
echo [SUCCESS] APK created:
echo %BB_APK%
if not defined BULLETBOOK_CI explorer /select,"%BB_APK%"
if not defined BULLETBOOK_CI pause
exit /b 0

:failed
echo.
echo [ERROR] Android build failed.
echo Open the android folder in Android Studio and check the Build output.
if not defined BULLETBOOK_CI pause
exit /b 1
