// 은행 · 카드 · 홈택스 · ERP 에서 내려받은 파일을 읽어 표준 행으로 바꾼다.
// 외부 패키지 없이 .xlsx(zip+xml) · .csv · "엑셀인 척하는 HTML(.xls)" 을 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ------------------------------------------------------------- 파일 → 표 */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('엑셀(xlsx) 구조를 읽지 못했습니다.');
  const files = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xmlText = (s) => s.replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  if (files.has('xl/sharedStrings.xml')) {
    for (const si of files.get('xl/sharedStrings.xml')().match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(xmlText).join(''));
    }
  }
  const sheetName = files.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml'
    : [...files.keys()].find((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k));
  if (!sheetName) throw new Error('엑셀 안에서 시트를 찾지 못했습니다.');
  const rows = [];
  for (const row of files.get(sheetName)().match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const cells = [];
    for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = (c.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const type = (c.match(/\bt="(\w+)"/) || [])[1];
      let v = '';
      if (type === 'inlineStr') v = xmlText((c.match(/<is>([\s\S]*?)<\/is>/) || ['', ''])[1]);
      else {
        const raw = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (raw != null) v = type === 's' ? shared[Number(raw)] ?? '' : xmlText(raw);
      }
      cells[ref ? colIndex(ref) : cells.length] = v;
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}

function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buf); }
}

function readHtmlTable(text) {
  // 은행이 주는 ".xls" 는 대개 HTML 표다. 가장 행이 많은 표를 쓴다.
  const tables = text.match(/<table[\s\S]*?<\/table>/gi) || [text];
  let best = [];
  for (const t of tables) {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) =>
      (tr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map((td) => xmlText(td.replace(/<br\s*\/?>/gi, ' ')).replace(/&nbsp;/g, ' ').trim()));
    if (rows.length > best.length) best = rows;
  }
  return best;
}

function readCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function readTable(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf); // zip = xlsx
  if (buf.readUInt32LE(0) === 0xe011cfd0) {
    throw new Error('예전 엑셀(.xls) 형식입니다. 엑셀에서 열어 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)" 로 저장한 뒤 다시 넣어 주세요.');
  }
  const text = decode(buf);
  if (/<table|<tr/i.test(text.slice(0, 20000))) return readHtmlTable(text);
  if (['.csv', '.txt', '.tsv'].includes(ext) || text.includes(',')) return readCsv(text);
  throw new Error('읽을 수 없는 파일 형식입니다(xlsx · csv · 은행 엑셀만 가능).');
}

/* ------------------------------------------------------- 표 → 자료 종류 */
const clean = (s) => String(s ?? '').replace(/\s+/g, '');

// 머리줄 낱말로 자료 종류를 알아본다. 파일 이름 힌트도 함께 본다.
export const SOURCES = {
  계좌: { need: [/출금|찾으신|지급금액|출금액/, /입금|맡기신|입금액/], hint: /거래내역|통장|계좌|입출금|은행/ },
  카드: { need: [/가맹점|이용처|사용처/, /이용금액|승인금액|매출금액|이용액|결제금액|사용금액/], not: /공급가액/, hint: /카드|승인내역|이용내역/ },
  사업용카드: { need: [/가맹점/, /공급가액/, /세액|부가세/], hint: /사업용.?카드|홈택스.*카드/ },
  세금계산서: { need: [/승인번호/, /공급가액/, /세액/, /상호|공급자|공급받는자|거래처/], not: /가맹점/, hint: /세금계산서|계산서/ },
  현금영수증: { need: [/가맹점|상호|사업자/, /공급가액|금액/, /부가세|세액/], hint: /현금영수증/ },
};

function findHeader(rows) {
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const words = rows[i].map(clean).filter(Boolean);
    if (words.length < 3) continue;
    const score = words.filter((w) => /일자|일시|날짜|금액|가맹점|적요|내용|입금|출금|잔액|승인|공급|세액|상호|거래처|계정|차변|대변|품목|수량|단가|사업자/.test(w)).length;
    if (score > best.score) best = { idx: i, score };
  }
  return best.idx;
}

export function detectSource(header, fileName) {
  const h = header.map(clean).join('|');
  const scores = Object.entries(SOURCES).map(([kind, s]) => {
    const hits = s.need.filter((re) => re.test(h)).length;
    let score = hits === s.need.length ? 10 + hits : 0;
    if (s.not && s.not.test(h)) score -= 20;
    if (s.hint.test(fileName)) score += 5;
    return [kind, score];
  }).sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : null;
}

/* ------------------------------------------------------- 값 다듬기 */
export function toNumber(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/[,원\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function toDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) { // 엑셀 날짜 일련번호
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = s.match(/(\d{4})\s*[.\-/년]?\s*(\d{1,2})\s*[.\-/월]?\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
}

const mask = (s) => {
  const t = String(s ?? '').trim();
  if (!t) return '';
  const digits = t.replace(/\D/g, '');
  return digits.length >= 8 ? `${t.slice(0, 4)}****${digits.slice(-4)}` : t;
};

function pick(header, re) {
  const i = header.findIndex((h) => re.test(clean(h)));
  return i;
}

// 여러 후보를 우선순위대로 시도한다. "번호" · "코드" 칸은 이름 칸으로 보지 않는다.
function firstOf(header, list) {
  for (const re of list) {
    const i = header.findIndex((h) => re.test(clean(h)) && !/번호|코드/.test(clean(h)));
    if (i >= 0) return i;
  }
  return -1;
}

/* ------------------------------------------------------- 표 → 표준 행 */
export function normalize(rows, kind, fileName) {
  const hi = findHeader(rows);
  const header = rows[hi] || [];
  const body = rows.slice(hi + 1).filter((r) => r.some((c) => String(c).trim()));
  const col = (re) => pick(header, re);
  const get = (r, i) => (i >= 0 ? r[i] ?? '' : '');
  const out = [];
  const dir = /매출/.test(fileName) ? '매출' : /매입/.test(fileName) ? '매입' : '';

  const C = {
    date: col(/거래일시|거래일자|이용일자|이용일시|승인일자|승인일시|매출일자|작성일자|발급일자|거래일|이용일|일자|날짜/),
    time: col(/^거래시간$|^시간$|승인시간/),
    memo: col(/적요|거래내용|비고|품목|^내용$/),
    // 거래처는 "이름" 칸을 우선한다(가맹점사업자번호 · 거래처코드 같은 번호 칸을 잡지 않게).
    who: firstOf(header, [/가맹점명/, /상호/, /거래처명/, /이용처|사용처/, /기재내용|받는분|보낸분|입금자|의뢰인|입금인/, /^가맹점$/, /^거래처$/]),
    out: col(/출금액|출금|찾으신|지급금액/),
    in: col(/입금액|입금|맡기신/),
    bal: col(/잔액|거래후잔액/),
    amt: col(/이용금액|승인금액|매출금액|이용액|결제금액|사용금액|합계금액|합계|금액/),
    supply: col(/공급가액/),
    vat: col(/^세액$|부가세|부가가치세|세액/),
    total: col(/합계금액|합계|총금액/),
    no: col(/승인번호/),
    card: col(/카드번호|카드명/),
    status: col(/취소|승인구분|상태|구분/),
    bizno: col(/사업자등록번호|사업자번호|공급받는자등록번호|공급자등록번호/),
  };
  // 세금계산서 목록은 "상호"·"등록번호" 가 공급자 · 공급받는자 두 번 나온다. 매출이면 상대방은 공급받는자(두 번째)다.
  if (kind === '세금계산서' && dir === '매출') {
    const second = (re) => header.map((h, i) => (re.test(clean(h)) ? i : -1)).filter((i) => i >= 0)[1];
    C.who = second(/상호/) ?? C.who;
    C.bizno = second(/등록번호|사업자/) ?? C.bizno;
  }

  for (const r of body) {
    const date = toDate(get(r, C.date));
    if (!date) continue; // 합계줄 · 안내문 줄은 날짜가 없다
    const status = String(get(r, C.status));
    const cancel = /취소/.test(status) ? -1 : 1;
    const row = { kind, date, counterpart: String(get(r, C.who)).trim(), memo: String(get(r, C.memo)).trim(),
      inAmt: 0, outAmt: 0, supply: 0, vat: 0, total: 0, balance: 0, approvalNo: String(get(r, C.no)).trim(),
      account: mask(get(r, C.card)), bizNo: String(get(r, C.bizno)).trim(), direction: dir, file: fileName };
    if (kind === '계좌') {
      row.inAmt = toNumber(get(r, C.in)); row.outAmt = toNumber(get(r, C.out)); row.balance = toNumber(get(r, C.bal));
      if (!row.counterpart) row.counterpart = row.memo;
      row.total = row.inAmt - row.outAmt;
      if (!row.inAmt && !row.outAmt) continue;
    } else if (kind === '카드') {
      row.outAmt = toNumber(get(r, C.amt)) * cancel; row.total = row.outAmt;
      if (!row.outAmt) continue;
    } else {
      row.supply = toNumber(get(r, C.supply)) * cancel; row.vat = toNumber(get(r, C.vat)) * cancel;
      row.total = toNumber(get(r, C.total)) * cancel || row.supply + row.vat;
      if (kind !== '세금계산서') row.outAmt = row.total;
      if (!row.total) continue;
    }
    row.key = [row.kind, row.date, row.total, row.counterpart, row.approvalNo].join('|');
    out.push(row);
  }
  return { header, rows: out };
}

/* ------------------------------------------------------------- 폴더 읽기 */
export const ACCEPT = /\.(xlsx|xls|csv|tsv|txt|html?)$/i;

export function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && ACCEPT.test(d.name) && !d.name.startsWith('~$'))
    .map((d) => {
      const full = path.join(dir, d.name);
      const st = fs.statSync(full);
      return { name: d.name, full, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function collect(dir) {
  const reports = [], all = [], seen = new Set();
  for (const f of listFiles(dir)) {
    try {
      const table = readTable(f.full);
      const hi = findHeader(table);
      const kind = hi >= 0 ? detectSource(table[hi], f.name) : null;
      if (!kind) { reports.push({ file: f.name, ok: false, error: '자료 종류를 알아보지 못했습니다(머리줄에 일자 · 금액 · 가맹점 등이 있어야 합니다).' }); continue; }
      const { rows } = normalize(table, kind, f.name);
      let dup = 0;
      for (const r of rows) { if (seen.has(r.key)) { dup++; continue; } seen.add(r.key); all.push(r); }
      reports.push({ file: f.name, ok: true, kind, count: rows.length, dup });
    } catch (e) {
      reports.push({ file: f.name, ok: false, error: e.message });
    }
  }
  all.sort((a, b) => b.date.localeCompare(a.date));
  return { reports, rows: all };
}

/* ------------------------------------------------------------- ERP 표 */
// ERP 에서 내려받은 표는 종류가 제각각이라 "어느 화면인지"만 알아보고 표는 그대로 보여 준다.
// 1순위: 파일 이름 — 화면 이름 목록은 암호화된 ERP 안내(screens)에 있고, 인증 뒤에만 넘어온다.
// 2순위: 머리줄 낱말 (일반 회계 용어만 쓴다)
const ERP_BY_HEADER = [
  ['거래처 목록', /거래처명|상호/, /사업자등록번호|대표자/],
  ['원가 집계', /현장명/, /공사금액|기성|공사비/],
  ['시산표', /계정과목|과목/, /차변.*대변|대변.*차변/],
  ['계정 원장', /계정과목|계정명|계정코드/, /차변|대변|잔액/],
  ['거래처 원장', /거래처/, /차변|대변|잔액/],
  ['전표', /전표번호|전표일자/, /차변|대변/],
  ['매입 · 매출', /매출|매입/, /공급가액|세액/],
];

// 위아래 두 줄 머리줄("공사비 내역" / "당기공사비")을 한 줄("공사비 내역 당기공사비")로 합친다.
function mergeHeader(table, hi) {
  const top = table[hi] || [], sub = table[hi + 1] || [];
  const subCells = sub.filter((c) => String(c).trim());
  const looksSub = subCells.length >= 2 && subCells.every((c) => !/^[-\d.,()\s]+$/.test(String(c)))
    && sub.some((c, i) => String(c).trim() && !String(top[i] ?? '').trim()); // 위 칸이 비어 있는(병합된) 자리에 아래 이름이 있다
  if (!looksSub) return { header: top.map((c) => String(c).trim()), start: hi + 1 };
  const width = Math.max(top.length, sub.length);
  const header = []; let group = '';
  for (let i = 0; i < width; i++) {
    const t = String(top[i] ?? '').trim(), s = String(sub[i] ?? '').trim();
    if (t) group = t;
    header.push(s ? `${t || group} ${s}`.trim() : t || group);
  }
  return { header, start: hi + 2 };
}

export function collectErp(dir, screens = []) {
  const ERP_SCREENS = screens.map(([name, src]) => [name, new RegExp(src)]);
  const out = [];
  for (const f of listFiles(dir)) {
    try {
      const table = readTable(f.full);
      const hi = Math.max(0, findHeader(table));
      const { header, start } = mergeHeader(table, hi);
      const name = clean(f.name);
      const h = header.map(clean).join('|');
      const item = (ERP_SCREENS.find(([, re]) => re.test(name))
        || ERP_BY_HEADER.find(([, a, b]) => a.test(h) && b.test(h)) || ['기타'])[0];
      const body = table.slice(start).filter((r) => r.some((c) => String(c).trim()));
      out.push({ file: f.name, ok: true, item, header, rows: body.slice(0, 5000), total: body.length });
    } catch (e) {
      out.push({ file: f.name, ok: false, error: e.message });
    }
  }
  return out;
}
