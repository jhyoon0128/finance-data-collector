// 금융 자료 수집 · 정리 화면 동작
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => (n ? Math.round(n).toLocaleString('ko-KR') : '');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dot = (s) => s.replace(/-/g, '.');

async function api(path, opt = {}) {
  const headers = { ...(opt.headers || {}) };
  const token = sessionStorage.getItem('erp');
  if (token) headers['x-erp-session'] = token;
  const r = await fetch(path, { ...opt, headers });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; throw e; }
  return j;
}

function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function copyText(text, btn) {
  navigator.clipboard?.writeText(text).then(() => { const t = btn.textContent; btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = t), 1200); });
}

/* -------------------------------------------------------------- 탭 · 테마 */
function showTab(t) {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === `view-${t}`));
  store.set('tab', t);
  if (t === 'sum') renderSum();
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
applyTheme(store.get('theme', ''));
$('#themeBtn').onclick = () => {
  const now = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = now === 'dark' ? 'light' : 'dark'; applyTheme(next); store.set('theme', next);
};

let info = { inbox: '', erpInbox: '' };
const openFolder = (target) => api(`/api/open-folder${target ? `?target=${target}` : ''}`, { method: 'POST' }).catch((e) => alert(e.message));

/* ---------------------------------------------------------- ① 수집 지시 */
function lastMonth() {
  const now = new Date();
  return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
}
const task = store.get('task', { type: 'hometax_invoice', from: lastMonth()[0], to: lastMonth()[1] });
$('#taskType').innerHTML = Object.entries(window.ASIDE_TASKS).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
$('#quickRange').innerHTML = [['지난달', 'lm'], ['이번 달', 'tm'], ['지난 분기', 'lq'], ['올해', 'ty'], ['작년', 'ly']]
  .map(([l, k]) => `<button class="btn small" data-range="${k}">${l}</button>`).join('');

function range(k) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  if (k === 'lm') return lastMonth();
  if (k === 'tm') return [iso(new Date(y, m, 1)), iso(n)];
  if (k === 'lq') { const q = Math.floor(m / 3) - 1; const qy = q < 0 ? y - 1 : y; const qs = ((q + 4) % 4) * 3; return [iso(new Date(qy, qs, 1)), iso(new Date(qy, qs + 3, 0))]; }
  if (k === 'ty') return [`${y}-01-01`, iso(n)];
  return [`${y - 1}-01-01`, `${y - 1}-12-31`];
}

function renderTask() {
  const t = window.ASIDE_TASKS[task.type];
  $('#taskType').value = task.type;
  const needsOrg = task.type === 'bank' || task.type === 'card';
  $('#orgRow').style.display = needsOrg ? '' : 'none';
  $('#orgLabel').textContent = task.type === 'bank' ? '은행 이름' : '카드사 이름';
  $('#targetLabel').textContent = task.type === 'bank' ? '계좌 (끝 4자리 · 별칭)' : '카드 (끝 4자리 · 법인/개인)';
  $('#taskOrg').placeholder = task.type === 'bank' ? '예: 기업은행' : '예: 신한카드';
  $('#taskOrg').value = task.org || ''; $('#taskTarget').value = task.target || '';
  $('#taskFrom').value = task.from; $('#taskTo').value = task.to;
  $('#taskText').value = t.build({ ...task, from: dot(task.from), to: dot(task.to), folder: info.inbox || '(수집함 폴더)' }).join('\n');
  store.set('task', task);
}
$('#favs').innerHTML = window.FAVORITES.map((f, i) => `<button class="btn small" data-fav="${i}">${esc(f.label)}</button>`).join('');
$('#favs').onclick = (e) => {
  const b = e.target.closest('[data-fav]'); if (!b) return;
  const f = window.FAVORITES[Number(b.dataset.fav)];
  Object.assign(task, { type: f.type, org: f.org, url: f.url, note: f.note || '' });
  renderTask();
};
// 직접 고르거나 기관 이름을 고치면 바로가기의 주소 · 안내는 떼어 낸다
$('#taskType').onchange = (e) => { Object.assign(task, { type: e.target.value, url: '', note: '' }); renderTask(); };
$('#taskOrg').oninput = (e) => { Object.assign(task, { org: e.target.value, url: '', note: '' }); renderTask(); };
for (const [id, k] of [['#taskTarget', 'target'], ['#taskFrom', 'from'], ['#taskTo', 'to']]) $(id).oninput = (e) => { task[k] = e.target.value; renderTask(); };
$('#quickRange').onclick = (e) => { const b = e.target.closest('[data-range]'); if (!b) return; [task.from, task.to] = range(b.dataset.range); renderTask(); };
$('#copyTask').onclick = () => copyText($('#taskText').value, $('#copyTask'));
$('#openInbox').onclick = () => openFolder();
$('#openInbox2').onclick = () => openFolder();

/* ---------------------------------------------------------- ② 자료 정리 */
let data = { rows: [], reports: [] };
const overrides = store.get('catOverrides', {});
const KINDS = ['계좌', '카드', '사업용카드', '현금영수증', '세금계산서'];

function categoryOf(row) {
  if (overrides[row.key]) return overrides[row.key];
  const text = `${row.counterpart} ${row.memo}`;
  const hit = window.CATEGORY_RULES.find(([, re]) => re.test(text));
  if (row.kind === '세금계산서') return window.DEFAULT_CATEGORY(row);
  return hit ? hit[0] : window.DEFAULT_CATEGORY(row);
}
const allCats = () => [...new Set([...window.CATEGORY_RULES.map(([c]) => c), '입금 · 매출 회수', '매출 (세금계산서)', '매입 (세금계산서)', '미분류'])];

async function load() {
  $('#loadMsg').textContent = '읽는 중…';
  try {
    data = await api('/api/data');
    data.rows.forEach((r) => (r.cat = categoryOf(r)));
    const ok = data.reports.filter((r) => r.ok);
    $('#loadMsg').textContent = `파일 ${data.reports.length}개 · 거래 ${data.rows.length.toLocaleString()}건`;
    $('#reports').innerHTML = data.reports.length ? `<ul class="rep">${data.reports.map((r) => r.ok
      ? `<li>✓ ${esc(r.file)} — <span class="kind">${esc(r.kind)}</span> ${r.count}건${r.dup ? ` (중복 ${r.dup}건 제외)` : ''}</li>`
      : `<li class="bad">✕ ${esc(r.file)} — ${esc(r.error)}</li>`).join('')}</ul>`
      : '<p class="muted">수집함이 비어 있습니다. ① 수집 지시로 Aside 를 돌리거나 파일을 끌어다 놓으세요.</p>';
    if (!ok.length && data.reports.length) $('#loadMsg').textContent += ' — 읽은 파일이 없습니다';
    fillFilters(); renderRows();
  } catch (e) { $('#loadMsg').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}
$('#reload').onclick = load;

function fillFilters() {
  const keep = (id) => $(id).value;
  const opts = (id, list, all) => { const v = keep(id); $(id).innerHTML = `<option value="">${all}</option>` + list.map((x) => `<option>${esc(x)}</option>`).join(''); if (list.includes(v)) $(id).value = v; };
  opts('#fKind', KINDS.filter((k) => data.rows.some((r) => r.kind === k)), '전체 종류');
  opts('#fCat', allCats(), '전체 항목');
  opts('#fMonth', [...new Set(data.rows.map((r) => r.date.slice(0, 7)))].sort().reverse(), '전체 월');
}
const filtered = () => {
  const k = $('#fKind').value, c = $('#fCat').value, m = $('#fMonth').value, t = $('#fText').value.trim();
  return data.rows.filter((r) => (!k || r.kind === k) && (!c || r.cat === c) && (!m || r.date.startsWith(m)) && (!t || `${r.counterpart} ${r.memo}`.includes(t)));
};
['#fKind', '#fCat', '#fMonth'].forEach((id) => ($(id).onchange = renderRows));
$('#fText').oninput = renderRows;

function renderRows() {
  const rows = filtered();
  const cats = allCats();
  const shown = rows.slice(0, 1500);
  const sumIn = rows.reduce((n, r) => n + r.inAmt, 0), sumOut = rows.reduce((n, r) => n + r.outAmt, 0);
  $('#fCount').textContent = `${rows.length.toLocaleString()}건 · 들어온 돈 ${won(sumIn) || 0}원 · 나간 돈 ${won(sumOut) || 0}원${rows.length > shown.length ? ' (화면에는 1,500건까지)' : ''}`;
  $('#rowsTable').innerHTML = `<tr><th>일자</th><th>종류</th><th>거래처</th><th>적요 · 품목</th><th class="num">들어온 돈</th><th class="num">나간 돈</th><th class="num">공급가액</th><th class="num">세액</th><th>항목</th><th>계좌 · 카드</th><th>파일</th></tr>` +
    shown.map((r, i) => `<tr><td>${r.date}</td><td><span class="kind">${esc(r.kind)}${r.direction ? ` ${r.direction}` : ''}</span></td>
      <td class="wrap">${esc(r.counterpart)}</td><td class="wrap">${esc(r.memo)}</td>
      <td class="num in">${won(r.inAmt)}</td><td class="num out">${won(r.outAmt)}</td><td class="num">${won(r.supply)}</td><td class="num">${won(r.vat)}</td>
      <td><select data-i="${i}">${cats.map((c) => `<option${c === r.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td>${esc(r.account)}</td><td class="muted">${esc(r.file)}</td></tr>`).join('');
  $$('#rowsTable select').forEach((s) => (s.onchange = () => {
    const r = shown[Number(s.dataset.i)]; r.cat = s.value; overrides[r.key] = s.value; store.set('catOverrides', overrides);
  }));
}

$('#exportRows').onclick = () => downloadCsv(`정리자료_${iso(new Date())}.csv`, [
  ['일자', '종류', '구분', '거래처', '적요', '들어온돈', '나간돈', '공급가액', '세액', '합계', '항목', '계좌카드', '승인번호', '사업자번호', '파일'],
  ...filtered().map((r) => [r.date, r.kind, r.direction, r.counterpart, r.memo, r.inAmt, r.outAmt, r.supply, r.vat, r.total, r.cat, r.account, r.approvalNo, r.bizNo, r.file]),
]);

function setupDrop(zone, input, target, after) {
  const upload = async (files) => {
    for (const f of files) {
      try { await api(`/api/upload${target ? `?target=${target}` : ''}`, { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name) }, body: f }); }
      catch (e) { alert(`${f.name}: ${e.message}`); }
    }
    after();
  };
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('over'); upload([...e.dataTransfer.files]); };
  input.onchange = () => { upload([...input.files]); input.value = ''; };
}
setupDrop($('#drop'), $('#pick'), '', load);

/* ---------------------------------------------------------- ③ 항목별 집계 */
let sumTable = [];
function renderSum() {
  if (!data.rows.length) { $('#sumOut').innerHTML = '<p class="muted">② 자료 정리에서 자료를 먼저 읽으세요.</p>'; return; }
  const months = [...new Set(data.rows.map((r) => r.date.slice(0, 7)))].sort();
  const block = (title, pick, cats) => {
    const sums = {};
    for (const r of data.rows) { const v = pick(r); if (!v) continue; (sums[r.cat] ||= {})[r.date.slice(0, 7)] = (sums[r.cat][r.date.slice(0, 7)] || 0) + v; }
    const list = (cats || Object.keys(sums)).filter((c) => sums[c]).sort((a, b) => Object.values(sums[b]).reduce((x, y) => x + y, 0) - Object.values(sums[a]).reduce((x, y) => x + y, 0));
    if (!list.length) return '';
    const total = (c) => months.reduce((n, m) => n + (sums[c][m] || 0), 0);
    sumTable.push([title], ['항목', ...months, '합계'], ...list.map((c) => [c, ...months.map((m) => sums[c][m] || 0), total(c)]), []);
    const colTotal = (m) => list.reduce((n, c) => n + (sums[c][m] || 0), 0);
    return `<h3 style="margin-top:14px">${title}</h3><div class="tablewrap"><table class="grid"><tr><th>항목</th>${months.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">합계</th></tr>
      ${list.map((c) => `<tr><td>${esc(c)}</td>${months.map((m) => `<td class="num">${won(sums[c][m])}</td>`).join('')}<td class="num"><b>${won(total(c))}</b></td></tr>`).join('')}
      <tr class="total"><td>합계</td>${months.map((m) => `<td class="num">${won(colTotal(m))}</td>`).join('')}<td class="num">${won(months.reduce((n, m) => n + colTotal(m), 0))}</td></tr></table></div>`;
  };
  sumTable = [];
  const skip = new Set(window.EXCLUDE_FROM_SPEND);
  const hasCard = data.rows.some((r) => r.kind === '카드');
  const hasBizCard = data.rows.some((r) => r.kind === '사업용카드');
  const notes = [`「${[...skip].join(' · ')}」 항목은 다른 자료와 같은 돈이라 나간 돈에서 뺐습니다.`];
  if (hasCard && hasBizCard) notes.push('카드사 이용내역과 홈택스 사업용카드 자료는 같은 거래가 겹칩니다. 나간 돈에는 카드사 자료만 넣고 사업용카드는 뺐습니다.');
  $('#sumOut').innerHTML = `<p class="hint">${notes.map(esc).join('<br>')}</p>` +
    block('나간 돈 (카드 · 계좌 출금 · 현금영수증 · 사업용카드)', (r) => (r.kind === '세금계산서' || skip.has(r.cat) || (hasCard && r.kind === '사업용카드') ? 0 : r.outAmt)) +
    block('들어온 돈 (계좌 입금)', (r) => r.inAmt) +
    block('세금계산서 공급가액 (매출 · 매입)', (r) => (r.kind === '세금계산서' ? r.supply : 0));
}
$('#exportSum').onclick = () => { renderSum(); downloadCsv(`항목별집계_${iso(new Date())}.csv`, sumTable); };

/* ---------------------------------------------------------- ④ ERP (인증키) */
// ERP 접속 주소 · 메뉴 · 작업지시(guide)는 인증키로 로그인한 뒤 서버에서 받는다. 이 파일에는 없다.
let guide = null;
const erp = store.get('erp', { items: [], extra: '', from: lastMonth()[0], to: lastMonth()[1] });

function erpTaskText() {
  const paths = Object.fromEntries(Object.entries(guide.menus).flatMap(([g, list]) => list.map((m) => [m, `${g} › ${m}`])));
  const items = [...erp.items.map((it) => paths[it] || it), ...erp.extra.split(',').map((s) => s.trim()).filter(Boolean)];
  const vars = { name: guide.name, url: guide.url, from: dot(erp.from), to: dot(erp.to), toCompact: erp.to.replace(/-/g, ''), folder: info.erpInbox };
  $('#erpTask').value = items.length ? guide.task.flatMap((line) => (line === '{items}' ? items.map((it, i) => `${i + 1}. ${it}`)
    : [line.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)])).join('\n') : '모을 화면을 고르세요.';
  store.set('erp', erp);
}
function renderErpForm() {
  const all = Object.values(guide.menus).flat();
  // 예전에 고른 화면 이름이 안내에 없으면 버리고, 하나도 안 남으면 안내의 기본 화면으로 되돌린다
  erp.items = erp.items.filter((it) => all.includes(it));
  if (!erp.items.length) erp.items = [...guide.defaults];
  $('#erpTitle').textContent = `${guide.name} 자료 수집`;
  $('#erpConnect').innerHTML = `접속: <a href="${esc(guide.url)}" target="_blank" rel="noopener">${esc(guide.url)}</a><br>${esc(guide.login)}`;
  $('#erpNotice').textContent = guide.notice || '';
  $('#erpItems').innerHTML = Object.entries(guide.menus).map(([group, list]) => `<div class="group"><div class="muted">${esc(group)}</div>` +
    list.map((it) => `<label><input type="checkbox" value="${esc(it)}"${erp.items.includes(it) ? ' checked' : ''}> ${esc(it)}</label>`).join('') + '</div>').join('');
  $$('#erpItems input').forEach((c) => (c.onchange = () => { erp.items = $$('#erpItems input:checked').map((x) => x.value); erpTaskText(); }));
  $('#erpExtra').value = erp.extra; $('#erpFrom').value = erp.from; $('#erpTo').value = erp.to;
  $('#erpExtra').oninput = (e) => { erp.extra = e.target.value; erpTaskText(); };
  $('#erpFrom').oninput = (e) => { erp.from = e.target.value; erpTaskText(); };
  $('#erpTo').oninput = (e) => { erp.to = e.target.value; erpTaskText(); };
  $('#erpPath').textContent = info.erpInbox;
  erpTaskText();
}

let erpTables = [];
async function loadErp() {
  $('#erpMsg').textContent = '읽는 중…';
  try {
    const j = await api('/api/erp/data');
    erpTables = j.tables;
    $('#erpWho').textContent = `인증: ${j.label}`;
    $('#erpMsg').textContent = `파일 ${erpTables.length}개`;
    const groups = {};
    erpTables.forEach((t, i) => (groups[t.ok ? t.item : '읽기 실패'] ||= []).push(i));
    $('#erpOut').innerHTML = erpTables.length ? Object.entries(groups).map(([item, idx]) => `<h3 style="margin-top:14px">${esc(item)}</h3>` + idx.map((i) => {
      const t = erpTables[i];
      if (!t.ok) return `<p class="err">✕ ${esc(t.file)} — ${esc(t.error)}</p>`;
      return `<p class="muted">${esc(t.file)} · ${t.total.toLocaleString()}행 <button class="btn small" data-csv="${i}">CSV 저장</button></p>
        <div class="tablewrap" style="max-height:340px"><table class="grid"><tr>${t.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
        ${t.rows.slice(0, 200).map((r) => `<tr>${t.header.map((_, c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>`;
    }).join('')).join('') : '<p class="muted">ERP 수집함이 비어 있습니다. Aside 로 받은 ERP 파일을 이 폴더에 넣거나 끌어다 놓으세요.</p>';
    $$('[data-csv]').forEach((b) => (b.onclick = () => { const t = erpTables[Number(b.dataset.csv)]; downloadCsv(`ERP_${t.item}_${t.file.replace(/\.\w+$/, '')}.csv`, [t.header, ...t.rows]); }));
  } catch (e) {
    if (e.status === 401) return lockErp('인증이 끝났습니다. 인증키를 다시 넣으세요.');
    $('#erpMsg').innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

function lockErp(msg) {
  sessionStorage.removeItem('erp');
  guide = null;
  $('#erpItems').innerHTML = ''; $('#erpTask').value = ''; $('#erpConnect').innerHTML = ''; $('#erpOut').innerHTML = '';
  $('#erpOpen').hidden = true; $('#erpLocked').hidden = false;
  $('#erpErr').textContent = msg || '';
  $('[data-tab="erp"]').textContent = '④ ERP 자료 🔒';
}
async function openErp() {
  try {
    const g = await api('/api/erp/guide');
    guide = g.guide; info.erpInbox = g.dir;
  } catch (e) { return lockErp(e.status === 401 ? '인증이 끝났습니다. 인증키를 다시 넣으세요.' : e.message); }
  $('#erpOpen').hidden = false; $('#erpLocked').hidden = true;
  $('[data-tab="erp"]').textContent = '④ ERP 자료';
  renderErpForm(); loadErp();
}
$('#erpUnlock').onclick = async () => {
  $('#erpErr').textContent = '';
  try {
    const j = await api('/api/erp/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: $('#erpKey').value }) });
    sessionStorage.setItem('erp', j.token);
    $('#erpKey').value = '';
    openErp();
  } catch (e) { $('#erpErr').textContent = e.message; }
};
$('#erpKey').onkeydown = (e) => { if (e.key === 'Enter') $('#erpUnlock').click(); };
$('#erpLock').onclick = async () => { await api('/api/erp/lock', { method: 'POST' }).catch(() => {}); lockErp(); };
$('#erpReload').onclick = loadErp;
$('#copyErp').onclick = () => copyText($('#erpTask').value, $('#copyErp'));
$('#openErp').onclick = () => openFolder('erp');
setupDrop($('#erpDrop'), $('#erpPick'), 'erp', loadErp);

/* ------------------------------------------------------------------ 시작 */
(async () => {
  try { info = await api('/api/info'); } catch {}
  $('#inboxPath').textContent = info.inbox;
  renderTask();
  showTab(store.get('tab', 'aside'));
  load();
  if (sessionStorage.getItem('erp')) openErp();
})();
