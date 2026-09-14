/**
 * POST /api/interview
 *
 * body: {
 *   messages: [{ role: 'assistant'|'user', content: string }],  // 지금까지의 대화
 *   turn: 1~8,                                                   // 이번에 진행할 턴
 *   userContext: { nickname, prevType, reason },
 *   retryUsed: boolean                                           // 이 턴에서 이미 되물었는지
 * }
 *
 * 200: { question, turn, advanced, paused, usage }
 *   - advanced: true면 이 턴 완료, 다음 턴으로. false면 되묻기 중이라 턴 유지.
 *   - paused: true면 위기 신호. 프론트는 인터뷰를 중단하고 안내 화면으로.
 */

const {
  SYSTEM_INTERVIEW,
  TURN_BRIEF,
  RETRY_BRIEF,
  withUserContext,
  MAX_TURNS,
} = require('./_prompts');

const MODEL = 'claude-sonnet-5';

// 요청 크기 제한 (악용 방지)
const MAX_MESSAGES = 30;
const MAX_CHARS_PER_MESSAGE = 2000;

// 되묻기 판정 기준
const SHORT_ANSWER_CHARS = 40;

// 전체 일일 상한. 인스턴스별 메모리라 정확하지 않다. 아래 주석 참고.
const GLOBAL_DAILY_CAP = 50;
let globalCounter = { date: '', count: 0 };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function bumpGlobal() {
  const d = today();
  if (globalCounter.date !== d) globalCounter = { date: d, count: 0 };
  globalCounter.count += 1;
  return globalCounter.count;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 허용됩니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버 설정이 완료되지 않았습니다.' });
  }

  const { messages = [], turn = 1, userContext = {}, retryUsed = false } = req.body || {};

  // ── 입력 검증 ───────────────────────────────
  if (!Number.isInteger(turn) || turn < 1 || turn > MAX_TURNS) {
    return res.status(400).json({ error: '잘못된 턴 번호입니다.' });
  }
  if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: '대화가 너무 깁니다.' });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return res.status(400).json({ error: '대화 형식이 올바르지 않습니다.' });
    }
    if (m.content.length > MAX_CHARS_PER_MESSAGE) {
      return res.status(400).json({ error: '답변이 너무 깁니다.' });
    }
  }

  if (bumpGlobal() > GLOBAL_DAILY_CAP) {
    return res.status(429).json({
      error: 'CAPACITY',
      message: '오늘은 인원이 다 찼어요. 내일 다시 만나요.',
    });
  }

  // ── 되묻기 판정 ─────────────────────────────
  // 서버가 결정한다. 모델에게 맡기면 무한히 되물을 수 있다.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const isShort =
    turn > 1 &&
    !retryUsed &&
    lastUser &&
    lastUser.content.trim().length < SHORT_ANSWER_CHARS;

  const brief = isShort ? RETRY_BRIEF : TURN_BRIEF[turn];

  // ── 첫 턴 처리 ──────────────────────────────
  // messages가 비어 있으면 모델에게 줄 user 메시지가 없다.
  // Anthropic API는 첫 메시지가 user여야 하므로 자리를 만들어준다.
  const apiMessages =
    messages.length > 0 ? messages : [{ role: 'user', content: '인터뷰를 시작해주세요.' }];

  // ── 호출 ────────────────────────────────────
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        // system을 두 블록으로 나눠 앞쪽만 캐싱한다.
        // 긴 시스템 프롬프트가 매 턴 반복되므로 입력 비용이 크게 줄어든다.
        system: [
          {
            type: 'text',
            text: withUserContext(SYSTEM_INTERVIEW, userContext),
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: brief },
        ],
        messages: apiMessages,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('anthropic error', r.status, detail);
      return res.status(502).json({ error: '잠시 문제가 생겼어요. 다시 시도해주세요.' });
    }

    const data = await r.json();
    let question = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    // ── 위기 신호 ─────────────────────────────
    const paused = question.startsWith('[PAUSE]');
    if (paused) question = question.replace('[PAUSE]', '').trim();

    return res.status(200).json({
      question,
      turn,
      advanced: !isShort,   // 되묻기면 턴 유지
      paused,
      usage: data.usage,    // 비용 모니터링용
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '잠시 문제가 생겼어요. 다시 시도해주세요.' });
  }
};
