import { useEffect, useRef } from 'react';
import { playSfx } from '../effects/sfx';

export function useGameEvents(state: any) {
  const prevRef = useRef<any>(null);

  useEffect(() => {
    const prev = prevRef.current;
    const cur = state;
    if (!prev) { prevRef.current = cur; return; }

    // 도전 열림
    if (!prev.pendingChallenge && cur.pendingChallenge) {
      playSfx('challenge:open');
      const ctx = cur.pendingChallenge.ctx;
      if (ctx?.kind === 'skill') {
        playSfx(`skill:${ctx.skill}`);
      } else if (ctx?.kind === 'block') {
        playSfx(`block:${ctx.blockType}`);
      }
    }

    // 증명 열림
    if (!prev.pendingProof && cur.pendingProof) {
      playSfx('proof:open');
    }

    // loseOne 열림
    if (!prev.pendingLose && cur.pendingLose) {
      playSfx('lose:open');
    }

    // 트페 교환 시작
    if (!prev.pendingTf && cur.pendingTf) {
      playSfx('skill:TwistedFate');
    }

    prevRef.current = cur;
  }, [state]);
}
