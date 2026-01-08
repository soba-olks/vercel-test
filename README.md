# vercel-test

curl https://close-to-git-main-tdtshs-projects.vercel.app/api/health
curl https://close-to-tdtshs-projects.vercel.app/api/health





## LINE側設定

### NFTPlatの認証用 Line Business ID でLINE Official Account Managerにログイン
> https://manager.line.biz/
> user: dev@soba-project.com	
> pass: gZW******Ckg ( see https://docs.google.com/spreadsheets/d/1d8XR50gcn0YQZW3DaPE1yZjcK2b4Rs9_mwGlcnaBGbE/edit?gid=8#gid=8 )


### Bot前提のLINE公式アカウントを作成
- [LINE公式アカウントを作成]をクリック
- SMS認証を行ってください、で、[SMS認証を行う]をクリック
- 作成フォームに入力→作成 ￼
> アカウント名: NFT Plat
> 業種: 通信・情報・メディア・情報サービス
> ベーシックID: @185wdidw
> 2FA: 090-7752-5391 (花崎私物)
- LINE Official Account Manager で対象アカウントが見えることを確認  ￼
https://manager.line.biz/account/@185wdidw/autoresponse


### Messaging APIを有効化してMessaging APIチャネルを作る
- LINE Official Account Manager 側で、作成した公式アカウントの設定を開く
https://manager.line.biz/account/@185wdidw/setting
- 左メニュー Messaging API をクリック
- [Messaging API を利用する] をクリック
- プロバイダーを作成でプロバイダー名 "SOBA Project" を入力し[同意する]をクリック
- プロバイダーのプライバシーポリシーと利用規約を登録する
> プライバシーポリシー: https://nftplat.soba-project.com/static_pages/privacy_policy.html
> 利用規約: https://nftplat.soba-project.com/static_pages/kiyaku.html
- LINE Developersコンソールで該当プロバイダー配下にMessaging APIチャネルができていることを確認  ￼
> Messaging API Channel情報
> Channel ID: 2008835320
> Channel secret: a3d**************************b10


### 自動応答メッセージのDisable

- LINE Official Account Manager を開く
- 自動応答 - 応答メッセージを開く
https://manager.line.biz/account/@185wdidw/autoresponse
- default の応答メッセージがオンになっていたら、オフにする

### LINE Developers Console の Channel access token

- LINE Developers Consoleを開く
https://developers.line.biz/console/

- 左ペインからプロバイダー[SOBA Project]をクリック

- [NFT Plat Messaging API]をクリック

- チャネルアクセストークン（長期）の[発行]をクリック

> fbc9**************************************lFU=


## Dify
- Difyにログイン
https://cloud.dify.ai/

- アプリ (sobaxolks)を開く
https://cloud.dify.ai/app/aedc0b12-1c62-436e-a20f-ee7db3aa8c29/workflow

- Publish（公開）」する

- 左メニュー [APIアクセス]をクリック

> ベースURL: https://api.dify.ai/v1

- 右上[APIキー]をクリック

- APIシークレットキーダイアログで[+新しいシークレットキーを作成]をクリック

> APIシークレットキー: app-xw1******************XTD



## Vercel

### Vercelの環境変数を設定

Vercel Dashboard - Project - Settings - Environment Variables

> DATABASE_URL: (Neonと連携時に自動で入る)
> LINE_CHANNEL_SECRET: a3d**************************b10
> LINE_CHANNEL_ACCESS_TOKEN: fbc9**************************************lFU=
> DIFY_API_BASE: https://api.dify.ai/v1
> DIFY_API_KEY: app-xw1******************XTD

追加したら Redeploy


## Line webhooks

### webhook#1(発言) を登録
- 登録したMessage APIを開き
https://manager.line.biz/account/@185wdidw/setting/messaging-api
- webhook URLを登録する
https://close-to-tdtshs-projects.vercel.app/api/line/webhook
- 左メニューの応答設定をクリック
- webhookトグルをオンに


## テスト
- Line公式に対して発言する
- Vercel のLogsで POST /api/line/webhook がstatus 200である事を確認する
- NeonのSQL Editor で発言が記録された事を確認する

`
SELECT * FROM line_events ORDER BY id DESC LIMIT 3;
`

`
SELECT session_id, user_id, role, content, created_at FROM chat_messages ORDER BY id DESC LIMIT 10;
`

NeonはPostgresなので、MacOSならPosticoで接続可能
https://eggerapps.at/postico2/

