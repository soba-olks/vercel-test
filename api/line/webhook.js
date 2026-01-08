import crypto from 'crypto';
import { Pool } from 'pg';

export const config = {
  api: {
    bodyParser: false, // raw bodyを取る
  },
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }, 
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Line署名確認
function validateLineSignature(rawBody, signature, channelSecret) {
  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(rawBody);
  const digest = hmac.digest('base64');
  return digest === signature;
}

// Line応答関数
async function replyToLine(replyToken, messages) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${text}`);
  }
}

// Dify呼び出し関数
async function callDifyChat({ userId, query, conversationId }) {
  const url = `${process.env.DIFY_API_BASE}/chat-messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {},                 // TODO: 必要なら後で使う
      query,
      response_mode: 'blocking',
      user: userId,               // Dify側のuser識別子
      conversation_id: conversationId || null,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dify error: ${res.status} ${text}`);
  }

  return await res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) return res.status(500).json({
    error: 'LINE_CHANNEL_SECRET not set'
  });

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-line-signature'];

  if (!signature || !validateLineSignature(rawBody, signature, channelSecret)) {
    return res.status(401).json({
      error: 'Invalid signature'
    });
  }

  const body = JSON.parse(rawBody);
  const events = body.events || [];

  // イベントをまとめて保存（まずは message / postback も全部保存）
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const ev of events) {
      // 重複防止キー
      // postback等で message.id が無い場合は webhookEventId があればそれ、無ければ timestamp+userId+type を合成
      const eventId =
        ev.message?.id ||
        ev.webhookEventId ||
        `${ev.timestamp || Date.now()}-${ev.source?.userId || 'unknown'}-${ev.type || 'unknown'}`;

      // 1 生イベント保存
      await client.query(
        `INSERT INTO line_events (event_id, event_type, user_id, reply_token, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (event_id) DO NOTHING`, [
          eventId,
          ev.type || 'unknown',
          ev.source?.userId || null,
          ev.replyToken || null,
          JSON.stringify(ev),
        ]
      );

      if (ev.type === 'message' && ev.message?.type === 'text') {

        const userId = ev.source?.userId;
        const text = ev.message.text;
        const lineMessageId = ev.message.id;
        const sessionId = userId; // FIXME: 仮で userId を session_id とする

        if (userId && text) {

          // 2 messageイベントだけ chat_messages に入れる
          await client.query(
            `INSERT INTO chat_messages (platform, session_id, user_id, role, content, line_message_id)
            VALUES ('line', $1, $2, 'user', $3, $4)
            ON CONFLICT ON CONSTRAINT chat_messages_line_message_id_uq DO NOTHING`,
            [sessionId, userId, text, lineMessageId]
          );
        }

        // FIXME: 固定文返信
        /*if (ev.replyToken) {
          await replyToLine(ev.replyToken, [
            { type: 'text', text: '受け取ったよ！(DB保存OK)' },
          ]);
        }*/

        // 1) そのユーザーの dify_conversation_id を取得
        const convRow = await client.query(
          'SELECT dify_conversation_id FROM line_conversations WHERE user_id = $1',
          [userId]
        );
        const difyConversationId = convRow.rows[0]?.dify_conversation_id || null;

        // 2) Difyへ送信
        const dify = await callDifyChat({
          userId,
          query: text,
          conversationId: difyConversationId,
        });

        // 3) Difyの返答（多くの場合 dify.answer に入る）
        const answer = dify.answer || '(no answer)';
        const newConversationId = dify.conversation_id || difyConversationId;

        // 4) 会話IDを保存（新規ならここで作られる）
        if (newConversationId && newConversationId !== difyConversationId) {
          await client.query(
            `INSERT INTO line_conversations (user_id, dify_conversation_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id)
            DO UPDATE SET dify_conversation_id = EXCLUDED.dify_conversation_id, updated_at = NOW()`,
            [userId, newConversationId]
          );
        }

        // 5) assistant返答を chat_messages に保存
        await client.query(
          `INSERT INTO chat_messages (platform, session_id, user_id, role, content, line_message_id)
          VALUES ('line', $1, $2, 'assistant', $3, NULL)`,
          [sessionId, userId, answer]
        );

        // 6) LINEに返信
        if (ev.replyToken) {
          await replyToLine(ev.replyToken, [{ type: 'text', text: answer }]);
        }

      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return res.status(500).json({
      error: 'DB insert failed'
    });
  } finally {
    client.release();
  }

  // LINEは 200 を返せばOK
  return res.status(200).json({
    ok: true
  });

}
