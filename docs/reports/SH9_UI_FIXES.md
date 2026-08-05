
---

# 統括検収(2026-08-05)— **合格**

ブラウザ実機で確認。以下は**統括が自分で操作・測定**した結果。

## ① ナビ導線

```
#/starforce : EXP Ranking->#/ | Task Manager->#/dashboard | SF履歴->#/starforce  (aria-current=page)
#/          : EXP Ranking->#/ (aria-current=page) | Task Manager | SF履歴
#/dashboard : Task Manager (aria-current=page) + TM のサブナビ3つが従来どおり
```
**既存2ページとも `#root` が生きており、既存リンクの href・ラベル・選択状態は不変。回帰なし。**

## ② 全装備検索(データは代表)

- `/sf-history/equipment` の **aliases 総数 186 / 名前欠落 0 / ユニーク名 186**
- 検索実例: **`AbsoLab Knight Gloves`(1082636)= 代表でない装備名で引ける**
  (候補に `AbsoLab Knight Gloves#1082636 · ☆22まで` が出る)
- 選択後、**データが表示される**(現在値 556M・チャート2本)
- **代表で叩かれていることの証明(消去法)**:
  `prices?itemId=1082636` → **404** / `prices?itemId=1082637`(代表)→ **200**。
  画面にデータが出ている以上、リクエストは代表 `1082637` で行われている
- **(d) 正直さの表示**: `.sfh-group-shared-note` =
  **「強化費用はこのグループ共通です(代表: AbsoLab Mage Gloves)。」** を確認。
  黙って別装備の数字を出していない

## ③ テーマ対応

`SfHistoryRoot` の最上位が **`site-theme sfh-root min-h-screen`** になった。実測:

| 操作 | `--theme-focus` | `--theme-bg-start` | `--theme-card-bg` |
|---|---|---|---|
| green / deep(初期) | `#34d399` | `#020617` | `rgb(255 255 255/.96)` 系の暗色 |
| **purple / light** | **`#a78bfa`** | **`#f8fafc`** | `rgb(255 255 255/.92)` |

**色・深さとも計算済みスタイルが変わることを確認**(`getComputedStyle` 実測)。

> **統括の躓き(記録)**: 最初「色が効かない」と判断しかけたが、**私の操作ミス**だった。
> 色スウォッチは `aria-label` のみでテキストを持たない(`<button aria-label="パープル" class="theme-swatch ...">`)ため、
> テキスト一致で掴めていなかった。**深さ(Light/Standard/Deep)だけが効いて見えたのはそのため。**
> aria-label で掴み直したら正しく切り替わった。

## 残す観察(block しない)

- **P3**: グループ共通の注記が**プリセット行より後ろ**に描画されている。装備セレクタの近くのほうが目に入る。
  デザインの好みの範囲なので修正要求はしない
- **P2(実装担当の自己申告・妥当)**: `App.jsx` が route に関係なく
  `document.documentElement.dataset.themeColor/Depth` をランキング側の state から設定するため、
  **セッション最初の `#/starforce` 遷移で一度だけ**テーマが上書きされうる。
  既定値が同じ(green/deep)なので通常は無害。恒久修正は `App.jsx` の変更が要る=**別スライス**。
  **実装担当が自分から報告した**点を評価する(隠せば気づかれにくい種類の制約)
- **チャートの折れ線色は cyan 固定**でテーマ非追従。実装担当の意図的判断でコメントも残っている。
  デザイン判断としてユーザーに委ねる
- 計画書の検索実例 `AbsoLab Warrior Gloves` は**実在しなかった**(AbsoLab の職業ラインは
  Knight/Mage/Archer/Bandit/Pirate)。**統括の作文ミス**を実装担当が実データで訂正した
