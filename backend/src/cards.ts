import { ChampionCard, ChampionName } from "./schemas";
// 기존: import { v4 as uuidv4 } from "uuid";
import { randomUUID } from "crypto";

export const CARD_TEXT: Record<ChampionName, {skill: string; passive: string}> = {
  Vladimir: {
    skill: "동전 3개를 가져온다.",
    passive: "다른 플레이어의 '동전 2개 받기'를 제지할 수 있다."
  },
  Braum: {
    skill: "없음",
    passive: "아칼리의 공격을 방어할 수 있다."
  },
  Garen: {
    skill: "다른 플레이어의 동전 2개를 강탈한다.",
    passive: "가렌에게 강탈 당하지 않는다."
  },
  Akali: {
    skill: "동전 3개를 가지고 브라움이 없는 다른 플레이어를 처형한다.",
    passive: "없음"
  },
  TwistedFate: {
    skill: "챔피언 1장을 내고 2장을 뽑은 뒤 하나를 골라 사용한다.",
    passive: "가렌에게 강탈 당하지 않는다."
  }
};

export function buildDeck(): ChampionCard[] {
  const names: ChampionName[] = ["Vladimir", "Braum", "Garen", "Akali", "TwistedFate"];
  const deck: ChampionCard[] = [];
  for (const n of names) {
    for (let i = 0; i < 3; i++) {
      deck.push({ id: randomUUID(), name: n, text: CARD_TEXT[n] });
    }
  }
  return shuffle(deck);
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
