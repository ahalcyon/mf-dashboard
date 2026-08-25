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
   ECS Fargate: site-builder ── DB を読んで next build (output: "export")
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
#    enable_writer = true / enable_crawler_schedule = true
terraform -chdir=terraform/aws apply
```

静的サイトを手で公開する場合は、ビルドしてから同期する。

```sh
DB_PATH=../../data/moneyforward.db STATIC_EXPORT=true pnpm --filter @mf-dashboard/web build
aws s3 sync apps/web/out "s3://$(terraform -chdir=terraform/aws output -raw site_bucket)" --delete
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=terraform/aws output -raw cloudfront_distribution_id)" \
  --paths '/*'
```

## 認証

エッジで Basic 認証を行い、成功した1回だけをセッションクッキーへ引き換える。
ブラウザーは Basic のセッションを保持できないため、`https://user:pass@host/` を
ブックマークして踏む運用を前提にしている。

viewer-request は 1 つのビヘイビアに 1 つしか関連付けられないので、
認証とディレクトリインデックスの書き換えは同じ関数にまとめている。

1. クッキー `chv` があれば KeyValueStore の `session` と突き合わせ、一致なら通す
2. 無ければ `Authorization: Basic` を KeyValueStore の `authorization` と照合し、
   一致すれば **302 + `Set-Cookie: chv`** を返す（初回だけ通る入口）
3. どちらも駄目なら **401 + `WWW-Authenticate: Basic`**

`session` が読めない場合は誰も通さない（フェイルクローズ）。

資格情報は関数コードではなく KeyValueStore に置く。コードへ埋め込むと、
関数を再デプロイしない限り差し替えられなくなるため。

ブックマークする URL は output から取得する。

```sh
terraform -chdir=terraform/aws output -raw bookmark_url
```

`basic_auth_password` を空のままにすると自動生成する。固定したい場合は
`terraform.tfvars` で指定する。パスワードはブックマーク URL に埋め込む都合上、
URL セーフな文字だけを受け付ける。

## state について

state には Basic 認証のパスワードやセッショントークンが**平文で入る**ため、
git へは置かず S3 に暗号化して保管する。

- バージョニング有効。apply ごとに版が残り、任意の時点へ戻せる
- SSE 暗号化、パブリックアクセス全遮断
- Terraform 1.10 以降の `use_lockfile` によるロック。DynamoDB は使わない

state バケット自体を本体のモジュールで作ると循環するため、`bootstrap/` を
別に切っている。bootstrap の state はローカルに残るが、作るのはバケット 1 つ
だけなので失っても import で復旧できる。

初回のみ次の順で実行する。

```sh
# 1. state バケットを作る
terraform -chdir=terraform/aws/bootstrap init
terraform -chdir=terraform/aws/bootstrap apply

# 2. 本体の state を S3 へ移す
terraform -chdir=terraform/aws init -migrate-state
```

移行後は `terraform/aws/terraform.tfstate` を削除してよい。

## 静的サイトの発行

フロントは実行時の DB 接続を持たないため、データを反映するにはビルドし直す。
これは S3 のデータベース更新を起点に自動で走るので、通常は何もしなくてよい。

```
S3 の DB 更新 → EventBridge → ECS Fargate (site-builder) → s3 sync → invalidation
```

CodeBuild を使わないのは、GitHub 接続の認可が Terraform の管理外で必要になり、
リポジトリと CI の二重管理になるため。ソースはイメージへ同梱する。

手元から即座に発行したい場合は次を実行する。接続先は環境変数を優先し、
無ければ `terraform output` から解決するため、同じスクリプトが両方で動く。

```sh
pnpm publish:site
```
