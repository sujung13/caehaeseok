# 나를 위한 캐해석

## 폴더 구조

```
/
├── index.html
├── style.css
├── app.js
├── questions.js         ← Phase 1 객관식 문항
├── vercel.json
├── README.md
├── api/
│   ├── _prompts.js      ← 언더바 필수. 없으면 프롬프트가 URL로 노출됨
│   ├── interview.js     → POST /api/interview
│   └── result.js        → POST /api/result
└── assets/
    ├── hue-master.webp / .png       기본 포즈 (랜딩, 파비콘, OG)
    ├── hue-hello.webp / .png        인사 (안내 화면)
    ├── hue-interview.webp / .png    돋보기 (인터뷰, 색이 차오름)
    ├── hue-loading.webp / .png      집중 (로딩)
    ├── hue-result.webp / .png       완성 (결과, 카드)
    ├── icon-*.webp / .png           장식 6종
    ├── bg.jpg                       배경
    ├── LeeSeoyun.woff2              웹폰트 (276KB)
    └── LeeSeoyun.ttf                원본
```

`.webp`를 화면에서 쓰고, `.png`는 canvas 카드 생성에 씁니다.
(canvas는 webp도 읽지만 png가 더 안전합니다.)

## 배포

1. GitHub에 올리고 Vercel에서 Import
2. 프레임워크 프리셋은 **Other**, 빌드 명령 없음
3. 환경변수 추가

```
ANTHROPIC_API_KEY = sk-ant-...
```

4. **Settings → Functions에서 Fluid Compute를 켜세요.**
   결과 생성은 1분을 넘길 수 있는데, Hobby 플랜의 기본 함수 제한은 60초입니다.
   Fluid Compute를 켜면 Hobby에서도 300초까지 늘어나고, `vercel.json`이 그 값을 씁니다.
   빌드가 `maxDuration must be between 1 and 60 for plan hobby` 오류로 실패하면
   Fluid Compute가 꺼져 있는 겁니다. 켜거나 `vercel.json`의 300을 60으로 낮추세요.

5. **배포 전에 Anthropic 콘솔에서 월 예산 한도를 걸어두세요.**
   코드로 건 제한은 전부 우회 가능하지만 이건 아닙니다.

로컬 테스트는 `vercel dev`. `.env.local`에 키를 넣으면 됩니다.

## 흐름

```
랜딩 → 안내 → 준비질문
  → [Phase 1] 객관식 10문항 (API 호출 없음, 무료)
  → [Phase 2] 서술형 5턴 (AI가 질문 생성)
  → 로딩 → 결과 1차
              ↓ 더 보기
           결과 2차 (미리 생성됨)
              ↓ 마지막 장 보기
           결과 3차 → 카드 저장
```

**Phase 1**은 `questions.js`에 고정된 10문항입니다. API를 쓰지 않아 비용도 대기도 없습니다.
선택은 점수로 환산하지 않고, 그대로 Phase 2와 결과 생성의 재료로만 넘어갑니다.
답변은 대화의 첫 user 메시지로 들어갑니다.

**Phase 2 (1~3턴)** 는 관찰입니다. 객관식에서 특이한 선택을 파고들고, 가까운 사람과의
장면과 혼자일 때의 선택을 끌어냅니다.

**Phase 3 (4~5턴)** 은 검증입니다. 쌓인 장면에서 서로 어긋나는 지점을 가릅니다.
특히 객관식 선택과 서술형 답변이 어긋나는 곳을 우선해서 봅니다.
5턴에서 더 가를 게 없으면 "외부에서 본 나"로 자동 대체됩니다.
턴 수는 5로 고정이라 진행률이 항상 정직합니다.

- 결과 1차를 보여주는 동안 2차를 백그라운드에서 생성합니다. 체감 대기가 크게 줄어듭니다.
- 서술형 답변이 40자 미만이면 서버가 되묻습니다. 한 턴당 한 번까지.
- 5번째 답변 뒤에는 되묻지 않고 바로 결과로 넘어갑니다.

## 상태 저장

localStorage 두 개만 씁니다. 서버에는 아무것도 저장하지 않습니다.

- `hue:session` — 진행 중인 대화. 새로고침해도 이어서 하기 가능. 24시간 뒤 만료
- `hue:usage` — 오늘 사용 횟수. 기본 2회

## 조정할 만한 값

| 위치 | 값 | 설명 |
|---|---|---|
| `questions.js` | `QUIZ` | Phase 1 문항. 늘리거나 바꿔도 앱은 그대로 동작 |
| `app.js` | `MAX_TURNS = 5` | Phase 2 턴 수. `api/_prompts.js`의 `MAX_TURNS`와 함께 바꿀 것 |
| `app.js` | `DAILY_LIMIT = 2` | 개인 일일 제한 |
| `api/interview.js` | `GLOBAL_DAILY_CAP = 50` | 전체 일일 상한 |
| `api/interview.js` | `SHORT_ANSWER_CHARS = 40` | 되묻기 기준 |
| `api/interview.js` | `max_tokens: 800` | 질문 하나의 상한 |
| `api/result.js` | `MAX_TOKENS` | 결과 단계별 상한. 끊기면 자동으로 이어받음 |
| `api/result.js` | `MODEL` | `claude-opus-5` → `claude-sonnet-5`로 바꾸면 비용 절감, 속도도 빨라짐 |
| `api/_prompts.js` | `TURN_BRIEF` | 8개 질문의 주제 |
| `api/_prompts.js` | `160자` | 질문 길이 상한. 여전히 길면 120자로 |

## 잘림 대응

인터뷰 질문과 결과가 중간에 끊기는 문제는 두 겹으로 막아두었습니다.

- **질문**: 800토큰. 넘치면 마지막 완성 문장까지만 잘라서 보냅니다.
- **결과**: 단계별 4,000~8,000토큰. 그래도 끊기면 서버가 마지막 지점부터 이어서
  최대 두 번까지 더 받아 붙입니다. 로그에 `truncated, continuing`이 찍힙니다.

이어받기가 자주 발생하면 호출이 늘어 비용도 늘어납니다. 로그에 계속 보이면
`MAX_TOKENS`를 올리거나 결과 프롬프트의 분량 지시를 줄이세요.

## 알아두실 것

**전체 일일 상한은 정확하지 않습니다.** 서버리스 인스턴스별 메모리라 여러 인스턴스가
뜨면 각각 따로 셉니다. 나중에 공개 범위를 넓히시면 Vercel KV를 붙여 IP 단위로 올리세요.

**개인 제한도 localStorage 기반이라 시크릿 모드로 뚫립니다.** 지인 공유 규모에서는
문제가 없지만, 진짜 방어선은 콘솔의 예산 한도입니다.

**폰트 라이선스를 확인하세요.** 이서윤체는 흥국생명 배포 폰트입니다. 웹서버 업로드와
서브셋 변환이 허용되는지 배포처에서 확인하고 쓰시는 게 안전합니다.
