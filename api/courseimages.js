// 코스 대표 이미지 조회
// - keywords 모드: TourAPI searchKeyword2 로 코스 제목 검색
// - place_id 모드: 카카오 장소 페이지 og:image 스크래핑

const TOUR_KEY = '7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

  // 카카오 장소 단건 이미지 (없으면 TourAPI 폴백)
  if (req.query.place_id) {
    let image = await fetchKakaoPlaceImage(req.query.place_id);
    if (!image && req.query.keyword) {
      image = await fetchTourImage(req.query.keyword);
    }
    return res.status(200).json({ image: image || '' });
  }

  // 코스 제목 bulk 이미지 (TourAPI)
  const keywords = (req.query.keywords || '').split('|').map(s => s.trim()).filter(Boolean);
  if (!keywords.length) return res.status(200).json({});

  const results = {};
  await Promise.all(keywords.map(async (kw) => {
    try {
      const url = `https://apis.data.go.kr/B551011/KorService2/searchKeyword2?serviceKey=${TOUR_KEY}&keyword=${encodeURIComponent(kw)}&_type=json&MobileOS=ETC&MobileApp=abbadda&numOfRows=5&pageNo=1`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      const items = data?.response?.body?.items?.item;
      const arr = Array.isArray(items) ? items : (items ? [items] : []);
      const withImg = arr.find(i => i.firstimage);
      if (withImg) results[kw] = withImg.firstimage;
    } catch {}
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
