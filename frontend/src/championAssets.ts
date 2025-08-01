// frontend/src/championAssets.ts

// 카드 이름을 파일명 5개 중 하나로 고정 매핑합니다.
export function cardImageSrc(name: string): string {
  const raw = (name ?? '').toString().trim().toLowerCase();

  // 공백/밑줄/하이픈 제거 버전도 함께 만든다 (오타/띄어쓰기 대응)
  const noSpace = raw.replace(/[\s_\-]+/g, '');

  // 별칭/한글 포함 매핑 테이블 (모두 소문자 키)
  const dict: Record<string, string> = {
    // 영어
    'akali': 'Akali',
    'braum': 'Braum',
    'garen': 'Garen',
    'vladimir': 'Vladimir',
    'twistedfate': 'TwistedFate',
    'twisted fate': 'TwistedFate',
    'tf': 'TwistedFate',

    // 한글 별칭
    '아칼리': 'Akali',
    '브라움': 'Braum',
    '가렌': 'Garen',
    '블라디미르': 'Vladimir',
    '트페': 'TwistedFate',
    '트위스티드페이트': 'TwistedFate',
  };

  // 매칭 시도 순서: 원문 → 공백제거
  const key = dict[raw] || dict[noSpace];

  // 매칭이 되면 그걸 쓰고, 아니면 원래 입력에서 공백만 제거해서 사용
  const fileKey = (key || (name ?? '').toString().replace(/\s+/g, '')) || 'Garen';

  // 최종 PNG 경로
  return `/cards/${fileKey}.png`;
}
