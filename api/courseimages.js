// 코스 대표 이미지 조회
// 우선순위: 카카오 og:image → TourAPI → 네이버 이미지 검색

const TOUR_KEY = '7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95';
const NAVER_CLIENT_ID = 'ioZXkMir4q45hSe5NjQx';
const NAVER_CLIENT_SECRET = 'mqfNVKWzGo';

// "남산 N서울타워 + 케이블카" → "남산 N서울타워" (검색 정확도 향상)
function cleanKeyword(kw) {
  return kw.replace(/\s*[+&]\s*.+$/, '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

  // 카카오 장소 단건 이미지 (없으면 TourAPI → 네이버 순으로 폴백)
  if (req.query.place_id) {
    const keyword = req.query.keyword || '';
    let image = await fetchKakaoPlaceImage(req.query.place_id);
    if (!image && keyword) image = await fetchTourImage(cleanKeyword(keyword));
    if (!image && keyword) image = await fetchNaverImage(cleanKeyword(keyword));
    return res.status(200).json({ image: image || '' });
  }

  // 코스 제목 bulk 이미지: TourAPI 우선, 없으면 네이버
  const keywords = (req.query.keywords || '').split('|').map(s => s.trim()).filter(Boolean);
  if (!keywords.length) return res.status(200).json({});

  const results = {};
  await Promise.all(keywords.map(async (kw) => {
    const ckw = cleanKeyword(kw);
    let image = await fetchTourImage(ckw);
    if (!image) image = await fetchNaverImage(ckw);
    if (image) results[kw] = image;
  }));

  return res.status(200).json(results);
}

async function fetchTourImage(keyword) {
  try {
    const url = `https://apis.data.go.kr/B551011/KorService2/searchKeyword2?serviceKey=${TOUR_KEY}&keyword=${encodeURIComponent(keyword)}&_type=json&MobileOS=ETC&MobileApp=abbadda&numOfRows=5&pageNo=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    const items = data?.response?.body?.items?.item;
    const arr = Array.isArray(items) ? items : (items ? [items] : []);
    const withImg = arr.find(i => i.firstimage);
    return withImg ? withImg.firstimage : '';
  } catch {
    return '';
  }
}

async function fetchNaverImage(keyword) {
  try {
    const url = `https://openapi.naver.com/v1/search/image.json?query=${encodeURIComponent(keyword)}&display=1&filter=large`;
    const resp = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    return data?.items?.[0]?.link || '';
  } catch {
    return '';
  }
}

async function fetchKakaoPlaceImage(placeId) {
  try {
    const resp = await fetch(`https://place.map.kakao.com/${placeId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return '';
    const html = await resp.text();
    const m = html.match(/property="og:image"\s+content="([^"]+)"/i)
           || html.match(/content="([^"]+)"\s+property="og:image"/i);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}
