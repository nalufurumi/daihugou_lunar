import { canPlayGroup, getPlayStrength, getPlaySuits } from './card.js';

// ゲームの状態を表すオブジェクト
export function createGameState(hands) {
  return {
    hands,              // 各プレイヤーの手札 [[...], [...]]
    field: null,         // 場に出ている最後のグループ (カードの配列 or null)
    turn: 0,             // 現在のターンのプレイヤーindex
    passCount: 0,        // 連続パス数
    finished: [],        // 上がった順のプレイヤーindex
    sequenceLock: false, // 階段縛り(1枚出しの連番縛り)が発動しているか
    lastPlaySuits: null, // 直前に出した組で使われていたスートの集合 (記号縛り判定用)
    suitLock: null,      // 記号縛りが発動している場合、固定されたスート
  };
}

// カードの組 (1枚 or ペア以上) を出す処理
// cards: 出そうとしているカードの配列 (例: [{suit:'spade',rank:5}, {suit:'heart',rank:5}])
export function playGroup(state, playerIndex, cards) {
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

  if (!canPlayGroup(cards, state.field)) {
    throw new Error('そのカードの組は場に出せません');
  }

  // 階段縛りが発動中は、場と同じ枚数で、代表の数字が「場の数字+1」でなければ出せない
  if (state.sequenceLock) {
    const fieldStrength = getPlayStrength(state.field);
    const playStrength = getPlayStrength(cards);
    if (cards.length !== state.field.length || playStrength !== fieldStrength + 1) {
      throw new Error('階段縛りにより、連続する数字しか出せません');
    }
  }

  const playSuits = getPlaySuits(cards);

  // 記号縛りが発動中は、出すカードの中に固定スートが含まれていなければならない
  if (state.suitLock && !playSuits.has(state.suitLock)) {
    throw new Error('記号縛りにより、そのスートを含まないと出せません');
  }

  // 手札から取り除く
  for (const card of cards) {
    const idx = hand.findIndex(
      (c) => c.suit === card.suit && c.rank === card.rank
    );
    hand.splice(idx, 1);
  }

  // 階段縛りの判定・更新 (1枚出しがターンをまたいで連番になったら発動)
  updateSequenceLock(state, cards);

  // 記号縛りの判定・更新 (直前の組と共通するスートが1つでもあれば、そのスートで発動)
  updateSuitLock(state, playSuits);

  state.field = cards;
  state.passCount = 0;

  // 上がり判定
  if (hand.length === 0 && !state.finished.includes(playerIndex)) {
    state.finished.push(playerIndex);
  }

  advanceTurn(state);
  return state;
}

// 階段縛りの判定・更新を行う (playGroup内、場を更新する前に呼ぶ)
// 場と枚数が同じ組同士で、代表の数字がちょうど+1になっていれば発動する
function updateSequenceLock(state, cards) {
  const prevField = state.field;

  // 既に発動中なら、そのカードを出せた時点で連番は続いているので維持する
  if (state.sequenceLock) return;

  if (prevField && cards.length === prevField.length) {
    const prevStrength = getPlayStrength(prevField);
    const newStrength = getPlayStrength(cards);
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
  if (state.passCount >= state.hands.length - 1) {
    state.field = null;
    state.passCount = 0;
    state.sequenceLock = false;
    state.lastPlaySuits = null;
    state.suitLock = null;
  }

  advanceTurn(state);
  return state;
}

// 次のプレイヤーにターンを移す
function advanceTurn(state) {
  const playerCount = state.hands.length;
  let next = (state.turn + 1) % playerCount;

  while (state.finished.includes(next) && state.finished.length < playerCount) {
    next = (next + 1) % playerCount;
  }

  state.turn = next;
}

// ゲーム終了判定 (2人プレイなら1人上がったら終了)
export function isGameOver(state) {
  return state.finished.length >= state.hands.length - 1;
}
