# IMPL_PLAN_SH1 — 公式 enhance-price/history API の実測調査

設計正典: `docs/DESIGN_SF_COST_HISTORY.md`(r2・**承認済 2026-08-05**)。本スライスは §13 の SH-1。
ブランチ: `feat/sf-cost-history`(ワークツリー `C:\Users\pachi\Desktop\msu-ranking-sfhist`)

## 0. 目的と背景

**設計書 §2 の前提 P1〜P4 を、推測でなく実測値で決着させる。**
特に **P2(単位)** — 公式 `history` の `endPrice` が `latest` の `closePrice / price_divisor`(1e18)と
同じスケールかどうか。**ここを外すと以降の全数値が 1e18 倍ずれ、しかも例外が出ない**
(それらしい数字が表示されてしまう)。∴ 本スライスは以降の全スライスの前提を張る。

**★本スライスは調査である。本番コードを書かない。** SQLite スキーマ・FastAPI・UI はすべて SH-2 以降。

## 1. スコープ

**作るもの**(すべて新規・既存ファイルを1つも変更しない):
- `tools/sf_history_probe/probe.py` — 調査スクリプト本体
- `tools/sf_history_probe/README.md` — 実行方法と、各測定が設計書のどの前提に対応するか
- `docs/reports/SH1_API_PROBE.md` — **測定結果の報告書(本スライスの主成果物)**
- `docs/reports/sh1_samples/*.json` — 生レスポンスの抜粋(**各ファイル 50KB 以内に間引く**)

**触らないもの**(1つでも触れたら停止):
- `exp_ranking/` 配下すべて(bot / web / api)
- `server/` 配下すべて
- `.github/workflows/` 配下すべて
- `docs/DECISION_LOG.md`(追記は統括が行う)
- `docs/DESIGN_SF_COST_HISTORY.md`(設計変更が要るなら停止して報告)

**依存**: `requests`(bot が既に使用・`exp_ranking/bot/requirements.txt` で `>=2.32.3,<3` 固定)。
**新規 npm / pip 依存の追加は禁止**(ユーザー専権)。標準ライブラリ + `requests` で完結させること。

## 2. 調査対象

**対象は1装備のみ**: `itemId=1382265`(Arcane Umbra Staff)。
理由: maplenEnhancebot の parity fixture に同 itemId があり、後続 SH-4 の突き合わせに使えるため。

API:
```
GET https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/history
    ?itemId=&itemUpgrade=&period=2&minTimestamp=&maxTimestamp=
GET https://msu.io/maplestoryn/api/msn/dynamicpricing/enhance-price/latest?itemId=   ← P2 の照合用
```

`period=2` が1時間足の想定(**要確認。違ったら測定して正しい値を報告**)。

### 2.1 公式 API への負荷の上限(厳守)

- **並列数 1(逐次)**・**リクエスト間隔 1.0 秒以上**
- **本スライスの総リクエスト数 ≤ 60**。超えそうなら測定項目を削って報告する
- **429 を意図的に誘発しない。** レート制限の境界を探る測定は**行わない**
  (429 が偶発したら §5 の停止条件)
- User-Agent を明示的に設定する(既存 bot の流儀に合わせる)

## 3. 測定項目(この7つに答えを出す)

| # | 問い | 設計書の前提 | 報告する数値 |
|---|------|--------------|--------------|
| M1 | **`history.endPrice` と `latest.closePrice` のスケール関係** | **P2(最優先)** | 同一 itemId・同一 itemUpgrade・最新時刻で両者を取得し、**比 `closePrice / endPrice` を実数で**。1e18 なのか 1 なのか他の値なのか |
| M2 | `itemUpgrade` を省略すると全星が返るか | P4 | 返る星の集合、または返らない場合のステータス/エラー本文 |
| M3 | 1時間足で遡れる最古の時刻 | P1 | 最古 `date` と、現在時刻との差(**日数・小数1桁**) |
| M4 | 有効な `itemUpgrade` の範囲 | — | 応答が返る `itemUpgrade` の集合(0..21 か 0..24 か) |
| M5 | `sumEnhanceCnt=0` の時間帯にも `endPrice` があるか | P3 | 全行数 / `sumEnhanceCnt=0` の行数 / **そのうち `endPrice` が非 null の行数** |
| M6 | 1リクエストの所要時間と返る点数 | — | 所要時間の**中央値(n=5)**、1レスポンスの点数、**点数に上限があるか**(150日=3600点が1回で返るか) |
| M7 | `period` パラメータの意味 | — | `period=2` が1時間足か。`date` の間隔を実測して確認 |

**M1 の測り方(具体)**: `latest` の `starForce` 配列から `itemUpgrade=N` の `closePrice` を取り、
`history`(`itemUpgrade=N`)の**最新 `date` の `endPrice`** と比べる。
時刻がずれる可能性があるので、**比が安定するか複数の N(例 0/10/17/21)で確認**すること。
比が装備・星によらず一定なら、それが単位換算係数。**一定でないなら M1 は「不定」と報告して停止**。

## 4. 受け入れ基準(数値・機械判定)

- **(a)** M1〜M7 のすべてに、`docs/reports/SH1_API_PROBE.md` で**実測値**が書かれている
  (「〜のようだ」「おそらく」は不可。測れなかった項目は**測れなかった理由**を書く)
- **(b)** M1 の比が **4つ以上の異なる `itemUpgrade` で一致**する(相対ばらつき ≤ 1e-6)、
  または「一致しない」ことがばらつきの数値付きで示されている
- **(c)** 総リクエスト数が **≤ 60**、**429 が 0 件**。実際の総数と各エンドポイントの内訳を報告する
- **(d)** `probe.py` が**再実行可能**(同じコマンドで同じ測定ができる。取得済みを前提にしない)
- **(e)** 生レスポンス抜粋が `docs/reports/sh1_samples/` にあり、**各ファイル ≤ 50KB**
- **(f)** 既存ファイルの差分が **0 件**(`git status` で新規追加のみであることを示す)
- **(g)** `cd exp_ranking/web && npm run build` が通る(**本スライスは web を触らないので、
  触っていないことの確認**)

## 5. 停止条件(該当したら止めて選択肢+推奨付きで統括に報告)

1. **M1 の比が一定にならない**(装備・星によって換算係数が変わる)— 単位の正が特定できない。
   **これは設計の前提が崩れる事象なので、必ず停止する**
2. **429 が返った** — レート制限を探りに行かない。即停止して、それまでの測定結果を報告
3. **認証・CORS・その他の理由でアクセスが拒否される**(401/403 等)
4. API のパラメータ名・レスポンス構造が §2 の記述と違う(測って正しい形を報告し、停止)
5. **設計書 `DESIGN_SF_COST_HISTORY.md` の記述と実測が矛盾する** — 設計書を書き換えず、停止して報告
   (設計書の更新は統括の役目)
6. §1 の「触らないもの」に触る必要が生じた
7. 総リクエスト数が 60 に達しても測定項目が埋まらない

## 6. 検証コマンド

```
python tools/sf_history_probe/probe.py --item-id 1382265 --out docs/reports
git status --short
git diff -w
cd exp_ranking/web && npm run build
```

## 7. ロールバック

新規ファイルの追加のみ。revert すれば `tools/sf_history_probe/` と `docs/reports/SH1_*` が消えるだけで、
既存の挙動・ビルド・ワークフローに一切影響しない。

## 8. コミット

- **ローカルコミットを行う**(1コミットでよい)。
- **`git push` は行わない**(ユーザー専権)。
- **`git add -A` 禁止**。追加したファイルのみ個別 add し、add したパスを報告に列挙すること。

## 9. 完了報告テンプレ

```
## SH-1 完了報告
- コミット: <hash>
- M1 単位: closePrice / endPrice = <実数>(itemUpgrade=0/10/17/21 の各値と相対ばらつき)
- M2 itemUpgrade 省略: <返る星の集合 or エラー>
- M3 最古時刻: <ISO8601>(現在から <n.n> 日前)
- M4 有効 itemUpgrade: <集合>
- M5 sumEnhanceCnt=0: 全 <n> 行 / うち 0 が <n> 行 / うち endPrice 非null が <n> 行
- M6 所要時間: 中央値 <n> ms(n=5)/ 1レスポンス <n> 点 / 点数上限: <有無と値>
- M7 period=2: <1時間足か。date 間隔の実測>
- 総リクエスト数: <n>(history <n> / latest <n>)、429: <n> 件
- 受け入れ基準 (a)〜(g): 各項目の結果
- git status --short / add したパス一覧
- 停止条件に触れた事項(あれば)
- 設計書との矛盾(あれば。**自分で設計書を直さずここに書く**)
- 気づいたが本スライスでは扱わなかったこと:
```
