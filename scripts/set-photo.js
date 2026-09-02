#!/usr/bin/env node
/* set-photo.js — define profile_image de um utilizador de teste (E2E browser). */
const fs = require('fs');
const path = require('path');
let url = process.env.DATABASE_URL || '';
if (!url.startsWith('postgresql')) {
  const m = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m);
  url = (m?.[1] || '').replace(/^["']|["']$/g, '');
}
const { neon } = require('@neondatabase/serverless');
const sql = neon(url);
const email = process.argv[2];
const photo = `/api/media/perfil/99999/${Date.now()}-browser.jpg`;
sql`UPDATE users SET profile_image = ${photo} WHERE email = ${email} RETURNING id, profile_image`
  .then((r) => { console.log(JSON.stringify(r[0])); })
  .catch((e) => { console.error('ERRO', e.message); process.exit(1); });
