<div align="center">
  <img src="apps/web/public/logo.png" alt="MoneyForward Me Dashboardのロゴ" width="120">
  <h1>MoneyForward Me Dashboard</h1>
  <p>Money Forward MEのデータ取得・更新・可視化を自動化するダッシュボード</p>
</div>

Money Forward MEの家計・資産・投資データを定期的に取得し、Webダッシュボードで確認できる。更新結果の通知や、資産データの書き出しにも対応する。

[デモを見る](https://mf-dashboard-demo.vercel.app/) · [セットアップ手順](docs/setup.md)

## 主な機能

### 金融機関の情報を自動更新

登録した金融機関の「一括更新」を毎日6:30と15:30に自動で実行し、完了を待ってから最新のデータを取り込む。

### 更新結果をSlackやDiscordへ通知

通知先を設定すると、更新結果や前日との差分をSlackまたはDiscordへ投稿できる。

<img src="./.github/assets/slack.png" alt="Slackに投稿された更新結果" width="420" />

### 家計・資産情報を可視化

予算機能を除くダッシュボードの表示を、[公開デモ](https://mf-dashboard-demo.vercel.app/)で確認できる。

| 月次画面                                                                     | ダッシュボード                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| <img src="./.github/assets/demo-month.png" alt="月次収支画面" width="600" /> | <img src="./.github/assets/demo-dashboard.png" alt="資産ダッシュボード画面" width="600" /> |

### スクレイピング処理をフックで拡張

スクレイピング中に独自のスクリプトを実行できる。MoneyForward Meでなにか処理を挟み込みたいときに利用する。

### 資産データのエクスポート

日次の資産総額の推移、資産・負債の内訳、口座残高、保有銘柄の評価損益を、JSONとMarkdownで書き出す。サイドバーからダウンロードして、そのまま手元のLLMへ読み込ませて分析できる。

### 複利シミュレーション

積立額や取崩額、年金などの条件を設定し、モンテカルロ法で資産推移をシミュレーションできる。[公開サイト](https://asset-melt.party/)でも利用可能。

<img src="./.github/assets/simulator.png" alt="複利シミュレーション画面" />
