export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { areaCodes } = req.query;
  const KEY = encodeURIComponent('7cd0819411acef067d0cc1ab73350bb7105cde8c2fd3de620bec99e518953f95');

  const now = new Date();
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const todayStr = fmt(now);

  // 진행 중 행사 포착: 90일 전 시작 ~ 60일 후 종료
  const past90 = new Date(now); past90.setDate(past90.getDate() - 90);
  const future60 = new Date(now); future60.setDate(future60.getDate() + 60);
  const startFrom = fmt(past90);
  const endUntil = fmt(future60);

  const codes = (areaCodes || '1,31').split(',').map(s => s.trim()).filter(Boolean).slice(0, 6);
  const seen = new Set();
  const allItems = [];
  const errors = [];

  for (const code of codes) {
    try {
      const url = `https://apis.data.go.kr/B551011/KorService2/searchFestival2?serviceKey=${KEY}&numOfRows=100&pageNo=1&MobileOS=ETC&MobileApp=%EC%95%84%EB%B9%A0%EB%94%B0&_type=json&listYN=Y&arrange=A&eventStartDate=${startFrom}&eventEndDate=${endUntil}&areaCode=${code}`;
      const resp = await fetch(url);
      if (!resp.ok) { errors.push(`areaCode=${code} HTTP ${resp.status}`); continue; }

      const text = await resp.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch(e) {
        errors.push(`areaCode=${code} JSON parse fail: ${text.slice(0, 200)}`);
        continue;
      }

      const resultCode = data?.response?.header?.resultCode;
      if (resultCode && resultCode !== '0000') {
        errors.push(`areaCode=${code} API error: ${resultCode} ${data?.response?.header?.resultMsg}`);
        continue;
      }

      const items = data?.response?.body?.items?.item;
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
      errors.push(`areaCode=${code} exception: ${e.message}`);
    }
  }

  return res.status(200).json({
    items: allItems,
    total: allItems.length,
    debug: { todayStr, startFrom, endUntil, errors }
  });
}
