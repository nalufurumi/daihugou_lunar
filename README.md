# 大富豪ゲームサイト（仮）

Lunarチームの遊びプロジェクト。みんなで共同開発する大富豪（Daifugo）オンラインゲーム。

## 技術スタック
- フロントエンド: React + Vite
- 通信: （検討中）まずはローカル対戦から実装し、将来的にリアルタイムオンライン対戦へ拡張予定

## 開発ルール
ブランチ運用・PRの流れは [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## セットアップ
```bash
git clone <このリポジトリのURL>
cd <repo名>
npm install
npm run dev
```

## 担当分け（暫定）
| 担当領域 | ブランチ | 担当者 |
|---|---|---|
| ゲームロジック | `feature/game-logic` | |
| ゲームUI | `feature/game-ui` | |
| ロビー画面 | `feature/lobby` | |
| トップページ・ルール説明 | `feature/homepage` | |
