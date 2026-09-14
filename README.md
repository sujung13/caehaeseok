# 나를 위한 캐해석

## 폴더 구조

```
/
├── index.html
├── style.css
├── app.js
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

4. **배포 전에 Anthropic 콘솔에서 월 예산 한도를 걸어두세요.**
   코드로 건 제한은 전부 우회 가능하지만 이건 아닙니다.

로컬 테스트는 `vercel dev`. `.env.local`에 키를 넣으면 됩니다.

## 흐름

```
랜딩 → 안내 → 준비질문 → 인터뷰 8턴 → 로딩 → 결과 1차
                                              ↓ 더 보기
                                           결과 2차 (미리 생성됨)
                                              ↓ 마지막 장 보기
                                           결과 3차 → 카드 저장
```

- 결과 1차를 보여주는 동안 2차를 백그라운드에서 생성합니다. 체감 대기가 크게 줄어듭니다.
- 인터뷰 답변이 40자 미만이면 서버가 되묻습니다. 한 턴당 한 번까지.
- 8번째 답변 뒤에는 되묻지 않고 바로 결과로 넘어갑니다.

## 상태 저장

localStorage 두 개만 씁니다. 서버에는 아무것도 저장하지 않습니다.

- `hue:session` — 진행 중인 대화. 새로고침해도 이어서 하기 가능. 24시간 뒤 만료
- `hue:usage` — 오늘 사용 횟수. 기본 2회

## 조정할 만한 값

| 위치 | 값 | 설명 |
|---|---|---|
| `app.js` | `DAILY_LIMIT = 2` | 개인 일일 제한 |
| `api/interview.js` | `GLOBAL_DAILY_CAP = 50` | 전체 일일 상한 |
| `api/interview.js` | `SHORT_ANSWER_CHARS = 40` | 되묻기 기준 |
| `api/result.js` | `MODEL` | `claude-opus-5` → `claude-sonnet-5`로 바꾸면 비용 절감 |
| `api/_prompts.js` | `TURN_BRIEF` | 8개 질문의 주제 |

## 알아두실 것

**전체 일일 상한은 정확하지 않습니다.** 서버리스 인스턴스별 메모리라 여러 인스턴스가
뜨면 각각 따로 셉니다. 나중에 공개 범위를 넓히시면 Vercel KV를 붙여 IP 단위로 올리세요.

**개인 제한도 localStorage 기반이라 시크릿 모드로 뚫립니다.** 지인 공유 규모에서는
문제가 없지만, 진짜 방어선은 콘솔의 예산 한도입니다.

**폰트 라이선스를 확인하세요.** 이서윤체는 흥국생명 배포 폰트입니다. 웹서버 업로드와
서브셋 변환이 허용되는지 배포처에서 확인하고 쓰시는 게 안전합니다.
