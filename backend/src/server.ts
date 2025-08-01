import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import {
  Game, PlayerState, RoomMap,
  ClientToServerEvents, ServerToClientEvents, LogEntry,
  ChallengeContext, ChampionName
} from "./schemas";
import { buildDeck, shuffle } from "./cards";

const app = express();
app.use(cors({ origin: "*" }));

const httpServer = createServer(app);

// Socket.IO 타입 제네릭 (경고 방지용)
interface InterServerEvents {}
interface SocketData {}
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: "*" }
});

const rooms: RoomMap = {};
const GRACE_MS = 60_000;       // 재접속 유예
const TURN_MS  = 20_000;       // 턴 타이머
const KILL_CHOICE_MS = 8_000;  // 처형 타깃 카드선택 제한시간
const BLOCK_TAKE2_MS = 7_000;  // 블라디 제지 대기시간
const BLOCK_AKALI_MS = 7_000;  // 아칼리 브라움 방어 대기시간
const TF_DISCARD_MS  = 10_000; // 트페 교환 선택시간(요청: 10초)
const CHALLENGE_MS   = 7_000;  // 도전 대기
const PROOF_MS       = 8_000;  // 증명 대기(카드 공개)
const LOSE_MS        = 8_000;  // 1장 손실 선택
const GAREN_RESP_MS  = 7_000;  // 가렌 응답(도전/제지 선택) 대기

// 방별 타임아웃 타이머 보관
const pendingKillTimers: Record<string, NodeJS.Timeout> = {};
const pendingBlockTimers: Record<string, NodeJS.Timeout> = {};
const pendingTfTimers: Record<string, NodeJS.Timeout> = {};
const pendingChallengeTimers: Record<string, NodeJS.Timeout> = {};
const pendingProofTimers: Record<string, NodeJS.Timeout> = {};
const pendingLoseTimers: Record<string, NodeJS.Timeout> = {};
const pendingGarenRespTimers: Record<string, NodeJS.Timeout> = {};

const now = () => Date.now();
const pushLog = (g: Game, text: string) => {
  const entry: LogEntry = { ts: now(), text };
  g.log.push(entry);
  if (g.log.length > 200) g.log.shift();
};

function newGame(roomCode: string): Game {
  return {
    roomCode,
    players: [],
    deck: [],
    discard: [],
    turnIndex: 0,
    phase: "action",
    timerExpire: 0,
    banner: "",
    log: [],
    hostId: undefined,
    started: false,
    winnerId: undefined,
  };
}

function dealInitial(game: Game) {
  for (const p of game.players) {
    p.hand.push(game.deck.pop()!, game.deck.pop()!);
  }
}

function broadcast(game: Game) {
  io.to(game.roomCode).emit("state", game);
}

function clearKillTimeout(roomCode: string) {
  if (pendingKillTimers[roomCode]) {
    clearTimeout(pendingKillTimers[roomCode]);
    delete pendingKillTimers[roomCode];
  }
}
function clearBlockTimeout(roomCode: string) {
  if (pendingBlockTimers[roomCode]) {
    clearTimeout(pendingBlockTimers[roomCode]);
    delete pendingBlockTimers[roomCode];
  }
}
function clearTfTimeout(roomCode: string) {
  if (pendingTfTimers[roomCode]) {
    clearTimeout(pendingTfTimers[roomCode]);
    delete pendingTfTimers[roomCode];
  }
}
function clearChallengeTimeout(roomCode: string) {
  if (pendingChallengeTimers[roomCode]) {
    clearTimeout(pendingChallengeTimers[roomCode]);
    delete pendingChallengeTimers[roomCode];
  }
}
function clearProofTimeout(roomCode: string) {
  if (pendingProofTimers[roomCode]) {
    clearTimeout(pendingProofTimers[roomCode]);
    delete pendingProofTimers[roomCode];
  }
}
function clearLoseTimeout(roomCode: string) {
  if (pendingLoseTimers[roomCode]) {
    clearTimeout(pendingLoseTimers[roomCode]);
    delete pendingLoseTimers[roomCode];
  }
}
function clearGarenRespTimeout(roomCode: string) {
  if (pendingGarenRespTimers[roomCode]) {
    clearTimeout(pendingGarenRespTimers[roomCode]);
    delete pendingGarenRespTimers[roomCode];
  }
}

// 승자 판정 & 종료 처리
function maybeEndGame(game: Game): boolean {
  const alive = game.players.filter(p => p.isAlive);
  if (alive.length <= 1) {
    const winner = alive[0];
    game.phase = "finished";
    game.started = false;
    game.timerExpire = 0;
    game.banner = winner ? `🏆 ${winner.nickname} 승리!` : `🤝 무승부`;
    game.winnerId = winner?.id;
    pushLog(game, game.banner);
    clearKillTimeout(game.roomCode);
    clearBlockTimeout(game.roomCode);
    clearTfTimeout(game.roomCode);
    clearChallengeTimeout(game.roomCode);
    clearProofTimeout(game.roomCode);
    clearLoseTimeout(game.roomCode);
    clearGarenRespTimeout(game.roomCode);
    broadcast(game);
    return true;
  }
  return false;
}

function checkElimination(game: Game, p: PlayerState) {
  if (p.isAlive && p.hand.length === 0) {
    p.isAlive = false;
    pushLog(game, `🏳️ ${p.nickname} 탈락 — 챔피언이 없습니다.`);
  }
}

function advanceTurn(game: Game) {
  const n = game.players.length;
  for (let i = 1; i <= n; i++) {
    const next = (game.turnIndex + i) % n;
    const p = game.players[next];
    if (p && p.isAlive) {
      game.turnIndex = next;
      game.phase = "action";
      game.banner = "";
      game.timerExpire = now() + TURN_MS;
      return;
    }
  }
}

function startTurnTimer(game: Game) {
  if (game.phase !== "action") return; // 종료/대기 상태면 타이머 중지
  game.timerExpire = now() + TURN_MS;
  const roomCode = game.roomCode;
  setTimeout(() => {
    const g = rooms[roomCode];
    if (!g) return;
    if (g.phase !== "action") return;
    if (now() >= g.timerExpire) {
      const current = g.players[g.turnIndex];
      if (!current || !current.isAlive) {
        advanceTurn(g);
        if (maybeEndGame(g)) return;
        broadcast(g); startTurnTimer(g); return;
      }
      current.coins += 1;
      current.afkCount += 1;
      pushLog(g, `⏰ ${current.nickname} AFK — 자동으로 코인 +1`);
      if (current.afkCount >= 3) {
        current.isAlive = false;
        pushLog(g, `⚠️ ${current.nickname} 연속 AFK 3회 — 탈락`);
      }
      if (maybeEndGame(g)) return;
      advanceTurn(g);
      broadcast(g);
      startTurnTimer(g);
    }
  }, TURN_MS + 50);
}

/* ──────────────────────────────────────────────
 * 공통: 카드 제거/덱 반환/셔플/보충
 * ────────────────────────────────────────────── */
function returnToDeckAndShuffle(g: Game, card: any) {
  g.deck.push(card);
  shuffle(g.deck);
}
function drawOne(g: Game): any | null {
  if (g.deck.length === 0) return null;
  return g.deck.pop()!;
}

/* ──────────────────────────────────────────────
 * Kill(처형) 타이머
 * ────────────────────────────────────────────── */
function scheduleKillTimeout(game: Game) {
  const code = game.roomCode;
  clearKillTimeout(code);
  pendingKillTimers[code] = setTimeout(() => {
    const g = rooms[code];
    if (!g || g.phase !== "awaitKillChoice" || !g.pendingKill) return;

    const target = g.players.find(p => p.id === g.pendingKill!.targetId);
    const by     = g.players.find(p => p.id === g.pendingKill!.byId);
    if (!target || !by || target.hand.length === 0) {
      g.banner = ""; g.pendingKill = undefined; g.phase = "action";
      if (maybeEndGame(g)) return;
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    const idx = Math.floor(Math.random() * target.hand.length);
    const [removed] = target.hand.splice(idx, 1);
    returnToDeckAndShuffle(g, removed);

    pushLog(g, `⌛ ${target.nickname} 카드 선택 시간 초과 — 무작위로 1장 제거되었습니다.`);
    g.banner = ""; g.pendingKill = undefined; g.phase = "action";
    if (target.socketId) io.to(target.socketId).emit("killChoiceClose");

    checkElimination(g, target);
    if (maybeEndGame(g)) return;

    advanceTurn(g); broadcast(g); startTurnTimer(g);
  }, KILL_CHOICE_MS);
}

/* ──────────────────────────────────────────────
 * 블라디 +2 제지 타이머
 * ────────────────────────────────────────────── */
function scheduleBlockTake2Timeout(game: Game) {
  const code = game.roomCode;
  clearBlockTimeout(code);
  pendingBlockTimers[code] = setTimeout(() => {
    const g = rooms[code];
    if (!g || g.phase !== "awaitBlockTake2" || !g.pendingBlock || g.pendingBlock.type !== "take2") return;

    const { actorId } = g.pendingBlock;
    const actor = g.players.find(p => p.id === actorId);
    if (!actor || !actor.isAlive) {
      g.banner = ""; g.pendingBlock = undefined; g.phase = "action";
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    // 제지 없음 → +2 성공
    actor.coins += 2;
    pushLog(g, `⏲️ 제지 없음 — ${actor.nickname} 코인 +2 성공`);
    g.banner = ""; g.pendingBlock = undefined; g.phase = "action";

    advanceTurn(g); broadcast(g); startTurnTimer(g);
  }, BLOCK_TAKE2_MS);
}

/* ──────────────────────────────────────────────
 * 아칼리 브라움 방어 타이머
 * ────────────────────────────────────────────── */
function scheduleBlockAkaliTimeout(game: Game) {
  const code = game.roomCode;
  clearBlockTimeout(code);
  pendingBlockTimers[code] = setTimeout(() => {
    const g = rooms[code];
    if (!g || g.phase !== "awaitBlockAkali" || !g.pendingBlock || g.pendingBlock.type !== "akali") return;

    const { actorId, targetId } = g.pendingBlock;
    const actor  = g.players.find(p => p.id === actorId);
    const target = g.players.find(p => p.id === targetId);
    if (!actor || !target || !actor.isAlive || !target.isAlive) {
      g.banner = ""; g.pendingBlock = undefined; g.phase = "action";
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    // 방어 없음 → 아칼리 성공 → 처형 흐름으로 전환
    g.pendingBlock = undefined;
    g.phase = "awaitKillChoice";
    g.pendingKill = { byId: actor.id, targetId: target.id };
    g.timerExpire = now() + KILL_CHOICE_MS; // ✅ 타이머 표시
    g.banner = `🗡️ ${actor.nickname} 의 아칼리 성공 — ${target.nickname} 이(가) 버릴 카드를 선택 중…`;

    if (target.socketId) {
      const brief = target.hand.map(c => ({ id: c.id, name: c.name }));
      io.to(target.socketId).emit("killChoice", brief);
    }
    pushLog(g, `⏲️ 방어 없음 — 아칼리 성공, ${target.nickname} 카드 1장 제거 진행`);
    scheduleKillTimeout(g);
    broadcast(g);
  }, BLOCK_AKALI_MS);
}

/* ──────────────────────────────────────────────
 * 트페: 교환 선택 타이머
 * ────────────────────────────────────────────── */
function scheduleTfDiscardTimeout(game: Game) {
  const code = game.roomCode;
  clearTfTimeout(code);
  pendingTfTimers[code] = setTimeout(() => {
    const g = rooms[code];
    if (!g || g.phase !== "awaitTFDiscard" || !g.pendingTf) return;

    const { actorId } = g.pendingTf;
    const actor = g.players.find(p => p.id === actorId);
    if (!actor || !actor.isAlive || actor.hand.length === 0) {
      g.banner = ""; g.pendingTf = undefined; g.phase = "action";
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    // 무작위로 1장 선택하여 교환
    const idx = Math.floor(Math.random() * actor.hand.length);
    const [outCard] = actor.hand.splice(idx, 1);
    returnToDeckAndShuffle(g, outCard);
    const drawn = drawOne(g);
    if (drawn) actor.hand.push(drawn);

    pushLog(g, `⌛ ${actor.nickname} 트페 교환 — 시간 초과로 무작위 카드와 교환됨`);
    g.banner = ""; g.pendingTf = undefined; g.phase = "action";

    advanceTurn(g); broadcast(g); startTurnTimer(g);
  }, TF_DISCARD_MS);
}

/* ──────────────────────────────────────────────
 * 가렌 응답(도전/제지) 타이머
 * ────────────────────────────────────────────── */
function scheduleGarenResponseTimeout(game: Game) {
  const code = game.roomCode;
  clearGarenRespTimeout(code);
  pendingGarenRespTimers[code] = setTimeout(() => {
    const g = rooms[code];
    if (!g || g.phase !== "awaitGarenResponse" || !g.pendingGarenResponse) return;

    const { actorId, targetId } = g.pendingGarenResponse;
    const actor  = g.players.find(p => p.id === actorId);
    const target = g.players.find(p => p.id === targetId);
    if (!actor || !target || !actor.isAlive || !target.isAlive) {
      g.banner = ""; g.pendingGarenResponse = undefined; g.phase = "action";
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    // 응답 없음 → 강탈 성공
    const amt = Math.min(2, target.coins);
    target.coins -= amt;
    actor.coins += amt;

    pushLog(g, `🗡️ 응답 없음 — ${actor.nickname} 가 ${target.nickname} 에게서 코인 ${amt} 강탈`);
    g.banner = ""; g.pendingGarenResponse = undefined; g.phase = "action";

    advanceTurn(g); broadcast(g); startTurnTimer(g);
  }, GAREN_RESP_MS);
}

/* ──────────────────────────────────────────────
 * 도전 흐름: Challenge / Proof / Lose
 * ────────────────────────────────────────────── */

// 도전 창 열기
function openChallenge(g: Game, ctx: ChallengeContext, claimName: ChampionName, allowedChallengerId?: string, preChosenChallengerId?: string) {
  g.pendingChallenge = { ctx, claimName, allowedChallengerId, challengerId: preChosenChallengerId };
  if (preChosenChallengerId) {
    // 즉시 증명 단계로 (예: 가렌 응답에서 '도전'을 누른 경우)
    const claimantId = ctx.kind === "skill" ? ctx.actorId : ctx.claimantId;
    g.banner = `⚖️ 도전 — ${g.players.find(p=>p.id===claimantId)?.nickname} 이(가) ${claimName} 공개로 증명 (8초)`;
    openProof(g, claimantId, claimName);
    return;
  }

  g.phase = "awaitChallenge";
  g.timerExpire = now() + CHALLENGE_MS; // ✅ 타이머 표시
  clearChallengeTimeout(g.roomCode);
  pendingChallengeTimers[g.roomCode] = setTimeout(() => {
    const gg = rooms[g.roomCode];
    if (!gg || gg.phase !== "awaitChallenge" || !gg.pendingChallenge) return;
    const { ctx: c } = gg.pendingChallenge;
    pushLog(gg, `⏲️ 도전 없음 — 주장 유지`);
    gg.banner = "";
    gg.pendingChallenge = undefined;
    continueAfterNoContest(gg, c);
  }, CHALLENGE_MS);
}

// 증명 창 열기
function openProof(g: Game, claimantId: string, claimName: ChampionName) {
  g.pendingProof = { claimantId, claimName };
  g.phase = "awaitProof";
  g.timerExpire = now() + PROOF_MS; // ✅ 타이머 표시
  clearProofTimeout(g.roomCode);
  pendingProofTimers[g.roomCode] = setTimeout(() => {
    const gg = rooms[g.roomCode];
    if (!gg || gg.phase !== "awaitProof" || !gg.pendingProof || !gg.pendingChallenge) return;
    const claimant = gg.players.find(p => p.id === gg.pendingProof!.claimantId);
    if (!claimant || !claimant.isAlive || claimant.hand.length === 0) {
      // 손패가 없으면 증명 실패와 동일 처리
      pushLog(gg, `⌛ 증명 시간 초과 — 손패 없음/미선택으로 증명 실패 처리`);
      handleProofResult(gg, false);
      return;
    }
    const idx = Math.floor(Math.random() * claimant.hand.length);
    const auto = claimant.hand[idx];
    handleProofReveal(gg, String(auto.id));
  }, PROOF_MS);
}

// 손실 선택 열기
function openLoseOne(g: Game, playerId: string) {
  g.pendingLose = { playerId };
  g.phase = "awaitLoseOne";
  g.timerExpire = now() + LOSE_MS; // ✅ 타이머 표시
  clearLoseTimeout(g.roomCode);
  pendingLoseTimers[g.roomCode] = setTimeout(() => {
    const gg = rooms[g.roomCode];
    if (!gg || gg.phase !== "awaitLoseOne" || !gg.pendingLose) return;
    const pl = gg.players.find(p => p.id === gg.pendingLose!.playerId);
    if (!pl || !pl.isAlive || pl.hand.length === 0) {
      // 이미 0장인 경우에도 탈락/종료 체크
      if (pl) {
        checkElimination(gg, pl);
        if (maybeEndGame(gg)) return;
      }
      gg.banner = ""; gg.pendingLose = undefined;
      finalizePostChallenge(gg, true);
      return;
    }
    const idx = Math.floor(Math.random() * pl.hand.length);
    const [removed] = pl.hand.splice(idx, 1);
    returnToDeckAndShuffle(gg, removed);
    pushLog(gg, `⌛ ${pl.nickname} 카드 손실 — 시간 초과로 무작위 1장 손실`);
    checkElimination(gg, pl);
    gg.banner = ""; gg.pendingLose = undefined;
    if (maybeEndGame(gg)) return;
    finalizePostChallenge(gg, true);
  }, LOSE_MS);
}

// 도전 없음 → 원래 흐름으로
function continueAfterNoContest(g: Game, ctx: ChallengeContext) {
  if (ctx.kind === "skill") {
    const actor = g.players.find(p => p.id === ctx.actorId);
    const target = ctx.targetId ? g.players.find(p => p.id === ctx.targetId) : undefined;
    if (!actor || !actor.isAlive) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }

    if (ctx.skill === "Vladimir") {
      actor.coins += 3;
      pushLog(g, `🧛 ${actor.nickname} 블라디미르 +3 (도전 없음)`);
      g.phase = "action"; advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }
    if (ctx.skill === "Garen") {
      // (안전장치) 스킬 도전이 열렸는데 도전자가 없다면 즉시 강탈 성공
      const amt = Math.min(2, target?.coins ?? 0);
      if (target) { target.coins -= amt; actor.coins += amt; }
      pushLog(g, `🗡️ 가렌 강탈 성공 (도전 없음)`);
      g.phase = "action"; advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }
    if (ctx.skill === "Akali") {
      if (!target || !target.isAlive || target.hand.length === 0) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }
      g.phase = "awaitBlockAkali";
      g.pendingBlock = { type: "akali", actorId: actor.id, targetId: target.id };
      g.timerExpire = now() + BLOCK_AKALI_MS;  // ✅ 타이머 표시
      g.banner = `🥷 ${actor.nickname} → ${target.nickname} 아칼리 — 타깃 브라움 방어(7초)`;
      pushLog(g, `🥷 ${actor.nickname} → ${target.nickname} 아칼리 (도전 없음)`);
      scheduleBlockAkaliTimeout(g); broadcast(g); return;
    }
    if (ctx.skill === "TwistedFate") {
      g.phase = "awaitTFDiscard";
      g.pendingTf = { actorId: actor.id };
      g.timerExpire = now() + TF_DISCARD_MS;   // ✅ 타이머 표시
      g.banner = `🎴 ${actor.nickname} 트페 — 손패에서 교환할 카드 선택(10초)`;
      pushLog(g, `🎴 ${actor.nickname} 트페 (도전 없음)`);
      scheduleTfDiscardTimeout(g); broadcast(g); return;
    }
  } else {
    // block
    if (ctx.blockType === "take2") {
      // 제지 유지 → +2 무효
      pushLog(g, `🛑 블라디 제지 유지 — +2 무효`);
      g.phase = "action"; g.pendingBlock = undefined;
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }
    if (ctx.blockType === "garenSteal") {
      // 제지 유지 → 강탈 무효
      pushLog(g, `🛡️ 가렌 강탈 제지 유지 — 강탈 무효`);
      g.phase = "action";
      g.pendingBlock = undefined;
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }
    if (ctx.blockType === "akali") {
      // 방어 유지 → 아칼리 무효
      pushLog(g, `🛡️ 아칼리 방어 유지 — 공격 무효`);
      g.phase = "action"; g.pendingBlock = undefined;
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }
  }
}

/* 증명 결과 처리 */
function handleProofResult(g: Game, success: boolean) {
  const pendC = g.pendingChallenge!;
  const challengerId = pendC.challengerId!;

  if (success) {
    // 도전자 1장 손실 대기 후 원효과 진행
    openLoseOne(g, challengerId);
  } else {
    // 원효과 취소/무효 처리 즉시
    finalizePostChallenge(g, false);
  }
}

// 공개 선택 처리
function handleProofReveal(g: Game, cardId: string) {
  if (!g.pendingProof || !g.pendingChallenge) return;
  const { claimantId, claimName } = g.pendingProof;
  const claimant = g.players.find(p => p.id === claimantId);
  if (!claimant) return;

  const idx = claimant.hand.findIndex(c => String(c.id) === String(cardId));
  if (idx < 0) return;

  // 공개!
  const [card] = claimant.hand.splice(idx, 1);
  pushLog(g, `🔎 ${claimant.nickname} 가 공개: ${card.name}`);

  const success = (card.name === claimName);

  // 공개 카드는 덱으로 돌리고 셔플
  returnToDeckAndShuffle(g, card);

  // 규칙: 증명 성공 시 공개 카드는 덱으로 넣고 1장 보충 / 실패 시 보충 없음
  if (success) {
    const newCard = drawOne(g);
    if (newCard) claimant.hand.push(newCard);
    checkElimination(g, claimant);
    if (maybeEndGame(g)) {
      g.pendingProof = undefined;
      g.pendingChallenge = undefined;
      g.pendingBlock = undefined;
      g.pendingKill = undefined;
      g.pendingTf = undefined;
      g.pendingGarenResponse = undefined;
      broadcast(g);
      return;
    }
  } else {
    checkElimination(g, claimant);
    if (maybeEndGame(g)) {
      g.pendingProof = undefined;
      g.pendingChallenge = undefined;
      g.pendingBlock = undefined;
      g.pendingKill = undefined;
      g.pendingTf = undefined;
      g.pendingGarenResponse = undefined;
      broadcast(g);
      return;
    }
  }

  g.pendingProof = undefined;
  clearProofTimeout(g.roomCode);

  handleProofResult(g, success);
  broadcast(g);
}

// 도전 전체 종결
function finalizePostChallenge(g: Game, success: boolean) {
  const pend = g.pendingChallenge!;
  const ctx = pend.ctx;

  // lose 단계 종료 정리
  if (g.phase === "awaitLoseOne") {
    g.pendingLose = undefined;
    clearLoseTimeout(g.roomCode);
  }

  // pendingChallenge 정리
  g.pendingChallenge = undefined;

  if (ctx.kind === "skill") {
    const actor = g.players.find(p => p.id === ctx.actorId);
    const target = ctx.targetId ? g.players.find(p => p.id === ctx.targetId) : undefined;
    if (!actor || !actor.isAlive) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }

    if (ctx.skill === "Vladimir") {
      if (success) {
        actor.coins += 3;
        pushLog(g, `🧛 ${actor.nickname} 블라디 +3 (증명 성공)`);
      } else {
        pushLog(g, `❌ 블라디 무효 (증명 실패)`);
      }
      g.phase = "action"; advanceTurn(g); if (!maybeEndGame(g)) { broadcast(g); startTurnTimer(g); } return;
    }

    if (ctx.skill === "Garen") {
      if (!target || !target.isAlive) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }
      if (success) {
        // 스킬 도전 통과 → 즉시 강탈 성공
        const amt = Math.min(2, target.coins);
        target.coins -= amt; actor.coins += amt;
        pushLog(g, `🗡️ 가렌 강탈 성공 (증명 성공) — ${actor.nickname} 가 ${target.nickname} 에게서 ${amt} 강탈`);
      } else {
        pushLog(g, `❌ 가렌 강탈 무효 (증명 실패)`);
      }
      g.phase = "action"; advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    if (ctx.skill === "Akali") {
      if (!target || !target.isAlive || target.hand.length === 0) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }
      if (success) {
        g.phase = "awaitBlockAkali";
        g.pendingBlock = { type: "akali", actorId: actor.id, targetId: target.id };
        g.timerExpire = now() + BLOCK_AKALI_MS; // ✅ 타이머 표시
        g.banner = `🥷 ${actor.nickname} → ${target.nickname} 아칼리 — 타깃 브라움 방어(7초)`;
        pushLog(g, `🥷 아칼리 진행 (증명 성공)`);
        scheduleBlockAkaliTimeout(g); broadcast(g); return;
      } else {
        pushLog(g, `❌ 아칼리 무효 (증명 실패)`);
        g.phase = "action"; advanceTurn(g); broadcast(g); startTurnTimer(g); return;
      }
    }

    if (ctx.skill === "TwistedFate") {
      if (success) {
        g.phase = "awaitTFDiscard";
        g.pendingTf = { actorId: actor.id };
        g.timerExpire = now() + TF_DISCARD_MS;  // ✅ 타이머 표시
        g.banner = `🎴 ${actor.nickname} 트페 — 교환 카드 선택(10초)`;
        pushLog(g, `🎴 트페 진행 (증명 성공)`);
        scheduleTfDiscardTimeout(g); broadcast(g); return;
      } else {
        pushLog(g, `❌ 트페 무효 (증명 실패)`);
        g.phase = "action"; advanceTurn(g); broadcast(g); startTurnTimer(g); return;
      }
    }
  } else {
    // block claim
    const actor = g.players.find(p => p.id === ctx.actorId);  // 원행동자
    const target = ctx.targetId ? g.players.find(p => p.id === ctx.targetId) : undefined;

    if (ctx.blockType === "take2") {
      if (!actor || !actor.isAlive) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }
      if (success) {
        pushLog(g, `🛑 블라디 제지 유지 (증명 성공) — +2 무효`);
      } else {
        actor.coins += 2;
        pushLog(g, `✅ 제지 무효 (증명 실패) — ${actor.nickname} 코인 +2`);
      }
      g.phase = "action"; g.pendingBlock = undefined;
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    if (ctx.blockType === "garenSteal") {
      if (!actor || !target || !actor.isAlive || !target.isAlive) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }
      if (success) {
        pushLog(g, `🛡️ 가렌 제지 유지 (증명 성공) — 강탈 무효`);
      } else {
        const amt = Math.min(2, target.coins);
        target.coins -= amt; actor.coins += amt;
        pushLog(g, `✅ 제지 무효 (증명 실패) — ${actor.nickname} 가 ${target.nickname} 에게서 ${amt} 강탈`);
      }
      g.phase = "action"; g.pendingBlock = undefined;
      advanceTurn(g); broadcast(g); startTurnTimer(g); return;
    }

    if (ctx.blockType === "akali") {
      if (!actor || !target || !actor.isAlive || !target.isAlive) { advanceTurn(g); broadcast(g); startTurnTimer(g); return; }
      if (success) {
        pushLog(g, `🛡️ 브라움 방어 유지 (증명 성공) — 아칼리 무효`);
        g.phase = "action"; g.pendingBlock = undefined;
        advanceTurn(g); broadcast(g); startTurnTimer(g); return;
      } else {
        // 방어 무효 → 즉시 아칼리 성공 → 처형으로 전환
        g.pendingBlock = undefined;
        g.phase = "awaitKillChoice";
        g.pendingKill = { byId: actor.id, targetId: target.id };
        g.timerExpire = now() + KILL_CHOICE_MS; // ✅ 타이머 표시
        g.banner = `🗡️ 아칼리 성공 — ${target.nickname} 카드 1장 선택(8초)`;
        pushLog(g, `✅ 방어 무효 (증명 실패) — 아칼리 성공`);
        if (target.socketId) {
          const brief = target.hand.map(c => ({ id: c.id, name: c.name }));
          io.to(target.socketId).emit("killChoice", brief);
        }
        scheduleKillTimeout(g); broadcast(g); return;
      }
    }
  }
}

/* ──────────────────────────────────────────────
 * 소켓 이벤트
 * ────────────────────────────────────────────── */

function findOrCreateGame(roomCode: string): Game {
  if (!rooms[roomCode]) rooms[roomCode] = newGame(roomCode);
  return rooms[roomCode];
}
function getPlayerById(g: Game, pid?: string) {
  return g.players.find(p => p.id === pid);
}

io.on("connection", (socket) => {
  socket.on("createRoom", (nickname, playerId, cb) => {
    const roomCode = (Math.floor(100000 + Math.random()*900000)).toString();
    const game = findOrCreateGame(roomCode);
    if (!game.hostId) game.hostId = playerId; // 방장 지정

    const p: PlayerState = {
      id: playerId, socketId: socket.id, nickname,
      coins: 0, hand: [], graveyard: [], afkCount: 0, isAlive: true, disconnectedAt: null
    };
    game.players.push(p);
    socket.join(roomCode);
    cb(roomCode);
    pushLog(game, `🟢 ${nickname} 방에 입장${game.hostId===playerId ? " (방장)" : ""}`);
    broadcast(game);
  });

  socket.on("joinRoom", (roomCode, nickname, playerId, cb) => {
    const game = rooms[roomCode];
    if (!game) { cb(false, "방을 찾을 수 없습니다."); return; }
    if (game.players.length >= 6) { cb(false, "정원이 가득 찼습니다."); return; }

    let player = game.players.find(pl => pl.id === playerId);
    if (player) {
      player.socketId = socket.id;
      player.nickname = nickname || player.nickname;
      player.disconnectedAt = null;
      pushLog(game, `🔄 ${player.nickname} 재접속`);
    } else {
      player = {
        id: playerId, socketId: socket.id, nickname,
        coins: 0, hand: [], graveyard: [], afkCount: 0, isAlive: true, disconnectedAt: null
      };
      game.players.push(player);
      pushLog(game, `🟢 ${nickname} 방에 입장`);
    }
    socket.join(roomCode);
    cb(true);
    broadcast(game);
  });

  socket.on("startGame", () => {
    const roomCode = [...socket.rooms].find(r => rooms[r]);
    if (!roomCode) return;
    const game = rooms[roomCode];
    if (!game) return;

    const requester = game.players.find(p => p.socketId === socket.id);
    if (!requester) return;

    if (game.hostId !== requester.id) {
      io.to(socket.id).emit("error", "방장만 게임을 시작할 수 있습니다.");
      return;
    }
    if (game.started) return;
    if (game.players.length < 2) {
      io.to(socket.id).emit("error", "플레이어가 최소 2명 필요합니다.");
      return;
    }

    game.deck = buildDeck();
    dealInitial(game);
    game.turnIndex = 0;
    game.phase = "action";
    game.started = true;
    game.winnerId = undefined;
    game.banner = "";

    pushLog(game, "🚀 게임 시작");
    broadcast(game);
    startTurnTimer(game);
  });

  socket.on("action", (payload) => {
    const pld: any = payload || {};
    let roomCode = pld.roomCode || [...socket.rooms].find(r => rooms[r]);
    if (!roomCode) return;
    const game = rooms[roomCode];
    if (!game) return;

    const kind = pld?.type;

    // ───────── (A) 턴 소유자 제한 없이 처리해야 하는 이벤트들 ─────────

    // 처형 타깃의 카드 선택
    if (kind === "chooseKillCard") {
      const pend = game.pendingKill;
      if (!pend) return;
      const target = getPlayerById(game, pend.targetId);
      const by = getPlayerById(game, pend.byId);
      if (!target || !by) return;
      if (target.socketId !== socket.id) return;
      if (game.phase !== "awaitKillChoice") return;

      const cardId = String(pld.cardId);
      const idx = target.hand.findIndex(c => c.id === cardId);
      if (idx < 0) { io.to(socket.id).emit("error", "해당 카드를 찾을 수 없습니다."); return; }

      clearKillTimeout(roomCode);

      const [removed] = target.hand.splice(idx, 1);
      returnToDeckAndShuffle(game, removed);

      pushLog(game, `💀 ${target.nickname} 이(가) 카드 1장을 버리고 덱으로 되돌렸습니다.`);
      game.banner = ""; game.pendingKill = undefined; game.phase = "action";
      if (target.socketId) io.to(target.socketId).emit("killChoiceClose");

      checkElimination(game, target);
      if (maybeEndGame(game)) return;

      advanceTurn(game); broadcast(game); startTurnTimer(game);
      return;
    }

    // 블라디 제지 선언
    if (kind === "blockTake2") {
      const pend = game.pendingBlock;
      if (!pend || pend.type !== "take2" || game.phase !== "awaitBlockTake2") return;
      const blocker = game.players.find(p => p.socketId === socket.id);
      const { actorId } = pend;
      const actor   = getPlayerById(game, actorId);
      if (!blocker || !actor) return;
      if (!blocker.isAlive) return;
      if (blocker.id === actor.id) return;

      clearBlockTimeout(roomCode);

      game.banner = `🛑 ${blocker.nickname} 블라디로 제지 주장 — ${actor.nickname} 도전 가능 (7초)`;
      pushLog(game, `🛑 ${blocker.nickname} 블라디 제지 주장`);
      openChallenge(game,
        { kind: "block", blockType: "take2", claimantId: blocker.id, actorId: actor.id },
        "Vladimir",
        actor.id
      );
      broadcast(game);
      return;
    }

    // 아칼리 브라움 방어
    if (kind === "blockAkali") {
      const pend = game.pendingBlock;
      if (!pend || pend.type !== "akali" || game.phase !== "awaitBlockAkali") return;
      const target = getPlayerById(game, pend.targetId);
      const actor  = getPlayerById(game, pend.actorId);
      if (!target || !actor) return;
      if (target.socketId !== socket.id) return;

      clearBlockTimeout(roomCode);

      game.banner = `🛡️ ${target.nickname} 브라움 방어 주장 — ${actor.nickname} 도전 가능 (7초)`;
      pushLog(game, `🛡️ ${target.nickname} 브라움 방어 주장`);
      openChallenge(game,
        { kind: "block", blockType: "akali", claimantId: target.id, actorId: actor.id, targetId: target.id, by: "Braum" },
        "Braum",
        actor.id
      );
      broadcast(game);
      return;
    }

    // 도전 버튼
    if (kind === "challenge") {
      if (game.phase !== "awaitChallenge" || !game.pendingChallenge) return;
      const pc = game.pendingChallenge;
      const challenger = game.players.find(p => p.socketId === socket.id);
      if (!challenger || !challenger.isAlive) return;

      // 도전자 제한 검사
      if (pc.allowedChallengerId) {
        if (challenger.id !== pc.allowedChallengerId) { io.to(socket.id).emit("error", "도전 권한이 없습니다."); return; }
      } else {
        const claimantId = pc.ctx.kind === "skill" ? pc.ctx.actorId : pc.ctx.claimantId;
        if (challenger.id === claimantId) { io.to(socket.id).emit("error", "본인은 도전할 수 없습니다."); return; }
      }
      if (pc.challengerId) { io.to(socket.id).emit("error", "이미 도전이 접수되었습니다."); return; }

      clearChallengeTimeout(roomCode);
      pc.challengerId = challenger.id;
      const claimantId = pc.ctx.kind === "skill" ? pc.ctx.actorId : pc.ctx.claimantId;

      game.banner = `⚖️ 도전 발생 — ${game.players.find(p=>p.id===claimantId)?.nickname} 이(가) ${pc.claimName} 공개로 증명 (8초)`;
      pushLog(game, `⚖️ 도전 — 증명 대기 (${pc.claimName})`);

      openProof(game, claimantId, pc.claimName);
      broadcast(game);
      return;
    }

    // 증명: 공개 카드 선택
    if (kind === "proofReveal") {
      if (game.phase !== "awaitProof" || !game.pendingProof || !game.pendingChallenge) return;
      const claimant = game.players.find(p => p.socketId === socket.id);
      if (!claimant || claimant.id !== game.pendingProof.claimantId) return;

      handleProofReveal(game, String(pld.cardId));
      return;
    }

    // 패배 측 1장 손실
    if (kind === "loseOne") {
      if (game.phase !== "awaitLoseOne" || !game.pendingLose || !game.pendingChallenge) return;
      const loser = game.players.find(p => p.socketId === socket.id);
      if (!loser || loser.id !== game.pendingLose.playerId) return;

      const idx = loser.hand.findIndex(c => String(c.id) === String(pld.cardId));
      if (idx < 0) { io.to(socket.id).emit("error", "해당 카드를 찾을 수 없습니다."); return; }

      clearLoseTimeout(roomCode);

      const [removed] = loser.hand.splice(idx, 1);
      returnToDeckAndShuffle(game, removed);
      pushLog(game, `🗑️ ${loser.nickname} 카드 1장 손실 (비공개)`);
      checkElimination(game, loser);
      if (maybeEndGame(game)) return;

      game.pendingLose = undefined;
      finalizePostChallenge(game, true);
      broadcast(game);
      return;
    }

    // 가렌 응답(도전/가렌제지/트페제지)
    if (kind === "garenResponse") {
      if (game.phase !== "awaitGarenResponse" || !game.pendingGarenResponse) return;
      const { actorId, targetId } = game.pendingGarenResponse;
      const target = getPlayerById(game, targetId);
      const actor  = getPlayerById(game, actorId);
      if (!target || !actor) return;
      if (target.socketId !== socket.id) return;

      clearGarenRespTimeout(roomCode);

      if (pld.choice === "challenge") {
        game.banner = `⚖️ 도전 — ${actor.nickname} 이(가) 가렌 공개로 증명 (8초)`;
        pushLog(game, `⚔️ 가렌 스킬에 도전`);
        game.pendingGarenResponse = undefined;
        openChallenge(
          game,
          { kind: "skill", skill: "Garen", actorId: actor.id, targetId: target.id },
          "Garen",
          undefined,
          target.id // pre-chosen challenger
        );
        broadcast(game);
        return;
      }

      if (pld.choice === "blockGaren" || pld.choice === "blockTF") {
        const by = pld.choice === "blockGaren" ? "Garen" : "TwistedFate";
        game.banner = `🛡️ ${target.nickname} ${by} 로 제지 주장 — ${actor.nickname} 도전 가능 (7초)`;
        pushLog(game, `🛡️ ${target.nickname} 가 ${by} 로 제지 주장`);
        game.pendingGarenResponse = undefined;

        openChallenge(
          game,
          { kind: "block", blockType: "garenSteal", claimantId: target.id, actorId: actor.id, targetId: target.id, by: by as any },
          by as any,
          actor.id // allowed challenger = 가렌 시전자
        );
        broadcast(game);
        return;
      }

      return;
    }

    // 트페: 교환 카드 선택(시전자 전용)
    if (kind === "tfSwap") {
      if (game.phase !== "awaitTFDiscard" || !game.pendingTf) {
        io.to(socket.id).emit("error", "트페 교환 단계가 아닙니다.");
        return;
      }
      const pend = game.pendingTf;
      const actor = game.players.find(p => p.id === pend.actorId);
      if (!actor || actor.socketId !== socket.id) {
        io.to(socket.id).emit("error", "교환 권한이 없습니다(시전자 아님).");
        return;
      }
      if (!actor.isAlive || actor.hand.length === 0) {
        game.banner = "";
        game.pendingTf = undefined;
        game.phase = "action";
        advanceTurn(game); broadcast(game); startTurnTimer(game);
        return;
      }

      const cardId = String(pld.cardId);
      const idx = actor.hand.findIndex(c => String(c.id) === cardId);
      if (idx < 0) {
        io.to(socket.id).emit("error", "해당 카드를 손패에서 찾을 수 없습니다.");
        return;
      }

      clearTfTimeout(roomCode);

      const [outCard] = actor.hand.splice(idx, 1);
      returnToDeckAndShuffle(game, outCard);
      const drawn = drawOne(game);
      if (drawn) actor.hand.push(drawn);

      pushLog(game, `🎴 ${actor.nickname} 트페 — 손패 1장을 덱과 교환`);
      game.banner = "";
      game.pendingTf = undefined;
      game.phase = "action";

      advanceTurn(game); broadcast(game); startTurnTimer(game);
      return;
    }

    // ───────── (B) 그 외는 게임 진행/턴 소유자/시작 여부 확인 ─────────

    if (game.phase === "finished") { io.to(socket.id).emit("error", "게임이 종료되었습니다."); return; }
    if (!game.started) { io.to(socket.id).emit("error", "게임이 아직 시작되지 않았습니다."); return; }

    const current = game.players[game.turnIndex];
    if (!current || current.socketId !== socket.id) return;

    const acted = () => { current.afkCount = 0; };

    // 기본 행동
    if (kind === "take1") {
      current.coins += 1; acted();
      pushLog(game, `🪙 ${current.nickname} 코인 +1`);
      advanceTurn(game); broadcast(game); startTurnTimer(game); return;
    }

    if (kind === "take2") {
      acted();
      game.phase = "awaitBlockTake2";
      game.pendingBlock = { type: "take2", actorId: current.id };
      game.timerExpire = now() + BLOCK_TAKE2_MS; // ✅ 타이머 표시
      game.banner = `➕ ${current.nickname} 코인 +2 시도 — 블라디로 제지 가능 (7초)`;
      pushLog(game, `➕ ${current.nickname} 코인 +2 시도`);
      scheduleBlockTake2Timeout(game);
      broadcast(game);
      return;
    }

    // 스킬: 블라디
    if (kind === "useSkill" && pld.skill === "Vladimir") {
      if (game.phase !== "action") return;
      acted();
      game.banner = `🧛 ${current.nickname} 블라디 +3 선언 — 도전 기회(7초)`;
      pushLog(game, `🧛 블라디 +3 선언`);
      openChallenge(game, { kind: "skill", skill: "Vladimir", actorId: current.id }, "Vladimir");
      broadcast(game); return;
    }

    // 스킬: 가렌 → 타깃에게 3가지 선택
    if (kind === "useSkill" && pld.skill === "Garen") {
      if (game.phase !== "action") return;
      const targetId = String(pld.targetId || "");
      const target = getPlayerById(game, targetId);
      if (!target || !target.isAlive) { io.to(socket.id).emit("error", "대상이 올바르지 않습니다."); return; }
      if (target.id === current.id) { io.to(socket.id).emit("error", "자기 자신은 대상이 될 수 없습니다."); return; }

      acted();
      game.phase = "awaitGarenResponse";
      game.pendingGarenResponse = { actorId: current.id, targetId: target.id };
      game.timerExpire = now() + GAREN_RESP_MS; // ✅ 타이머 표시
      game.banner = `🗡️ ${current.nickname} 가렌 강탈 선언 — ${target.nickname} (도전 / 가렌 제지 / 트페 제지 선택, 7초)`;
      pushLog(game, `🗡️ 가렌 강탈 선언 (타깃 응답 대기)`);
      scheduleGarenResponseTimeout(game);
      broadcast(game);
      return;
    }

    // 스킬: 아칼리
    if (kind === "useSkill" && pld.skill === "Akali") {
      if (game.phase !== "action") return;
      if (current.coins < 3) { io.to(socket.id).emit("error", "코인이 부족합니다. (필요: 3)"); return; }
      const targetId = String(pld.targetId || "");
      const target = getPlayerById(game, targetId);
      if (!target || !target.isAlive) { io.to(socket.id).emit("error", "대상이 올바르지 않습니다."); return; }
      if (target.id === current.id) { io.to(socket.id).emit("error", "자기 자신은 대상이 될 수 없습니다."); return; }
      if (target.hand.length === 0) { io.to(socket.id).emit("error", "카드가 없는 플레이어는 대상으로 지정할 수 없습니다."); return; }

      current.coins -= 3; acted();
      game.banner = `🥷 ${current.nickname} 아칼리 선언(3c) — ${target.nickname} 도전 기회(7초)`;
      pushLog(game, `🥷 아칼리 선언 (3코인 소모)`);
      openChallenge(game, { kind: "skill", skill: "Akali", actorId: current.id, targetId: target.id }, "Akali", target.id);
      broadcast(game); return;
    }

    // 스킬: 트페
    if (kind === "useSkill" && pld.skill === "TwistedFate") {
      if (game.phase !== "action") return;
      if ((current.hand?.length ?? 0) < 1) { io.to(socket.id).emit("error", "손패가 비어 있어 교환할 수 없습니다."); return; }

      acted();
      game.banner = `🎴 ${current.nickname} 트페 교환 선언 — 도전 기회(7초)`;
      pushLog(game, `🎴 트페 교환 선언`);
      openChallenge(game, { kind: "skill", skill: "TwistedFate", actorId: current.id }, "TwistedFate");
      broadcast(game); return;
    }

    // 처형/부활
    if (kind === "pay7Kill") {
      if (game.phase !== "action") return;
      const targetId = String(pld.targetId);
      const target = getPlayerById(game, targetId);
      if (!target || !target.isAlive) { io.to(socket.id).emit("error", "대상이 올바르지 않습니다."); return; }
      if (target.hand.length === 0) { io.to(socket.id).emit("error", "카드가 없는 플레이어는 처형할 수 없습니다."); return; }
      if (current.coins < 7) { io.to(socket.id).emit("error", "코인이 부족합니다."); return; }

      current.coins -= 7; acted();
      game.phase = "awaitKillChoice";
      game.pendingKill = { byId: current.id, targetId: target.id };
      game.timerExpire = now() + KILL_CHOICE_MS; // ✅ 타이머 표시
      game.banner = `🗡️ ${current.nickname} → ${target.nickname} 처형 — 타깃이 버릴 카드 선택(8초)`;

      if (target.socketId) {
        const brief = target.hand.map(c => ({ id: c.id, name: c.name }));
        io.to(target.socketId).emit("killChoice", brief);
      }
      pushLog(game, `🗡️ 처형 시도 (7코인 지불)`);
      scheduleKillTimeout(game);
      broadcast(game);
      return;
    }

    if (kind === "pay10Revive") {
      if (game.phase !== "action") return;
      if (current.coins < 10) { io.to(socket.id).emit("error", "코인이 부족합니다."); return; }
      if ((current.hand?.length ?? 0) !== 1) { io.to(socket.id).emit("error", "손패가 1장일 때만 부활을 사용할 수 있습니다."); return; }
      if (game.deck.length === 0) { io.to(socket.id).emit("error", "덱이 비어 있습니다."); return; }

      current.coins -= 10; acted();
      const drawn = game.deck.pop()!;
      current.hand.push(drawn);

      pushLog(game, `✨ ${current.nickname} 부활 — 덱에서 1장을 가져왔습니다. (10코인)`);
      advanceTurn(game); broadcast(game); startTurnTimer(game); return;
    }
  });

  socket.on("disconnect", () => {
    const roomCode = [...socket.rooms].find(r => rooms[r]);
    if (!roomCode) return;
    const game = rooms[roomCode];
    if (!game) return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    player.disconnectedAt = now();
    setTimeout(() => {
      const g = rooms[roomCode];
      if (!g) return;
      const p = g.players.find(pp => pp.id === player.id);
      if (!p) return;
      if (p.disconnectedAt && now() - p.disconnectedAt >= GRACE_MS) {
        p.isAlive = false;
        pushLog(g, `❌ ${p.nickname} 연결 종료 — 탈락 처리`);
        if (maybeEndGame(g)) return;
        broadcast(g);
      }
    }, GRACE_MS + 100);
  });
});

app.get("/", (_req, res) => res.send("Boardgame backend is running."));

// ✅ 환경변수 PORT를 숫자로 안전 파싱 + 로컬 기본 포트 지정
//   - Render 같은 PaaS에선 PORT가 문자열로 주어지므로 Number(...)가 안전합니다.
//   - 로컬 기본 포트는 3001을 권장(프런트가 기본으로 3001에 붙도록 되어있는 경우가 많음).
//     지금 8080을 쓰고 싶다면 3001 대신 8080을 그대로 두셔도 됩니다.
const PORT: number = Number(process.env.PORT) || 3001;

// ✅ 일부 호스팅은 0.0.0.0 바인딩이 필요합니다(외부 접속 허용).
const HOST = '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
