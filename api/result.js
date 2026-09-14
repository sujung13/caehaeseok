/**
 * POST /api/result
 *
 * body: {
 *   messages: [...],        // 인터뷰 전체 대화
 *   stage: 1 | 2 | 3,
 *   previous: [string],     // 앞 단계에서 생성된 결과 (2차는 1개, 3차는 2개)
 *   userContext: { nickname, prevType, reason }
 * }
 *
 * 200: { markdown, stage, usage }
 *
 * 프론트는 1차를 받아 화면에 그린 뒤, 사용자가 읽는 동안 2차를 미리 요청해둔다.
 * "더 보기"를 누를 때 이미 준비돼 있어 체감 대기가 거의 없다.
 */

const {
  SYSTEM_RESULT,
  RESULT_1,
  RESULT_2,
  RESULT_3,
  withUserContext,
} = require('./_prompts');

// 결과 품질이 서비스의 전부라 여기만 상위 모델을 쓴다.
// 비용을 더 줄이려면 'claude-sonnet-5'로 바꾸면 된다.
const MODEL = 'claude-opus-5';

const STAGE_PROMPT = { 1: RESULT_1, 2: RESULT_2, 3: RESULT_3 };
// 한글은 토큰 효율이 낮다. 3차는 표까지 들어가므로 넉넉히 잡는다.
const MAX_TOKENS = { 1: 4000, 2: 8000, 3: 8000 };
// 그래도 끊기면 이어받는다. 최대 이 횟수까지.
const MAX_CONTINUATIONS = 2;

const MAX_MESSAGES = 30;
const MAX_CHARS_PER_MESSAGE = 2000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST만 허용됩니다.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버 설정이 완료되지 않았습니다.' });
  }

  const { messages = [], stage, previous = [], userContext = {} } = req.body || {};

  if (![1, 2, 3].includes(stage)) {
    return res.status(400).json({ error: '잘못된 단계입니다.' });
  }
  if (!Array.isArray(messages) || messages.length < 2 || messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: '인터뷰 내용이 올바르지 않습니다.' });
  }
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || m.content.length > MAX_CHARS_PER_MESSAGE) {
      return res.status(400).json({ error: '인터뷰 내용이 올바르지 않습니다.' });
    }
  }

  // ── 앞 단계 결과를 대화에 끼워넣는다 ──────────────
  // 이걸 빼면 2·3차가 1차와 비슷한 내용을 반복한다.
  const apiMessages = [...messages];
  previous.slice(0, stage - 1).forEach((text, i) => {
    apiMessages.push({ role: 'user', content: STAGE_PROMPT[i + 1] });
    apiMessages.push({ role: 'assistant', content: text });
  });
  apiMessages.push({ role: 'user', content: STAGE_PROMPT[stage] });

  async function callClaude(msgs) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS[stage],
        system: [
          {
            type: 'text',
            text: withUserContext(SYSTEM_RESULT, userContext),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: msgs,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('anthropic error', r.status, detail);
      throw new Error('upstream');
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    return { text, stopReason: data.stop_reason, usage: data.usage };
  }

  try {
    let { text, stopReason, usage } = await callClaude(apiMessages);
    let markdown = text;
    let inputTokens = usage?.input_tokens || 0;
    let outputTokens = usage?.output_tokens || 0;

    // 토큰 상한에서 끊겼으면 이어서 받는다.
    // 마지막 메시지를 assistant로 두면 모델이 그 지점부터 이어 쓴다.
    let n = 0;
    while (stopReason === 'max_tokens' && n < MAX_CONTINUATIONS) {
      n++;
      console.warn(`stage ${stage} truncated, continuing (${n})`);
      const cont = await callClaude([
        ...apiMessages,
        // 끝의 공백이 남아 있으면 API가 거부한다
        { role: 'assistant', content: markdown.trimEnd() },
      ]);
      markdown += cont.text;
      stopReason = cont.stopReason;
      inputTokens += cont.usage?.input_tokens || 0;
      outputTokens += cont.usage?.output_tokens || 0;
    }

    markdown = markdown.trim();
    if (!markdown) {
      return res.status(502).json({ error: 'EMPTY', message: '결과를 받지 못했어요.' });
    }

    return res.status(200).json({
      markdown,
      stage,
      truncated: stopReason === 'max_tokens',
      usage: { input_tokens: inputTokens, output_tokens: outputTokens, continuations: n },
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'UPSTREAM', message: '결과를 만들다 문제가 생겼어요.' });
  }
};
