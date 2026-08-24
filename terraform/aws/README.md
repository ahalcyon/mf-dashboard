# Terraform: AWS 移行

Money Forward の取得・保存・配信を AWS 上に置き換えるためのルートモジュール。

Cloudflare Tunnel / Access 用の `terraform/` とは独立した state を持つ。認証・公開の
置き換えは本モジュールのスコープ外で、当面は既存の `terraform/` が並存する。

## 構成

```
EventBridge Scheduler (6:30 / 15:30 JST)
        │ RunTask
        ▼
   ECS Fargate: crawler ──── SSM Parameter Store (MF_EMAIL / MF_PASSWORD / MF_TOTP_SECRET)
        │ SendMessage
        ▼
   SQS FIFO (単一 MessageGroupId) ──▶ DLQ ──▶ CloudWatch Alarm
        │
        ▼
   Lambda: writer (予約同時実行数 1)
        │ ファイル全体の read-modify-write
        ▼
   S3: data バケット  s3://…/db/moneyforward.db  (バージョニング有効)
        │ EventBridge "Object Created"
        ▼
   CodeBuild: site  ── DB を読んで next build (output: "export")
        │ s3 sync + invalidation
        ▼
   S3: site バケット ──▶ CloudFront (OAC)  ──▶ 利用者
```

### 設計上の制約（変更してはいけない箇所）

- **S3 上の SQLite は部分書き込みもロックもできない。** 書き込みはファイル全体の
  read-modify-write になる。これを安全に保つのは次の 3 点セットで、どれか 1 つでも
  外すと後勝ちでデータが消える。
  - SQS が FIFO キューであること
  - 送信側が常に同じ `MessageGroupId`（出力 `write_message_group_id`）を使うこと
  - writer Lambda の `reserved_concurrent_executions = 1`
- **data バケットのバージョニングは唯一の巻き戻し手段。** 全体書き換えを行う以上、
  誤った書き込みの復旧はバージョン復元しかない。
- **キューの可視性タイムアウトは Lambda のタイムアウトを下回ってはならない。**
  下回ると処理中のメッセージが再配信され、二重書き込みになる。

### なぜ Lambda ではなく Fargate でクロールするか

`apps/crawler/src/scrapers/refresh.ts` の `DEFAULT_MAX_WAIT_MINUTES = 20` が示すとおり、
Money Forward の一括更新完了待ちだけで既定 20 分を見込む。Lambda の 15 分上限を
構造的に超えるため、スクレイパは Fargate タスクとして起動する。

## 前提

- Terraform 1.15.9
- `aws configure` 済みのプロファイル（既定は `default`）
- SSM Parameter Store に SecureString で認証情報を作成済み

```sh
aws ssm put-parameter --type SecureString --name /mf-dashboard/email       --value '...'
aws ssm put-parameter --type SecureString --name /mf-dashboard/password    --value '...'
aws ssm put-parameter --type SecureString --name /mf-dashboard/totp-secret --value '...'
```

- CodeBuild の GitHub 接続を一度だけ認可しておく（Terraform 管理外）。
  マネジメントコンソールの CodeBuild、または `aws codebuild import-source-credentials`。

## 適用手順

ECS タスク定義と writer Lambda は ECR 上のイメージを参照するため、**先にリポジトリだけ
作ってイメージを push し、その後に全体を apply する**。

ECR イメージの push と CodeBuild の GitHub 認可は Terraform の管理外なので、
それらに依存するリソースは既定で作成しない。順に有効化していく。

| 変数                      | 既定    | 有効化の前提                        |
| ------------------------- | ------- | ----------------------------------- |
| `enable_writer`           | `false` | writer イメージを ECR へ push 済み  |
| `enable_site_build`       | `false` | CodeBuild の GitHub 接続を認可済み  |
| `enable_crawler_schedule` | `false` | crawler イメージを ECR へ push 済み |

```sh
cp terraform/aws/terraform.tfvars.example terraform/aws/terraform.tfvars

terraform -chdir=terraform/aws init

# 1. 土台（S3 / CloudFront / SQS / ECR / ECS クラスタ / VPC）
terraform -chdir=terraform/aws apply

# 2. イメージを push する（リポジトリ URL は terraform output で確認）
#    crawler は既存の docker/crawler/Dockerfile をそのまま使う

# 3. 揃ったものから terraform.tfvars で有効化して再 apply
#    enable_writer = true / enable_crawler_schedule = true / enable_site_build = true
terraform -chdir=terraform/aws apply
```

静的サイトを手で公開する場合は、ビルドしてから同期する。

```sh
DB_PATH=../../data/demo.db DEMO_MODE=true pnpm --filter @mf-dashboard/web build
aws s3 sync apps/web/out "s3://$(terraform -chdir=terraform/aws output -raw site_bucket)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=terraform/aws output -raw cloudfront_distribution_id)" \
  --paths '/*'
```

## state について

現状はローカル state。`terraform/aws/.gitignore` で `*.tfstate` と `*.tfvars` を除外している。
S3 バックエンド（Terraform 1.10 以降は `use_lockfile = true` で DynamoDB 不要）への移行は
未実施。state バケット自体をこのモジュールで作ると循環するため、移行する場合は
bootstrap 用の小さなモジュールを別に切る。

## 未実装（アプリ側の対応が必要）

このモジュールは器だけを用意している。次はまだコードが存在しない。

1. **crawler が SQS へ発行する経路。** 現状の crawler は `packages/db` 経由で
   SQLite に直接書く。タスク定義は `WRITE_QUEUE_URL` / `WRITE_MESSAGE_GROUP_ID` を
   環境変数として渡しているが、これを使う実装はまだない。
2. **writer Lambda の実体。** S3 から DB を取得し、キューのメッセージを適用して
   書き戻すコンテナイメージ（Lambda Runtime Interface Client 同梱）が必要。
3. **メッセージスキーマ。** crawler と writer の間の契約が未定義。
4. **`DEMO_MODE` の二重用途。** `next.config.ts` は `DEMO_MODE=true` で
   `output: "export"` に切り替わるが、同時に AI チャットを無効化し
   `NEXT_PUBLIC_STATIC_DEMO_BUILD` を立てる。本番データを「デモ」フラグでビルドする
   状態なので、`STATIC_EXPORT` のような名前へ分離するのが望ましい。
5. **認証。** CloudFront は OAC で S3 オリジンを保護するだけで、人の認証は行わない。
   静的サイトには資産エクスポート（`/export/assets.json` と `/export/assets.md`）が
   含まれ、口座名・残高・保有銘柄が平文で入る。**認証を載せるまで、この配信構成を
   公開ホスト名に接続してはいけない。**
