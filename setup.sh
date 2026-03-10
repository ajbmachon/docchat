#!/usr/bin/env bash
# docchat — Idempotent setup and launch
# Usage: ./setup.sh [target-directory]
# If no target directory given, uses current working directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$(pwd)}"
PORT="${PORT:-3333}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ◈  docchat — codebase understanding tool${NC}"
echo -e "${DIM}  ═══════════════════════════════════════════${NC}"
echo ""

# ── Check bun ────────────────────────────────────────
if command -v bun &>/dev/null; then
  BUN_VERSION=$(bun --version 2>/dev/null || echo "unknown")
  echo -e "  ${GREEN}✓${NC} bun ${BUN_VERSION}"
else
  echo -e "  ${RED}✗${NC} bun not found"
  echo ""
  echo -e "  Install bun: ${YELLOW}curl -fsSL https://bun.sh/install | bash${NC}"
  echo "  Then re-run this script."
  exit 1
fi

# ── Check claude CLI (optional — needed for chat + explore) ──
if command -v claude &>/dev/null; then
  echo -e "  ${GREEN}✓${NC} claude CLI found (chat + explore enabled)"
else
  echo -e "  ${YELLOW}!${NC} claude CLI not found — chat and explore will be unavailable"
  echo -e "    Install: ${YELLOW}npm install -g @anthropic-ai/claude-code${NC}"
fi

# ── Check server.ts exists ───────────────────────────
if [ ! -f "$SCRIPT_DIR/server.ts" ]; then
  echo -e "  ${RED}✗${NC} Missing: server.ts"
  echo -e "  ${RED}Is this the correct docchat directory?${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} server.ts found"

# ── Check target directory ───────────────────────────
if [ ! -d "$TARGET_DIR" ]; then
  echo -e "  ${RED}✗${NC} Target directory does not exist: $TARGET_DIR"
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Target: ${TARGET_DIR}"

# ── Kill existing server on port (idempotent) ────────
EXISTING_PID=$(lsof -ti:"$PORT" 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  echo -e "  ${YELLOW}!${NC} Port $PORT in use (PID $EXISTING_PID) — stopping it"
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 0.5
fi

# ── Launch server ────────────────────────────────────
echo ""
echo -e "  ${CYAN}Starting on http://localhost:${PORT}${NC}"
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop"
echo ""

cd "$SCRIPT_DIR"
exec bun run server.ts "$TARGET_DIR"
