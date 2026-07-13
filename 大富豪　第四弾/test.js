import { createDeck, shuffleDeck, dealCards, sortHand } from './card.js';
import { createGameState, playGroup, passTurn, isGameOver } from './game.js';

// 山札を作って2人に配る
const deck = shuffleDeck(createDeck());
const hands = dealCards(deck, 2).map(sortHand);
console.log('プレイヤー0の手札枚数:', hands[0].length);
console.log('プレイヤー1の手札枚数:', hands[1].length);

// ゲーム状態を作って、player0が手札の先頭カードを1枚出してみる
const state = createGameState(hands);
const firstCard = hands[0][0];
playGroup(state, 0, [firstCard]);

console.log('1枚出した後の場:', state.field);
console.log('手番:', state.turn);
console.log('ゲーム終了か:', isGameOver(state));

console.log('\n動作確認OK: card.js / game.js は正常に読み込めています。');
