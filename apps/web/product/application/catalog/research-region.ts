export type ResearchRegion = 'japan' | 'mainland_china' | 'overseas';

export function researchRegion(address: string): ResearchRegion {
  const normalized = address.normalize().toLowerCase();
  // A provider may append China to Hong Kong, Macau or Taiwan addresses.
  if (
    /hong\s*kong|香港|macau|macao|澳門|澳门|taiwan|台湾|臺灣/u.test(normalized)
  )
    return 'overseas';
  if (
    /中国|china|beijing|北京市|shanghai|上海市|shenzhen|深圳市|guangzhou|广州市|廣州市|杭州|hangzhou/u.test(
      normalized,
    )
  )
    return 'mainland_china';
  if (
    /japan|日本|東京|北海道|大阪|京都|神奈川|埼玉|千葉|福岡|愛知|沖縄|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|佐賀|長崎|熊本|大分|宮崎|鹿児島|tokyo|osaka|kyoto|shinjuku|shibuya|roppongi/u.test(
      normalized,
    )
  )
    return 'japan';
  return 'overseas';
}
