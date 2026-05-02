import { kvGet } from '../_kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'no_token' });

  const sessRaw = await kvGet(`sess:${token}`);
  if (!sessRaw) return res.status(401).json({ error: 'invalid_session' });

  let sess;
  try { sess = JSON.parse(sessRaw); } catch { return res.status(401).json({ error: 'bad_session' }); }

  const [favsRaw, homeRaw] = await Promise.all([
    kvGet(`user:${sess.id}:favs`),
    kvGet(`user:${sess.id}:home`)
  ]);

  return res.status(200).json({
    favs: favsRaw ? JSON.parse(favsRaw) : null,   // number[]
    home: homeRaw ? JSON.parse(homeRaw) : null,   // { addr, lat, lng, manual }
  });
}
