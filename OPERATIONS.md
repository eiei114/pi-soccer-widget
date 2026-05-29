# pi-soccer-widget 運用方針

このリポジトリは、Pi Coding Agent 用のサッカーウィジェット拡張を小さく安全に保守するため、以下の方針で運用します。

## 1. 運用の優先順位

1. **秘密情報を漏らさない**: API key はチャット・ログ・Issue 本文に載せない。`/soccer login` とローカル保存を優先する。
2. **Pi 本体の入力体験を壊さない**: ウィジェット表示・コマンド補完・UI 入力が失敗しても、Pi セッション全体を止めない。
3. **API 使用量を抑える**: 6時間スナップショットキャッシュを維持し、手動更新は `/soccer sync` に寄せる。
4. **サッカー日程の薄い時期も有用にする**: favorite → watchlist → discovery の順で表示価値を確保する。

## 2. Issue 運用

Issue 着手時の情報不足を減らすため、作成時に「優先度」「影響範囲」「期待/実際の動作」「確認コマンド」を必ず埋めます。空欄のまま着手しないことが、手戻りを防ぐ最大のポイントです。

### 2.1 優先度の判断基準

各 Issue には high / medium / low のいずれかを付けます。迷ったら「利用者への影響の大きさ」と「放置した場合のリスク」で判断します。

| 優先度 | 判断基準 | 例 |
| --- | --- | --- |
| **high（高）** | 秘密情報の漏えい、Pi セッションを落とす不具合、認証フローの破損。放置するとデータ流出やセッション全損につながる。 | API key がログ/Issue に露出、未捕捉例外で Pi が停止、`/soccer login` `/logout` `/status` が機能しない |
| **medium（中）** | 主要コマンドが使えない、データが壊れる/明確に誤る。利用者は回避できるが体験が大きく損なわれる。 | `/soccer setup` `/pick` `/search` で選択不能、キャッシュ破損、表示データの明確な不整合 |
| **low（低）** | 体験を改善するが、現状でも実用できる。後回しでも実害が小さい。 | 文言改善、対応リーグ追加、表示フォーマット調整、README/ドキュメント改善 |

判断に迷う場合は一段上の優先度を仮置きし、Issue 本文に理由を書きます。

### 2.2 受け入れ条件テンプレート

新規 Issue 作成時は、以下をコピーして本文に貼り、各項目を埋めてから着手します。

```text
## 背景 / 目的
（なぜ必要か。利用者がどう困っているか）

## 影響範囲
- 対象コマンド / 表示箇所: （例: /soccer search、ウィジェット1行目）
- API key の要否: 要 / 不要

## 期待動作
（修正・追加後にどうなってほしいか）

## 実際の動作（バグの場合）
（現状どうなっているか。再現手順があれば記載）

## 受け入れ条件
- [ ] （満たすべき条件を箇条書き）
- [ ] 確認コマンド `npm run check` が成功する

## 優先度
high / medium / low （根拠: ）
```

### 2.3 確認コマンド

- すべての Issue で `npm run check`（build + `npm pack --dry-run`）の成功を必須条件にします。
- API 取得やキャッシュに触れる変更は、上記に加えて「7. 動作確認観点」の該当項目を受け入れ条件に追記します。

## 3. 変更フロー

1. `npm install` 済み状態で作業する。
2. 変更は小さく分ける。UI/コマンド/データ取得/文書を混ぜすぎない。
3. 変更後に必ず `npm run check` を実行する。
4. 仕様変更がある場合は `README.md` と `CHANGELOG.md` を更新する。
5. API key、ローカル設定ファイル、キャッシュファイルはコミットしない。

## 4. リリース方針

### 通常リリース

- patch: バグ修正、文言修正、内部リファクタ。
- minor: コマンド追加、設定項目追加、対応リーグ拡張。
- major: 設定ファイル形式やコマンド互換性を壊す変更。

リリース前チェック:

```bash
npm run check
```

`npm pack --dry-run` の出力で、配布物が `extensions/`, `dist/extensions/`, `README.md`, `OPERATIONS.md`, `LICENSE`, `CHANGELOG.md` に収まっているか確認します。

### npm publish（Trusted Publisher）

npm publish は GitHub Actions OIDC の Trusted Publisher 経由のみ。`NPM_TOKEN` は使わない。

npmjs.com の Trusted Publisher 設定:

- Publisher: GitHub Actions
- Repository: `eiei114/pi-soccer-widget`
- Workflow filename: `publish.yml`

通常フロー:

1. `main` へ version bump を merge する
2. `auto-release.yml` が tag / GitHub Release を作成する
3. 同 workflow から `publish.yml` を起動する
4. `publish.yml` が `npm run check` と `npm publish --access public` を実行する

手動 fallback（publish 失敗時や tag 先行時）:

```bash
gh workflow run publish.yml --repo eiei114/pi-soccer-widget --ref v0.3.0 -f ref=v0.3.0
```

`auto-release.yml` から直接 `npm publish` しない。Trusted Publisher は workflow filename が一致しないと E404 になる。

### 緊急リリース

秘密情報漏えいや Pi セッション停止級の不具合は、機能追加を止めて修正を優先します。修正後は `SECURITY.md` と `CHANGELOG.md` に利用者向け対応を追記します。

## 5. セキュリティ運用

- Football-data API key は Pi UI 入力で受け取り、モデル文脈に出さない。
- 保存先は `~/.pi/agent/pi-soccer-widget-auth.json`。可能な環境では `0600` を設定する。
- `pi-soccer-widget-auth.json` は secret 本体を含むローカル専用ファイル。コミット、Issue 添付、ログ貼り付けをしない。確認が必要な場合も key 値は伏せる。
- `FOOTBALL_DATA_API_TOKEN` がある場合は環境変数を優先する。`/soccer status` は source のみ表示し、環境変数・保存ファイルの key 本体を表示しない。
- Issue やログに key が貼られた場合は、即座に利用者へローテーションを促す。
- 公開 Issue に脆弱性詳細を書かず、`SECURITY.md` の私的報告方針に従う。

## 6. 外部 API 運用

- football-data.org API の一時障害は、古いスナップショット表示で耐える。
- 個別チーム取得の失敗は全体失敗にしない。既存実装の per-team fallback を維持する。
- 新しい API エンドポイント利用時は timeout、HTTP エラー、rate limit 時の表示を確認する。
- キャッシュ TTL を短くする変更は、API 使用量増加の理由を Issue に残す。

## 7. 動作確認観点

最低限、以下を確認対象にします。

- TypeScript build が通る。
- `npm pack --dry-run` が通る。
- API key 未設定時に案内表示になる。
- API key 設定済み時に `/soccer status` が key 本体を表示しない。
- search/add/favorite/remove が、cached result 番号と文字列指定の両方で破綻しない。
- favorite の情報が薄いとき、watchlist/discovery に fallback できる。

## 8. ロードマップ管理

README の Roadmap は利用者向けの短い一覧に保ちます。実装前に、Issue 側で以下を決めます。

- 利用者が得る具体価値
- 追加するコマンド・設定・表示
- football-data.org 以外の provider が必要か
- 既存ローカルファイルとの互換性

現時点の優先候補:

1. FIFA World Cup 2026 mode
2. misspell に強い fuzzy matching
3. football-data.org 以外の provider fallback

## 9. 保守担当者向けメモ

- ローカル状態は `~/.pi/agent/` 配下に集まる。
- 旧 `soccer-team.json` と `soccer-teams-cache.json` は移行互換のため、削除判断は慎重に行う。
- Pi extension API の型や UI 仕様が変わった場合は、まず `ExtensionAPI` まわりの compile error を確認する。
