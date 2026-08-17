# Terraform: AWS RDS (PostgreSQL)

家計データの保存先をローカルSQLiteからAWS RDS (PostgreSQL) へ移すためのTerraform。
アプリ側は `DATABASE_URL` が設定されているとRDSへ、未設定ならローカルPGlite（`data/` 以下）へ接続する。

構成:

- RDS for PostgreSQL 17（既定 `db.t4g.micro` / 20GiB gp3 / 暗号化 / 7日バックアップ / 削除保護）
- デフォルトVPCに配置し、`allowed_cidr_blocks` からの5432のみ許可
- 接続文字列を Secrets Manager `mf-dashboard/database-url` に保存（将来のECSクローラーから参照する）

## 前提

- `terraform` (>= 1.6)
- AWS認証情報（`AWS_PROFILE` など）が設定済み
- 自宅ネットワークの固定グローバルIP（またはVPNの出口IP）を把握していること

## stateの扱い

backendを設定していないため、stateは実行したマシンのローカルファイル（`terraform/aws/terraform.tfstate`）に置かれる。
このため以下を守ること。

- **applyは常に同じマシンから実行する。** stateを失うと、RDSがAWS上に残ったままTerraformから管理できなくなる。
  `deletion_protection = true` のため、その場合の後始末はコンソールでの手作業になる。
- **stateをコミットしない。** `random_password.db` が生成するマスターパスワードがstateに平文で記録される。
  `.gitignore` で `*.tfstate` / `*.tfvars` / `.terraform/` を除外済み。
- 使い捨て環境やCIからは applyしない。複数マシンから運用したくなった時点で、S3 backend（バージョニング + 暗号化 + ロック）へ移行する。

`.terraform.lock.hcl` はプロバイダのchecksumを固定するものなので、これはコミットする。

## 適用

```sh
cp terraform/aws/terraform.tfvars.example terraform/aws/terraform.tfvars
# allowed_cidr_blocks を自宅IPに設定する (.gitignore で除外済み)

terraform -chdir=terraform/aws init
terraform -chdir=terraform/aws plan
terraform -chdir=terraform/aws apply
```

適用後、接続文字列を取得してリポジトリルートの `.env` へ設定する:

```sh
terraform -chdir=terraform/aws output -raw database_url
```

```dotenv
DATABASE_URL=postgres://mf_dashboard:...@mf-dashboard-db....ap-northeast-1.rds.amazonaws.com:5432/moneyforward?sslmode=require
```

`sslmode=require` は通信を暗号化する（サーバ証明書のCA検証は行わない）。CA検証まで行う場合は
[AWSのRDS証明書バンドル](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
をダウンロードし、`sslmode=verify-full&sslrootcert=/path/to/global-bundle.pem` を使用する。

## データ移行（SQLite → RDS）

既存の `data/moneyforward.db`（旧SQLite）からデータを移す:

```sh
DATABASE_URL=$(terraform -chdir=terraform/aws output -raw database_url) \
  pnpm --filter @mf-dashboard/db migrate:from-sqlite
```

スキーマは移行スクリプトが自動適用する。移行先にデータが残っている場合は `-- --truncate` を付けると全削除してから移行する。

## ローカルからviewerとして使う

`.env` に `DATABASE_URL` を設定した上で:

```sh
pnpm --filter @mf-dashboard/web dev:prod
```

`DATABASE_URL` が設定されているとwebはRDSを読む。クローラーも同様に `DATABASE_URL` があればRDSへ書き込むため、
ローカルからのスクレイプ実行（`pnpm db:dev`）もそのままRDSへ保存される。

## 日次クローラーのAWS移行（フォローアップ）

クローラー本体をAWSで日次実行する部分はこのモジュールには含めていない。設計方針:

- `docker/crawler` のイメージ（supercronicで06:30 / 15:30 JSTに実行）をECRへpushし、
  ECS Fargate serviceとして常駐させる（`DATABASE_URL` はSecrets Manager
  `mf-dashboard/database-url` から注入する）
- `data/auth-state.json`（Money Forwardのログインセッション）はコンテナ起動時にS3から取得する
  仕組みが必要。セッション失効時の再ログイン（要人手）とセットで運用手順を決めてから実装する

## 破棄

`deletion_protection = true` のため、破棄するにはまず `aws_db_instance` の
`deletion_protection` を `false` にしてapplyしてから `destroy` する。
最終スナップショット `mf-dashboard-db-final` が作成される。

```sh
terraform -chdir=terraform/aws destroy
```
