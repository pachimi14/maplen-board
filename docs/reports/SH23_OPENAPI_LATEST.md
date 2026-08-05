# SH-23 実測レポート — 公式 Open API への現在価格切替

対象: `itemId=1003720`(Chaos Von Bon Helmet)。計画書: `docs/IMPL_PLAN_SH23.md`。
検証は実装担当がローカル(`server/sf-history`、port 8785)で実行。**キー値はこのファイル・
どのコマンド出力にも記録していない**(§2 参照)。

---

## (a) `latestUpdatedAt` が分単位で進むこと — 5分キャッシュ越しに2回観測

`MSU_OPEN_API_KEY` 設定済みの状態で `GET /sf-history/latest?itemId=1003720` を実測。

| # | 実時刻(UTC) | `latestUpdatedAt` |
|---|---|---|
| 1 | 2026-08-05T13:04:23Z | `2026-08-05T13:03:00Z` |
| 2 | 2026-08-05T13:09:53Z(約5.5分後、デフォルト300s TTLを跨ぐ) | `2026-08-05T13:10:00Z` |

2回目のリクエストは1回目の約5.5分後、デフォルト300s(5分)TTLの期限切れ後に発行 →
キャッシュが実際に上流(Open API)へ再フェッチし、`latestUpdatedAt` が **13:03 → 13:10 と
7分進んだ**(20分グリッド上の値 13:00/13:20 のどちらでもない)。分単位で進むことを確認した。

旧無認証エンドポイント(20分グリッド、同時刻に直接比較)の `latestUpdatedAt` は
`2026-08-05T12:40:00Z` — Open API のほうが分単位で新しいことを確認。

## (b) 単位・星インデックスの一致 — 同一時刻に両エンドポイントを直接比較

`fetch_latest.py` を経由せず、両エンドポイントへ直接リクエストして同時刻の値を比較
(実行: 2026-08-05T13:05Z 頃)。

- 旧 `latest` の `latestUpdatedAt`: `2026-08-05T12:40:00Z`(24分古い)
- Open API のサンプル `startDate`(star 0): `2026-08-05T13:04:00Z`
- Open API の星キー数: **25**(0..24 文字列キー、25件前提のハードコードはしていない)

| star | legacy (NESO) | openapi (NESO) | 比 openapi/legacy |
|---|---|---|---|
| 0  | 36922.3016  | 36902.4509  | 0.9995 |
| 5  | 67360.3583  | 67316.2683  | 0.9993 |
| 10 | 238756.6434 | 238557.1809 | 0.9992 |
| 15 | 742474.9631 | 741837.0980 | 0.9991 |
| 17 | 531214.0458 | 530576.1807 | 0.9988 |
| 20 | 512843.5312 | 512205.6661 | 0.9988 |
| 21 | 512843.5312 | 512205.6661 | 0.9988 |

**全星で比が 0.999 前後**(1.00 からの乖離は 0.05〜0.12% で、旧エンドポイントが24分古い
ぶんの価格変動として説明できる範囲)。単位(1e18)・星インデックスの意味は従来と同じと確認。
IMPL_PLAN_SH23 §0 の統括の実測(0.9963〜0.9984、最大20分古い分)と整合。

## (c) キー未設定時のフォールバック

`MSU_OPEN_API_KEY` を外した状態で起動 → 起動ログ:

```
sf-history: current-price upstream = legacy enhance-price/latest (no MSU_OPEN_API_KEY)
```

`GET /sf-history/latest?itemId=1003720` は正常に応答し、`latestUpdatedAt` は
`2026-08-05T12:40:00Z`(20分グリッド、旧エンドポイントの挙動)。応答フィールドは
`{itemId, latestUpdatedAt, prices}` で、キーありのときと完全に同じ形。

キーを設定して再起動すると起動ログが切り替わる:

```
sf-history: current-price upstream = openapi.msu.io (MSU_OPEN_API_KEY configured)
```

**両ログとも、キーの値そのものは一度も出力していない。**

## 手順(再現用)

```bash
cd server/sf-history
# キー無し
python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
# キーあり(値をコマンド履歴に残さない)
set -a; source "$HOME/.lulumi-tools/raffle-api.env"; set +a
python -m uvicorn app:app --host 127.0.0.1 --port 8785 --workers 1
```
