# SH-22 / SH-23 統括検収(2026-08-05)— **両方合格**

## SH-22 — Magic Eyepatch / Berserked の追加

### リスト出どころの照合(ユーザー指摘の起点)

統括が **VPS の SF キャッシュ bot の実リスト**を取得して照合した:

```
VPS: /home/botuser/apps/maplenEnhancebot (HEAD e34591b)
     sf-priority-cache-bot.service → load_priority_representative_item_ids() = 30件
SF履歴: 28件
差分: 1113282 Noble Ifia's Ring / 1122254 Mechanator Pendant
      = ユーザーが原案で除外指定した2件のみ
```

**∴ リストの出どころは同じ関数だった。**別のリストを使っていたわけではない。

**Magic Eyepatch は bot のリストにも入っていない**:
maplenEnhancebot の `EXCLUDED_REPRESENTATIVE_ITEM_IDS` が除外している
(`1003622` Black Bean Hat / `1052527` Black Bean Suit / `1012632` Berserked /
`1022278` Magic Eyepatch / GS-263 の3件)。**前者4件には除外理由のコメントが無い。**

### バックフィル結果(統括が実行)

```
1012632 Berserked       rows=82,588  maxUpgrade=21  2026-02-26T13:00Z .. 2026-08-05T11:00Z
1022278 Magic Eyepatch  rows=82,588  maxUpgrade=21  同上
装備数: 30 / 4h テーブル: 621,240行
```

`maxStar` はデータから導出され **両方とも ☆22**。alias は各1件(単独グループ)。
**既存28件の差分は `generatedAt` のみ**(`git diff -w` で確認)。

## SH-23 — 現在価格を公式 Open API へ

### ★鮮度の対比(統括が実測)

```
Open API(キーあり)      : latestUpdatedAt = 2026-08-05T13:12:00Z   (now 13:12:40 → 40秒前)
フォールバック(キー無し) : latestUpdatedAt = 2026-08-05T12:40:00Z   (32分前・20分グリッド上)
起動ログ(キー無し)      : "current-price upstream = legacy enhance-price/latest (no MSU_OPEN_API_KEY)"
起動ログ(キーあり)      : "current-price upstream = openapi.msu.io (MSU_OPEN_API_KEY configured)"
```

**40秒前 vs 32分前。**切り替えとフォールバックの両方が効いている。

### ★秘密情報(統括が実値で検索して確認)

```
git grep -F <実キー>           → 混入なし(追跡ファイル)
grep -r  -F <実キー> 作業ツリー  → 混入なし
grep -r  -F <実キー> docs/     → 混入なし
```

**キー無しで `pytest` 102 passed** = テストはオフラインで、キーに依存していない。

### 意味論の一致

統括の事前実測(星ごとの比 0.9963〜0.9984)と実装担当の実測(0.9988〜0.9995)がいずれも
**1.00 近傍**。差は**旧エンドポイントが最大20〜32分古い**ぶんで説明できる。
単位(÷1e18)・星インデックスとも従来と同じ。

## 統括の誤りの訂正(記録)

SH-14/SH-15 で「上流は20分粒度」と結論し、**それを前提に TTL を設計した**。
**実際には、無認証エンドポイントが20分粒度だっただけ**で、
**公式 Open API は1分粒度**(`startDate`〜`endDate` で有効期間を明示)だった。

**ユーザーが「公式APIを使えばリアルタイム取得できるはず」と指摘して発覚。**
**測ったものが「上流の限界」なのか「使っているエンドポイントの限界」なのかを、
最初に区別すべきだった。**

> なお SH-15 で入れた「スタンプから次回公開時刻を導出する TTL」は、
> **1分粒度のエンドポイントには合わない**(毎分叩きに行く)ため、
> ユーザー指定の**固定5分**に戻した。**上限・下限ガードと single-flight は維持**。
