import {
  canPlayGroup,
  getPlayStrength,
  getPlaySuits,
  getPlayType,
  getPossiblePlayTypes,
  getStraightRanks,
  getStraightStartCandidates,
  isSpade3CounterJoker,
  isSandstormPlay,
  sortHand,
  RANK_ORDER,
  SUITS,
} from './card.js';

// ゲームの状態を表すオブジェクト
export function createGameState(hands) {
  return {
    hands,               // 各プレイヤーの手札 [[...], [...]]
    field: null,          // 場に出ている最後のグループ (カードの配列 or null)
    fieldType: null,      // 場の組が'group'/'straight'どちらとして出されたか (fieldがnullならnull)
    fieldDeclaredRank: null, // 場が全部ジョーカーの組だった場合、それが代表していた数字 (通常はnull)
    fieldStraightStartRank: null, // 場が階段だった場合、その開始rank (一番弱いカードのrank。通常はnull=自動)
    turn: 0,              // 現在のターンのプレイヤーindex
    direction: 1,         // 手番が進む向き (1: 通常, -1: リバース中)
    passCount: 0,         // 連続パス数
    finished: [],         // 上がった順のプレイヤーindex
    sequenceLock: false,  // 階段縛り(場と同じ枚数の組が連番になったら発動)が発動しているか
    lastPlaySuits: null,  // 直前に出した組で使われていたスートの集合 (記号縛り判定用)
    suitLock: null,       // 記号縛りが発動している場合、固定されたスート
    revolution: false,    // 革命が発動しているか (ゲーム終了まで持続)
    elevenEffect: null,   // 11(バック/ステイ)の効果。null | 'back' | 'stay' (場が流れるまで持続)
    sandstormLock: false, // 砂嵐・ろくろ首が発動中か (発動中は砂嵐・ろくろ首以外出せない)
  };
}

// 革命とバックは独立した反転要因なので、実際に反転しているかはXORで決める
function isEffectivelyReversed(state) {
  return state.revolution !== (state.elevenEffect === 'back');
}

// 7/10の選択カードが「出した枚数と一致しているか」「実際に(渡す/捨てる時点の)手札にあるか」を検証する。
// pool には、これから出すカードを除いた後の手札 (handCopy) を渡す。
// UI側のバリデーションだけに頼らず、game.js自身でも枚数と実在をチェックする
function validateCardSelection(chosenCards, expectedCount, pool, label) {
  if (!Array.isArray(chosenCards) || chosenCards.length !== expectedCount) {
    throw new Error(`${label}は${expectedCount}枚選んでください`);
  }
  const remaining = [...pool];
  for (const card of chosenCards) {
    const idx = remaining.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    if (idx === -1) {
      throw new Error(`${label}に手札にないカードが含まれています`);
    }
    remaining.splice(idx, 1);
  }
}

// 12で宣言する数字が「出した枚数と一致しているか」「重複していないか」「1〜13の範囲か」を検証する
function validateDeclareRanks(ranks, expectedCount) {
  if (!Array.isArray(ranks) || ranks.length !== expectedCount) {
    throw new Error(`宣言する数字は${expectedCount}個選んでください`);
  }
  if (new Set(ranks).size !== ranks.length) {
    throw new Error('同じ数字を重複して宣言することはできません');
  }
  if (ranks.some((r) => !Number.isInteger(r) || r < 1 || r > 13)) {
    throw new Error('宣言する数字は1〜13の範囲で指定してください');
  }
}

// カードの組 (1枚 or ペア以上 or 階段) を出す処理
// cards: 出そうとしているカードの配列
// options:
//   playAs: 出そうとしているカード群が組('group')としても階段('straight')としても成立する場合に、
//           どちらの役として出すかを明示する ('group' | 'straight')。未指定なら階段を優先して自動判定する
//   declareRank: 出そうとしているカードが全部ジョーカーの場合に、それを何のrank(1〜13)として
//                出すかを明示する。指定しない場合は従来通り最強固定(rank効果は発動しない)
//   straightFrom: 階段でジョーカーが実カードの間を埋める以上に余っていて、複数の開始位置が
//                 考えられる場合 (例: 6,7,8,ジョーカー は「5〜8」でも「6〜9」でも成立する) に、
//                 開始rank (一番弱いカードのrank) を明示する。指定しない場合は実カードの最小
//                 rankを起点に上へ延長する (従来の挙動)
//   giveCards: 7を出した時、次のプレイヤーに渡すカードの配列
//   discardCards: 10を出した時、自分の手札から捨てるカードの配列
//   declareRanks: 12を出した時、全員に捨てさせる数字の配列
//   elevenChoice: 11を出した時の選択 ('through' | 'back' | 'stay'。省略時は'through')
export function playGroup(state, playerIndex, cards, options = {}) {
  const hand = state.hands[playerIndex];

  // 手札に本当にそのカードが揃っているか確認する
  const handCopy = [...hand];
  for (const card of cards) {
    const idx = handCopy.findIndex(
      (c) => c.suit === card.suit && c.rank === card.rank
    );
    if (idx === -1) {
      throw new Error('そのカードは手札にありません');
    }
    handCopy.splice(idx, 1);
  }

  const effectiveRevolution = isEffectivelyReversed(state);

  // 出そうとしているカード群がどちらの役としても成立し得る場合 (実カード1枚+ジョーカー2枚 等)、
  // options.playAsで明示的に選べるようにする。未指定なら従来通り階段を優先して自動判定する
  const possibleTypes = getPossiblePlayTypes(cards);
  let playType;
  if (options.playAs) {
    if (!possibleTypes.includes(options.playAs)) {
      throw new Error('そのカードの組み合わせでは指定した役にできません');
    }
    playType = options.playAs;
  } else {
    playType = getPlayType(cards);
  }
  // 全部ジョーカーの組('group'型のみ。ジョーカーだけでは階段は成立しない)は、
  // 通常は代表rankが無く最強固定になるが、options.declareRankで「何のrankとして出すか」を
  // 明示できるようにする。これで階段縛りの厳密な数字一致や、5/7/9/10/11/12の効果にも使えるようになる
  const allJokers = cards.every((c) => c.suit === 'joker');
  let declaredRank = null;
  if (allJokers && playType === 'group' && options.declareRank !== undefined && options.declareRank !== null) {
    if (!Number.isInteger(options.declareRank) || options.declareRank < 1 || options.declareRank > 13) {
      throw new Error('宣言する数字は1〜13の範囲で指定してください');
    }
    declaredRank = options.declareRank;
  }

  const representativeRank = (cards.find((c) => c.suit !== 'joker') || {}).rank ?? declaredRank ?? null;

  // 階段でジョーカーが実カードの隙間を埋める以上に余っている場合、開始位置が複数考えられる
  // (例: 6,7,8,ジョーカー は「5〜8」でも「6〜9」でも成立する)。options.straightFromで明示できる。
  // 未指定なら従来通り、実カードの最小rankを起点に上へ延長する
  let straightStartRank = null;
  if (playType === 'straight' && options.straightFrom !== undefined && options.straightFrom !== null) {
    const startCandidates = getStraightStartCandidates(cards);
    if (!startCandidates.includes(options.straightFrom)) {
      throw new Error('その開始rankでは階段が成立しません');
    }
    straightStartRank = options.straightFrom;
  }

  // 階段の場合、ジョーカーが埋めている数字 (内側の穴埋め・末尾の延長どちらも) も
  // 特殊効果の対象に含める。例: 3,4,ジョーカー,6 の階段なら、ジョーカーが埋めている
  // 5の効果 (スキップ等) も発動する
  const effectiveStraightRanks = playType === 'straight' ? getStraightRanks(cards, straightStartRank) : [];
  const containsRank = (rank) =>
    cards.some((c) => c.rank === rank) || effectiveStraightRanks.includes(rank);

  // 砂嵐・ろくろ首の特例 (3を3枚同時出し) は場の状態を問わず出せる例外
  const isSandstorm = isSandstormPlay(cards);

  // 砂嵐・ろくろ首が発動中は、スペ3を含めどんな例外も無視して砂嵐・ろくろ首以外出せない
  if (state.sandstormLock && !isSandstorm) {
    throw new Error('砂嵐・ろくろ首の後は、砂嵐・ろくろ首でしか出せません');
  }

  // スペ3の特例 (場がジョーカー1枚だけの時にスペードの3を出す) は、
  // 縛り系のルールも含めた通常の制約を無視できる例外なのでここで判定しておく
  const spade3CounterJoker = isSpade3CounterJoker(cards, state.field);

  // ステイ中のJは、J同士だと強さが同じで通常の「場より強くないと出せない」を
  // 満たせなくなってしまうため、通常の強さ比較も例外的にバイパスする
  const allJackOrJoker = cards.every((c) => c.suit === 'joker' || c.rank === 11);
  const isStayJackPlay = state.elevenEffect === 'stay' && playType === 'group' && allJackOrJoker;

  // 通常の強さ比較・種類判定をバイパスできる例外全般
  const bypassNormalCheck = spade3CounterJoker || isSandstorm || isStayJackPlay;

  // 場を流して出した本人の手番のまま続行する例外 (スペ3のみ。砂嵐・ろくろ首は別扱い)
  const isUniversalPlay = spade3CounterJoker;

  // ステイ中は、上記の例外を除いてJ(11)しか出せない
  if (state.elevenEffect === 'stay' && !bypassNormalCheck) {
    throw new Error('ステイ中はJしか出せません');
  }

  if (
    !bypassNormalCheck &&
    !canPlayGroup(
      cards,
      state.field,
      effectiveRevolution,
      playType,
      state.fieldType,
      declaredRank,
      state.fieldDeclaredRank,
      straightStartRank,
      state.fieldStraightStartRank
    )
  ) {
    throw new Error('そのカードの組は場に出せません');
  }
  if (bypassNormalCheck && playType === 'invalid') {
    throw new Error('そのカードの組は場に出せません');
  }

  // 階段縛りが発動中は、場と同じ枚数で、代表の数字が「場の数字+1」でなければ出せない
  if (state.sequenceLock && !bypassNormalCheck) {
    const fieldStrength = getPlayStrength(
      state.field,
      effectiveRevolution,
      state.fieldType,
      state.fieldDeclaredRank,
      state.fieldStraightStartRank
    );
    const playStrength = getPlayStrength(cards, effectiveRevolution, playType, declaredRank, straightStartRank);
    if (cards.length !== state.field.length || playStrength !== fieldStrength + 1) {
      throw new Error('階段縛りにより、連続する数字しか出せません');
    }
  }

  const playSuits = getPlaySuits(cards);

  // 記号縛りが発動中は、出すカードの中に固定スートが含まれていなければならない
  if (state.suitLock && !playSuits.has(state.suitLock) && !bypassNormalCheck) {
    throw new Error('記号縛りにより、そのスートを含まないと出せません');
  }

  // 7/10/12は出したカードの枚数に応じて要求される個数が決まる。
  // 手札を実際に動かす前にここで検証しておく (途中で例外が飛んで手札が半端に変化するのを防ぐため)
  // handCopyはこの時点で「出そうとしているカードを除いた後の手札」になっている
  if (!bypassNormalCheck && (playType === 'group' || playType === 'straight')) {
    const magnitudeEarly = (rank) => {
      if (playType === 'group') return cards.length;
      if (playType === 'straight') return containsRank(rank) ? 1 : 0;
      return 0;
    };
    const willTrigger7 = playType === 'group' ? representativeRank === 7 : containsRank(7);
    const willTrigger10 = playType === 'group' ? representativeRank === 10 : containsRank(10);
    const willTrigger12 = playType === 'group' ? representativeRank === 12 : containsRank(12);

    if (willTrigger7 && options.giveCards) {
      validateCardSelection(options.giveCards, magnitudeEarly(7), handCopy, '渡すカード');
    }
    if (willTrigger10 && options.discardCards) {
      validateCardSelection(options.discardCards, magnitudeEarly(10), handCopy, '捨てるカード');
    }
    if (willTrigger12 && options.declareRanks) {
      validateDeclareRanks(options.declareRanks, magnitudeEarly(12));
    }
  }

  // 手札から取り除く
  for (const card of cards) {
    const idx = hand.findIndex(
      (c) => c.suit === card.suit && c.rank === card.rank
    );
    hand.splice(idx, 1);
  }

  // 革命判定: 同じ数字4枚以上同時出し、または4枚以上の階段でゲーム終了まで強さの序列が反転する
  // (革命返しにも対応: どちらの形でも、もう一度発動条件を満たせば元に戻る)
  const isGroupRevolution = cards.length >= 4 && playType === 'group';
  const isStraightRevolution = playType === 'straight' && cards.length >= 4;
  if (isGroupRevolution || isStraightRevolution) {
    state.revolution = !state.revolution;
  }

  // 8切り判定: 8を含む組を出すと場が流れ、出した本人の手番が続く (ペア系・階段どちらも対象。
  // 階段でジョーカーが8を埋めている場合も対象に含める)
  const isEightCut = containsRank(8);

  // 効果の大きさ: ペア系は出した枚数、階段はその数字が1枚しかないので常に1
  const magnitude = (rank) => {
    if (playType === 'group') return cards.length;
    if (playType === 'straight') return containsRank(rank) ? 1 : 0;
    return 0;
  };

  // 数字による特殊効果 (ペア系・階段どちらも対象。1つの階段に複数の数字が
  // 含まれる場合は該当する効果を全部同時に発動させる)
  let skipCount = 0;
  let reverseTriggered = false;
  let trigger11 = false;

  if (!bypassNormalCheck && (playType === 'group' || playType === 'straight')) {
    const trigger5 = playType === 'group' ? representativeRank === 5 : containsRank(5);
    const trigger7 = playType === 'group' ? representativeRank === 7 : containsRank(7);
    const trigger9 =
      playType === 'group'
        ? representativeRank === 9 && cards.length % 2 === 1
        : containsRank(9);
    const trigger10 = playType === 'group' ? representativeRank === 10 : containsRank(10);
    const trigger12 = playType === 'group' ? representativeRank === 12 : containsRank(12);
    trigger11 = playType === 'group' ? representativeRank === 11 : containsRank(11);

    if (trigger5) {
      skipCount = magnitude(5);
    }
    if (trigger9) {
      reverseTriggered = true;
    }
    if (trigger7 && options.giveCards) {
      giveCardsToNextPlayer(state, playerIndex, options.giveCards);
    }
    if (trigger10 && options.discardCards) {
      discardOwnCards(state, playerIndex, options.discardCards);
    }
    if (trigger12 && options.declareRanks) {
      forceDiscardByRanks(state, options.declareRanks);
    }
  }

  // 上がり判定 (自分が出したカードで手札が空になったか)
  const justFinished = hand.length === 0 && !state.finished.includes(playerIndex);
  if (justFinished) {
    state.finished.push(playerIndex);
  }

  let stayOnSamePlayer = false;

  if (isUniversalPlay || isEightCut) {
    // 場を流し、縛り・11の効果・砂嵐ロックもリセットする (革命状態はそのまま維持)
    state.field = null;
    state.fieldType = null;
    state.fieldDeclaredRank = null;
    state.fieldStraightStartRank = null;
    state.passCount = 0;
    state.sequenceLock = false;
    state.lastPlaySuits = null;
    state.suitLock = null;
    state.elevenEffect = null;
    state.sandstormLock = false;

    if (!justFinished) {
      // 出した本人の手番のまま続行する (ただし11が同時に含まれていれば、この後で効果を反映する)
      stayOnSamePlayer = true;
    }
  } else if (isSandstorm) {
    // 砂嵐・ろくろ首: 場にそのまま残り、次のプレイヤー以降は砂嵐・ろくろ首でしか返せなくなる
    // (それ以外の縛り・11の効果は無関係になるのでリセットする)
    state.field = cards;
    state.fieldType = playType;
    state.fieldDeclaredRank = declaredRank;
    state.fieldStraightStartRank = straightStartRank;
    state.passCount = 0;
    state.sequenceLock = false;
    state.lastPlaySuits = null;
    state.suitLock = null;
    state.elevenEffect = null;
    state.sandstormLock = true;
  } else {
    // 階段縛りの判定・更新 (場と同じ枚数の組同士で連番になったら発動)
    updateSequenceLock(state, cards, effectiveRevolution, playType, declaredRank, straightStartRank);

    // 記号縛りの判定・更新 (直前の組と共通するスートが1つでもあれば、そのスートで発動)
    updateSuitLock(state, playSuits);

    state.field = cards;
    state.fieldType = playType;
    state.fieldDeclaredRank = declaredRank;
    state.fieldStraightStartRank = straightStartRank;
    state.passCount = 0;
  }

  // 11(バック/ステイ)の選択を反映する。'through'または未指定なら効果なし
  // 8切りと同時に11が含まれていた場合、場クリア後にここで改めて効果を適用する
  if (trigger11 && !bypassNormalCheck) {
    const choice = options.elevenChoice || 'through';
    state.elevenEffect = choice === 'back' || choice === 'stay' ? choice : null;
  }

  if (reverseTriggered) {
    state.direction = -state.direction;
  }

  if (stayOnSamePlayer) {
    return state;
  }

  // 通常の手番進行 + 5スキップ分
  const steps = 1 + skipCount;
  for (let i = 0; i < steps; i++) {
    advanceTurn(state);
  }

  // 5スキップ等で他の全プレイヤーを飛ばし、出した本人まで手番が一周してしまった場合は、
  // 誰もそのカードに挑戦する機会がなかったことになるので、パスで全員流れた時と同様に場を流す
  if (!justFinished && state.turn === playerIndex) {
    state.field = null;
    state.fieldType = null;
    state.fieldDeclaredRank = null;
    state.fieldStraightStartRank = null;
    state.passCount = 0;
    state.sequenceLock = false;
    state.lastPlaySuits = null;
    state.suitLock = null;
    state.elevenEffect = null;
    state.sandstormLock = false;
  }

  return state;
}

// 次のプレイヤーのindexを求める (状態は変更しない)
function peekNextPlayer(state, fromIndex) {
  const playerCount = state.hands.length;
  let next = (fromIndex + state.direction + playerCount) % playerCount;

  // `finished.length < playerCount` は無限ループ防止のガード。
  // 通常はisGameOverが「1人を除いて全員上がったら終了」を見ているので発生しないが、
  // 12の効果(forceDiscardByRanks)で残り全員の手札が同時に0になるようなケースでは
  // finished.length === playerCount になり得る。その場合このガードがないと
  // 「全員finished済み」で次のプレイヤーが永遠に見つからず無限ループする。
  while (state.finished.includes(next) && state.finished.length < playerCount) {
    next = (next + state.direction + playerCount) % playerCount;
  }

  return next;
}

// 7の効果: 指定したカードを次のプレイヤーに渡す
function giveCardsToNextPlayer(state, playerIndex, chosenCards) {
  const hand = state.hands[playerIndex];
  const nextIndex = peekNextPlayer(state, playerIndex);

  let moved = false;
  for (const card of chosenCards) {
    const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    if (idx === -1) continue; // 手札にないものは無視する
    const [removed] = hand.splice(idx, 1);
    state.hands[nextIndex].push(removed);
    moved = true;
  }

  // 渡したカードが手札の末尾に付くだけでは並び順が崩れるので、渡した分があれば並び替える
  if (moved) {
    state.hands[nextIndex] = sortHand(state.hands[nextIndex]);
  }
}

// 10の効果: 指定したカードを自分の手札から捨てる
function discardOwnCards(state, playerIndex, chosenCards) {
  const hand = state.hands[playerIndex];

  for (const card of chosenCards) {
    const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    if (idx === -1) continue;
    hand.splice(idx, 1);
  }

  if (hand.length === 0 && !state.finished.includes(playerIndex)) {
    state.finished.push(playerIndex);
  }
}

// 12の効果: 指定した数字を持つプレイヤー全員に、その数字のカードを捨てさせる
function forceDiscardByRanks(state, ranks) {
  state.hands.forEach((hand, idx) => {
    for (let i = hand.length - 1; i >= 0; i--) {
      if (hand[i].suit !== 'joker' && ranks.includes(hand[i].rank)) {
        hand.splice(i, 1);
      }
    }
    if (hand.length === 0 && !state.finished.includes(idx)) {
      state.finished.push(idx);
    }
  });
}

// 階段縛りの判定・更新を行う (playGroup内、場を更新する前に呼ぶ)
// 場と枚数が同じ組同士で、代表の数字がちょうど+1になっていれば発動する
// playType/declaredRank/straightStartRank: 今回出すcardsについて、呼び出し側で解決済みのものを渡す
function updateSequenceLock(state, cards, effectiveRevolution, playType, declaredRank, straightStartRank) {
  const prevField = state.field;
  const prevFieldType = state.fieldType;
  const prevFieldDeclaredRank = state.fieldDeclaredRank;
  const prevFieldStraightStartRank = state.fieldStraightStartRank;

  // 既に発動中なら、そのカードを出せた時点で連番は続いているので維持する
  if (state.sequenceLock) return;

  if (prevField && cards.length === prevField.length) {
    const prevStrength = getPlayStrength(
      prevField,
      effectiveRevolution,
      prevFieldType,
      prevFieldDeclaredRank,
      prevFieldStraightStartRank
    );
    const newStrength = getPlayStrength(cards, effectiveRevolution, playType, declaredRank, straightStartRank);
    if (newStrength === prevStrength + 1) {
      state.sequenceLock = true;
    }
  }
}

// 記号縛りの判定・更新を行う (playGroup内、場を更新する前に呼ぶ)
// 直前の組と今回の組で「共通するスートが1つでもあれば」そのスートで発動する
function updateSuitLock(state, playSuits) {
  const prevSuits = state.lastPlaySuits;

  if (!state.suitLock && prevSuits) {
    for (const suit of playSuits) {
      if (prevSuits.has(suit)) {
        state.suitLock = suit;
        break;
      }
    }
  }

  state.lastPlaySuits = playSuits;
}

// パス処理
export function passTurn(state) {
  state.passCount++;

  // 全員(自分以外)パスしたら場を流す
  const activePlayers = state.hands.length - state.finished.length;
  if (state.passCount >= activePlayers - 1) {
    state.field = null;
    state.fieldType = null;
    state.fieldDeclaredRank = null;
    state.fieldStraightStartRank = null;
    state.passCount = 0;
    state.sequenceLock = false;
    state.lastPlaySuits = null;
    state.suitLock = null;
    state.elevenEffect = null;
    state.sandstormLock = false;
  }

  advanceTurn(state);
  return state;
}

// 次のプレイヤーにターンを移す
function advanceTurn(state) {
  state.turn = peekNextPlayer(state, state.turn);
}

// ゲーム終了判定 (1人を除いて全員上がったら終了)
export function isGameOver(state) {
  return state.finished.length >= state.hands.length - 1;
}

// stateを複製する (playGroupが手札配列をsplice等で書き換えるため、hands/finishedだけは
// 新しい配列にしておく。カードオブジェクト自体は書き換えないので中身の参照は共有してよい)
function cloneStateForDryRun(state) {
  return {
    ...state,
    hands: state.hands.map((hand) => [...hand]),
    finished: [...state.finished],
  };
}

// 実際に手札やゲーム状態を変更せず、その組が今出せるかどうかだけを判定する
// (playGroupを複製したstateに対して実行し、例外が飛ぶかどうかで判定する。
// ルールの重複実装を避けるため、実際のplayGroupをそのままドライランする)
export function wouldBeLegal(state, playerIndex, cards, options = {}) {
  try {
    playGroup(cloneStateForDryRun(state), playerIndex, cards, options);
    return true;
  } catch (e) {
    return false;
  }
}

// 現在の手札の中で、「今すぐ出せる組み合わせ」に1回でも使えるカードを全て返す
// (UI側で「出せるカードを明るく、それ以外を暗く」表示するために使う想定)
// 戻り値は手札内のカードオブジェクトへの参照そのものの配列 (`===`で比較できる)
export function getPlayableCards(state, playerIndex) {
  const hand = state.hands[playerIndex];
  const jokers = hand.filter((c) => c.suit === 'joker');
  const playable = new Set();
  const markPlayable = (cards) => {
    for (const c of cards) playable.add(c);
  };

  // 同じ数字の組み合わせ (ペア系)。ジョーカーを混ぜたパターンも試す
  const realsByRank = new Map();
  for (const c of hand) {
    if (c.suit === 'joker') continue;
    if (!realsByRank.has(c.rank)) realsByRank.set(c.rank, []);
    realsByRank.get(c.rank).push(c);
  }
  for (const reals of realsByRank.values()) {
    const lockedReals = state.suitLock ? reals.filter((c) => c.suit === state.suitLock) : [];
    // 記号縛り中で、この数字にロック中のスートの実カードが1枚も無いなら、
    // ジョーカーはスートを持たないので束ねても記号縛りを満たせない → この数字はまるごと対象外
    if (state.suitLock && lockedReals.length === 0) continue;

    const otherReals = state.suitLock ? reals.filter((c) => c.suit !== state.suitLock) : reals;
    const maxCount = reals.length + jokers.length;

    for (let k = 1; k <= maxCount; k++) {
      const m = Math.min(k, reals.length);
      const jokerUsed = jokers.slice(0, k - m);

      // 1枚出し (k===1) かつ記号縛りが無い場合は、スペ3対ジョーカーのような「そのカード固有」の
      // 特例があり得るため、同じ数字でも同一視せずカードごとに個別で試す
      if (k === 1 && !state.suitLock) {
        for (const target of reals) {
          if (wouldBeLegal(state, playerIndex, [target])) {
            markPlayable([target]);
          }
        }
        continue;
      }

      // 記号縛り中は、ロック中のスートの実カードを必ず1枚含めた組み合わせで試す
      // (それ以外の実カードは、そのカード自体がロック中のスートでない限り単独では出せないため)
      const testReals = state.suitLock
        ? [lockedReals[0], ...otherReals.slice(0, m - 1)]
        : reals.slice(0, m);
      const cards = [...testReals, ...jokerUsed];

      if (wouldBeLegal(state, playerIndex, cards)) {
        if (!state.suitLock) {
          // 記号縛りが無く2枚以上の組なら、同じ数字の実カード同士はどれを選んでも legality は同じ
          // (スペ3等の1枚出し限定の特例はここでは関係ない) ので全部playableにする
          markPlayable(reals);
        } else {
          // 記号縛り中は、ロック中スートの実カード(2デッキなら複数枚あり得る。どれも互いに交換可能)は確定でplayable
          markPlayable(lockedReals);
          // 2枚以上使うなら、ロック中スートのカードさえ1枚含まれていれば残り枠はどの同数字カードでもよいので、
          // 未使用の同数字カードも含めて全部playableにできる
          if (m >= 2) markPlayable(reals);
        }
        if (jokerUsed.length > 0) markPlayable(jokers);
      }
    }
  }

  // 全部ジョーカーの組 (宣言rank無し=最強固定、および1〜13を宣言した場合の両方を試す)
  for (let k = 1; k <= jokers.length; k++) {
    const cards = jokers.slice(0, k);
    if (wouldBeLegal(state, playerIndex, cards)) {
      // ジョーカー同士はどれを選んでも legality は変わらないので、試した分だけでなく全ジョーカーを playable にする
      markPlayable(jokers);
    }
    for (let r = 1; r <= 13; r++) {
      if (wouldBeLegal(state, playerIndex, cards, { declareRank: r })) {
        markPlayable(jokers);
        break; // 1つでも通る宣言があれば、このジョーカー達は「出せる」ので十分
      }
    }
  }

  // 階段 (スートごとに、実カードが収まる範囲の窓を全部試す)
  for (const suit of SUITS) {
    const suitReals = hand.filter((c) => c.suit === suit);
    if (suitReals.length === 0) continue;

    const realByIdx = new Map();
    for (const c of suitReals) {
      const idx = RANK_ORDER.indexOf(c.rank);
      if (!realByIdx.has(idx)) realByIdx.set(idx, []);
      realByIdx.get(idx).push(c);
    }

    const maxLength = Math.min(RANK_ORDER.length, suitReals.length + jokers.length);
    for (let length = 3; length <= maxLength; length++) {
      for (let start = 0; start + length - 1 < RANK_ORDER.length; start++) {
        const windowIdxs = [];
        for (let i = 0; i < length; i++) windowIdxs.push(start + i);

        const realsInWindow = windowIdxs.filter((idx) => realByIdx.has(idx));
        if (realsInWindow.length === 0) continue; // 実カードが1枚も無い窓は階段として意味を成さない

        const jokersNeeded = length - realsInWindow.length;
        if (jokersNeeded > jokers.length) continue;

        // 判定には各枠から代表1枚だけ使う (同じ枠に2デッキ分の重複があっても、階段には1枚あれば足りるため)
        const cards = [
          ...realsInWindow.map((idx) => realByIdx.get(idx)[0]),
          ...jokers.slice(0, jokersNeeded),
        ];
        const straightFrom = RANK_ORDER[start];

        if (wouldBeLegal(state, playerIndex, cards, { straightFrom })) {
          // マークするときは、同じ枠にある重複カード(2デッキ分)も全部playableにする
          markPlayable(realsInWindow.flatMap((idx) => realByIdx.get(idx)));
          if (jokersNeeded > 0) markPlayable(jokers);
        }
      }
    }
  }

  return hand.filter((c) => playable.has(c));
}
