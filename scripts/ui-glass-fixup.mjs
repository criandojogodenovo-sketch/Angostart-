#!/usr/bin/env node
/**
 * Corrige desvios de tonalidade do codemod (colisões de substring):
 * pares -/+ do `git diff -U0` — só linhas cujo original tinha o token esmeralda.
 *   bg-emerald-500        → bg-blue-500  ⇒ bg-blue-600
 *   hover:bg-emerald-500  → hover:bg-blue-500 ⇒ hover:bg-blue-600
 *   hover:bg-emerald-600  → hover:bg-blue-600 ⇒ hover:bg-blue-700
 *   text-emerald-500      → text-blue-500 ⇒ text-blue-600
 *   hover:text-emerald-600→ hover:text-blue-600 ⇒ hover:text-blue-700
 *   hover:text-emerald-500→ hover:text-blue-500 ⇒ hover:text-blue-600
 */
import { execSync } from 'child_process';
import fs from 'fs';

const files = execSync('git diff --name-only -U0', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.startsWith('src/'));
const FIXES = [
  ['bg-emerald-500/', null], // sólidos com alpha já corretos — ignorar (sentinela)
  ['bg-emerald-500', [['bg-blue-500', 'bg-blue-600']]],
  ['hover:bg-emerald-500', [['hover:bg-blue-500', 'hover:bg-blue-600']]],
  ['hover:bg-emerald-600', [['hover:bg-blue-600', 'hover:bg-blue-700']]],
  ['text-emerald-500', [['text-blue-500', 'text-blue-600']]],
  ['hover:text-emerald-500', [['hover:text-blue-500', 'hover:text-blue-600']]],
  ['hover:text-emerald-600', [['hover:text-blue-600', 'hover:text-blue-700']]],
];

let fixes = 0;
for (const file of files) {
  const diff = execSync(`git diff -U0 -- "${file}"`, { encoding: 'utf8' });
  const lines = diff.split('\n');
  const out = [];
  let i = 0;
  // constrói mapa linha→conteúdo novo
  const result = fs.readFileSync(file, 'utf8').split('\n');
  while (i < lines.length) {
    if (lines[i].startsWith('@@')) {
      // hunk: recolhe pares -/+
      const pairs = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith('@@')) {
        if (lines[j].startsWith('-')) pairs.push(['-', lines[j].slice(1)]);
        else if (lines[j].startsWith('+')) pairs.push(['+', lines[j].slice(1)]);
        j++;
      }
      // emenda pares 1:1 (- seguido de + na mesma quantidade)
      const minus = pairs.filter((p) => p[0] === '-');
      const plus = pairs.filter((p) => p[0] === '+');
      if (minus.length === plus.length) {
        for (let k = 0; k < plus.length; k++) {
          const oldLine = minus[k][1];
          let newLine = plus[k][1];
          for (const [token, subs] of FIXES) {
            if (!subs) continue;
            if (oldLine.includes(token)) {
              for (const [from, to] of subs) {
                if (newLine.includes(from)) {
                  newLine = newLine.split(from).join(to);
                  fixes++;
                }
              }
            }
          }
          pairs.push(['NEW', k, newLine]); // guarda
        }
        // substitui no ficheiro: as linhas + deste hunk, por ordem
        // localiza números de linha do hunk
        const m = lines[i].match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (m) {
          const start = parseInt(m[1], 10) - 1;
          let idx = 0;
          for (let k = 0; k < pairs.length && idx < plus.length; k++) {
            if (pairs[k][0] === '+') {
              const newLine = pairs.find((p) => p[0] === 'NEW' && p[1] === idx);
              if (newLine) result[start + idx] = newLine[2];
              idx++;
            }
          }
        }
      }
      i = j;
    } else i++;
  }
  fs.writeFileSync(file, result.join('\n'));
}
console.log(`✅ ${fixes} correções de tonalidade aplicadas`);
