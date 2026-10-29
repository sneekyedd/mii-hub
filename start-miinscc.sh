#!/bin/sh
# Starts MiiNSCC (Mac / Linux): quietly gets the latest version first, then opens it in your browser.
cd "$(dirname "$0")"
command -v git >/dev/null 2>&1 && git pull --ff-only --quiet >/dev/null 2>&1
if command -v open >/dev/null 2>&1; then open index.html; else xdg-open index.html >/dev/null 2>&1; fi
