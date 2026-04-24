// 코스 대표 이미지 조회
// 정적 코스(bulk): Wikipedia → TourAPI → 네이버 (동시 5개 제한)
// 동적 코스(place_id): Wikipedia → 카카오 → 네이버 → TourAPI

const TOUR_KEY = '7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95';
const NAVER_CLIENT_ID = 'ioZXkMir4q45hSe5NjQx';
const NAVER_CLIENT_SECRET = 'mqfNVKWzGo';

// "홍천 수리산 + 공작산 산내음" → "수리산"  (도시명 + 부제목 제거)
function cleanKeyword(kw) {
  let k = kw.replace(/\s*[+&]\s*.+$/, '').trim(); // "+ 부제목" 제거
  // 앞에 붙은 도시/지역명 제거 (예: "과천 서울대공원" → "서울대공원")
  k = k.replace(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|수원|과천|성남|안양|안산|고양|용인|파주|이천|양평|남양주|의왕|가평|포천|연천|춘천|강릉|속초|홍천|양주|화성|안성|평택|시흥|광명|오산|하남|의정부|구리|군포|광주|여주|동두천)\s+/, '').trim();
  return k;
}

// 동시 실행 제한 (max N개)
function pLimit(concurrency) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= concurrency || !queue.length) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { running--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');

  // ── 동적 코스 단건: Wikipedia → 카카오 → 네이버 → TourAPI ──
  if (req.query.place_id) {
    const keyword = req.query.keyword || '';
    const ckw = keyword ? cleanKeyword(decodeURIComponent(keyword)) : '';
    let image = ckw ? await fetchWikipediaImage(ckw) : '';
    if (!image) image = await fetchKakaoPlaceImage(req.query.place_id);
    if (!image && ckw) image = await fetchNaverImage(ckw);
    if (!image && ckw) image = await fetchTourImage(ckw);
    return res.status(200).json({ image: image || '' });
  }

  // ── 정적 코스 bulk: Wikipedia → TourAPI → 네이버 (5개 병렬 제한) ──
  const keywords = (req.query.keywords || '').split('|').map(s => s.trim()).filter(Boolean);
  if (!keywords.length) return res.status(200).json({});

  const limit = pLimit(5);
  const results = {};

  // 1차: Wikipedia (무료, 고화질 공식 사진)
  await Promise.all(keywords.map(kw => limit(async () => {
    const ckw = cleanKeyword(kw);
    const image = await fetchWikipediaImage(ckw);
    if (image) results[kw] = image;
  })));

  // 2차: Wikipedia 못 찾은 것 → TourAPI
  const miss1 = keywords.filter(kw => !results[kw]);
  await Promise.all(miss1.map(kw => limit(async () => {
    const ckw = cleanKeyword(kw);
    const image = await fetchTourImage(ckw);
    if (image) results[kw] = image;
  })));

  // 3차: 여전히 없는 것 → 네이버
  const miss2 = keywords.filter(kw => !results[kw]);
  await Promise.all(miss2.map(kw => limit(async () => {
    const ckw = cleanKeyword(kw);
    let image = await fetchNaverImage(ckw);
    if (!image) {
      const lastWord = ckw.split(' ').pop();
      if (lastWord && lastWord !== ckw) image = await fetchNaverImage(lastWord);
    }
    if (image) results[kw] = image;
  })));

  return res.status(200).json(results);
}

async function fetchWikipediaImage(keyword) {
  try {
    const url = `https://ko.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(keyword)}&prop=pageimages&format=json&pithumbsize=1200&redirects=1&pilicense=any`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    const pages = data?.query?.pages || {};
    const page = Object.values(pages)[0];
    // pageid -1 = 문서 없음
    if (!page || page.pageid === -1) return '';
    return page.thumbnail?.source || '';
  } catch {
    return '';
  }
}

async function fetchTourImage(keyword) {
  try {
    const searchUrl = `https://apis.data.go.kr/B551011/KorService2/searchKeyword2?serviceKey=${TOUR_KEY}&keyword=${encodeURIComponent(keyword)}&_type=json&MobileOS=ETC&MobileApp=abbadda&numOfRows=5&pageNo=1`;
    const resp = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    const items = data?.response?.body?.items?.item;
    const arr = Array.isArray(items) ? items : (items ? [items] : []);
    if (!arr.length) return '';

    // contentid로 detailImage2 호출 → 원본 고화질
    const contentid = arr[0].contentid;
    if (contentid) {
      const imgUrl = `https://apis.data.go.kr/B551011/KorService2/detailImage2?serviceKey=${TOUR_KEY}&contentId=${contentid}&imageYN=Y&MobileOS=ETC&MobileApp=abbadda&_type=json`;
      const imgResp = await fetch(imgUrl, { signal: AbortSignal.timeout(5000) });
      const imgData = await imgResp.json();
      const imgItems = imgData?.response?.body?.items?.item;
      const imgArr = Array.isArray(imgItems) ? imgItems : (imgItems ? [imgItems] : []);
      if (imgArr[0]?.originimgurl) return imgArr[0].originimgurl;
    }
    // detailImage2 실패 시 firstimage 폴백
    const withImg = arr.find(i => i.firstimage);
    return withImg ? withImg.firstimage : '';
  } catch {
    return '';
  }
}

async function fetchNaverImage(keyword) {
  try {
    const url = `https://openapi.naver.com/v1/search/image.json?query=${encodeURIComponent(keyword)}&display=5&filter=large&sort=sim`;
    const resp = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return '';
    const data = await resp.json();
    if (!data?.items?.length) return '';
    // 가장 큰 이미지 선택
    const best = data.items.reduce((a, b) =>
      (parseInt(b.sizewidth) * parseInt(b.sizeheight)) > (parseInt(a.sizewidth) * parseInt(a.sizeheight)) ? b : a
    );
    const thumb = best.thumbnail || '';
    return thumb ? thumb.replace(/type=b\d+/, 'type=w640') : (best.link || '');
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
