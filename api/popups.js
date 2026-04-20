// Popply.co.kr 크롤링 기반 팝업스토어 API
// 팝업 ID를 역순으로 스캔해 현재 진행중/예정 팝업을 수집

const POPPLY_BASE = 'https://popply.co.kr/popup';
const CONCURRENCY = 30;
const REQUEST_TIMEOUT_MS = 4000;
const MAX_RESULTS = 40;
const SCAN_BUDGET_MS = 28000; // 28초 내 완료

// 오늘 기준으로 스캔할 ID 범위 추정
// 경험치: ~100 ID/월, 2026-04 기준 최대 ID ≈ 4800
const SCAN_MAX = 4900;
const SCAN_MIN = 4100; // 6개월 전까지

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // CDN 캐시 6시간
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const futureLimit = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  // 최신 ID부터 역순으로
  const ids = [];
  for (let i = SCAN_MAX; i >= SCAN_MIN; i--) ids.push(i);

  const found = [];
  const startAt = Date.now();

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    if (Date.now() - startAt > SCAN_BUDGET_MS) break;
    if (found.length >= MAX_RESULTS) break;

    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(id => fetchPopupPage(id, todayStr, futureLimit))
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        found.push(r.value);
      }
    }
  }

  // 시작일 오름차순 정렬
  found.sort((a, b) => a.startDate.localeCompare(b.startDate));

  return res.status(200).json({ items: found, total: found.length });
}

async function fetchPopupPage(id, todayStr, futureLimit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(`${POPPLY_BASE}/${id}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    clearTimeout(timer);

    if (!resp.ok) return null;
    const html = await resp.text();

    // 제목
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (!titleMatch) return null;
    const title = titleMatch[1].replace(/\s*[-–|]\s*(POPPLY|팝플리).*$/i, '').trim();
    if (!title || title.length < 2) return null;

    // RSC 스트리밍 청크에서 날짜 추출
    const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs)].map(m => m[1]);
    const combined = chunks.join('');

    const dateMatches = [...combined.matchAll(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/g)].map(m => m[1]);
    if (dateMatches.length < 2) return null;

    const startDate = dateMatches[0];
    const endDate = dateMatches[1];

    // 날짜 필터: 이미 종료됐거나 너무 미래인 팝업 제외
    if (endDate < todayStr) return null;
    if (startDate > futureLimit) return null;

    // 주소 (한국어 주소 패턴)
    const addrMatch = combined.match(/(?:서울|경기|인천|부산|대구|대전|광주|울산|제주)[가-힣0-9\s\-·,()]+/);
    const address = addrMatch ? addrMatch[0].trim().replace(/\s+/g, ' ').slice(0, 50) : '';

    // 좌표 (Naver Maps용으로 HTML에 직접 포함됨)
    const latMatch = html.match(/(?:37|36|35|34|38|33)\.[0-9]{5,}/);
    const lngMatch = html.match(/(?:126|127|128|129)\.[0-9]{5,}/);
    const lat = latMatch ? parseFloat(latMatch[0]) : null;
    const lng = lngMatch ? parseFloat(lngMatch[0]) : null;

    // 대표 이미지
    const imgMatch = html.match(/content="(https:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    const image = imgMatch ? imgMatch[1] : '';

    return {
      id: `popply_${id}`,
      title,
      startDate,
      endDate,
      address,
      lat,
      lng,
      image,
      url: `https://popply.co.kr/popup/${id}`,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}
