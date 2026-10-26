// 금융 자료 수집 · 정리 앱 — 로컬 서버
// Aside 가 내려받은 카드 · 계좌 · 홈택스 파일을 수집함 폴더에서 읽어 항목별로 정리하고,
// 회사 ERP 자료 기능과 그 접속 안내는 앱 인증키로 로그인해야 열어 준다. 외부 패키지 없음. 자료는 PC 밖으로 나가지 않는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect, collectErp, listFiles, ACCEPT } from './lib/parse.mjs';
import { unlock, readGuide, loadKeys } from './lib/keys.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const envFile = path.join(here, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const port = Number(process.env.PORT || 5198);
const inbox = path.resolve(here, process.env.INBOX_DIR || './수집함');
const erpInbox = path.resolve(here, process.env.ERP_INBOX_DIR || './수집함/ERP');
fs.mkdirSync(inbox, { recursive: true });
fs.mkdirSync(erpInbox, { recursive: true });

/* ------------------------------------------------- ERP 인증 (세션 · 시도 제한) */
const sessions = new Map(); // token → { label, until }
const attempts = [];        // 최근 실패 시각
const SESSION_MS = 8 * 3600 * 1000;

function erpSession(req) {
  const t = req.headers['x-erp-session'];
  const s = t && sessions.get(t);
  if (!s || s.until < Date.now()) { if (t) sessions.delete(t); return null; }
  return s;
}

/* -------------------------------------------------------------- HTTP 서버 */
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/rules.js': 'rules.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const readBody = (req, limit = 30e6) => new Promise((ok, fail) => {
  const chunks = []; let size = 0;
  req.on('data', (d) => { size += d.length; if (size > limit) { fail(new Error('파일이 너무 큽니다(30MB 초과).')); req.destroy(); } else chunks.push(d); });
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', fail);
});
const safeName = (n) => path.basename(decodeURIComponent(n || '')).replace(/[\\/:*?"<>|]/g, '_');

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/info') {
    return send(res, 200, { inbox, erpInbox, erpKeys: loadKeys().filter((k) => !k.revoked).length });
  }
  if (p === '/api/data') return send(res, 200, collect(inbox));
  if (p === '/api/files') return send(res, 200, { files: listFiles(inbox).map(({ name, size, mtime }) => ({ name, size, mtime })) });

  // 수집함에 파일 넣기 (끌어다 놓기). target=erp 는 인증된 세션만.
  if (p === '/api/upload' && req.method === 'POST') {
    const toErp = url.searchParams.get('target') === 'erp';
    if (toErp && !erpSession(req)) return send(res, 401, { error: 'ERP 인증키가 필요합니다.' });
    const name = safeName(req.headers['x-filename']);
    if (!ACCEPT.test(name)) return send(res, 400, { error: 'xlsx · xls · csv 파일만 넣을 수 있습니다.' });
    fs.writeFileSync(path.join(toErp ? erpInbox : inbox, name), await readBody(req));
    return send(res, 200, { ok: true, name });
  }

  // 수집함 폴더를 탐색기로 열기 (Windows · macOS)
  if (p === '/api/open-folder' && req.method === 'POST') {
    const toErp = url.searchParams.get('target') === 'erp';
    if (toErp && !erpSession(req)) return send(res, 401, { error: 'ERP 인증키가 필요합니다.' });
    const dir = toErp ? erpInbox : inbox;
    execFile(process.platform === 'win32' ? 'explorer' : 'open', [dir], () => {});
    return send(res, 200, { ok: true, dir });
  }

  if (p === '/api/erp/unlock' && req.method === 'POST') {
    const now = Date.now();
    while (attempts.length && attempts[0] < now - 60000) attempts.shift();
    if (attempts.length >= 5) return send(res, 429, { error: '실패가 많습니다. 1분 뒤에 다시 시도하세요.' });
    const { key } = JSON.parse((await readBody(req, 4096)).toString() || '{}');
    const ok = unlock(key);
    if (!ok) { attempts.push(now); return send(res, 401, { error: '인증키가 맞지 않거나 폐기된 키입니다.' }); }
    // 암호화된 ERP 안내(접속 주소 · 메뉴 · 작업지시)는 여기서 처음 풀린다. 세션에만 두고 디스크에 풀어 쓰지 않는다.
    let guide = null;
    try { guide = readGuide(ok.contentKey); } catch { guide = null; }
    if (!guide) { attempts.push(now); return send(res, 401, { error: '이 키로는 ERP 안내를 열 수 없습니다. 배포자에게 새 키를 받으세요.' }); }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { label: ok.label, guide, until: now + SESSION_MS });
    return send(res, 200, { token, label: ok.label });
  }
  if (p.startsWith('/api/erp/')) {
    const s = erpSession(req);
    if (!s) return send(res, 401, { error: 'ERP 인증키가 필요합니다.' });
    if (p === '/api/erp/guide') {
      const { screens, ...shown } = s.guide;
      return send(res, 200, { label: s.label, dir: erpInbox, guide: shown });
    }
    if (p === '/api/erp/data') return send(res, 200, { label: s.label, dir: erpInbox, tables: collectErp(erpInbox, s.guide.screens) });
    if (p === '/api/erp/lock' && req.method === 'POST') { sessions.delete(req.headers['x-erp-session']); return send(res, 200, { ok: true }); }
  }

  const file = STATIC[p];
  if (req.method === 'GET' && file) return send(res, 200, fs.readFileSync(path.join(here, 'public', file), 'utf8'), TYPES[path.extname(file)]);
  send(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: String(e?.message || e) }));
}).listen(port, '127.0.0.1', () => {
  console.log(`금융 자료 수집 · 정리 앱: http://localhost:${port}`);
  console.log(`수집함: ${inbox}`);
  console.log('끄려면 이 창을 닫거나 Ctrl+C');
});
