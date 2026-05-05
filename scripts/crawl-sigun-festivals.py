#!/usr/bin/env python3
"""
시청 보도자료 RSS 크롤러 - 표준 CMS(K-Sapience 류) 시청 사이트에서 행사 정보 추출

매일 GitHub Actions cron으로 실행, 결과는 api/_data/sigun-festivals.json에 저장.
events.js의 fetchSigunFestivals()가 이 정적 파일을 읽어 응답에 보강한다.

시 추가 방법: SITES 배열에 항목 추가 (rss URL과 시 중심 좌표). 단일 어댑터로 동작.
"""
import json
import re
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

UA = 'Mozilla/5.0 (compatible; abbadda-bot/1.0)'
TIMEOUT = 15

# 행사 키워드: "축제·페스티벌·문화제" 류 (잡음 없는 강한 매치)
FESTIVAL_KW = ['축제', '페스티벌', '문화제', '한마당', '박람회', '엑스포', '대축제']

# 시청 등록 (단계적 확장 — 검증된 시만 추가)
SITES = [
    {
        'sigun': '광명시', 'sido': '경기', 'sido_code': '31',
        'rss': 'https://news.gm.go.kr/rss/allArticle.xml',
        # 시 중심 좌표 (좌표 없는 행사의 fallback — 거리 정렬용)
        'lat': 37.4781, 'lng': 126.8644,
    },
]

DATE_LABELS = r'(?:일시|운영\s*기간|기간|행사\s*일시|일정|개최\s*일시|행사\s*기간|개최\s*기간)'
PLACE_LABELS = r'(?:장소|운영\s*장소|위치|개최\s*장소|행사\s*장소)'

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
    for enc in ('utf-8', 'euc-kr', 'cp949'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')

def parse_rss(xml: str) -> list:
    items = re.findall(r'<item>([\s\S]*?)</item>', xml)
    out = []
    for it in items:
        def get(tag):
            m = re.search(rf'<{tag}>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?</{tag}>', it)
            return m.group(1).strip() if m else ''
        out.append({
            'title': get('title'),
            'link': get('link'),
            'description': get('description'),
            'pubDate': get('pubDate'),
        })
    return out

def text_only(html: str) -> str:
    s = re.sub(r'<!\[CDATA\[|\]\]>', '', html or '')
    s = re.sub(r'<[^>]+>', ' ', s)
    s = unescape(s)
    s = s.replace(' ', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def extract_dates(text: str):
    """일시·기간을 (시작YYYYMMDD, 종료YYYYMMDD)로 추출"""
    pat = (
        rf'{DATE_LABELS}\s*[:：]\s*'
        r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?'  # 시작 연·월·일
        r'[^~\n.]{0,30}?'  # (요일 등 가벼운 잡음 허용)
        r'(?:[~∼]\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.?)?'  # 종료 (옵션)
    )
    m = re.search(pat, text)
    if not m:
        return None
    sy, sm, sd = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
    ey = m.group(4) or sy
    em = m.group(5).zfill(2) if m.group(5) else sm
    ed = m.group(6).zfill(2) if m.group(6) else sd
    return f'{sy}{sm}{sd}', f'{ey}{em}{ed}'

def extract_place(text: str):
    m = re.search(rf'{PLACE_LABELS}\s*[:：]\s*([^\n.]{{1,80}})', text)
    if not m:
        return None
    place = m.group(1)
    # 첫 의미 단위만 (다음 라벨/문구 전까지)
    place = re.split(
        r'\s{2,}|✨|▶|주요\s*프로그램|문의\s*[:：]|체험\s*[:：]|공연\s*[:：]|먹거리\s*[:：]|내용\s*[:：]|마켓\s*[:：]|행사\s*[:：]|일정\s*[:：]|프로그램\s*[:：]',
        place,
    )[0]
    return place.strip().rstrip(',·')

def get_article_body(html: str, fallback_desc: str) -> str:
    # K-Sapience 류 표준: id="article-view-content-div"
    # 본문 안에 nested div가 있어 닫는 태그로 끝낼 수 없음 → 종료 마커로 끊기
    m = re.search(r'id=["\']article-view-content-div["\'][^>]*>', html)
    if not m:
        return text_only(fallback_desc)
    start = m.end()
    end_match = re.search(r'(저작권자|SNS\s*기사보내기|article-bottom|<!--\s*//본문)', html[start:])
    end = start + (end_match.start() if end_match else 10000)
    return text_only(html[start:end])

def crawl_site(site: dict) -> list:
    print(f'\n=== {site["sigun"]} ({site["rss"]}) ===')
    try:
        xml = fetch(site['rss'])
    except Exception as e:
        print(f'  RSS fetch 실패: {e}')
        return []
    items = parse_rss(xml)
    print(f'  RSS 총 {len(items)}건')
    festivals = [i for i in items if any(k in i['title'] for k in FESTIVAL_KW)]
    print(f'  키워드 매칭: {len(festivals)}건')

    today = datetime.now().strftime('%Y%m%d')
    results = []
    for f in festivals:
        try:
            detail_html = fetch(f['link'])
        except Exception as e:
            print(f'  ❌ detail fetch 실패: {f["title"][:30]} ({e})')
            continue
        text = get_article_body(detail_html, f.get('description', ''))
        dates = extract_dates(text)
        if not dates:
            print(f'  ⏭️  날짜 추출 실패: {f["title"][:40]}')
            continue
        start, end = dates
        if end < today:
            print(f'  ⏭️  이미 종료: {f["title"][:40]} ({end})')
            continue
        place = extract_place(text)
        results.append({
            'title': f['title'],
            'eventstartdate': start,
            'eventenddate': end,
            'addr1': f'{site["sido"]} {site["sigun"]} {place}'.strip() if place else f'{site["sido"]} {site["sigun"]}',
            'mapy': site['lat'],  # 시 중심 좌표 fallback
            'mapx': site['lng'],
            'sido_code': site['sido_code'],
            'link': f['link'],
            'pubDate': f['pubDate'],
            'source': f'sigun-rss/{site["sigun"]}',
        })
        print(f'  ✅ {f["title"][:35]} ({start}~{end}) @ {place or "?"}')
    return results

def main():
    all_items = []
    for site in SITES:
        all_items.extend(crawl_site(site))

    out_path = Path(__file__).parent.parent / 'api' / '_data' / 'sigun-festivals.json'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        'updated': datetime.now(timezone.utc).isoformat(),
        'count': len(all_items),
        'items': all_items,
    }, ensure_ascii=False, indent=2))
    print(f'\n저장: {out_path.relative_to(Path(__file__).parent.parent)} ({len(all_items)}건)')

if __name__ == '__main__':
    main()
