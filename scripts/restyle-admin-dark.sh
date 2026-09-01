#!/usr/bin/env bash
# Fase 16 — converte o painel admin para Dark Premium (#0B1120).
# Seds com fronteira [^0-9] nos genéricos para nunca reprocessar
# resultados de substituições anteriores.
set -e
F="src/app/admin/page.tsx"

sed -i \
  -e 's|border-slate-200 bg-white|border-slate-700/60 bg-slate-800/50 backdrop-blur|g' \
  -e "s|text-\[11px\] font-bold text-slate-900|text-[11px] font-bold text-slate-950|g" \
  -e 's|bg-slate-900 text-white|bg-blue-600 text-white|g' \
  -e 's|hover:bg-slate-50|hover:bg-slate-700/40|g' \
  -e 's|hover:bg-slate-200|hover:bg-slate-600|g' \
  -e 's|hover:bg-emerald-50|hover:bg-emerald-500/10|g' \
  -e 's|hover:bg-rose-50|hover:bg-rose-500/10|g' \
  -e 's|hover:bg-sky-50|hover:bg-sky-500/10|g' \
  -e 's|bg-slate-900 font-semibold text-white hover:bg-slate-800|bg-blue-600 font-semibold text-white hover:bg-blue-700|g' \
  -e 's|bg-slate-100\([^0-9]\)|bg-slate-700/40\1|g' \
  -e 's|bg-slate-200\([^0-9]\)|bg-slate-700/60\1|g' \
  -e 's|bg-slate-50\([^0-9]\)|bg-slate-900/40\1|g' \
  -e 's|bg-rose-50\([^0-9]\)|bg-rose-500/10\1|g' \
  -e 's|bg-rose-100\([^0-9]\)|bg-rose-500/20\1|g' \
  -e 's|bg-emerald-50\([^0-9]\)|bg-emerald-500/10\1|g' \
  -e 's|bg-emerald-100\([^0-9]\)|bg-emerald-500/20\1|g' \
  -e 's|bg-amber-50\([^0-9]\)|bg-amber-500/10\1|g' \
  -e 's|bg-amber-100\([^0-9]\)|bg-amber-500/20\1|g' \
  -e 's|bg-sky-50\([^0-9]\)|bg-sky-500/10\1|g' \
  -e 's|bg-sky-100\([^0-9]\)|bg-sky-500/20\1|g' \
  -e 's|bg-violet-100\([^0-9]\)|bg-violet-500/20\1|g' \
  -e 's|text-slate-900|text-slate-100|g' \
  -e 's|text-slate-800|text-slate-200|g' \
  -e 's|text-slate-700|text-slate-200|g' \
  -e 's|text-emerald-700|text-emerald-300|g' \
  -e 's|text-amber-700|text-amber-300|g' \
  -e 's|text-sky-700|text-sky-300|g' \
  -e 's|text-violet-700|text-violet-300|g' \
  -e 's|text-rose-700|text-rose-300|g' \
  -e 's|border-slate-200|border-slate-700/60|g' \
  -e 's|border-slate-100|border-slate-700/50|g' \
  -e 's|border-slate-300|border-slate-600|g' \
  -e 's|border-rose-300|border-rose-500/40|g' \
  -e 's|border-emerald-300|border-emerald-500/40|g' \
  -e 's|border-sky-300|border-sky-500/40|g' \
  -e 's|border-amber-300|border-amber-500/40|g' \
  -e 's|stroke="#e2e8f0"|stroke="#334155"|g' \
  -e 's|fill="#10b981"|fill="#3b82f6"|g' \
  -e 's|stroke="#0f172a"|stroke="#3b82f6"|g' \
  -e "s|dot={{ r: 3, fill: '#10b981' }}|dot={{ r: 3, fill: '#14b8a6' }}|g" \
  -e 's|contentStyle={{ borderRadius: 12, fontSize: 12 }}|contentStyle={{ borderRadius: 12, fontSize: 12, backgroundColor: "#1e293b", border: "1px solid #334155", color: "#e2e8f0" }}|g' \
  "$F"

echo "OK — admin convertido para Dark Premium"
