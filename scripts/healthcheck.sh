#!/bin/bash
# HiveClaw Health Check
# Returns: exit 0 = healthy, exit 1 = unhealthy

PORT="${PORT:-4070}"
ENDPOINT="http://localhost:${PORT}/api/health"
TIMEOUT=5

response=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$ENDPOINT" 2>/dev/null)

if [ "$response" = "200" ]; then
    # Also check channels API is reachable
    webhook_response=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "http://localhost:${PORT}/api/channels" 2>/dev/null)
    if [ "$webhook_response" = "200" ]; then
        echo "✅ HiveClaw: healthy (HTTP 200, channels API OK)"
        exit 0
    else
        echo "⚠️ HiveClaw: server up but channels API returned $webhook_response"
        exit 1
    fi
else
    echo "🔴 HiveClaw: DOWN (HTTP $response)"
    exit 1
fi
