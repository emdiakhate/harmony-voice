#!/bin/bash
# Setup Piper TTS — downloads binary and French voice models
# Usage: bash scripts/setup-piper.sh
# Or:    npm run setup:piper

set -e

PIPER_VERSION="2023.11.14-2"
PIPER_DIR="server/piper"
VOICES_DIR="$PIPER_DIR/voices"

mkdir -p "$PIPER_DIR" "$VOICES_DIR"

# Detect OS
OS=$(uname -s)
ARCH=$(uname -m)

echo "=== Piper TTS Setup ==="
echo "OS: $OS, Arch: $ARCH"

# Download Piper binary
if [ -f "$PIPER_DIR/piper" ] || [ -f "$PIPER_DIR/piper.exe" ]; then
  echo "[OK] Piper binary already exists"
else
  echo "[*] Downloading Piper binary..."

  case "$OS" in
    Linux)
      if [ "$ARCH" = "x86_64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_linux_x86_64.tar.gz"
      elif [ "$ARCH" = "aarch64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_linux_aarch64.tar.gz"
      fi
      curl -L "$PIPER_URL" -o /tmp/piper.tar.gz
      tar xzf /tmp/piper.tar.gz -C "$PIPER_DIR" --strip-components=1
      rm /tmp/piper.tar.gz
      chmod +x "$PIPER_DIR/piper"
      ;;
    Darwin)
      if [ "$ARCH" = "arm64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_macos_aarch64.tar.gz"
      else
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_macos_x86_64.tar.gz"
      fi
      curl -L "$PIPER_URL" -o /tmp/piper.tar.gz
      tar xzf /tmp/piper.tar.gz -C "$PIPER_DIR" --strip-components=1
      rm /tmp/piper.tar.gz
      chmod +x "$PIPER_DIR/piper"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PIPER_URL="https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_windows_amd64.zip"
      curl -L "$PIPER_URL" -o /tmp/piper.zip
      unzip -o /tmp/piper.zip -d "$PIPER_DIR"
      # Files may be in a subdirectory
      if [ -d "$PIPER_DIR/piper" ]; then
        mv "$PIPER_DIR/piper/"* "$PIPER_DIR/"
        rmdir "$PIPER_DIR/piper" 2>/dev/null || true
      fi
      rm /tmp/piper.zip
      ;;
    *)
      echo "Unsupported OS: $OS"
      echo "Download manually from: https://github.com/rhasspy/piper/releases"
      exit 1
      ;;
  esac
  echo "[OK] Piper binary installed"
fi

# Download voice models
HUGGINGFACE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

download_voice() {
  local lang=$1
  local model=$2

  if [ -f "$VOICES_DIR/${model}.onnx" ]; then
    echo "[OK] Voice $model already exists"
    return
  fi

  echo "[*] Downloading voice: $model ..."
  # Extract parts: fr_FR-siwis-medium → lang_short=fr, voice_name=siwis, quality=medium
  local lang_short="${lang%%_*}"
  local without_lang="${model#${lang}-}"
  local voice_name="${without_lang%-*}"
  local quality="${without_lang##*-}"

  curl -L "$HUGGINGFACE_BASE/$lang_short/$lang/$voice_name/$quality/$model.onnx" \
    -o "$VOICES_DIR/${model}.onnx"
  curl -L "$HUGGINGFACE_BASE/$lang_short/$lang/$voice_name/$quality/$model.onnx.json" \
    -o "$VOICES_DIR/${model}.onnx.json"
  echo "[OK] Voice $model downloaded"
}

echo ""
echo "=== Downloading voice models ==="

# French (primary + alt for podcast)
download_voice "fr_FR" "fr_FR-siwis-medium"
download_voice "fr_FR" "fr_FR-upmc-medium"

# English
download_voice "en_US" "en_US-lessac-medium"
download_voice "en_US" "en_US-amy-medium"

echo ""
echo "=== Setup Complete ==="
echo "Piper binary: $PIPER_DIR/piper"
echo "Voices: $VOICES_DIR/"
ls -la "$VOICES_DIR/"*.onnx 2>/dev/null || echo "No voices found (download may have failed)"
echo ""
echo "To add more voices, download from:"
echo "https://huggingface.co/rhasspy/piper-voices/tree/main"
echo ""
echo "To test: echo 'Bonjour le monde' | $PIPER_DIR/piper --model $VOICES_DIR/fr_FR-siwis-medium.onnx --output_file test.wav"
