#!/bin/bash
# HEAVY STEEL starten (macOS, Doppelklick): ruft das gemeinsame Startskript auf.
cd "$(dirname "$0")" || exit 1
exec bash ./start.sh
