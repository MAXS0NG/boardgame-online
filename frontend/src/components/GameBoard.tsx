import React, { useEffect, useMemo, useState } from 'react'
import { getSocket } from '../hooks/useSocket'
import { cardImageSrc } from '../championAssets'
import { useGameEvents } from '../hooks/useGameEvents'
import { getSfxEnabled, setSfxEnabled } from '../effects/sfx'

type Player = { id: string; nickname: string; coins: number; afkCount: number; isAlive: boolean; hand?: any[] }
type LogEntry = { ts: number; text: string }

/** 카드 썸네일 — 이름 표준화 → PNG 우선, 실패 시 WebP, 최종 데이터URL */
function CardThumb({ name, className }: { name: string; className?: string }) {
  const src = cardImageSrc(name);
  return (
    <img
      src={src}
      alt={name}
      className={className ?? "w-20 h-28 object-cover rounded"}
    />
  );
}


export default function GameBoard({ state, playerId }: { state: any, playerId: string }) {
  const s = getSocket()
  useGameEvents(state) // 효과음 트리거

  // 타이머 UI
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 300); return () => clearInterval(id) }, [])
  const remainSec = Math.max(0, Math.floor((state.timerExpire - nowTick) / 1000))

  // 사운드 토글
  const [sfxOn, setSfxOn] = useState(getSfxEnabled())
  const toggleSfx = () => { setSfxEnabled(!sfxOn); setSfxOn(!sfxOn) }

  // 모달/바 상태
  const [targetPickOpen, setTargetPickOpen] = useState(false) // 처형 타깃
  const [garenPickOpen, setGarenPickOpen] = useState(false)   // 가렌 타깃
  const [akaliPickOpen, setAkaliPickOpen] = useState(false)   // 아칼리 타깃

  // 처형: 내가 타깃일 때(버릴 카드 선택)
  const [killChoiceCards, setKillChoiceCards] = useState<{id: string; name: string}[] | null>(null)
  useEffect(() => {
    const onChoice = (cards: {id: string; name: string}[]) => setKillChoiceCards(cards)
    const onClose  = () => setKillChoiceCards(null)
    const onErr    = (msg: string) => console.error('[server error]', msg)
    s.on('killChoice', onChoice); s.on('killChoiceClose', onClose); s.on('error', onErr)
    return () => { s.off('killChoice', onChoice); s.off('killChoiceClose', onClose); s.off('error', onErr) }
  }, [s])
  useEffect(() => { if (state.phase !== 'awaitKillChoice' && killChoiceCards) setKillChoiceCards(null) }, [state.phase, killChoiceCards])

  // 현재 플레이어/권한
  const youIndex = state.players.findIndex((p: Player) => p.id === playerId)
  const you: Player = state.players[youIndex]
  const isYourTurn = youIndex === state.turnIndex
  const isHost = state.hostId === playerId

  // 바닥 선택 바 데이터
  const isKillTarget = state.phase === 'awaitKillChoice' && state?.pendingKill?.targetId === playerId
  const bottomChoices: { id: string; name: string }[] | null =
    killChoiceCards ??
    (isKillTarget && you?.hand?.length ? (you.hand as any[]).map(c => ({ id: String(c.id), name: String(c.name) })) : null)

  // 상태 플래그
  const isAwaitChallenge   = state.phase === 'awaitChallenge'
  const isAwaitProof       = state.phase === 'awaitProof'
  const isAwaitLoseOne     = state.phase === 'awaitLoseOne'
  const isAwaitGarenResp   = state.phase === 'awaitGarenResponse'
  const isAwaitAkali       = state.phase === 'awaitBlockAkali'
  const isAwaitTake2       = state.phase === 'awaitBlockTake2'
  const isAwaitTFDiscard   = state.phase === 'awaitTFDiscard'

  const challenge = state.pendingChallenge
  const proof = state.pendingProof
  const lose = state.pendingLose
  const garenResp = state.pendingGarenResponse

  const claimantId = challenge?.ctx?.kind === 'skill' ? challenge?.ctx?.actorId : challenge?.ctx?.claimantId
  const claimName = challenge?.claimName

  const youCanChallenge = useMemo(() => {
    if (!isAwaitChallenge || !challenge) return false
    if (!you?.isAlive) return false
    if (challenge.allowedChallengerId) return challenge.allowedChallengerId === playerId
    return claimantId && claimantId !== playerId
  }, [isAwaitChallenge, challenge, you?.isAlive, playerId, claimantId])

  const youAreClaimant = isAwaitProof && proof?.claimantId === playerId
  const youLoseOne     = isAwaitLoseOne && lose?.playerId === playerId
  const isTFActor      = isAwaitTFDiscard && state?.pendingTf?.actorId === playerId

  // 행동 핸들러
  const take1 = () => s.emit('action', { type: 'take1' })
  const take2 = () => s.emit('action', { type: 'take2' })

  const openKill = () => setTargetPickOpen(true)
  const doKillOn = (targetId: string) => { setTargetPickOpen(false); s.emit('action', { type: 'pay7Kill', targetId }) }
  const chooseKillCard = (cardId: string) => { setKillChoiceCards(null); s.emit('action', { type: 'chooseKillCard', cardId, roomCode: state.roomCode }) }
  const revive = () => s.emit('action', { type: 'pay10Revive' })
  const startGame = () => s.emit('startGame')

  // 스킬 바
  const showSkillBar = state.started && state.phase === 'action' && isYourTurn && state.phase !== 'finished'
  const useSkillVlad = () => s.emit('action', { type: 'useSkill', skill: 'Vladimir' })
  const openGaren = () => setGarenPickOpen(true)
  const useSkillGarenOn = (targetId: string) => { setGarenPickOpen(false); s.emit('action', { type: 'useSkill', skill: 'Garen', targetId }) }
  const openAkali = () => setAkaliPickOpen(true)
  const useSkillAkaliOn = (targetId: string) => { setAkaliPickOpen(false); s.emit('action', { type: 'useSkill', skill: 'Akali', targetId }) }
  const useSkillTF = () => s.emit('action', { type: 'useSkill', skill: 'TwistedFate' })

  const skills = [
    { key: 'Vladimir',    label: '블라디미르 — 코인 +3',            onClick: useSkillVlad },
    { key: 'Garen',       label: '가렌 — 상대 코인 2 강탈',          onClick: openGaren },
    { key: 'Akali',       label: '아칼리 — 브라움 방어 없으면 처형', onClick: openAkali },
    { key: 'TwistedFate', label: '트페 — 손패 1장 덱과 교환',        onClick: useSkillTF },
  ] as const

  // 제지/방어/선택 상태 및 핸들러
  const take2ActorId = state?.pendingBlock?.type === 'take2' ? state.pendingBlock.actorId : undefined
  const isBlockerTake2 = isAwaitTake2 && playerId !== take2ActorId && (you?.isAlive !== false)
  const blockTake2 = () => s.emit('action', { type: 'blockTake2' })

  const akaliTargetId = (state?.pendingBlock?.type === 'akali') ? state.pendingBlock.targetId : undefined
  const isAkaliBlockTarget = isAwaitAkali && akaliTargetId === playerId
  const blockAkaliAsBraum  = () => s.emit('action', { type: 'blockAkali', by: 'Braum' })

  const tfSwap = (cardId: string) => s.emit('action', { type: 'tfSwap', cardId })

  // 대상 필터 (youIndex 재사용 — 중복 선언 금지)
  const eligibleTargetsForKill = state.players.filter((p: Player, idx: number) => idx !== youIndex && p.isAlive && (p.hand?.length ?? 0) > 0)
  const eligibleTargetsForGaren = state.players.filter((p: Player, idx: number) => idx !== youIndex && p.isAlive)
  const eligibleTargetsForAkali = eligibleTargetsForKill

  const canKill   = state.started && isYourTurn && you.coins >= 7 && eligibleTargetsForKill.length > 0 && state.phase === 'action'
  const canRevive = state.started && isYourTurn && you.coins >= 10 && (you?.hand?.length ?? 0) === 1 && state.phase === 'action' && (state.deck?.length ?? 0) > 0

  // 배너 배경색(간단 톤)
  const bannerClass = useMemo(() => {
    const base = "mt-3 p-3 text-center border rounded "
    const pc = state.pendingChallenge
    if (!pc) return base + "bg-amber-700/40 border-amber-600"
    const ctx = pc.ctx
    if (ctx.kind === 'skill') {
      if (ctx.skill === 'Vladimir')    return base + "bg-purple-700/40 border-purple-600"
      if (ctx.skill === 'Garen')       return base + "bg-indigo-700/40 border-indigo-600"
      if (ctx.skill === 'Akali')       return base + "bg-emerald-700/40 border-emerald-600"
      if (ctx.skill === 'TwistedFate') return base + "bg-fuchsia-700/40 border-fuchsia-600"
    } else {
      if (ctx.blockType === 'take2')       return base + "bg-purple-700/30 border-purple-600"
      if (ctx.blockType === 'garenSteal')  return base + "bg-indigo-700/30 border-indigo-600"
      if (ctx.blockType === 'akali')       return base + "bg-emerald-700/30 border-emerald-600"
    }
    return base + "bg-amber-700/40 border-amber-600"
  }, [state.pendingChallenge])

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <header className="flex justify-between items-center">
        <h1 className="text-xl font-bold">보드게임</h1>
        <div className="flex items-center gap-3">
          <div>방 코드: <b>{state.roomCode}</b></div>
          <button className={"px-2 py-1 rounded " + (sfxOn ? "bg-emerald-600" : "bg-gray-600")} onClick={toggleSfx}>
            🔊 SFX {sfxOn ? 'ON' : 'OFF'}
          </button>
        </div>
      </header>

      {!!state.banner && (
        <div className={bannerClass}>
          {state.banner}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 로그 */}
        <aside className="bg-gray-800 p-4 rounded md:col-span-1">
          <h2 className="font-semibold mb-2">게임 로그</h2>
          <ul className="space-y-2 max-h-[50vh] overflow-auto pr-1">
            {(state.log as LogEntry[]).map((e, i) => (
              <li key={i} className="text-sm text-gray-300">• {e.text}</li>
            ))}
          </ul>
        </aside>

        {/* 메인 */}
        <section className="bg-gray-800 p-4 rounded md:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div>현재 턴: <b>{state.players[state.turnIndex]?.nickname ?? "-"}</b></div>
              <div>남은 시간: <b>{state.started && state.phase!=='finished' ? `${remainSec}s` : "-"}</b></div>
              <div>단계: <b>{state.phase}</b></div>
              {!state.started && state.phase!=='finished' && <div className="text-sm text-gray-400 mt-1">게임이 아직 시작되지 않았습니다.</div>}
            </div>

            <div className="space-x-2">
              <button disabled={!state.started || state.phase!=='action' || !isYourTurn}
                      className="px-3 py-2 bg-blue-600 rounded disabled:opacity-50"
                      onClick={take1}>코인 +1</button>

              <button disabled={!state.started || state.phase!=='action' || !isYourTurn}
                      className="px-3 py-2 bg-green-600 rounded disabled:opacity-50"
                      onClick={take2}>코인 +2</button>

              <button disabled={!canKill}
                      className="px-3 py-2 bg-red-600 rounded disabled:opacity-50"
                      onClick={openKill}>처형 (7c)</button>

              <button disabled={!canRevive}
                      className="px-3 py-2 bg-yellow-600 rounded disabled:opacity-50"
                      onClick={revive}>부활 (10c)</button>
            </div>
          </div>

          {/* 손패 */}
          <div className="mt-4">
            <h2 className="font-semibold mb-2">내 손패 ({you?.hand?.length ?? 0})</h2>
            <div className="flex gap-2 flex-wrap">
              {(you?.hand ?? []).map((c: any) => (
                <div key={c.id} className="p-2 bg-gray-700 rounded flex items-center gap-2">
                  <CardThumb name={c.name} />
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-gray-300">스킬: {c.text?.skill}</div>
                    <div className="text-xs text-gray-300">패시브: {c.text?.passive}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 플레이어 */}
        <aside className="bg-gray-800 p-4 rounded md:col-span-1">
          <h2 className="font-semibold mb-2">플레이어</h2>
          <ul className="space-y-2">
            {state.players.map((p: Player, idx: number) => (
              <li key={p.id} className={"p-2 rounded " + (idx===state.turnIndex?'bg-gray-700':'bg-gray-900')}>
                <div className="flex justify-between">
                  <span>
                    {p.nickname} {p.isAlive ? '' : '(탈락)'}
                    {state.hostId === p.id ? ' 👑' : ''}
                  </span>
                  <span>{p.coins}c</span>
                </div>
                <div className="text-xs text-gray-400">AFK {p.afkCount}/3</div>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {/* 방장 시작 */}
      {!state.started && state.phase!=='finished' && (
        <div className="mt-4 flex justify-center">
          {isHost ? (
            <button className="px-4 py-2 bg-indigo-600 rounded" onClick={startGame}>게임 시작 (방장 전용)</button>
          ) : (
            <div className="px-4 py-2 text-gray-300 bg-gray-800 rounded">방장이 게임을 시작할 때까지 기다려 주세요.</div>
          )}
        </div>
      )}

      {/* 모달: 처형 타깃 */}
      {targetPickOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-4 rounded w-[90%] max-w-md">
            <div className="mb-2 text-center"><b>처형</b>: 타깃 플레이어를 선택하세요. (7코인 지불)</div>
            <div className="grid grid-cols-1 gap-2 mb-3">
              {eligibleTargetsForKill.map((p: any) => (
                <button key={p.id} className="w-full px-3 py-2 bg-red-600 rounded hover:bg-red-500" onClick={() => doKillOn(p.id)}>
                  {p.nickname} 처형
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-700 rounded" onClick={() => setTargetPickOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달: 가렌 타깃 */}
      {garenPickOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-4 rounded w-[90%] max-w-md">
            <div className="mb-2 text-center"><b>가렌 — 강탈</b>: 타깃 플레이어 선택</div>
            <div className="grid grid-cols-1 gap-2 mb-3">
              {eligibleTargetsForGaren.map((p: any) => (
                <button key={p.id} className="w-full px-3 py-2 bg-indigo-600 rounded hover:bg-indigo-500" onClick={() => { setGarenPickOpen(false); useSkillGarenOn(p.id) }}>
                  {p.nickname} 에게 강탈 시도
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-700 rounded" onClick={() => setGarenPickOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달: 아칼리 타깃 */}
      {akaliPickOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-4 rounded w-[90%] max-w-md">
            <div className="mb-2 text-center"><b>아칼리</b>: 처형 시도 대상 선택 (3코인)</div>
            <div className="text-sm text-gray-300 mb-2 text-center">타깃은 7초 동안 <b>브라움</b>으로 방어할 수 있습니다.</div>
            <div className="grid grid-cols-1 gap-2 mb-3">
              {eligibleTargetsForAkali.map((p: any) => (
                <button key={p.id} className="w-full px-3 py-2 bg-emerald-600 rounded hover:bg-emerald-500" onClick={() => { setAkaliPickOpen(false); useSkillAkaliOn(p.id) }}>
                  {p.nickname} 에게 사용
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-700 rounded" onClick={() => setAkaliPickOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 바(1): 처형 타깃 카드 선택 */}
      {bottomChoices && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-50">
          <div className="text-center mb-2"><b>처형 방어</b> — 버릴 카드를 선택하세요. (남은 {remainSec}s)</div>
          <div className="flex justify-center gap-2 flex-wrap">
            {bottomChoices.map(c => (
              <button key={c.id} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 flex items-center gap-2" onClick={() => chooseKillCard(c.id)}>
                <CardThumb name={c.name} className="w-10 h-14 rounded" />
                <span>{c.name} 버리기</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 바(2): 블라디 제지 */}
      {isBlockerTake2 && (
        <div className={`fixed ${bottomChoices ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-40`}>
          <div className="text-center mb-2"><b>블라디로 제지</b> — 남은 시간 {remainSec}s</div>
          <div className="flex justify-center">
            <button className="px-4 py-2 bg-red-600 rounded hover:bg-red-500" onClick={blockTake2}>제지하기</button>
          </div>
        </div>
      )}

      {/* 바(3): 아칼리 방어 */}
      {isAkaliBlockTarget && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2) ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-40`}>
          <div className="text-center mb-2"><b>아칼리 방어</b> — 브라움으로 방어 (남은 {remainSec}s)</div>
          <div className="flex justify-center">
            <button className="px-4 py-2 bg-sky-600 rounded hover:bg-sky-500" onClick={blockAkaliAsBraum}>브라움으로 방어</button>
          </div>
        </div>
      )}

      {/* 바(4): 트페 — 교환 */}
      {isTFActor && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2 || isAkaliBlockTarget) ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-60`}>
          <div className="text-center mb-2"><b>트페</b> — 교환할 카드를 선택하세요. (남은 {remainSec}s)</div>
          <div className="flex justify-center gap-2 flex-wrap">
            {(you?.hand ?? []).map((c: any) => (
              <button key={c.id} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 flex items-center gap-2" onClick={() => tfSwap(c.id)}>
                <CardThumb name={c.name} className="w-10 h-14 rounded" />
                <span>{c.name} 교환</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 바(5): 도전 */}
      {youCanChallenge && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2 || isAkaliBlockTarget || isTFActor) ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-40`}>
          <div className="text-center mb-2"><b>도전 가능</b> — 주장: <b>{claimName}</b> (남은 {remainSec}s)</div>
          <div className="flex justify-center">
            <button className="px-4 py-2 bg-rose-600 rounded hover:bg-rose-500" onClick={() => s.emit('action', { type: 'challenge' })}>도전하기</button>
          </div>
        </div>
      )}

      {/* 바(6): 증명 */}
      {youAreClaimant && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2 || isAkaliBlockTarget || isTFActor || youCanChallenge) ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-50`}>
          <div className="text-center mb-2"><b>증명</b> — <b>{state?.pendingProof?.claimName}</b> 카드 공개 (남은 {remainSec}s)</div>
          <div className="flex justify-center gap-2 flex-wrap">
            {(you?.hand ?? []).map((c: any) => (
              <button key={c.id} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 flex items-center gap-2"
                      onClick={() => s.emit('action', { type: 'proofReveal', cardId: c.id })}>
                <CardThumb name={c.name} className="w-10 h-14 rounded" />
                <span>{c.name} 공개</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 바(7): 손실 */}
      {youLoseOne && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2 || isAkaliBlockTarget || isTFActor || youCanChallenge || youAreClaimant) ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-50`}>
          <div className="text-center mb-2"><b>카드 1장 손실</b> — 버릴 카드를 선택하세요. (남은 {remainSec}s)</div>
          <div className="flex justify-center gap-2 flex-wrap">
            {(you?.hand ?? []).map((c: any) => (
              <button key={c.id} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 flex items-center gap-2"
                      onClick={() => s.emit('action', { type: 'loseOne', cardId: c.id })}>
                <CardThumb name={c.name} className="w-10 h-14 rounded" />
                <span>{c.name} 버리기</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 바(8): 가렌 응답 — 타깃 3선택 */}
      {isAwaitGarenResp && garenResp?.targetId === playerId && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2 || isAkaliBlockTarget || isTFActor || youCanChallenge || youAreClaimant || youLoseOne) ? 'bottom-24' : 'bottom-0'} left-0 right-0 bg-gray-900 border-t border-gray-700 p-3 z-60`}>
          <div className="text-center mb-2"><b>가렌 강탈 대응</b> — 도전 / 가렌 제지 / 트페 제지 (남은 {remainSec}s)</div>
          <div className="flex justify-center gap-2 flex-wrap">
            <button className="px-4 py-2 bg-rose-600 rounded hover:bg-rose-500" onClick={() => s.emit('action', { type: 'garenResponse', choice: 'challenge' })}>도전하기</button>
            <button className="px-4 py-2 bg-yellow-600 rounded hover:bg-yellow-500" onClick={() => s.emit('action', { type: 'garenResponse', choice: 'blockGaren' })}>가렌으로 제지</button>
            <button className="px-4 py-2 bg-purple-600 rounded hover:bg-purple-500" onClick={() => s.emit('action', { type: 'garenResponse', choice: 'blockTF' })}>트페로 제지</button>
          </div>
        </div>
      )}

      {/* 스킬 바 */}
      {showSkillBar && (
        <div className={`fixed ${(bottomChoices || isBlockerTake2 || isAkaliBlockTarget || isTFActor || youCanChallenge || youAreClaimant || youLoseOne || isAwaitGarenResp) ? 'bottom-20' : 'bottom-0'} left-0 right-0 bg-gray-800/95 border-t border-gray-700 p-3 z-30`}>
          <div className="text-center text-sm text-gray-300 mb-2">스킬 사용(보유 여부와 관계 없이 사용 가능)</div>
          <div className="flex justify-center gap-2 flex-wrap">
            {skills.map(skl => (
              <button key={skl.key as string} className="px-3 py-2 bg-indigo-600 rounded hover:bg-indigo-500" onClick={skl.onClick}>
                {skl.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
