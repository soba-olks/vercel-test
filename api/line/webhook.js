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

  const client = await pool.connect();

  try {
    for (const ev of events) {
      // -----------------------------------------------------------
      // [STEP 1] RawEvent & User Message Save (Transaction A)
      // -----------------------------------------------------------
      let shouldProcessResponse = false;
      let userId, text, lineMessageId, sessionId;

      try {
        await client.query('BEGIN'); // START Transaction A

        const eventId =
          ev.message?.id ||
          ev.webhookEventId ||
          `${ev.timestamp || Date.now()}-${ev.source?.userId || 'unknown'}-${ev.type || 'unknown'}`;

        // 1. Save Raw Event
        await client.query(
          `INSERT INTO line_events (event_id, event_type, user_id, reply_token, payload)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT (event_id) DO NOTHING`,
          [
            eventId,
            ev.type || 'unknown',
            ev.source?.userId || null,
            ev.replyToken || null,
            JSON.stringify(ev),
          ]
        );

        // 2. Save User Message (if text)
        if (ev.type === 'message' && ev.message?.type === 'text') {
          userId = ev.source?.userId;
          text = ev.message.text;
          lineMessageId = ev.message.id;
          sessionId = userId;

          if (userId && text) {
            await client.query(
              `INSERT INTO chat_messages (platform, session_id, user_id, role, content, line_message_id)
              VALUES ('line', $1, $2, 'user', $3, $4)
              ON CONFLICT ON CONSTRAINT chat_messages_line_message_id_uq DO NOTHING`,
              [sessionId, userId, text, lineMessageId]
            );
            shouldProcessResponse = true;
          }
        }

        await client.query('COMMIT'); // END Transaction A (User input is definitely saved)

      } catch (e) {
        await client.query('ROLLBACK');
        console.error('Error recording input event:', e);
        // If we failed to save the input, we probably shouldn't reply?
        continue;
      }

      // -----------------------------------------------------------
      // [STEP 2] Dify Call & Response (Transaction B)
      // -----------------------------------------------------------
      if (shouldProcessResponse && userId && text) {
        try {
          // A. Get Dify Conversation ID
          const convRow = await client.query(
            'SELECT dify_conversation_id FROM line_conversations WHERE user_id = $1',
            [userId]
          );
          const difyConversationId = convRow.rows[0]?.dify_conversation_id || null;

          // B. Call Dify API (No Tx)
          const dify = await callDifyChat({
            userId,
            query: text,
            conversationId: difyConversationId,
          });

          const answer = dify.answer || '(no answer)';
          const newConversationId = dify.conversation_id || difyConversationId;

          // C. Save Response (Transaction B)
          await client.query('BEGIN'); // START Transaction B

          // Save Conversation ID
          if (newConversationId && newConversationId !== difyConversationId) {
            await client.query(
              `INSERT INTO line_conversations (user_id, dify_conversation_id)
              VALUES ($1, $2)
              ON CONFLICT (user_id)
              DO UPDATE SET dify_conversation_id = EXCLUDED.dify_conversation_id, updated_at = NOW()`,
              [userId, newConversationId]
            );
          }

          // Save Assistant Message
          await client.query(
            `INSERT INTO chat_messages (platform, session_id, user_id, role, content, line_message_id)
            VALUES ('line', $1, $2, 'assistant', $3, NULL)`,
            [sessionId, userId, answer]
          );

          await client.query('COMMIT'); // END Transaction B

          // D. Reply to LINE
          if (ev.replyToken) {
            await replyToLine(ev.replyToken, [{
              type: 'text',
              text: answer,
              quickReply: {
                items: [{
                  type: 'action',
                  action: {
                    type: 'postback',
                    label: 'これまでの会話を保存して終了する',
                    data: 'action=end_session',
                    displayText: '保存して終了する',
                  },
                }, {
                  type: 'action',
                  action: {
                    type: 'postback',
                    label: '質問を続ける',
                    data: 'action=resume_session',
                    displayText: '質問を続ける',
                  },
                }],
              },
            }]);
          }

        } catch (e) {
          await client.query('ROLLBACK');
          console.error('Error during Dify/Response processing:', e);

          if (ev.replyToken) {
            try {
              await replyToLine(ev.replyToken, [{ type: 'text', text: `エラーが発生しました: ${e.message}` }]);
            } catch (replyError) {
              console.error('Failed to send error reply:', replyError);
            }
          }
        }
      }

      // -----------------------------------------------------------
      // [STEP 3] Handle Postbacks (Optional logic)
      // -----------------------------------------------------------
      if (ev.type === 'postback') {
        if (ev.postback?.data === 'action=end_session') {
          // Future logic
        } else if (ev.postback?.data === 'action=resume_session') {
          if (ev.replyToken) {
            await replyToLine(ev.replyToken, [{ type: 'text', text: 'はい。続けてどうぞ。' }]);
          }
        }
      }

    } // end for loop

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('Unexpected error in handler:', e);
    // Even if error, Line webhook usually expects 200 to stop retries.
    // But 500 signals valid server error. Use 500 for unhandled top-level errors.
    return res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    client.release();
  }
}
