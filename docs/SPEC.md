# vercel-test 仕様

## 発言・回答機能
Line公式アカウント
↓
Vercel のAPI (Line側webhookに登録)
↓
Neonに発言保存
↓
VercelがDify APIコール、Dify LLMが回答生成
↓
Vercelが回答受け取り、Neonに回答保存
↓
VercelがLineに回答

## 要約記録、LLM差し込み機能

Line側終了ボタンで 発言履歴の要約
次回chat開始時に GET でユーザーの「要約/プロファイル」を取得
それを LLMノードのシステムプロンプト（または前置きコンテキスト）に差し込む




## API一覧

- 1) Line -> Vercel 上の webhook#1(質問) (/api/line/webhook)

## フロー

## 1) Line公式アカウント
- Line公式アカウントにユーザが訪問し発言する

## 2) LINE質問入力処理
- Line-> Vercel 上の webhook#1(質問) (/api/line/webhook)
- VercelがNeonに質問保存
- Vercelが Dify API をコール、Dify回答を Neonに保存
- Vercelが Line (Reply API) を叩き、LINE回答表示

## 3) 発言履歴の要約機能 
- 「会話を保存する」等のボタン押下
- Line-> Vercel 上の webhook#3(要約保存) 
- Vercelで要約処理 
- VercelからNeonに要約保存 

## 4) ２回目以降のセッション開始時、LLMノードのシステムプロンプト（または前置きコンテキスト）に差し込む
- Dify ->  Vercel 上の webhook#2(要約取得) 
- Vercelのwebhook#2 で要約を返す
- Dify で Variable Assigner -> memory_summary に代入 (ユーザ発話ごとにDifyメモリ上で参照出来る)



## Neonデータベース

```
-- Lineログテーブル (line_events)
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


-- 発言テーブル (chat_messages)
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'line',
  session_id TEXT NOT NULL,              -- 今は line userId を仮で入れる（後でDify conversation_idに移行可）
  user_id TEXT NOT NULL,                 -- LINEのuserId
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  line_message_id TEXT,                  -- message.id（重複防止）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_line_message_id_uq
ON chat_messages(line_message_id)
WHERE line_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx
ON chat_messages(session_id, created_at);



-- LINE userId <-> Dify conversation_id関連テーブル (line_conversations)
CREATE TABLE IF NOT EXISTS line_conversations (
  user_id TEXT PRIMARY KEY,
  dify_conversation_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- セッションサマリテーブル (session_summaries)
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY,          -- 今の設計なら LINE userId でOK（後でconversation_idにしてもいい）
  summary TEXT NOT NULL,
  from_message_id BIGINT,               -- chat_messages.id の範囲
  to_message_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

```



## 認証設計

GigHub認証中心でいく。
Olks社員であれ私以外の開発者にであれ、GitHubの当該オーガニゼーションに追加するだけで、Vercel ＆ Neonの認証・認可まで可能。

Google Workspace (SOBA)
  └─ hanazaki@soba-project.com 
        ↓
soba-olks GitHub Organization（SOBA管理）
        ↓
Vercel Team（案件単位）
        ↓
Neon Project（案件単位）

