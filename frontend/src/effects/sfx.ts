let enabled = true;        // 상단 토글로 켜고/끄기
let defaultVolume = 0.8;   // 전역 볼륨

export function setSfxEnabled(v: boolean) { enabled = v; }
export function getSfxEnabled() { return enabled; }
export function setSfxVolume(v: number) { defaultVolume = Math.max(0, Math.min(1, v)); }

const cache = new Map<string, HTMLAudioElement>();

// 원하는 파일명으로 자유롭게 변경하세요.
const SFX: Record<string, string> = {
  'skill:Vladimir': '/sfx/vladimir_skill.mp3',
  'skill:Garen': '/sfx/garen_steal.mp3',
  'skill:Akali': '/sfx/akali_cast.mp3',
  'skill:TwistedFate': '/sfx/tf_swap.mp3',

  'block:take2': '/sfx/take2_block_claim.mp3',
  'block:akali': '/sfx/braum_block.mp3',
  'block:garenSteal': '/sfx/garen_steal.mp3',

  'challenge:open': '/sfx/challenge_open.mp3',
  'proof:open': '/sfx/proof_open.mp3',
  'lose:open': '/sfx/lose_one.mp3',
};

function getAudio(path: string) {
  // 캐시된 오디오가 재생 중이면 새 인스턴스로 중첩 재생
  const cached = cache.get(path);
  if (!cached) {
    const a = new Audio(path);
    a.volume = defaultVolume;
    cache.set(path, a);
    return a;
  }
  if (!cached.paused) {
    const b = new Audio(path);
    b.volume = defaultVolume;
    return b;
  }
  cached.currentTime = 0;
  cached.volume = defaultVolume;
  return cached;
}

export function playSfx(key: string) {
  if (!enabled) return;
  const path = SFX[key];
  if (!path) return;
  try {
    getAudio(path).play().catch(() => {});
  } catch {}
}
