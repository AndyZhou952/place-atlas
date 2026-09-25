CREATE TABLE IF NOT EXISTS agent_catalog_items (
  id TEXT PRIMARY KEY CHECK (id IS json_extract(payload_json, '$.id')),
  kind TEXT NOT NULL CHECK (
    kind IN ('food', 'event', 'architecture')
    AND kind IS json_extract(payload_json, '$.kind')
  ),
  verification_status TEXT NOT NULL CHECK (
    verification_status IN ('verified', 'needs_review')
    AND verification_status IS json_extract(payload_json, '$.verificationStatus')
  ),
  latitude REAL NOT NULL CHECK (
    latitude >= -90
    AND latitude <= 90
    AND latitude IS json_extract(payload_json, '$.latitude')
  ),
  longitude REAL NOT NULL CHECK (
    longitude >= -180
    AND longitude <= 180
    AND longitude IS json_extract(payload_json, '$.longitude')
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  record_origin TEXT NOT NULL DEFAULT 'catalog_intake' CHECK (
    record_origin IN ('repo_seed', 'catalog_intake')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_catalog_items_nearby_idx
  ON agent_catalog_items (
    verification_status,
    kind,
    latitude,
    longitude
  );

-- INSERT OR IGNORE is intentional: a later Catalog write or user edit owns the
-- existing row. Reapplying this seed must never restore repository defaults over
-- data that has since changed in the isolated PoC Catalog.
INSERT OR IGNORE INTO agent_catalog_items (
  id,
  kind,
  verification_status,
  latitude,
  longitude,
  payload_json,
  record_origin,
  created_at,
  updated_at
) VALUES
  (
    'koffee-mameya-kakeru',
    'food',
    'verified',
    35.6751,
    139.8034,
    '{"id":"koffee-mameya-kakeru","kind":"food","title":"コーヒー マメヤ カケル","alternateTitle":"KOFFEE MAMEYA -Kakeru-","area":"清澄白河・木場","address":"東京都江東区平野2-16-14","description":"コーヒーと料理をコース形式で体験する予約優先のカフェ。カウンター席のみ。","latitude":35.6751,"longitude":139.8034,"verificationStatus":"verified","verifiedAt":"2026-09-06","officialUrl":"https://koffee-mameya.com/kakeru/","tabelog":{"score":3.5,"reviewCount":168,"url":"https://tabelog.com/tokyo/A1313/A131303/13255632/","checkedAt":"2026-09-06"},"reservation":{"mode":"advance","label":"予約優先","channel":"TableCheck","url":"https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing","advanceDays":30,"bookingWindowLabel":"最大1か月先まで","releaseNote":"TableCheckで最大1か月先まで受付。当日予約は店舗へ直接確認。","checkedAt":"2026-09-06"},"personalState":"candidate","tags":["coffee","tasting","清澄白河","予約"],"sources":[{"label":"公式サイト","url":"https://koffee-mameya.com/kakeru/","role":"official"},{"label":"食べログ","url":"https://tabelog.com/tokyo/A1313/A131303/13255632/","role":"tabelog"},{"label":"TableCheck","url":"https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing","role":"reservation"}]}',
    'repo_seed',
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z'
  ),
  (
    'tonkatsu-narikura',
    'food',
    'verified',
    35.6996,
    139.6358,
    '{"id":"tonkatsu-narikura","kind":"food","title":"とんかつ 成蔵","alternateTitle":"Tonkatsu Narikura","area":"南阿佐ケ谷","address":"東京都杉並区成田東4-33-9","description":"低温で火入れする白い衣のとんかつ。完全予約制で、予約時にコースと品目を選ぶ。","latitude":35.6996,"longitude":139.6358,"verificationStatus":"verified","verifiedAt":"2026-09-06","officialUrl":"https://tonkatsu-narikura.com/","tabelog":{"score":4.28,"reviewCount":2012,"url":"https://tabelog.com/tokyo/A1319/A131905/13236380/","checkedAt":"2026-09-06"},"reservation":{"mode":"advance","label":"完全予約制","channel":"OMAKASE","url":"https://omakase.in/ja/r/qw473765","advanceDays":14,"bookingWindowLabel":"目安：2週間前から","releaseNote":"食べログ掲載情報では2週間前から受付。実際の発売日時と空席はOMAKASEで都度確認。","checkedAt":"2026-09-06"},"personalState":"candidate","tags":["とんかつ","南阿佐ケ谷","完全予約制"],"sources":[{"label":"公式サイト","url":"https://tonkatsu-narikura.com/","role":"official"},{"label":"食べログ","url":"https://tabelog.com/tokyo/A1319/A131905/13236380/","role":"tabelog"},{"label":"OMAKASE","url":"https://omakase.in/ja/r/qw473765","role":"reservation"}]}',
    'repo_seed',
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z'
  ),
  (
    'onibus-nakameguro',
    'food',
    'verified',
    35.6443,
    139.6993,
    '{"id":"onibus-nakameguro","kind":"food","title":"オニバスコーヒー 中目黒駅前店","alternateTitle":"ONIBUS COFFEE NAKAMEGURO","area":"中目黒","address":"東京都目黒区上目黒2-14-1","description":"中目黒駅から徒歩約2分のスペシャルティコーヒー店。予約不可のため直接来店。","latitude":35.6443,"longitude":139.6993,"verificationStatus":"verified","verifiedAt":"2026-09-06","officialUrl":"https://onibuscoffee.com/pages/locations/nakameguro","tabelog":{"score":3.58,"reviewCount":472,"url":"https://tabelog.com/tokyo/A1317/A131701/13191293/","checkedAt":"2026-09-06"},"reservation":{"mode":"unavailable","label":"予約不可・直接来店","checkedAt":"2026-09-06"},"personalState":"candidate","tags":["coffee","中目黒","walk-in"],"sources":[{"label":"公式サイト","url":"https://onibuscoffee.com/pages/locations/nakameguro","role":"official"},{"label":"食べログ","url":"https://tabelog.com/tokyo/A1317/A131701/13191293/","role":"tabelog"}]}',
    'repo_seed',
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z'
  ),
  (
    'sumida-hokusai-museum',
    'architecture',
    'verified',
    35.6965,
    139.8006,
    '{"id":"sumida-hokusai-museum","kind":"architecture","title":"すみだ北斎美術館","alternateTitle":"The Sumida Hokusai Museum","area":"両国","address":"東京都墨田区亀沢2-7-2","description":"妹島和世が設計した、アルミ外装と街区を横切る通路が特徴の美術館。","latitude":35.6965,"longitude":139.8006,"verificationStatus":"verified","verifiedAt":"2026-09-06","officialUrl":"https://hokusai-museum.jp/","reservation":{"mode":"walk-in","label":"当日入館可","checkedAt":"2026-09-06"},"personalState":"candidate","tags":["architecture","museum","妹島和世","両国"],"sources":[{"label":"公式サイト","url":"https://hokusai-museum.jp/","role":"official"}]}',
    'repo_seed',
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z'
  ),
  (
    'best-of-sumida-hokusai-2026',
    'event',
    'verified',
    35.6965,
    139.8006,
    '{"id":"best-of-sumida-hokusai-2026","kind":"event","title":"開館10周年記念 特別展「ベスト オブ すみだ北斎美術館」","alternateTitle":"Best of the Sumida Hokusai Museum","area":"両国","address":"東京都墨田区亀沢2-7-2","description":"開館10周年を記念し、未公開・新規収蔵作品を含む名品を紹介する特別展。前後期で一部展示替え。","latitude":35.6965,"longitude":139.8006,"verificationStatus":"verified","verifiedAt":"2026-09-06","officialUrl":"https://hokusai-museum.jp/modules/Exhibition/exhibitions/view/5021","reservation":{"mode":"ticketed","label":"チケット制・当日券あり","checkedAt":"2026-09-06"},"event":{"startDate":"2026-09-15","endDate":"2026-11-23","displayDate":"2026年9月15日 — 11月23日"},"personalState":"candidate","tags":["exhibition","北斎","両国","2026秋"],"sources":[{"label":"展覧会公式ページ","url":"https://hokusai-museum.jp/modules/Exhibition/exhibitions/view/5021","role":"official"}]}',
    'repo_seed',
    '2026-09-15T00:00:00.000Z',
    '2026-09-15T00:00:00.000Z'
  );
