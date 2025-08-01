# Boardgame (MVP) — React + Socket.IO

이 저장소는 **프론트엔드(Vite + React)** 와 **백엔드(Node.js + Express + Socket.IO)** 로 구성된
멀티플레이 턴제 카드 게임의 기초 템플릿입니다.

## ✅ 기능 (v0.1)
- 방 생성 / 입장 (6자리 코드)
- 게임 시작 시 각 플레이어 2장 배분, 코인 0
- 턴 타이머 20초 (초과 시 자동 코인 +1, AFK 카운트 +1, 3회 연속 시 탈락)
- 재접속 60초 허용 (같은 `playerId`로 재연결)
- 행동: 코인 1개 받기(`take1`), 코인 2개 받기(`take2`)
- 도전/스킬은 기본 구조만 포함(추후 구현 확대)

## 폴더 구조
```
boardgame-template/
  frontend/   # Vite + React + Tailwind + socket.io-client
  backend/    # Express + Socket.IO + TypeScript
```
---

## 로컬 실행

### 0) 사전 준비
- Node.js 20+
- Git

### 1) 의존성 설치
```bash
# 루트에서는 별도 설치 없음
cd backend
npm install
cd ../frontend
npm install
```

### 2) 개발 서버 실행
```bash
# 터미널 1: 백엔드 (http://localhost:8080)
cd backend
npm run dev

# 터미널 2: 프론트 (http://localhost:5173)
cd frontend
npm run dev
```

브라우저를 두 개 열고 서로 다른 닉네임으로 접속 → 방 생성/입장 → 테스트.

---

## 배포

### A. 백엔드 (Render)
1. Render에서 **New → Web Service** → GitHub 저장소 선택 → `backend/` 디렉터리 지정
2. **Build Command**: `npm install && npm run build`
3. **Start Command**: `npm start`
4. 배포 URL 예시: `https://<your-app>.onrender.com`

### B. 프론트 (Vercel)
1. Vercel에서 **Add New → Project** → 동일 저장소 선택 → **Root Directory**: `frontend`
2. **Environment Variables**에 다음을 추가
   - `VITE_SOCKET_URL = https://<your-app>.onrender.com`
3. Deploy 완료 후 제공되는 Vercel URL을 친구에게 공유하세요.

---

## 카드/규칙 (현재 반영 상태)
- 챔피언: Vladimir, Braum, Garen, Akali, TwistedFate (각 3장 → 15장)
- 시작 시: 각 플레이어 **카드 2장**, **코인 0**
- 턴 타이머: 20초, 초과 시 자동 `take1`, AFK 3회 연속 탈락
- 공개된 카드가 덱으로 돌아가면 즉시 셔플 (기본 셔플 사용)
- 도전 규칙/스킬은 다음 버전에서 확장 예정 (백엔드 코드에 구조 준비됨)

---

## 다음 단계(개발 계획)
- 스킬 실행 및 도전 처리 전체 구현
- 가렌 강탈/블라디 패시브/브라움 방어/아칼리 처형/트페 카드 변환 로직
- 게임 로그 뷰 & 리플레이
- 모바일 UI 대응
- 카드 이미지 교체: `frontend/src/assets/cards/` 폴더에 파일 추가 후 코드 매핑
