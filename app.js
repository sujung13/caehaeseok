/* ─────────────────────────────────────────
   나를 위한 캐해석 - app.js
   ───────────────────────────────────────── */

const MAX_TURNS = 8;
const DAILY_LIMIT = 2;
const KEY_USAGE = 'hue:usage';
const KEY_SESSION = 'hue:session';

const $ = (s) => document.querySelector(s);
const today = () => new Date().toISOString().slice(0, 10);

// ── 상태 ───────────────────────────────
let state = null;

function freshState() {
  return {
    ctx: { nickname: '', prevType: '', reason: '' },
    messages: [],      // [{role, content}]
    turn: 1,           // 화면에 떠 있는 질문의 턴
    pendingTurn: 1,    // 요청 중인 턴 (재시도용)
    retryUsed: false,  // 이번 턴에서 이미 되물었는지
    answered: 0,       // 실제로 답한 개수 (진행률용)
    results: [null, null, null],
    done: false,
  };
}

function save() {
  try {
    localStorage.setItem(KEY_SESSION, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch (_) {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(KEY_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // 하루 지난 세션은 버린다
    if (Date.now() - (s.savedAt || 0) > 864e5) return null;
    if (s.done) return null;
    if (!s.messages || s.messages.length === 0) return null;
    // 빈 메시지가 하나라도 섞이면 이후 호출이 전부 실패한다
    s.messages = s.messages.filter((m) => m && typeof m.content === 'string' && m.content.trim());
    if (s.messages.length === 0) return null;
    return s;
  } catch (_) { return null; }
}

// ── 일일 제한 ──────────────────────────
function getUsage() {
  try {
    const u = JSON.parse(localStorage.getItem(KEY_USAGE) || '{}');
    return u.date === today() ? u : { date: today(), count: 0 };
  } catch (_) { return { date: today(), count: 0 }; }
}
function bumpUsage() {
  const u = getUsage();
  u.count += 1;
  localStorage.setItem(KEY_USAGE, JSON.stringify(u));
  return u.count;
}

// ── 화면 전환 ──────────────────────────
function go(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('is-active'));
  $('#s-' + name).classList.add('is-active');
  window.scrollTo({ top: 0 });
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── API ────────────────────────────────
async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || '문제가 생겼어요');
    err.code = data.error;
    throw err;
  }
  return data;
}

// ── 진행률과 채움 ──────────────────────
function paint() {
  const shown = Math.min(state.turn, MAX_TURNS);
  $('#progress-fill').style.width = (shown / MAX_TURNS) * 100 + '%';
  $('#progress-label').textContent = `${shown} / ${MAX_TURNS}`;
  // 답한 개수에 비례해 색이 차오른다
  const fill = 0.18 + 0.82 * (state.answered / MAX_TURNS);
  $('#hue-avatar').style.setProperty('--fill', fill.toFixed(2));
}

// ── 인터뷰 ─────────────────────────────
function setComposer(on) {
  $('#answer').disabled = !on;
  $('#btn-send').disabled = !on;
  if (on) setTimeout(() => $('#answer').focus(), 120);
}

function showTyping() {
  $('#question').innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
}

function showQuestion(text) {
  const b = $('#question');
  b.textContent = text;
  b.classList.remove('is-new');
  void b.offsetWidth;
  b.classList.add('is-new');
}

/** 질문을 받지 못했을 때. 대화 기록은 건드리지 않고 재시도 버튼만 띄운다. */
function questionFailed(msg) {
  $('#question').textContent = msg;
  $('#btn-retry').classList.remove('hidden');
  setComposer(false);
}

async function askTurn(turnToAsk) {
  showTyping();
  setComposer(false);
  $('#btn-retry').classList.add('hidden');
  state.pendingTurn = turnToAsk; // 재시도용

  try {
    const r = await api('/api/interview', {
      messages: state.messages,
      turn: Math.min(turnToAsk, MAX_TURNS),
      userContext: state.ctx,
      retryUsed: state.retryUsed,
    });

    if (r.paused) {
      $('#pause-message').textContent = r.question;
      localStorage.removeItem(KEY_SESSION);
      go('pause');
      return;
    }

    // 빈 질문은 절대 대화 기록에 넣지 않는다.
    // 빈 assistant 메시지가 들어가면 이후 호출이 전부 실패한다.
    const q = (r.question || '').trim();
    if (!q) {
      questionFailed('질문을 받지 못했어요. 아래 버튼을 눌러주세요.');
      return;
    }

    state.messages.push({ role: 'assistant', content: q });

    if (r.advanced) {
      state.turn = Math.min(turnToAsk, MAX_TURNS);
      state.retryUsed = false;
    } else {
      state.retryUsed = true; // 되묻는 중이라 턴은 그대로
    }

    showQuestion(q);
    paint();
    setComposer(true);
    save();
  } catch (e) {
    if (e.code === 'CAPACITY') {
      $('#limit-title').textContent = '오늘은 인원이 다 찼어요';
      $('#limit-text').textContent = '내일 다시 만나요';
      go('limit');
      return;
    }
    questionFailed('잠시 문제가 생겼어요. 아래 버튼을 눌러주세요.');
  }
}

async function sendAnswer() {
  const text = $('#answer').value.trim();
  if (!text) return;

  state.messages.push({ role: 'user', content: text });
  state.answered = Math.max(state.answered, state.turn);
  $('#answer').value = '';
  paint();
  save();

  // 마지막 턴을 답했으면 결과로. 되묻기는 하지 않는다.
  if (state.turn >= MAX_TURNS) return finish();

  await askTurn(state.turn + 1);
}

// ── 결과 ───────────────────────────────
const LOADING_LINES = [
  '당신의 색을 찾는 중이에요',
  '진하게 번진 곳을 보고 있어요',
  '이름을 하나 지어보는 중이에요',
];

async function finish() {
  go('loading');
  let i = 0;
  const rotate = setInterval(() => {
    i = (i + 1) % LOADING_LINES.length;
    $('#loading-text').textContent = LOADING_LINES[i];
  }, 4200);

  try {
    const r = await api('/api/result', {
      messages: state.messages,
      stage: 1,
      previous: [],
      userContext: state.ctx,
    });
    state.results[0] = r.markdown;
    state.done = true;
    save();

    renderResult(1);
    go('result');
    prefetch(2); // 읽는 동안 미리 만들어둔다
  } catch (e) {
    toast('결과를 만들지 못했어요. 다시 시도해주세요.');
    go('interview');
    setComposer(true);
  } finally {
    clearInterval(rotate);
  }
}

let pending = {};
function prefetch(stage) {
  if (state.results[stage - 1] || pending[stage]) return;
  pending[stage] = api('/api/result', {
    messages: state.messages,
    stage,
    previous: state.results.slice(0, stage - 1),
    userContext: state.ctx,
  }).then((r) => {
    state.results[stage - 1] = r.markdown;
    save();
    return r.markdown;
  }).catch(() => null);
}

async function showMore(stage) {
  const btn = $('#btn-more');
  btn.disabled = true;
  btn.textContent = '가져오는 중...';

  if (!state.results[stage - 1]) {
    if (!pending[stage]) prefetch(stage);
    await pending[stage];
  }

  if (!state.results[stage - 1]) {
    btn.disabled = false;
    btn.textContent = '다시 시도';
    toast('불러오지 못했어요');
    return;
  }

  renderResult(stage);
  $('#result-' + stage).classList.remove('hidden');
  btn.disabled = false;

  if (stage === 2) {
    btn.textContent = '마지막 장 보기';
    btn.dataset.stage = '3';
    prefetch(3);
  } else {
    btn.classList.add('hidden');
    $('#result-actions').classList.remove('hidden');
  }

  $('#result-' + stage).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── 마크다운 렌더 ──────────────────────
function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function md2html(src) {
  const lines = src.split('\n');
  const out = [];
  let list = null;

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { closeList(); continue; }

    // 표
    if (t.startsWith('|') && (lines[i + 1] || '').trim().match(/^\|[\s\-:|]+\|$/)) {
      closeList();
      const head = t.split('|').slice(1, -1).map((c) => c.trim());
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      out.push('<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      rows.forEach((r) => out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'));
      out.push('</tbody></table>');
      continue;
    }

    let m;
    if ((m = t.match(/^###\s+(.*)/))) { closeList(); out.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = t.match(/^##\s+(.*)/)))  { closeList(); out.push(`<h2>${inline(m[1])}</h2>`); continue; }
    if ((m = t.match(/^#\s+(.*)/)))   { closeList(); out.push(`<h2>${inline(m[1])}</h2>`); continue; }
    if ((m = t.match(/^>\s?(.*)/)))   { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }

    if ((m = t.match(/^[-*]\s+(.*)/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if ((m = t.match(/^\d+\.\s+(.*)/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join('\n');
}

/** 1차 결과에서 유형명 / 영문 별명 / 한 줄 설명을 뽑는다 */
function parseHeadline(md) {
  const sec = {};
  md.split(/^##\s+/m).forEach((block) => {
    const nl = block.indexOf('\n');
    if (nl < 0) return;
    sec[block.slice(0, nl).trim()] = block.slice(nl + 1).trim();
  });
  const firstLine = (s) => (s || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  return {
    name: firstLine(sec['유형명']).replace(/^[*"'`]+|[*"'`]+$/g, ''),
    en: firstLine(sec['영문 별명']).replace(/^[*"'`]+|[*"'`]+$/g, ''),
    line: firstLine(sec['한 줄 설명']).replace(/^[*"'`]+|[*"'`]+$/g, ''),
  };
}

function renderResult(stage) {
  const md = state.results[stage - 1];
  if (!md) return;

  if (stage === 1) {
    const h = parseHeadline(md);
    // 유형명과 영문 별명은 별도 스타일로 올리고, 본문에서는 뺀다
    const body = md
      .replace(/^##\s+유형명[\s\S]*?(?=^##\s)/m, '')
      .replace(/^##\s+영문 별명[\s\S]*?(?=^##\s)/m, '');
    $('#result-1').innerHTML =
      (h.name ? `<div class="typename">${esc(h.name)}</div>` : '') +
      (h.en ? `<div class="typename-en">${esc(h.en)}</div>` : '') +
      md2html(body);
  } else {
    $('#result-' + stage).innerHTML = md2html(md);
  }
}

// ── 결과 카드 ──────────────────────────
function wrap(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function makeCard() {
  const canvas = $('#card-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const h = parseHeadline(state.results[0] || '');

  const load = (src) => new Promise((ok, no) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = no;
    im.src = src;
  });

  try { await document.fonts.load('400 88px LeeSeoyun'); } catch (_) {}
  try { await document.fonts.ready; } catch (_) {}

  // 배경
  try {
    const bg = await load('/assets/bg.jpg');
    const s = Math.max(W / bg.width, H / bg.height);
    ctx.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  } catch (_) {
    ctx.fillStyle = '#F6F2FE';
    ctx.fillRect(0, 0, W, H);
  }

  ctx.textAlign = 'center';

  // 상단 서비스명
  ctx.font = '600 34px Pretendard, sans-serif';
  ctx.fillStyle = '#9A93AD';
  ctx.fillText('나를 위한 캐해석', W / 2, 180);

  // 캐릭터
  try {
    const hue = await load('/assets/hue-result.png');
    const w = 560, hh = hue.height * (w / hue.width);
    ctx.drawImage(hue, (W - w) / 2, 300, w, hh);
  } catch (_) {}

  let y = 1080;

  // 유형명 (길면 줄바꿈)
  ctx.font = '400 92px LeeSeoyun, Pretendard, sans-serif';
  ctx.fillStyle = '#7F5CDB';
  const nameLines = wrap(ctx, h.name || '나만의 유형', W - 180);
  nameLines.forEach((l) => { ctx.fillText(l, W / 2, y); y += 108; });

  // 영문 별명
  if (h.en) {
    y += 14;
    ctx.font = '500 38px Pretendard, sans-serif';
    ctx.fillStyle = '#9A93AD';
    ctx.fillText(h.en, W / 2, y);
    y += 70;
  }

  // 한 줄 설명
  if (h.line) {
    y += 40;
    ctx.font = '400 40px Pretendard, sans-serif';
    ctx.fillStyle = '#6D6487';
    wrap(ctx, h.line, W - 200).forEach((l) => { ctx.fillText(l, W / 2, y); y += 62; });
  }

  // 하단
  ctx.font = '400 30px Pretendard, sans-serif';
  ctx.fillStyle = '#B0A9C2';
  ctx.fillText('16개 중 하나 말고, 나 하나만을 위한 유형', W / 2, H - 120);

  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

async function saveCard() {
  const btn = $('#btn-card');
  btn.disabled = true;
  btn.textContent = '만드는 중...';
  try {
    const blob = await makeCard();
    const file = new File([blob], '나를위한캐해석.png', { type: 'image/png' });

    // 모바일은 공유 시트, 데스크톱은 다운로드
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '나를 위한 캐해석' });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '나를위한캐해석.png';
      a.click();
      URL.revokeObjectURL(url);
      toast('저장했어요');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') toast('카드를 만들지 못했어요');
  } finally {
    btn.disabled = false;
    btn.textContent = '결과 카드 저장하기';
  }
}

// ── 시작 ───────────────────────────────
async function startInterview() {
  const usage = getUsage();
  if (usage.count >= DAILY_LIMIT) {
    $('#limit-title').textContent = '오늘은 여기까지예요';
    $('#limit-text').textContent = '하루에 두 번까지 만날 수 있어요. 내일 또 와주세요.';
    go('limit');
    return;
  }

  state.ctx = {
    nickname: $('#in-nickname').value.trim(),
    prevType: $('#in-prevtype').value.trim(),
    reason: $('#in-reason').value.trim(),
  };
  bumpUsage();
  go('interview');
  paint();
  await askTurn(1);
}

function resetAll() {
  state = freshState();
  pending = {};
  localStorage.removeItem(KEY_SESSION);
  ['#result-2', '#result-3', '#result-actions'].forEach((s) => $(s).classList.add('hidden'));
  $('#btn-more').classList.remove('hidden');
  $('#btn-more').dataset.stage = '2';
  $('#btn-more').textContent = '더 보기';
  ['#result-1', '#result-2', '#result-3'].forEach((s) => ($(s).innerHTML = ''));
  go('landing');
}

// ── 이벤트 ─────────────────────────────
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) go(t.dataset.go);
});

$('#btn-start').addEventListener('click', startInterview);
$('#btn-send').addEventListener('click', sendAnswer);
$('#btn-retry').addEventListener('click', () => {
  // 마지막으로 요청하려던 턴을 그대로 다시 시도한다
  askTurn(state.pendingTurn || state.turn);
});
$('#btn-more').addEventListener('click', (e) => showMore(Number(e.currentTarget.dataset.stage)));
$('#btn-card').addEventListener('click', saveCard);
$('#btn-restart').addEventListener('click', resetAll);
$('#btn-pause-home').addEventListener('click', resetAll);

// 데스크톱에서 Ctrl/Cmd + Enter로 전송
$('#answer').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendAnswer();
});

// 답변 길이에 따라 힌트를 바꾼다
$('#answer').addEventListener('input', (e) => {
  const n = e.target.value.trim().length;
  $('#answer-hint').textContent =
    n === 0 ? '생각보다는 최근에 있었던 일 하나를 떠올려보세요'
    : n < 40 ? '조금만 더 자세히 적어주시면 훨씬 정확해져요'
    : '좋아요';
});

// 인터뷰 중 이탈 방지
window.addEventListener('beforeunload', (e) => {
  if (state && state.messages.length > 0 && !state.done) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 초기화
state = freshState();
const prev = loadSession();
if (prev) {
  $('#btn-resume').classList.remove('hidden');
  $('#btn-resume').addEventListener('click', () => {
    state = prev;
    go('interview');
    paint();
    const last = [...state.messages].reverse().find((m) => m.role === 'assistant');
    if (last) showQuestion(last.content);
    setComposer(true);
  });
}
