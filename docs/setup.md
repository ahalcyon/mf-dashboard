# セットアップ

このガイドでは、Money Forward MEのデータ取得から配信までをAWS上に構築する。完了すると、Basic認証で保護された静的ダッシュボードへアクセスでき、毎日6:30と15:30（JST）の自動更新と、画面上からの手動更新を利用できる。

セットアップは次の順番で進める。

1. Money Forward MEを準備する
2. 資格情報をAWS SSM Parameter Storeへ置く
3. Terraform stateの保管先を作る
4. Terraformを適用する
5. 動作を確認する

構成の詳細と設計上の制約は[terraform/aws/README.md](../terraform/aws/README.md)にある。

## 必須要件

- [Money Forward ME](https://moneyforward.com/)
- AWSアカウント
- ローカルにインストール済みのツール:
  - `git`
  - `terraform`（1.15.9以上）
  - `aws`（`aws configure`でプロファイル設定済み）
  - Docker互換のCLI（`terraform apply`がコンテナイメージをビルドしてECRへpushする）

リポジトリを取得し、以降のコマンドを実行するディレクトリへ移動する。

```sh
git clone https://github.com/hiroppy/mf-dashboard.git
cd mf-dashboard
pnpm install
```

## 1. Money Forward MEの準備

- Money Forward MEでワンタイムパスワードを設定する（[設定方法](https://support.me.moneyforward.com/hc/ja/articles/7359917171481-%E4%BA%8C%E6%AE%B5%E9%9A%8E%E8%AA%8D%E8%A8%BC%E3%81%AE%E8%A8%AD%E5%AE%9A%E6%96%B9%E6%B3%95)）
- 認証アプリ登録時に表示されるセットアップキー（Base32）を控えておく。crawlerはこのキーからワンタイムパスワードを生成する。

`MF_TOTP_SECRET`には6桁のコードではなく、Base32のセットアップキーを設定する。QRコードしか表示されない場合は「QRコードを読み取れない場合」の導線からキー文字列を表示する。crawlerはこのキーからRFC 6238のコードをローカルで生成するため、認証アプリと同じ値が同時に得られる。

同じキーはスマートフォンの認証アプリにも並行して登録できる。手動ログイン用の控えとして登録しておくとよい。

## 2. 資格情報をSSM Parameter Storeへ置く

crawlerはECSタスクとして動くため、資格情報はSSM Parameter Storeから注入する。標準ティアのパラメータとAWS管理キーによる`SecureString`は追加料金なしで利用できる。

```sh
aws ssm put-parameter --type SecureString --name /mf-dashboard/email       --value '<メールアドレス>'
aws ssm put-parameter --type SecureString --name /mf-dashboard/password    --value '<パスワード>'
aws ssm put-parameter --type SecureString --name /mf-dashboard/totp-secret --value '<セットアップキー>'
aws ssm put-parameter --type SecureString --name /mf-dashboard/recovery-code --value '<二段階認証のリカバリコード>'
```

`/mf-dashboard/recovery-code`はアプリからは読まない。Money Forward MEから締め出されたときにだけ人が参照する。ローカルへ平文で置かない。

タスク定義の`secrets`が`email`、`password`、`totp-secret`を環境変数として注入するため、コンテナ内ではSSMを直接呼ばない。接頭辞を変える場合は`terraform.tfvars`の`ssm_parameter_prefix`と、crawlerの`SSM_PARAMETER_PREFIX`を揃える。

## 3. Terraform stateの保管先を作る

stateにはBasic認証のパスワードとセッショントークンが平文で入るため、gitへは置かずS3へ暗号化して保管する。stateバケット自体を本体のモジュールで作ると循環するので、`bootstrap/`を別に切ってある。

```sh
terraform -chdir=terraform/aws/bootstrap init
terraform -chdir=terraform/aws/bootstrap apply
```

bootstrapのstateはローカルに残るが、作るのはバケット1つだけなので失っても`import`で復旧できる。

## 4. Terraformの適用

設定ファイルを用意する。既定値のままでも適用できるので、上書きしたい項目だけコメントを外す。

```sh
cp terraform/aws/terraform.tfvars.example terraform/aws/terraform.tfvars
chmod 600 terraform/aws/terraform.tfvars
```

| 変数                      | 既定             | 内容                                                   |
| ------------------------- | ---------------- | ------------------------------------------------------ |
| `aws_profile`             | `default`        | 使用する名前付きAWSプロファイル                        |
| `region`                  | `ap-northeast-1` | crawler、キュー、データベース、writerを置くリージョン  |
| `hostname`                | 空               | 独自ドメイン。空ならCloudFrontの既定ドメインで配信する |
| `acm_certificate_arn`     | 空               | `hostname`を設定する場合に必要なus-east-1の証明書      |
| `container_cli`           | `docker`         | イメージのビルドに使うDocker互換CLI                    |
| `basic_auth_username`     | `mf`             | エッジのBasic認証のユーザー名                          |
| `basic_auth_password`     | 空               | 空なら自動生成する。`bookmark_url`から読み出せる       |
| `schedule_expression`     | 6:30と15:30      | 自動更新のcron。`schedule_timezone`で評価する          |
| `enable_crawler_schedule` | `false`          | 定期クロールの有効化                                   |
| `ssm_parameter_prefix`    | `/mf-dashboard`  | 資格情報を置いたSSMの接頭辞                            |

初回は定期クロールを無効のまま適用し、手動で1回流して動作を確かめてから有効化するとよい。

```sh
terraform -chdir=terraform/aws init
terraform -chdir=terraform/aws apply
```

`apply`の中でcrawler、writer、site-builder、refresh-triggerの4イメージをビルドしてECRへpushする。イメージのタグはソースのハッシュなので、ソースを変えずに再適用してもpushは走らない。初回は数分かかる。

Windowsで開発する場合は、`container_cli`にWSL Container CLIのパスを指定する。

```hcl
container_cli = "/mnt/c/Program Files/WSL/wslc.exe"
```

### 適用後の確認

```sh
terraform -chdir=terraform/aws output
```

`site_url`にダッシュボードのURLが出る。アクセスに使うブックマークURLは資格情報を含むため、明示的に読み出す。

```sh
terraform -chdir=terraform/aws output -raw bookmark_url
```

`https://<user>:<password>@<host>/`形式で出力される。ブラウザーはBasic認証のセッションを保持できないため、このURLをブックマークして踏む運用を前提にしている。初回だけBasicを検証し、以後はセッションクッキーで通す。

## 5. 動作確認

データベースがまだ空なので、最初のクロールを手で起動する。

```sh
aws ecs run-task \
  --cluster "$(terraform -chdir=terraform/aws output -raw ecs_cluster_name)" \
  --task-definition mf-dashboard-crawler \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[<subnet-id>],securityGroups=[<sg-id>],assignPublicIp=ENABLED}'
```

進行状況はCloudWatch Logsの`/aws/ecs/mf-dashboard-crawler`で確認する。以降は次の順に自動で進む。

```
crawler → SQS FIFO → writer Lambda → S3のデータベース更新
        → クロール完了のイベント → EventBridge → site-builder
        → S3へsync → CloudFrontのinvalidation
```

サイトが焼き上がったらブックマークURLでアクセスし、ダッシュボードが表示されることを確認する。確認できたら`terraform.tfvars`で`enable_crawler_schedule = true`にして再適用し、定期実行を有効にする。

## 6. 運用

- **手動で更新する**: ダッシュボードのヘッダーにある更新ボタンを押す。refresh-trigger Lambdaが実行中のcrawlerタスクの有無を確認してからECSタスクを起動する。すでに走っている場合は409を返して二重起動を防ぐ。
- **サイトだけ焼き直す**: `pnpm publish:site`。S3のデータベースを読んでビルドし、syncとinvalidationまで行う。
- **コードを変更して反映する**: `terraform -chdir=terraform/aws apply`。変更のあったイメージだけが再ビルドされ、タスク定義とLambdaが更新される。
- **誤った書き込みを戻す**: dataバケットのバージョニングが唯一の巻き戻し手段である。S3上のSQLiteはファイル全体の書き換えになるため、バージョンを復元する以外に復旧方法がない。

### ローカルで開発する

`.env`を作成する。

```sh
cp .env.example .env
```

`MF_EMAIL`、`MF_PASSWORD`、`MF_TOTP_SECRET`を空のままにすると、crawlerが実行時にSSMから解決する。`aws configure`が済んでいれば追記は不要である。

```sh
pnpm --filter @mf-dashboard/crawler dev:scrape   # ローカルのdata/moneyforward.dbへ取得する
pnpm --filter @mf-dashboard/web dev              # デモデータでダッシュボードを起動する
```

`.env`の各キーは次のとおり。

| `.env`のキー               | 必須 | 内容                                                           |
| -------------------------- | ---- | -------------------------------------------------------------- |
| `MF_EMAIL` / `MF_PASSWORD` | 任意 | Money Forward MEのログイン情報。空ならSSMから解決する          |
| `MF_TOTP_SECRET`           | 任意 | 認証アプリのセットアップキー（Base32）。空ならSSMから解決する  |
| `DASHBOARD_URL`            | 任意 | Open Graph / Twitter metadataと通知に使う公開ダッシュボードURL |
| `SSM_PARAMETER_PREFIX`     | 任意 | SSM Parameter Storeの接頭辞。既定値は`/mf-dashboard`           |
| `NEXT_PUBLIC_BASE_PATH`    | 任意 | ドメインの直下以外で配信する場合のURL接頭辞                    |
| `NOTIFICATION_TOPIC_ARN`   | 任意 | 通知先のSNSトピック。デプロイ時はTerraformが渡す               |
| `MAX_WAIT_MINUTES`         | 任意 | 金融機関の一括更新を待つ上限（分）。既定値は20                 |
| `AUTH_STATE_PATH`          | 任意 | ブラウザーセッションの保存先。既定値は`data/auth-state.json`   |

デプロイされたサイトでは`DASHBOARD_URL`をsite-builderがCloudFrontのURLから渡すため、`.env`の値は使われない。

## 7. オプション設定

ここからの設定は、基本セットアップの完了後に必要なものだけ追加する。

### メール通知（SNS）

クロール完了時に、総資産と前日比・今月比、資産内訳、口座の更新状態をメールで受け取れる。クロールが失敗したときも通知が届く。

`terraform/aws/terraform.tfvars`に宛先を設定して適用する。

```hcl
notification_email = "user-a@example.com"
```

適用後、AWSから確認メールが届くので本文のリンクを開いて承認する。承認するまで`PendingConfirmation`のままで、通知は配信されない。状態は次で確認できる。

```sh
terraform -chdir=terraform/aws output -raw notification_subscription_status
```

宛先を設定しない場合もトピック自体は作られるが、購読者がいないため何も届かない。crawlerは`NOTIFICATION_TOPIC_ARN`が無ければ通知を試みない。

### 資産データのエクスポート

ビルド時に、資産データをJSONとMarkdownで`public/export/`へ書き出す。生成物は静的ファイルなので、静的エクスポートでもそのまま配信できる。手元のLLMへ読み込ませて分析する用途を想定している。

| パス                            | 内容                                 |
| ------------------------------- | ------------------------------------ |
| `/export/assets.json`           | 既定グループの資産データ             |
| `/export/assets.md`             | 同じ内容をMarkdownの表で整形したもの |
| `/export/<groupId>/assets.json` | グループ別の資産データ               |
| `/export/<groupId>/assets.md`   | グループ別のMarkdown                 |

含まれるのは、日次の資産総額の推移（カテゴリ別内訳つき）、資産・負債のカテゴリ別内訳、口座の残高と更新状態、保有銘柄の評価額と評価損益。ダッシュボードのサイドバーからもダウンロードできる。

`pnpm --filter @mf-dashboard/web build`の前に自動で実行されるほか、単体では次で生成する。

```sh
DB_PATH=../../data/moneyforward.db pnpm --filter @mf-dashboard/web export:assets
```

エクスポートには口座名や残高が含まれる。公開URLへ配置する場合は、認証を通過した利用者だけが到達できる構成を維持する。
