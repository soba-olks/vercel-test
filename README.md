# vercel-test

curl https://close-to-git-main-tdtshs-projects.vercel.app/api/health
curl https://close-to-tdtshs-projects.vercel.app/api/health


## Neon

Neonの該当プロジェクトのSQL Editorに下記を貼り付けて [Run]をクリック


```
CREATE TABLE IF NOT EXISTS line_events (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,                -- 重複防止キー（message.id等）
  event_type TEXT NOT NULL,              -- message / postback など
  user_id TEXT,                          -- source.userId
  reply_token TEXT,                      -- 返信する時に使う（今は保存だけ）
  payload JSONB NOT NULL,                -- 受け取った生データ
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS line_events_event_id_uq
ON line_events(event_id);
```

Tablesに line_events があることを確認



## LINE Developers の Channel secret 取得

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




## Vercelの環境変数を設定

Vercel Dashboard - Project - Settings - Environment Variables
- DATABASE_URL: (Neonと連携時に自動で入る)
- LINE_CHANNEL_SECRET: a3d**************************b10

追加したら Redeploy


