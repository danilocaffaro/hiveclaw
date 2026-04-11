# 🔧 Troubleshooting

> Common problems and how to fix them.

---

## Quick Diagnostics

Run these first:

```bash
# Is the server running?
curl http://localhost:4070/api/health

# Check logs
tail -50 ~/.hiveclaw/logs/server.log

# Check database
ls -la ~/.hiveclaw/hiveclaw.db

# Check Node.js version
node -v  # Should be 20+

# Check pnpm
pnpm -v  # Should be 9+
```

---

## Server Issues

### Server won't start

**Symptom:** `pnpm start` exits immediately or crashes.

**Check:**
```bash
# Port already in use?
lsof -i :4070

# Missing build?
ls apps/server/dist/index.js  # Should exist

# Missing dependencies?
pnpm install

# Rebuild
pnpm build
```

**Common causes:**
| Cause | Fix |
|-------|-----|
| Port 4070 in use | Kill the other process or set `PORT=4071` in `.env` |
| Missing build | Run `pnpm build` |
| Missing node_modules | Run `pnpm install` |
| Wrong Node.js version | Upgrade to Node 20+ |
| Bad .env | Check for syntax errors — no quotes around values with spaces |

### Server starts but UI is blank

**Cause:** Frontend build is missing or outdated.

```bash
# Rebuild frontend
pnpm build:web

# Check the static export exists
ls apps/web/out/index.html  # Should exist
```

### "Database is locked" error

**Cause:** Multiple processes accessing the same SQLite database.

```bash
# Find processes using the DB
fuser ~/.hiveclaw/hiveclaw.db 2>/dev/null
lsof ~/.hiveclaw/hiveclaw.db

# Kill duplicates (keep only one server process)
# Then restart
pnpm start
```

> HiveClaw uses WAL mode for better concurrent reads, but only one writer at a time.

---

## Agent Issues

### Agent doesn't respond

**Check:**
1. Is the server running? (`curl http://localhost:4070/api/health`)
2. Is the provider configured? (check `.env` for API keys)
3. Is the API key valid? (try the key directly with `curl`)
4. Check server logs for errors

```bash
# Test provider directly
curl -s http://localhost:4070/api/health | python3 -c "
import sys, json
data = json.load(sys.stdin)
for p in data.get('providers', []):
    print(f\"{p['id']}: {'✅' if p['enabled'] else '❌'}\")
"
```

### Agent gives "something went wrong" error

**Cause:** All LLM providers failed.

**Fix:**
1. Check API key validity
2. Check provider rate limits
3. Add fallback providers
4. Check network connectivity to LLM APIs

### Agent "forgets" things

**Cause:** Memory not persisting, or session changed.

**Check:**
```bash
# List agent memories
curl http://localhost:4070/api/agents/{agentId}/memories | python3 -m json.tool | head -20

# Check if memory compaction is too aggressive
# Core memory blocks have a 2500 char limit
```

---

## Channel Issues

### Telegram bot doesn't respond

**Checklist:**
1. ✅ Bot token is correct (from @BotFather)
2. ✅ Channel is connected in Settings
3. ✅ Your Telegram user ID is in `allowedUsers` (if restricted)
4. ✅ Server is reachable from the internet (Telegram needs to reach your webhook, OR you're using polling)

```bash
# Check channel status
curl http://localhost:4070/api/channels | python3 -m json.tool

# Test Telegram bot token
curl "https://api.telegram.org/bot{TOKEN}/getMe"
```

**Common fixes:**
- Restart the channel: disconnect and reconnect in Settings
- Check firewall: Telegram webhooks need port 443 or 8443 externally
- Use polling mode if you can't expose a public URL

### WhatsApp QR code won't scan

**Cause:** Previous session expired or corrupted.

```bash
# Clear WhatsApp session
rm -rf ~/.hiveclaw/channels/whatsapp/session/

# Restart server — new QR code will appear
pnpm start
```

### Messages arrive but agent doesn't reply

**Cause:** Agent is processing (stuck) or LLM provider is down.

```bash
# Check active sessions
curl http://localhost:4070/api/sessions?status=processing

# If a session is stuck, reset it
curl -X POST http://localhost:4070/api/sessions/{sessionId}/reset
```

---

## Build Issues

### TypeScript errors during build

```bash
# Check for type errors
pnpm typecheck

# Common fix: rebuild shared package first
pnpm --filter @hiveclaw/shared build
pnpm build
```

### "Module not found" errors

```bash
# Clean install
pnpm clean
rm -rf node_modules
pnpm install
pnpm build
```

### Next.js build fails

```bash
# Check for missing NEXT_OUTPUT env
NEXT_OUTPUT=export pnpm --filter @hiveclaw/web build

# If CSS issues, check for Tailwind references (HiveClaw uses inline styles, not Tailwind)
```

---

## Performance Issues

### Server is slow

**Check:**
```bash
# Memory usage
curl http://localhost:4070/api/health | python3 -c "
import sys, json
m = json.load(sys.stdin)['memory']
print(f\"RSS: {m['rss']}MB | Heap: {m['heapUsed']}MB\")
"

# Database size
du -h ~/.hiveclaw/hiveclaw.db

# Message count
curl http://localhost:4070/api/health | python3 -c "
import sys, json
db = json.load(sys.stdin)['db']
print(f\"Messages: {db['messages']} | Sessions: {db['sessions']}\")
"
```

**Fixes:**
- If DB > 500MB: consider archiving old sessions
- If heap > 500MB: restart the server
- If many concurrent sessions: increase Node.js memory with `NODE_OPTIONS=--max-old-space-size=4096`

### Agent responses are slow

**Causes:**
| Cause | Fix |
|-------|-----|
| LLM provider latency | Switch to a faster model (Haiku, Flash) |
| Large system prompt | Trim to essentials |
| Too many memories | Compact core memory |
| Network issues | Check `ping api.anthropic.com` |

---

## Database Issues

### Recover from corrupted DB

```bash
# Backup first!
cp ~/.hiveclaw/hiveclaw.db ~/.hiveclaw/hiveclaw.db.bak

# Check integrity
sqlite3 ~/.hiveclaw/hiveclaw.db "PRAGMA integrity_check;"

# If corrupted, try recovery
sqlite3 ~/.hiveclaw/hiveclaw.db ".dump" | sqlite3 ~/.hiveclaw/hiveclaw-recovered.db
mv ~/.hiveclaw/hiveclaw-recovered.db ~/.hiveclaw/hiveclaw.db
```

### Reset database (nuclear option)

⚠️ **This deletes all data — agents, sessions, messages, memories.**

```bash
rm ~/.hiveclaw/hiveclaw.db
pnpm start  # Creates fresh DB
```

---

## Network Issues

### "ECONNREFUSED" when accessing localhost:4070

**Cause:** Server not running, or running on a different port.

```bash
# Check if anything is on 4070
lsof -i :4070

# Check .env for custom port
grep PORT .env

# Start the server
pnpm start
```

### Can't reach server from another device

**Cause:** Server binds to localhost by default.

**Fix:** Set `HOST=0.0.0.0` in `.env` to listen on all interfaces.

⚠️ **Security warning:** Only do this on trusted networks. Use a reverse proxy (nginx, Caddy) for public access.

---

## Still Stuck?

1. **Check logs:** `tail -100 ~/.hiveclaw/logs/server.log`
2. **Check health:** `curl http://localhost:4070/api/health`
3. **Search issues:** [github.com/danilocaffaro/superclaw-pure/issues](https://github.com/danilocaffaro/superclaw-pure/issues)
4. **Ask for help:** Open a new issue with:
   - HiveClaw version (`curl http://localhost:4070/api/health | jq .version`)
   - Node.js version (`node -v`)
   - OS and architecture
   - Error message (full)
   - Steps to reproduce

---

*HiveClaw v1.3 — [Getting Started](GETTING-STARTED.md) | [User Guide](USER-GUIDE.md) | [API Reference](API.md)*
