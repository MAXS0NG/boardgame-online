export type ChampionName =
  | "Vladimir"
  | "Braum"
  | "Garen"
  | "Akali"
  | "TwistedFate";

export interface ChampionCard {
  id: string;
  name: ChampionName;
  text: { skill: string; passive: string };
}

export interface PlayerState {
  id: string;           // playerId (not socket.id)
  socketId?: string;    // current live socket id
  nickname: string;
  coins: number;
  hand: ChampionCard[];
  graveyard: ChampionCard[];
  afkCount: number;
  isAlive: boolean;
  disconnectedAt?: number | null; // 60s grace
}

export interface LogEntry {
  ts: number;        // epoch ms
  text: string;      // 공개 가능한 설명만 기록 (카드 실명 X)
}

export type Phase =
  | "action"               // 일반 행동 대기
  | "awaitKillChoice"      // 처형 타깃이 버릴 카드 고르는 중
  | "awaitBlockTake2"      // 코인 +2 제지 대기 (블라디 패시브)
  | "awaitBlockAkali"      // 아칼리 공격 브라움 방어 대기 (타깃 전용)
  | "awaitTFDiscard"       // 트페: 교환할 카드 선택 대기(시전자 전용)
  | "awaitGarenResponse"   // 가렌 스킬: 타깃이 '도전/가렌제지/트페제지' 중 하나 선택 대기
  | "awaitChallenge"       // 도전 대기 (7초)
  | "awaitProof"           // 증명: 주장자가 카드 공개 (8초)
  | "awaitLoseOne"         // 패배 측 1장 손실 (8초)
  | "finished";            // 게임 종료

export interface PendingKill {
  byId: string;       // 시전자 id
  targetId: string;   // 타깃 id
}

export type PendingBlock =
  | { type: "take2"; actorId: string }
  | { type: "akali"; actorId: string; targetId: string }; // 가렌은 통합 응답으로 처리

export interface PendingTF { actorId: string; }

export interface PendingGarenResponse {
  actorId: string;   // 가렌 시전자
  targetId: string;  // 가렌 타깃(응답자)
}

export type ChallengeContext =
  | { kind: "skill"; skill: ChampionName; actorId: string; targetId?: string }
  | {
      kind: "block";
      blockType: "take2" | "garenSteal" | "akali";
      claimantId: string;       // 제지/방어를 주장한 사람
      actorId: string;          // 원행동자(예: +2 시전자 / 가렌 시전자 / 아칼리 시전자)
      targetId?: string;        // 가렌/아칼리의 타깃
      by?: "Garen" | "TwistedFate" | "Braum"; // 주장의 카드명
    };

export interface PendingChallenge {
  ctx: ChallengeContext;
  allowedChallengerId?: string;  // 제한 도전자(없으면 자유 도전)
  challengerId?: string;         // 실제 도전자(선착순 1명)
  claimName: ChampionName;       // 증명해야 할 카드명
}

export interface PendingProof {
  claimantId: string;            // 증명하는 사람
  claimName: ChampionName;       // 증명 대상 카드명
}

export interface PendingLose { playerId: string; }

export interface Game {
  roomCode: string;
  players: PlayerState[];
  deck: ChampionCard[];
  discard: ChampionCard[];
  turnIndex: number;
  phase: Phase;
  timerExpire: number;     // epoch ms (action/각종 대기 공용)
  banner?: string;         // 중앙 안내 메시지
  log: LogEntry[];

  // 진행 중인 대기 이벤트
  pendingKill?: PendingKill;
  pendingBlock?: PendingBlock;
  pendingTf?: PendingTF;
  pendingGarenResponse?: PendingGarenResponse;

  pendingChallenge?: PendingChallenge;
  pendingProof?: PendingProof;
  pendingLose?: PendingLose;

  // 방장 & 시작 여부
  hostId?: string;
  started: boolean;

  // 승자
  winnerId?: string;
}

export interface RoomMap { [code: string]: Game; }

export interface ServerToClientEvents {
  state: (game: Game) => void;
  error: (msg: string) => void;

  // 처형 타깃에게만 전송 (유실 방지용 UI도 병행)
  killChoice: (cards: { id: string; name: string }[]) => void;
  killChoiceClose: () => void;
}

export interface ClientToServerEvents {
  createRoom: (nickname: string, playerId: string, cb: (roomCode: string) => void) => void;
  joinRoom: (roomCode: string, nickname: string, playerId: string, cb: (ok: boolean, msg?: string) => void) => void;
  startGame: () => void;

  // 모든 액션은 payload.type으로 구분
  action: (payload:
    | { type: "take1" }
    | { type: "take2" }
    | { type: "pay7Kill"; targetId: string }
    | { type: "chooseKillCard"; cardId: string; roomCode?: string }
    | { type: "pay10Revive" }
    | { type: "useSkill"; skill: "Vladimir" | "Garen" | "Akali" | "TwistedFate"; targetId?: string }
    | { type: "blockTake2" }
    | { type: "blockAkali"; by: "Braum" }
    | { type: "tfSwap"; cardId: string }

    // 가렌 응답(도전/가렌제지/트페제지)
    | { type: "garenResponse"; choice: "challenge" | "blockGaren" | "blockTF" }

    // 도전/증명/손실
    | { type: "challenge" }
    | { type: "proofReveal"; cardId: string }
    | { type: "loseOne"; cardId: string }
  ) => void;
}
