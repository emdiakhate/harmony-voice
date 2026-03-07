# Setup Piper TTS for Windows — downloads binary and voice models
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-piper.ps1
# Or:    npm run setup:piper:win

$ErrorActionPreference = "Stop"

$PIPER_VERSION = "2023.11.14-2"
$PIPER_DIR = "server\piper"
$VOICES_DIR = "$PIPER_DIR\voices"

New-Item -ItemType Directory -Force -Path $PIPER_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $VOICES_DIR | Out-Null

Write-Host "=== Piper TTS Setup (Windows) ===" -ForegroundColor Cyan

# Download Piper binary
if (Test-Path "$PIPER_DIR\piper.exe") {
    Write-Host "[OK] Piper binary already exists" -ForegroundColor Green
} else {
    Write-Host "[*] Downloading Piper binary..." -ForegroundColor Yellow
    $url = "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_windows_amd64.zip"
    $zipPath = "$env:TEMP\piper.zip"

    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $PIPER_DIR -Force

    # Files may be in a subdirectory
    if (Test-Path "$PIPER_DIR\piper") {
        Get-ChildItem "$PIPER_DIR\piper\*" | Move-Item -Destination $PIPER_DIR -Force
        Remove-Item "$PIPER_DIR\piper" -Force -ErrorAction SilentlyContinue
    }

    Remove-Item $zipPath -Force
    Write-Host "[OK] Piper binary installed" -ForegroundColor Green
}

# Download voice models
$HUGGINGFACE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

function Download-Voice {
    param (
        [string]$LangCode,
        [string]$ModelName
    )

    if (Test-Path "$VOICES_DIR\$ModelName.onnx") {
        Write-Host "[OK] Voice $ModelName already exists" -ForegroundColor Green
        return
    }

    Write-Host "[*] Downloading voice: $ModelName ..." -ForegroundColor Yellow
    $langShort = $LangCode.Split("_")[0]

    Invoke-WebRequest -Uri "$HUGGINGFACE_BASE/$langShort/$LangCode/$ModelName/$ModelName.onnx" `
        -OutFile "$VOICES_DIR\$ModelName.onnx" -UseBasicParsing
    Invoke-WebRequest -Uri "$HUGGINGFACE_BASE/$langShort/$LangCode/$ModelName/$ModelName.onnx.json" `
        -OutFile "$VOICES_DIR\$ModelName.onnx.json" -UseBasicParsing

    Write-Host "[OK] Voice $ModelName downloaded" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Downloading voice models ===" -ForegroundColor Cyan

# French (primary + alt for podcast)
Download-Voice "fr_FR" "fr_FR-siwis-medium"
Download-Voice "fr_FR" "fr_FR-upmc-medium"

# English
Download-Voice "en_US" "en_US-lessac-medium"
Download-Voice "en_US" "en_US-amy-medium"

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host "Piper binary: $PIPER_DIR\piper.exe"
Write-Host "Voices: $VOICES_DIR\"
Get-ChildItem "$VOICES_DIR\*.onnx" | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1MB, 1))MB)" }
Write-Host ""
Write-Host "To test:" -ForegroundColor Yellow
Write-Host "  echo 'Bonjour le monde' | .\$PIPER_DIR\piper.exe --model .\$VOICES_DIR\fr_FR-siwis-medium.onnx --output_file test.wav"
