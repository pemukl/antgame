#!/bin/bash
# Start (or restart) the Bloom & Burrow game server on port 8420.
cd "$(dirname "$0")"
if [ -f server.pid ]; then
  kill "$(cat server.pid | awk '{print $2}')" 2>/dev/null
  sleep 0.5
fi
nohup node server.js > server.log 2>&1 &
echo "PID $!" > server.pid
echo "Bloom & Burrow running (PID $!) — http://taylor.shnei.de:8420/"
