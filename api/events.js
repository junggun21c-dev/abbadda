export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { areaCodes } = req.query;
  const KEY = '7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95';

  const now = new Date();
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const todayStr = fmt(now);

  // 6개월 전부터 시작한 행사 포함 (eventEndDate 제거 - 필터 너무 좁아짐)
  const past180 = new Date(now); past180.setDate(past180.getDate() - 180);
  const startFrom = fmt(past180);

  const codes = (areaCodes || '1,31').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const seen = new Set();
  const allItems = [];
  const debugLog = [];
  let firstRaw = null;

  for (const code of codes) {
    try {
      const url = `https://apis.data.go.kr/B551011/KorService2/searchFestival2?serviceKey=${KEY}&numOfRows=100&pageNo=1&MobileOS=ETC&MobileApp=%EC%95%84%EB%B9%A0%EB%94%B0&_type=json&arrange=A&eventStartDate=${startFrom}&areaCode=${code}`;
      const resp = await fetch(url);
      if (!resp.ok) { debugLog.push(`[${code}] HTTP ${resp.status}`); continue; }

      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); }
      catch(e) { debugLog.push(`[${code}] JSON parse fail: ${text.slice(0,150)}`); continue; }

      // 에러 응답: {resultCode, resultMsg} 플랫 구조
      if (data.resultCode && data.resultCode !== '0000') {
        debugLog.push(`[${code}] error: ${data.resultCode} ${data.resultMsg}`);
        continue;
      }

      const header = data?.response?.header;
      const body = data?.response?.body;
      const totalCount = body?.totalCount ?? '?';
      const resultCode = header?.resultCode;
      if (!firstRaw) firstRaw = text.slice(0, 500);
      debugLog.push(`[${code}] rc=${resultCode} total=${totalCount}`);

      if (resultCode && resultCode !== '0000') continue;

      const items = body?.items?.item;
      if (!items) continue;
      const arr = Array.isArray(items) ? items : [items];
      for (const item of arr) {
        const endDate = String(item.eventenddate || '');
        if (endDate.length === 8 && endDate < todayStr) continue;
        if (item.contentid && !seen.has(item.contentid)) {
          seen.add(item.contentid);
          allItems.push(item);
        }
      }
    } catch(e) {
      debugLog.push(`[${code}] exception: ${e.message}`);
    }
  }

  return res.status(200).json({
    items: allItems,
    total: allItems.length,
    debug: { todayStr, startFrom, log: debugLog, firstRaw }
  });
}
