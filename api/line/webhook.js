import crypto from 'crypto';
import { Pool } from 'pg';

export const config = {
  api: {
    bodyParser: false, // ★これが超重要：raw bodyを取るため
  },
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }, // Neonで必要になることが多い
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function validateLineSignature(rawBody, signature, channelSecret) {
  const hmac = crypto.createHmac('sha256', channelSecret);
  hmac.update(rawBody);
  const digest = hmac.digest('base64');
  return digest === signature;
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
      // 重複防止キー（message.id が一番扱いやすい）
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

      // 2 messageイベントだけ chat_messages に入れる
      if (ev.type === 'message' && ev.message?.type === 'text') {

        const userId = ev.source?.userId;
        const text = ev.message.text;
        const lineMessageId = ev.message.id;
        const sessionId = userId; // いまは仮で userId を session_id とする

        if (userId && text) {

          await client.query(
            `INSERT INTO chat_messages (platform, session_id, user_id, role, content, line_message_id)
            VALUES ('line', $1, $2, 'user', $3, $4)
            ON CONFLICT (line_message_id) DO NOTHING`, [sessionId, userId, text, lineMessageId]
          );
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

  // LINEは 200 を返せばOK（返信は後で）
  return res.status(200).json({
    ok: true
  });
}
