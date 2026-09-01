#!/usr/bin/env bash
# Fase 16 — converte o painel do vendedor para Dark Premium (#0B1120).
# Substituições determinísticas de classes Tailwind (sem tocar em lógica).
set -e
F="src/app/dashboard/vendedor/page.tsx"

sed -i \
  -e 's|bg-emerald-50 text-emerald-600|bg-emerald-500/15 text-emerald-400|g' \
  -e 's|bg-sky-50 text-sky-600|bg-sky-500/15 text-sky-400|g' \
  -e 's|bg-teal-50 text-teal-600|bg-teal-500/15 text-teal-400|g' \
  -e 's|bg-amber-50 text-amber-600|bg-amber-500/15 text-amber-400|g' \
  -e 's|bg-violet-50 text-violet-600|bg-violet-500/15 text-violet-400|g' \
  -e 's|bg-amber-100 text-amber-700|bg-amber-500/20 text-amber-300|g' \
  -e 's|bg-emerald-100 text-emerald-700|bg-emerald-500/20 text-emerald-300|g' \
  -e 's|bg-rose-100 text-rose-700|bg-rose-500/20 text-rose-300|g' \
  -e 's|border-slate-200 bg-white|border-slate-700/60 bg-slate-800/50 backdrop-blur|g' \
  -e 's|border-orange-200 bg-white text-orange-600|border-orange-500/40 bg-slate-800/80 text-orange-400|g' \
  -e 's|hover:bg-orange-50|hover:bg-orange-500/10|g' \
  -e 's|hover:bg-slate-50|hover:bg-slate-700/40|g' \
  -e 's|bg-slate-50|bg-slate-900/40|g' \
  -e 's|bg-slate-100|bg-slate-700/40|g' \
  -e 's|border-slate-100|border-slate-700/50|g' \
  -e 's|border-slate-300|border-slate-600|g' \
  -e 's|via-white to-white|via-slate-800/50 to-slate-800/50|g' \
  -e 's|text-amber-300|text-amber-400|g' \
  -e 's|text-amber-900|text-amber-200|g' \
  -e 's|text-amber-800|text-amber-300|g' \
  -e 's|text-rose-300|text-rose-400|g' \
  -e 's|text-rose-800|text-rose-200|g' \
  -e 's|text-rose-700|text-rose-300|g' \
  -e 's|border-amber-300 bg-amber-50|border-amber-500/40 bg-amber-500/10|g' \
  -e 's|border-rose-300 bg-rose-50|border-rose-500/40 bg-rose-500/10|g' \
  -e 's|bg-rose-100|bg-rose-500/15|g' \
  -e 's|border-emerald-200 bg-emerald-50|border-emerald-500/30 bg-emerald-500/10|g' \
  -e 's|text-emerald-900|text-emerald-200|g' \
  -e 's|text-emerald-800/70|text-emerald-300/80|g' \
  -e 's|text-emerald-800|text-emerald-300|g' \
  -e 's|border-amber-200 bg-amber-50|border-amber-500/30 bg-amber-500/10|g' \
  -e 's|text-amber-700|text-amber-300|g' \
  -e 's|text-amber-600|text-amber-400|g' \
  -e 's|hover:bg-amber-100|hover:bg-amber-500/20|g' \
  -e 's|hover:bg-amber-50|hover:bg-amber-500/10|g' \
  -e 's|border-amber-200|border-amber-500/30|g' \
  -e 's|bg-amber-50|bg-amber-500/10|g' \
  -e 's|border-emerald-500 text-emerald-600 hover:bg-emerald-50|border-blue-500/60 text-blue-400 hover:bg-blue-500/10|g' \
  -e 's|from-emerald-500 to-teal-600|from-blue-600 to-teal-500|g' \
  -e 's|text-emerald-100|text-blue-100|g' \
  -e 's|text-emerald-700|text-blue-700|g' \
  -e 's|hover:bg-emerald-50|hover:bg-blue-50|g' \
  -e 's|text-emerald-500|text-emerald-400|g' \
  -e 's|text-emerald-600|text-emerald-400|g' \
  -e 's|bg-slate-900 px-3|bg-blue-600 px-3|g' \
  -e 's|text-slate-900|text-slate-100|g' \
  -e 's|text-slate-700|text-slate-200|g' \
  -e 's|text-slate-600|text-slate-300|g' \
  -e 's|text-slate-500|text-slate-400|g' \
  -e 's|stroke="#e2e8f0"|stroke="#334155"|g' \
  -e "s|fill: '#64748b'|fill: '#94a3b8'|g" \
  -e 's|fill="#10b981"|fill="#3b82f6"|g' \
  -e "s|borderRadius: 12, borderColor: '#e2e8f0', fontSize: 13|borderRadius: 12, borderColor: '#334155', backgroundColor: '#1e293b', color: '#e2e8f0', fontSize: 13|g" \
  -e "s|const PIE_COLORS = \['#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444'\];|const PIE_COLORS = ['#3b82f6', '#14b8a6', '#10b981', '#f59e0b', '#8b5cf6'];|g" \
  -e "s|wrapperStyle={{ fontSize: 12 }}|wrapperStyle={{ fontSize: 12, color: '#94a3b8' }}|g" \
  -e 's|border-slate-200|border-slate-700/60|g' \
  -e 's|border-emerald-200|border-emerald-500/30|g' \
  -e 's|bg-emerald-50|bg-emerald-500/10|g' \
  "$F"

echo "OK — vendor dashboard convertido para Dark Premium"
