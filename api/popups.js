// Popply.co.kr 크롤링 기반 팝업스토어 API
// 팝업 ID를 역순으로 스캔해 현재 진행중/예정 팝업을 수집

const POPPLY_BASE = 'https://popply.co.kr/popup';
const CONCURRENCY = 50;
const REQUEST_TIMEOUT_MS = 4000;
const MAX_RESULTS = 100;
const SCAN_BUDGET_MS = 45000; // 45초 내 완료 (Vercel maxDuration 60s)

// 좌표 → 광역시·도 추정 (광역시 우선, 도 폴백)
function regionFromCoords(lat, lng) {
  if (!lat || !lng) return null;
  // 광역시 (작고 밀집한 지역 먼저)
  if (lat >= 37.42 && lat <= 37.70 && lng >= 126.76 && lng <= 127.20) return '서울';
  if (lat >= 37.35 && lat <= 37.60 && lng >= 126.42 && lng <= 126.78) return '인천';
  if (lat >= 35.05 && lat <= 35.40 && lng >= 128.78 && lng <= 129.32) return '부산';
  if (lat >= 35.78 && lat <= 35.95 && lng >= 128.46 && lng <= 128.78) return '대구';
  if (lat >= 35.10 && lat <= 35.27 && lng >= 126.74 && lng <= 127.00) return '광주';
  if (lat >= 36.22 && lat <= 36.50 && lng >= 127.28 && lng <= 127.55) return '대전';
  if (lat >= 35.46 && lat <= 35.72 && lng >= 129.04 && lng <= 129.48) return '울산';
  if (lat >= 36.45 && lat <= 36.78 && lng >= 127.16 && lng <= 127.40) return '세종';
  // 도 (광역시 매칭 실패 시 폴백)
  if (lat >= 36.85 && lat <= 38.30 && lng >= 126.39 && lng <= 127.90) return '경기';
  if (lat >= 37.05 && lat <= 38.62 && lng >= 127.55 && lng <= 129.40) return '강원';
  if (lat >= 36.00 && lat <= 37.30 && lng >= 127.40 && lng <= 128.65) return '충북';
  if (lat >= 36.00 && lat <= 37.05 && lng >= 126.10 && lng <= 127.55) return '충남';
  if (lat >= 35.55 && lat <= 37.10 && lng >= 128.10 && lng <= 129.65) return '경북';
  if (lat >= 34.55 && lat <= 35.85 && lng >= 127.55 && lng <= 129.10) return '경남';
  if (lat >= 35.40 && lat <= 36.30 && lng >= 126.40 && lng <= 127.85) return '전북';
  if (lat >= 33.80 && lat <= 35.40 && lng >= 125.20 && lng <= 127.55) return '전남';
  if (lat >= 33.10 && lat <= 33.65 && lng >= 126.10 && lng <= 126.96) return '제주';
  return null;
}

// 동적 ID 범위: 경험치 기준 ~100 ID/월, 2026-04 기준 최대 ID ≈ 4800
const BASE_ID = 4800;
const BASE_MONTH = new Date('2026-04-01');
function calcScanRange() {
  const now = new Date();
  const monthsDiff = (now.getFullYear() - BASE_MONTH.getFullYear()) * 12 + (now.getMonth() - BASE_MONTH.getMonth());
  const SCAN_MAX = BASE_ID + Math.max(0, monthsDiff) * 120 + 250; // 250 여유
  const SCAN_MIN = Math.max(1, SCAN_MAX - 900); // 최근 900개 ID 스캔 (약 9개월치)
  return { SCAN_MAX, SCAN_MIN };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // CDN 캐시 6시간
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const futureLimit = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  // 최신 ID부터 역순으로
  const { SCAN_MAX, SCAN_MIN } = calcScanRange();
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

    // 첫 두 날짜 중 작은 것이 startDate
    const startDate = dateMatches[0] <= dateMatches[1] ? dateMatches[0] : dateMatches[1];
    const endDate   = dateMatches[0] <= dateMatches[1] ? dateMatches[1] : dateMatches[0];

    // 날짜 필터: 이미 종료됐거나 너무 미래인 팝업 제외
    if (endDate < todayStr) return null;
    if (startDate > futureLimit) return null;

    // 주소 추출 (다단계 시도)
    let address = '';
    // 지역명 이후 반드시 행정구역 단위(구/군/동/로/길 등) 포함 여부 검증 (설명문 오인식 방지)
    const regionRx = /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣0-9\s\-·,()]{4,60}/;
    const hasAddrUnit = /[가-힣]{1,5}(?:시|구|군|읍|면|동|로|길)/;
    // 1차: 광역시·도 접두사 + 행정구역 단위 포함
    const addrM1 = combined.match(regionRx);
    if (addrM1 && hasAddrUnit.test(addrM1[0])) {
      address = addrM1[0].trim().replace(/\s+/g, ' ');
    }
    // 2차: 도로명주소 (XX로/XX길 + 숫자 번지 필수)
    if (!address) {
      const roadRx = /[가-힣]{2,6}(?:로|길)\s*\d+(?:-\d+)?(?:\s*[가-힣\d()]{0,10})?/;
      const addrM2 = combined.match(roadRx);
      if (addrM2) address = addrM2[0].trim().replace(/\s+/g, ' ');
    }
    // 3차: og:description 메타태그에서 추출 (행정구역 단위 검증 동일 적용)
    if (!address) {
      const ogMatch = html.match(/property="og:description"\s+content="([^"]{10,120})"/);
      if (ogMatch) {
        const m = ogMatch[1].match(regionRx);
        if (m && hasAddrUnit.test(m[0])) address = m[0].trim().replace(/\s+/g, ' ');
      }
    }
    address = address.slice(0, 60);

    // 좌표: RSC chunk 우선, 없으면 전체 HTML에서 탐색
    const latMatch = combined.match(/(?:37|36|35|34|38|33)\.[0-9]{4,}/) || html.match(/(?:37|36|35|34|38|33)\.[0-9]{4,}/);
    const lngMatch = combined.match(/(?:126|127|128|129)\.[0-9]{4,}/) || html.match(/(?:126|127|128|129)\.[0-9]{4,}/);
    const lat = latMatch ? parseFloat(latMatch[0]) : null;
    const lng = lngMatch ? parseFloat(lngMatch[0]) : null;

    // 주소에 광역시·도 prefix 누락 시 좌표로 보강 (예: "왕십리로 63" → "서울 왕십리로 63")
    // "세종대로" 같은 도로명을 광역시로 오인하지 않도록 다음 글자 검증 (특별시/광역시/도/시/공백/끝)
    const provinceRx = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도|시|\s|$)/;
    if (!address) {
      const r = regionFromCoords(lat, lng);
      if (r) address = r;
    } else if (!provinceRx.test(address)) {
      const r = regionFromCoords(lat, lng);
      if (r) address = `${r} ${address}`;
    }

    // 대표 이미지 (og:image 우선, 없으면 첫 번째 이미지 URL)
    const ogImgMatch = html.match(/property="og:image"\s+content="([^"]+)"/i)
                    || html.match(/content="([^"]+)"\s+property="og:image"/i);
    const fallbackImgMatch = html.match(/content="(https:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
    const image = ogImgMatch ? ogImgMatch[1] : (fallbackImgMatch ? fallbackImgMatch[1] : '');

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
