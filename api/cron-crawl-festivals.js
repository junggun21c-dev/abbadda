// Vercel Cron: 매일 시청 보도자료 RSS 크롤링 → KV(Upstash Redis)에 저장
// vercel.json의 crons 항목으로 자동 호출. 수동 트리거: GET /api/cron-crawl-festivals?force=1
// CRON_SECRET 환경변수 설정 시 Authorization 헤더 검증.

import { kvSet, kvGet, kvExists } from './_kv.js';

const UA = 'Mozilla/5.0 (compatible; abbadda-bot/1.0)';
const FESTIVAL_KW = ['축제', '페스티벌', '문화제', '한마당', '박람회', '엑스포', '대축제'];

const SITES = [
  {
    sigun: '광명시', sido: '경기', sido_code: '31',
    rss: 'https://news.gm.go.kr/rss/allArticle.xml',
    lat: 37.4781, lng: 126.8644,
  },
  // 시 추가는 여기에 항목만 추가하면 됨 (단일 어댑터로 동작)
];

const DATE_LABELS = '(?:일시|운영\\s*기간|기간|행사\\s*일시|일정|개최\\s*일시|행사\\s*기간|개최\\s*기간)';
const PLACE_LABELS = '(?:장소|운영\\s*장소|위치|개최\\s*장소|행사\\s*장소)';

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function decode(s) {
  return (s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function parseRss(xml) {
  const re = /<item>([\s\S]*?)<\/item>/g;
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const it = m[1];
    const get = tag => {
      const r = it.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
      return r ? r[1].trim() : '';
    };
    out.push({
      title: get('title'),
      link: get('link'),
      description: get('description'),
      pubDate: get('pubDate'),
    });
  }
  return out;
}

function getArticleBody(html, fallbackDesc) {
  const m = html.match(/id=["']article-view-content-div["'][^>]*>/);
  if (!m) return decode(fallbackDesc);
  const start = m.index + m[0].length;
  const endMatch = html.slice(start).match(/(저작권자|SNS\s*기사보내기|article-bottom)/);
  const end = start + (endMatch ? endMatch.index : 10000);
  return decode(html.slice(start, end));
}

function extractOgImage(html) {
  let m = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/);
  if (m) return m[1];
  m = html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/);
  return m ? m[1] : '';
}

function extractDates(text) {
  const pat = new RegExp(
    `${DATE_LABELS}\\s*[:：]\\s*(\\d{4})\\.\\s*(\\d{1,2})\\.\\s*(\\d{1,2})\\.?[^~\\n.]{0,30}?(?:[~∼]\\s*(?:(\\d{4})\\.\\s*)?(\\d{1,2})\\.\\s*(\\d{1,2})\\.?)?`
  );
  const m = text.match(pat);
  if (!m) return null;
  const sy = m[1], sm = m[2].padStart(2, '0'), sd = m[3].padStart(2, '0');
  const ey = m[4] || sy;
  const em = m[5] ? m[5].padStart(2, '0') : sm;
  const ed = m[6] ? m[6].padStart(2, '0') : sd;
  return { start: `${sy}${sm}${sd}`, end: `${ey}${em}${ed}` };
}

function extractPlace(text) {
  const m = text.match(new RegExp(`${PLACE_LABELS}\\s*[:：]\\s*([^\\n.]{1,80})`));
  if (!m) return '';
  return m[1].split(/\s{2,}|✨|▶|주요\s*프로그램|문의\s*[:：]|체험\s*[:：]|공연\s*[:：]|먹거리\s*[:：]|내용\s*[:：]/)[0]
    .trim().replace(/[,·]+$/, '');
}

async function crawlSite(site) {
  const xml = await fetchText(site.rss);
  const items = parseRss(xml);
  const festivals = items.filter(i => FESTIVAL_KW.some(k => i.title.includes(k)));
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const results = [];
  for (const f of festivals) {
    let detail;
    try { detail = await fetchText(f.link, 10000); } catch { continue; }
    const text = getArticleBody(detail, f.description);
    const dates = extractDates(text);
    if (!dates) continue;
    if (dates.end < today) continue;
    const place = extractPlace(text);
    const image = extractOgImage(detail);
    results.push({
      title: f.title,
      eventstartdate: dates.start,
      eventenddate: dates.end,
      addr1: place ? `${site.sido} ${site.sigun} ${place}` : `${site.sido} ${site.sigun}`,
      mapy: site.lat,
      mapx: site.lng,
      firstimage: image,
      sido_code: site.sido_code,
      link: f.link,
      pubDate: f.pubDate,
      source: `sigun-rss/${site.sigun}`,
    });
  }
  return results;
}

export default async function handler(req, res) {
  // Vercel cron이 호출 시 Authorization: Bearer <CRON_SECRET> 헤더 자동 추가
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    const force = req.query?.force;
    if (auth !== `Bearer ${secret}` && !force) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const startedAt = new Date().toISOString();
  const allItems = [];
  const errors = [];
  for (const site of SITES) {
    try {
      const items = await crawlSite(site);
      allItems.push(...items);
    } catch (e) {
      errors.push({ sigun: site.sigun, error: e.message });
    }
  }

  const payload = { updated: startedAt, count: allItems.length, items: allItems };

  if (kvExists()) {
    // 25시간 TTL (다음 cron 전까지 유지, 실패 대비 1시간 여유)
    await kvSet('sigun-festivals', JSON.stringify(payload), 25 * 3600);
  }

  return res.status(200).json({
    ok: true,
    sites: SITES.length,
    total: allItems.length,
    kvSaved: kvExists(),
    errors,
    items: allItems,
  });
}
