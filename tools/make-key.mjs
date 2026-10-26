// ERP 인증키 · 암호화된 ERP 안내 관리 (배포하는 사람만 씁니다)
//
//   처음 한 번 (관리자 키 만들기 + 안내 잠그기):
//     node tools/make-key.mjs 초기화 "내이름" --guide <안내.json> --admin-key-file <관리자키를 저장할 파일>
//   받는 사람 키 발급:
//     node tools/make-key.mjs 발급 "홍길동(가나회계)" --admin-key-file <관리자키 파일>
//   안내 고치기 (풀기 → 고친 뒤 다시 잠그기):
//     node tools/make-key.mjs 안내풀기 --admin-key-file <관리자키 파일> --guide <내보낼 안내.json>
//     node tools/make-key.mjs 안내잠그기 --admin-key-file <관리자키 파일> --guide <안내.json>
//   목록 · 폐기:
//     node tools/make-key.mjs 목록
//     node tools/make-key.mjs 폐기 "홍길동(가나회계)"
//
// - 키 원문은 발급할 때 한 번만 나옵니다. 저장소에는 해시와 감싼 내용 키만 남습니다.
// - 안내 원문(.json)과 관리자 키 파일은 저장소 밖에 두세요. 공개 저장소에 올리면 잠근 의미가 없습니다.
// - 발급 · 폐기 · 안내 수정 후에는 새 버전을 배포해야 받는 사람에게 반영됩니다.
//   폐기한 사람이 예전 판을 갖고 있으면 그 판의 안내는 계속 열 수 있습니다(회수 불가).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadKeys, saveKeys, makeKey, hashKey, wrapFor, unlock, readGuide, writeGuide } from '../lib/keys.mjs';

const args = process.argv.slice(2);
const cmd = args[0];
const label = args[1] && !args[1].startsWith('--') ? args[1] : '';
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };
const die = (msg) => { console.error(`\n[오류] ${msg}\n`); process.exit(1); };
const keyFromFile = (file) => {
  if (!file || !fs.existsSync(file)) die('--admin-key-file 로 관리자 키 파일을 지정하세요.');
  const m = fs.readFileSync(file, 'utf8').match(/SMK-[A-Z0-9-]{19}/);
  if (!m) die('관리자 키 파일에서 SMK- 로 시작하는 키를 찾지 못했습니다.');
  return m[0];
};
const adminContentKey = () => {
  const u = unlock(keyFromFile(opt('--admin-key-file')));
  if (!u?.contentKey) die('관리자 키가 맞지 않거나, 안내를 열 수 있는 키가 아닙니다. 먼저 "초기화" 를 하세요.');
  return u.contentKey;
};
const readJson = (file) => { if (!file || !fs.existsSync(file)) die('--guide 로 안내 JSON 파일을 지정하세요.'); return JSON.parse(fs.readFileSync(file, 'utf8')); };
const today = () => new Date().toISOString().slice(0, 10);

if (cmd === '초기화') {
  if (!label) die('관리자 이름을 적으세요.');
  const guide = readJson(opt('--guide'));
  const keyFile = opt('--admin-key-file');
  if (!keyFile) die('--admin-key-file 로 관리자 키를 저장할 파일을 지정하세요(저장소 밖).');
  // 기존 관리자 키 파일이 있으면 그 키를 그대로 쓰고, 없으면 새로 만든다.
  const adminKey = fs.existsSync(keyFile) ? keyFromFile(keyFile) : makeKey();
  const contentKey = crypto.randomBytes(32);
  // 내용 키를 새로 만들었으므로, 예전 내용 키로 감싼 다른 키는 더 이상 안내를 못 연다 → 다시 발급해야 한다.
  const keys = loadKeys().filter((k) => k.hash !== hashKey(adminKey)).map((k) => ({ ...k, salt: undefined, wrapped: undefined }));
  keys.push({ label, hash: hashKey(adminKey), issued: today(), admin: true, ...wrapFor(adminKey, contentKey) });
  saveKeys(keys);
  writeGuide(contentKey, guide);
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(path.dirname(path.resolve(keyFile)), { recursive: true });
    fs.writeFileSync(keyFile, `관리자 인증키 (${label}) — 남에게 주지 마세요\n${adminKey}\n`);
  }
  const others = keys.filter((k) => !k.admin && !k.revoked).length;
  console.log(`초기화 완료. 관리자 키는 ${keyFile} 에 있습니다. 안내를 잠갔습니다.${others ? ` 다른 키 ${others}개는 안내를 못 열므로 다시 발급하세요.` : ''}`);
} else if (cmd === '발급') {
  if (!label) die('받는 사람 이름을 적으세요: node tools/make-key.mjs 발급 "홍길동" --admin-key-file <파일>');
  const contentKey = adminContentKey();
  const key = makeKey();
  const keys = loadKeys();
  keys.push({ label, hash: hashKey(key), issued: today(), ...wrapFor(key, contentKey) });
  saveKeys(keys);
  console.log(`\n발급 완료 — ${label}\n인증키: ${key}\n(이 키는 다시 볼 수 없습니다. 지금 받는 사람에게 따로 전달하세요.)\n`);
} else if (cmd === '안내풀기') {
  const out = opt('--guide'); if (!out) die('--guide 로 내보낼 파일을 지정하세요(저장소 밖).');
  fs.writeFileSync(out, JSON.stringify(readGuide(adminContentKey()), null, 2) + '\n');
  console.log(`안내를 풀어 ${out} 에 저장했습니다. 고친 뒤 "안내잠그기" 를 하세요.`);
} else if (cmd === '안내잠그기') {
  writeGuide(adminContentKey(), readJson(opt('--guide')));
  console.log('안내를 다시 잠갔습니다. 새 버전을 배포하면 반영됩니다.');
} else if (cmd === '폐기') {
  const keys = loadKeys();
  const hit = keys.filter((k) => k.label === label && !k.revoked);
  if (!hit.length) die(`"${label}" 이름의 사용 중인 키가 없습니다.`);
  hit.forEach((k) => { k.revoked = today(); delete k.wrapped; delete k.salt; });
  saveKeys(keys);
  console.log(`폐기 완료 — ${label} (${hit.length}개). 새 버전을 배포하면 반영됩니다.`);
} else if (cmd === '목록') {
  const keys = loadKeys();
  if (!keys.length) console.log('발급된 키가 없습니다.');
  for (const k of keys) console.log(`${k.revoked ? '[폐기]' : k.wrapped ? '[사용]' : '[안내X]'} ${k.label}${k.admin ? ' (관리자)' : ''} · 발급 ${k.issued}${k.revoked ? ` · 폐기 ${k.revoked}` : ''}`);
} else {
  console.log('사용법은 tools/make-key.mjs 맨 위 설명을 보세요. (초기화 · 발급 · 안내풀기 · 안내잠그기 · 목록 · 폐기)');
}
