import { Client } from 'pg';

export default async function handler(req, res) {

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  await client.connect();
  const result = await client.query('SELECT 1 as ok');
  await client.end();

  res.status(200).json({
    status: 'ok',
    db: result.rows[0],
  });
}
