// ERP 자료 수집 기능의 "앱 인증키"와 암호화된 ERP 안내.
//
// - config/erp-keys.json : 키마다 { label, hash(SHA-256), salt, wrapped } — 키 원문은 저장하지 않는다.
// - config/erp-guide.enc : ERP 접속 주소 · 메뉴 · 작업지시 · 화면 인식 규칙(안내)을 AES-256-GCM 으로 암호화한 것.
//   안내를 여는 "내용 키"는 키마다 scrypt(인증키) 로 감싸(wrapped) 두므로, 올바른 인증키로 로그인해야만 안내가 풀린다.
//
// 공개 저장소에 올라가는 것은 해시 · 암호문뿐이다. 다만 앱 코드를 고치면 "기능 잠금"은 우회할 수 있으므로,
// ERP 자료 자체의 보안은 ERP 계정(회사아이디 · 비밀번호)과 권한으로 지켜야 한다.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const configDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config');
export const KEYS_FILE = path.join(configDir, 'erp-keys.json');
export const GUIDE_FILE = path.join(configDir, 'erp-guide.enc');

export const normalizeKey = (k) => String(k ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashKey = (k) => crypto.createHash('sha256').update(normalizeKey(k)).digest('hex');

export function loadKeys() {
  try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')).keys || []; } catch { return []; }
}
export function saveKeys(keys) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(KEYS_FILE, JSON.stringify({ note: '키 원문이 아니라 해시와 감싼 내용 키입니다. tools/make-key.mjs 로 관리하세요.', keys }, null, 2) + '\n');
}

/* ---------------------------------------------------------- 암호 도구 */
const kek = (key, salt) => crypto.scryptSync(normalizeKey(key), Buffer.from(salt, 'hex'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function seal(keyBuf, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return { iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: data.toString('base64') };
}
function open(keyBuf, box) {
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(box.iv, 'hex'));
  d.setAuthTag(Buffer.from(box.tag, 'hex'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
}

// 내용 키를 이 인증키로 감싼다
export function wrapFor(key, contentKey) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, wrapped: seal(kek(key, salt), contentKey) };
}

// 인증키 확인 + 내용 키 풀기. 맞지 않으면 null.
export function unlock(key) {
  const h = hashKey(key);
  const hit = loadKeys().find((k) => k.hash === h && !k.revoked);
  if (!hit) return null;
  if (!hit.wrapped) return { label: hit.label, contentKey: null }; // 안내 없이 발급된 예전 키
  try { return { label: hit.label, contentKey: open(kek(key, hit.salt), hit.wrapped) }; } catch { return null; }
}

export function readGuide(contentKey) {
  if (!contentKey || !fs.existsSync(GUIDE_FILE)) return null;
  return JSON.parse(open(contentKey, JSON.parse(fs.readFileSync(GUIDE_FILE, 'utf8'))).toString('utf8'));
}
export function writeGuide(contentKey, guide) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(GUIDE_FILE, JSON.stringify(seal(contentKey, Buffer.from(JSON.stringify(guide), 'utf8'))) + '\n');
}

// 사람이 읽고 옮겨 적기 쉬운 형식: SMK-XXXX-XXXX-XXXX-XXXX (헷갈리는 0 O 1 I 제외)
export function makeKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = [...crypto.randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join('');
  return `SMK-${chars.match(/.{4}/g).join('-')}`;
}
