// ⚠️ 注意: このファイルは過去のスナップショット（アーカイブ）です。本番のindex.htmlはリポジトリ直下のcard.js/game.jsだけを読み込みます。
// ロジックを直す/機能を足す時は、直下の card.js / game.js を直接編集してください（詳細はCONTRIBUTING.md参照）。
// カードの強さ順 (弱い→強い)
export const RANK_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 2];

export const SUITS = ['spade', 'heart', 'diamond', 'club'];

// revolutionがtrueのとき、強さの序列が反転する (ジョーカーは革命下でも常に最強)
export function getStrength(card, revolution = false) {
  if (card.suit === 'joker') return Infinity;
  const index = RANK_ORDER.indexOf(card.rank);
  return revolution ? RANK_ORDER.length - 1 - index : index;
}

export function compareCards(cardA, cardB, revolution = false) {
  const strengthA = getStrength(cardA, revolution);
  const strengthB = getStrength(cardB, revolution);
  if (strengthA > strengthB) return 1;
  if (strengthA < strengthB) return -1;
  return 0;
}

// 山札を生成する (1デッキ54枚、ジョーカー2枚を含む。deckCountで複数デッキ分をまとめて生成できる)
export function createDeck(deckCount = 1) {
  const deck = [];

  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank });
      }
    }

    deck.push({ suit: 'joker', rank: null });
    deck.push({ suit: 'joker', rank: null });
  }

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

// 指定人数のプレイヤーに山札を均等に配る (2人以上の任意人数に対応)
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

  const strengths = reals.map((c) => getStrength(c));

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

// 階段が実際にカバーしている数字の配置には、実カードの間を埋めるのに必要な数より
// ジョーカーが多い場合、複数の解釈があり得る (例: 6,7,8,ジョーカー なら「5〜8」でも「6〜9」でも成立する)
// その候補となる開始rank (一番弱いカードのrank) を弱い方から順に全て返す
export function getStraightStartCandidates(cards) {
  if (!isValidStraight(cards)) return [];

  const reals = cards.filter((c) => c.suit !== 'joker');
  const strengths = reals.map((c) => getStrength(c));
  const minS = Math.min(...strengths);
  const maxS = Math.max(...strengths);
  const length = cards.length;

  // 実カードが収まる範囲で開始位置が動ける幅: [maxS-length+1, minS]
  // (これより下げると一番強い実カードがはみ出す、上げると一番弱い実カードがはみ出す)
  const lowStart = Math.max(0, maxS - length + 1);
  const highStart = Math.min(minS, RANK_ORDER.length - length);

  const candidates = [];
  for (let s = lowStart; s <= highStart; s++) {
    candidates.push(RANK_ORDER[s]);
  }
  return candidates;
}

// 出そうとしているカード群の種類を判定する ('group' | 'straight' | 'invalid')
// 階段としても組としても解釈できる場合 (実カード1枚+ジョーカー2枚など) は階段を優先する。
// どちらか一方をプレイヤーに選ばせたい場合は getPossiblePlayTypes を使う
export function getPlayType(cards) {
  if (isValidStraight(cards)) return 'straight';
  if (isValidGroup(cards)) return 'group';
  return 'invalid';
}

// 出そうとしているカード群が成立し得る役を全て返す (該当なしなら空配列)
// 実カード1枚+ジョーカー2枚のような組は、階段としても組としても解釈できるため両方返り得る
export function getPossiblePlayTypes(cards) {
  const types = [];
  if (isValidStraight(cards)) types.push('straight');
  if (isValidGroup(cards)) types.push('group');
  return types;
}

// 階段として出したカード群が実際にカバーしている数字の一覧を返す (ジョーカーで埋めた数字も含む)
// 例: 3,4,ジョーカー,6 の階段なら [3,4,5,6] を返す (ジョーカーが5を埋めている)
// startRank: 一番弱いカードのrankを明示したい場合に指定する (候補は getStraightStartCandidates を使う)。
// 省略時は、実カードの最小rankを起点に上へ延長する (従来の挙動)。
// 階段として不成立なカード群を渡した場合は空配列を返す
export function getStraightRanks(cards, startRank = null) {
  if (!isValidStraight(cards)) return [];

  const reals = cards.filter((c) => c.suit !== 'joker');
  const defaultStartIdx = Math.min(...reals.map((c) => getStrength(c)));
  const startIdx = startRank != null ? RANK_ORDER.indexOf(startRank) : defaultStartIdx;

  const ranks = [];
  for (let i = 0; i < cards.length; i++) {
    const idx = startIdx + i;
    if (idx < 0 || idx >= RANK_ORDER.length) break; // 序列の範囲外は無視 (通常は起こらない)
    ranks.push(RANK_ORDER[idx]);
  }
  return ranks;
}

// 階段として出す(出した)カード群を、実際に表している位置の順番に並べ替えて返す
// (ジョーカーが埋めている数字の位置に来るようにする)。例: 4,ジョーカー,6,7 → [4,ジョーカー,6,7]
// (ジョーカーは5の位置なので、4と6の間に来る)
// startRank: getStraightRanksと同じ意味 (省略時は実カードの最小rankを起点に上へ延長する従来の挙動)
// 階段として不成立なカード群を渡した場合は、元の配列をそのまま返す (並べ替えない)
export function orderStraightForDisplay(cards, startRank = null) {
  if (!isValidStraight(cards)) return [...cards];

  const ranks = getStraightRanks(cards, startRank);
  const jokers = cards.filter((c) => c.suit === 'joker');
  const byRank = new Map();
  for (const c of cards) {
    if (c.suit !== 'joker') byRank.set(c.rank, c);
  }

  let jokerIdx = 0;
  return ranks.map((r) => byRank.get(r) ?? jokers[jokerIdx++]);
}

// グループの強さを取得する (ジョーカー以外の代表rankで判定)
// declaredRank: 実カードが1枚も無い(全部ジョーカー)組で、プレイヤーが「このジョーカー達を
// 何のrankとして出すか」を明示した場合に使う。省略時、実カードが無ければ最強(Infinity)扱いのまま
export function getGroupStrength(cards, revolution = false, declaredRank = null) {
  const representative = cards.find((c) => c.suit !== 'joker');
  if (representative) return getStrength(representative, revolution);
  if (declaredRank != null) return getStrength({ suit: null, rank: declaredRank }, revolution);
  // 全部ジョーカーで宣言も無いなら、従来通り最強扱い
  return Infinity;
}

// 階段の強さを取得する (一番強い側のカードを基準に判定)
// startRank: getStraightRanksと同じ意味。省略時は実カードの最小rankを起点に上へ延長する(従来の挙動)
export function getStraightStrength(cards, revolution = false, startRank = null) {
  const reals = cards.filter((c) => c.suit !== 'joker');
  if (reals.length === 0) return Infinity;

  const defaultStartIdx = Math.min(...reals.map((c) => getStrength(c)));
  const startIdx = startRank != null ? RANK_ORDER.indexOf(startRank) : defaultStartIdx;
  const topIdx = startIdx + cards.length - 1;

  return revolution ? RANK_ORDER.length - 1 - topIdx : topIdx;
}

// 出そうとしているカード群の強さを、種類に応じて取得する
// playTypeを明示的に渡すと、階段/組どちらとして扱うかを自動判定に任せず固定できる
// (実カード1枚+ジョーカー2枚のような、両方に解釈できる組をプレイヤーが選択した場合など)
// declaredRankは、全部ジョーカーの組('group')が代表する数字を明示したい場合に使う
// straightStartRankは、階段('straight')の開始rankを明示したい場合に使う (getStraightRanks参照)
export function getPlayStrength(
  cards,
  revolution = false,
  playType = getPlayType(cards),
  declaredRank = null,
  straightStartRank = null
) {
  return playType === 'straight'
    ? getStraightStrength(cards, revolution, straightStartRank)
    : getGroupStrength(cards, revolution, declaredRank);
}

// 出そうとしているカード群で使われているスートの集合を取得する (ジョーカーは除く)
// 記号縛りの判定に使用: 複数枚出しでは複数スートが混ざることもあるため、集合として扱う
export function getPlaySuits(cards) {
  const suits = new Set(
    cards.filter((c) => c.suit !== 'joker').map((c) => c.suit)
  );
  return suits;
}

// スペ3の特例: 場が「ジョーカー1枚だけ」のとき、スペードの3だけは例外的に出せる
export function isSpade3CounterJoker(playGroup, fieldGroup) {
  if (!fieldGroup || fieldGroup.length !== 1 || fieldGroup[0].suit !== 'joker') {
    return false;
  }
  return (
    playGroup.length === 1 &&
    playGroup[0].suit === 'spade' &&
    playGroup[0].rank === 3
  );
}

// 砂嵐・ろくろ首の特例: 3を3枚同時に出すと、場の枚数・種類を問わずどんなカードにも被せられる
// (革命状態は変化させない。革命の解除は別の効果として扱う)
// isValidGroupで直接判定する (実カード1枚+ジョーカー2枚などは階段としても解釈できてしまうため、
// getPlayTypeの階段優先判定に頼らずここで確実にグループ扱いする)
export function isSandstormPlay(cards) {
  if (cards.length !== 3) return false;
  if (!isValidGroup(cards)) return false;

  const representative = cards.find((c) => c.suit !== 'joker');
  if (!representative) return false; // 全部ジョーカーは対象外(判定できないため)

  return representative.rank === 3;
}

// 場に出ているグループ (配列) に対して、出そうとしているグループが出せるか判定する
// fieldGroup: 場にある最後のグループ (カードの配列)。nullなら誰でも出せる
// playGroup: 出そうとしているカードの配列
// revolution: 革命発動中かどうか (強さの序列に影響)
// playType/fieldType: 明示的に渡すと、その役 (group/straight) として扱う。
// 省略時は自動判定 (getPlayType) を使う従来通りの挙動
// declaredRank/fieldDeclaredRank: 全部ジョーカーの組が代表する数字 (playGroup側/fieldGroup側それぞれ)
// straightStartRank/fieldStraightStartRank: 階段の開始rank (playGroup側/fieldGroup側それぞれ)
export function canPlayGroup(
  playGroup,
  fieldGroup,
  revolution = false,
  playType = getPlayType(playGroup),
  fieldType = fieldGroup ? getPlayType(fieldGroup) : null,
  declaredRank = null,
  fieldDeclaredRank = null,
  straightStartRank = null,
  fieldStraightStartRank = null
) {
  if (playType === 'invalid') return false;

  // 場が空なら何でも出せる
  if (!fieldGroup) return true;

  // スペ3の特例: ジョーカー1枚に対してのみ、通常の強さ判定を無視して出せる
  if (isSpade3CounterJoker(playGroup, fieldGroup)) return true;

  // 砂嵐・ろくろ首の特例: 3枚の3は、場の枚数・種類を問わず出せる
  if (isSandstormPlay(playGroup)) return true;

  // 場と種類 (ペア系 or 階段) が違うものは出せない
  if (playType !== fieldType) return false;

  // 枚数が場と同じでなければ出せない
  if (playGroup.length !== fieldGroup.length) return false;

  return (
    getPlayStrength(playGroup, revolution, playType, declaredRank, straightStartRank) >
    getPlayStrength(fieldGroup, revolution, fieldType, fieldDeclaredRank, fieldStraightStartRank)
  );
}
