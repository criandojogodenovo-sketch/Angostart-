#!/bin/bash
# run-security-audit.sh — prepara ambiente + build .next-sec + corre a auditoria de segurança.
# Causa raiz de falhas anteriores:
#  1. O shell pode ter DATABASE_URL=file: (stub da plataforma) que sobrepõe o .env → exportamos do .env.
#  2. Os valores do .env vêm entre aspas → normalizados (strip de "').
#  3. A auditoria exige build standalone em .next-sec → construído aqui se ausente/obsoleto.
# Uso: bash scripts/run-security-audit.sh [--rebuild]
set -euo pipefail
cd "$(dirname "$0")/.."

# 1) Carregar .env real (sem echo de segredos)
ENV_FILE=.env
if [ ! -f "$ENV_FILE" ]; then echo "❌ .env ausente — corre node scripts/verify-uploads.js"; exit 1; fi
export DATABASE_URL=$(grep -E '^DATABASE_URL=' $ENV_FILE | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')
export JWT_SECRET=$(grep -E '^JWT_SECRET=' $ENV_FILE | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')
export NEXT_TELEMETRY_DISABLED=1

# 2) Build standalone em .next-sec (se necessário)
if [ ! -f .next-sec/standalone/server.js ] || [ "$1" == "--rebuild" ]; then
  echo "🏗️  Building produção standalone em .next-sec …"
  rm -rf .next-sec
  NEXT_DIST_DIR=.next-sec npx next build
  cp -r .next-sec/static .next-sec/standalone/.next/
  cp -r public .next-sec/standalone/
fi

# 3) Correr auditoria
exec node scripts/security-audit.js
