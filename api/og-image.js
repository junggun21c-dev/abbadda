// 외부 페이지의 og:image 자동 추출 + 네이버 이미지 검색 fallback + KV 캐시
// 사용: <img src="/api/og-image?url=...&title=행사명">
// 행사 카드의 firstimage가 비어있을 때 자동 추출해 표시.
//
// 흐름:
// 1) ?url= + ?title= 받음
// 2) KV에서 og-image:{key} 캐시 확인 → 있으면 즉시 image stream
// 3) url 페이지에서 og:image / twitter:image 추출 시도
// 4) 실패 시 → 네이버 이미지 검색 (NAVER_CLIENT_ID/SECRET 필요, title 사용)
// 5) 모두 실패 → 1x1 transparent PNG (클라이언트가 emoji fallback)

import { kvGet, kvSet } from './_kv.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
// 1x1 투명 PNG (실패 시 폴백 — 클라이언트는 onerror로 emoji fallback 가능)
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

// 단순 djb2 hash (crypto 의존성 제거 - ESM 호환성 회피)
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// og:image content가 valid 이미지 URL인지 검증
// 일부 사이트는 og:image content에 안내 텍스트 박아놓음 (예: "대표이미지주소(full_url):관리자등록권장")
function isValidImageUrl(s) {
  if (!s || typeof s !== 'string') return false;
  // 절대 URL 또는 protocol-relative URL만
  if (!/^(https?:)?\/\//i.test(s)) return false;
  // 한국어 placeholder 키워드 거부
  if (/관리자|등록|권장|예시|샘플|이미지주소|full_url|placeholder|example|your[-_]?image|이미지크기/i.test(s)) return false;
  return true;
}

function extractOgImage(html) {
  // 다양한 메타태그 패턴: property/name 모두 + 순서 무관
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const v = m[1].trim();
      if (isValidImageUrl(v)) return v;
    }
  }
  return null;
}

function resolveUrl(base, target) {
  try {
    return new URL(target, base).toString();
  } catch {
    return target;
  }
}

async function fetchImage(imageUrl) {
  try {
    const r = await fetch(imageUrl, {
      headers: { 'User-Agent': UA, Referer: imageUrl },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { ct, buf };
  } catch {
    return null;
  }
}

// 네이버 이미지 검색 — title로 행사 대표 이미지 검색 (og:image 없는 사이트 fallback)
async function naverImageSearch(title) {
  // 환경변수 우선, 없으면 하드코딩 fallback
  const id = process.env.NAVER_CLIENT_ID || 'ioZXkMir4q45hSe5NjQx';
  const secret = process.env.NAVER_CLIENT_SECRET || 'mqfNVKWzGo';
  if (!id || !secret || !title) return null;
  try {
    const q = encodeURIComponent(title);
    const r = await fetch(`https://openapi.naver.com/v1/search/image?query=${q}&display=5&sort=sim`, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const items = data.items || [];
    // pstatic.net 썸네일이 호스트 안정적 (hotlink 차단 없음)
    for (const it of items) {
      if (it.thumbnail) return it.thumbnail;
      if (it.link) return it.link;
    }
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    return await _handler(req, res);
  } catch (e) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send(`og-image error: ${e && e.message}\n${e && e.stack}`);
  }
}

async function _handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, title } = req.query;
  if (!url && !title) return res.status(400).send('missing url or title');

  let parsed = null;
  if (url && typeof url === 'string') {
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) parsed = null;
    } catch {}
  }

  // 캐시 키 v3: og:image URL 검증 + redirect 방식 추가로 인한 기존 NONE 캐시 무효화
  const cacheKey = `og-image:v3:${hash(parsed ? url : `t:${title}`)}`;

  const sendPng = (status, png) => {
    const ttl = status === 200 ? 604800 : 86400;
    res.setHeader('Cache-Control', `public, s-maxage=${ttl}`);
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(png);
  };
  const failFallback = async (msg) => {
    await kvSet(cacheKey, 'NONE', 86400).catch(() => {});
    return sendPng(404, TRANSPARENT_PNG);
  };

  // KV 캐시 조회
  let cachedImageUrl = null;
  try {
    cachedImageUrl = await kvGet(cacheKey);
  } catch {}

  if (cachedImageUrl === 'NONE') return sendPng(404, TRANSPARENT_PNG);

  // 캐시된 image URL이 있으면 즉시 redirect (Vercel runtime이 image fetch 안 함 → 빠름)
  if (cachedImageUrl && cachedImageUrl.startsWith('http')) {
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
    return res.redirect(302, cachedImageUrl);
  }

  // 1순위: url 페이지 og:image 추출
  let candidateImageUrl = null;
  let stage = '';
  if (parsed) {
    try {
      const pageResp = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (pageResp.ok) {
        const html = await pageResp.text();
        const ogImageRaw = extractOgImage(html);
        if (ogImageRaw) {
          candidateImageUrl = resolveUrl(pageResp.url || url, ogImageRaw);
          stage = 'og';
        } else {
          stage = 'og-not-found';
        }
      } else {
        stage = `page-${pageResp.status}`;
      }
    } catch (e) {
      stage = `page-fetch-failed`;
    }
  }

  // 2순위: 네이버 이미지 검색 (title 사용)
  if (!candidateImageUrl && title && typeof title === 'string') {
    const naver = await naverImageSearch(title);
    if (naver) {
      candidateImageUrl = naver;
      stage = (stage ? stage + '+' : '') + 'naver';
    } else {
      stage = (stage ? stage + '+' : '') + 'naver-failed';
    }
  }

  if (!candidateImageUrl) {
    res.setHeader('X-OG-Stage', stage || 'no-source');
    return failFallback('no candidate');
  }

  // 성공 → KV에 image URL 저장 후 redirect (Vercel runtime은 image fetch 안 함)
  // 이전엔 fetchImage로 binary stream했는데 일부 사이트 SSL 호환성 issue로 실패 → redirect로 회피
  await kvSet(cacheKey, candidateImageUrl, 7 * 86400).catch(() => {});
  res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=86400');
  res.setHeader('X-OG-Stage', stage);
  return res.redirect(302, candidateImageUrl);
}
