#!/bin/zsh

cd "$(dirname "$0")" || exit 1

PORT=4173
URL="http://127.0.0.1:${PORT}/"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found on this Mac."
  echo "Install Python 3, or ask Codex to start the server for you."
  read "?Press Enter to close..."
  exit 1
fi

echo "Refreshing blog content index..."
python3 generate-content-index.py || {
  echo "Failed to refresh the blog content index."
  read "?Press Enter to close..."
  exit 1
}

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Blog server is already running."
  echo "Opening ${URL}"
  open "${URL}"
  exit 0
fi

echo "Starting blog server at ${URL}"
echo "Keep this window open while you are visiting the blog."
open "${URL}"
python3 -m http.server "${PORT}"
