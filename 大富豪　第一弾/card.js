// カードの強さ順 (弱い→強い)
export const RANK_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2];

export const SUITS = ['spade', 'heart', 'diamond', 'club'];

export function getStrength(card) {
  if (card.suit === 'joker') return Infinity; // ジョーカーは最強
  return RANK_ORDER.indexOf(card.rank);
}

export function compareCards(cardA, cardB) {
  const strengthA = getStrength(cardA);
  const strengthB = getStrength(cardB);
  if (strengthA > strengthB) return 1;
  if (strengthA < strengthB) return -1;
  return 0;
}

// 山札54枚(ジョーカー2枚を含む)を生成する
export function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ suit, rank });
    }
  }

  deck.push({ suit: 'joker', rank: null });
  deck.push({ suit: 'joker', rank: null });

  return deck;
}

// 山札をシャッフルする (Fisher-Yatesアルゴリズム)
export function shuffleDeck(deck) {
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

// 2人のプレイヤーに山札を均等に配る
export function dealCards(deck, playerCount = 2) {
  const hands = Array.from({ length: playerCount }, () => []);

  deck.forEach((card, index) => {
    hands[index % playerCount].push(card);
  });

  return hands;
}

// 手札を強さ順にソートする (デフォルトは弱い→強い)
export function sortHand(hand, order = 'asc') {
  const sorted = [...hand].sort((a, b) => compareCards(a, b));
  return order === 'desc' ? sorted.reverse() : sorted;
}

// ---- ここからペア出し関連 ----

// 複数枚のカードが「同じ数字の組」として出せるかを判定する
// ジョーカーは任意の数字として扱えるため、ジョーカー以外のrankが1種類にそろっていればOK
export function isValidGroup(cards) {
  if (cards.length < 1) return false;

  const nonJokerRanks = cards
    .filter((c) => c.suit !== 'joker')
    .map((c) => c.rank);

  // 全部ジョーカーの場合は成立とみなす
  if (nonJokerRanks.length === 0) return true;

  // ジョーカー以外のrankが全て同じであること
  return nonJokerRanks.every((r) => r === nonJokerRanks[0]);
}

// 階段 (同じスートで数字が3枚以上連続する組) として出せるかを判定する
// ジョーカーは連続する数字の穴埋めとして使える
export function isValidStraight(cards) {
  if (cards.length < 3) return false;

  const jokers = cards.filter((c) => c.suit === 'joker');
  const reals = cards.filter((c) => c.suit !== 'joker');

  // 実カードが1枚もないとスートも数字の並びも判定できない
  if (reals.length === 0) return false;

  const suit = reals[0].suit;
  if (!reals.every((c) => c.suit === suit)) return false;

  const strengths = reals.map(getStrength);

  // 同じ数字が2枚あると階段にならない
  if (new Set(strengths).size !== strengths.length) return false;

  const sorted = [...strengths].sort((a, b) => a - b);
  const minS = sorted[0];
  const maxS = sorted[sorted.length - 1];
  const span = maxS - minS + 1; // 実カードの最小〜最大までの幅

  // 幅が出そうとしている枚数より大きい = 埋めきれない隙間がある
  if (span > cards.length) return false;

  // 実カード間の隙間の数がジョーカーの枚数以内であればOK
  const gapsNeeded = span - reals.length;
  return gapsNeeded <= jokers.length;
}

// 出そうとしているカード群の種類を判定する ('group' | 'straight' | 'invalid')
export function getPlayType(cards) {
  if (isValidStraight(cards)) return 'straight';
  if (isValidGroup(cards)) return 'group';
  return 'invalid';
}

// グループの強さを取得する (ジョーカー以外の代表rankで判定)
export function getGroupStrength(cards) {
  const representative = cards.find((c) => c.suit !== 'joker');
  // 全部ジョーカーなら最強扱い
  if (!representative) return Infinity;
  return getStrength(representative);
}

// 階段の強さを取得する (一番強い実カードを基準に、末尾側の余りジョーカー分も加味)
export function getStraightStrength(cards) {
  const jokers = cards.filter((c) => c.suit === 'joker').length;
  const reals = cards.filter((c) => c.suit !== 'joker');
  if (reals.length === 0) return Infinity;

  const strengths = reals.map(getStrength);
  const maxS = Math.max(...strengths);
  const minS = Math.min(...strengths);
  const span = maxS - minS + 1;
  const extraJokers = jokers - (span - reals.length); // 内部の穴埋めに使わなかった余りジョーカー

  return maxS + Math.max(extraJokers, 0);
}

// 出そうとしているカード群の強さを、種類に応じて取得する
export function getPlayStrength(cards) {
  return getPlayType(cards) === 'straight'
    ? getStraightStrength(cards)
    : getGroupStrength(cards);
}

// 出そうとしているカード群で使われているスートの集合を取得する (ジョーカーは除く)
// 記号縛りの判定に使用: 複数枚出しでは複数スートが混ざることもあるため、集合として扱う
export function getPlaySuits(cards) {
  const suits = new Set(
    cards.filter((c) => c.suit !== 'joker').map((c) => c.suit)
  );
  return suits;
}

// 場に出ているグループ (配列) に対して、出そうとしているグループが出せるか判定する
// fieldGroup: 場にある最後のグループ (カードの配列)。nullなら誰でも出せる
// playGroup: 出そうとしているカードの配列
export function canPlayGroup(playGroup, fieldGroup) {
  const playType = getPlayType(playGroup);
  if (playType === 'invalid') return false;

  // 場が空なら何でも出せる
  if (!fieldGroup) return true;

  // 場と種類 (ペア系 or 階段) が違うものは出せない
  const fieldType = getPlayType(fieldGroup);
  if (playType !== fieldType) return false;

  // 枚数が場と同じでなければ出せない
  if (playGroup.length !== fieldGroup.length) return false;

  return getPlayStrength(playGroup) > getPlayStrength(fieldGroup);
}
