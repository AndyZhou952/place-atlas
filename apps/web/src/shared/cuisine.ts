import { normalizeText } from './text.ts';

/** Browsing taxonomy: [category id, English label, source labels that map to it]. */
const CATEGORIES: readonly (readonly [string, string, string])[] = [
  ['chinese.dim-sum', 'Dim sum', '点心|飲茶|dim sum'],
  ['chinese.beijing', 'Beijing cuisine', '北京料理|北京菜|peking cuisine|beijing cuisine'],
  ['chinese.shanghai', 'Shanghainese', '上海料理|本帮菜|本幫菜|shanghainese'],
  ['chinese.sichuan', 'Sichuan cuisine', '四川料理|川菜|四川菜|sichuan'],
  ['chinese.cantonese', 'Cantonese', '広東料理|粤菜|粵菜|cantonese'],
  ['chinese.hunan', 'Hunan cuisine', '湖南料理|湘菜|hunan'],
  ['chinese.dumplings', 'Dumplings', '餃子|饺子|餃子専門店|dumplings'],
  [
    'japanese.ramen',
    'Ramen / tsukemen',
    'ラーメン|らーめん|らぁ麺|つけ麺|ramen|tsukemen|拉面|拉麵',
  ],
  ['japanese.sushi', 'Sushi', '寿司|鮨|すし|回転寿司|sushi'],
  ['japanese.udon', 'Udon', 'うどん|udon|乌冬|烏冬'],
  ['japanese.soba', 'Soba', 'そば|蕎麦|soba'],
  ['japanese.yakitori', 'Yakitori', '焼き鳥|焼鳥|鳥料理|串焼き|yakitori|烧鸟|燒鳥'],
  ['japanese.tonkatsu', 'Tonkatsu', 'とんかつ|豚カツ|tonkatsu|炸猪排'],
  ['japanese.tempura', 'Tempura / tendon', '天ぷら|天婦羅|天丼|tempura'],
  ['japanese.unagi', 'Unagi', 'うなぎ|鰻|unagi'],
  [
    'japanese.shabu-sukiyaki',
    'Shabu-shabu / sukiyaki',
    'しゃぶしゃぶ|すき焼き|shabu shabu|sukiyaki',
  ],
  ['japanese.izakaya', 'Izakaya', '居酒屋|izakaya'],
  ['japanese.japanese-curry', 'Japanese curry', '日本式カレー|欧風カレー|日式咖喱|japanese curry'],
  ['japanese.yoshoku', 'Yoshoku', '洋食|yoshoku'],
  ['thai.thai-curry', 'Thai curry', 'タイカレー|thai curry'],
  ['thai.thai-noodles', 'Thai noodles', 'タイラーメン|pad thai|泰式炒河粉'],
  ['american.steak', 'American steak', 'アメリカンステーキ|american steak|美式牛排'],
  ['american.barbecue', 'American barbecue', 'american barbecue|美式烧烤'],
  ['italian.pasta', 'Pasta', 'パスタ|pasta|意大利面|義大利麵'],
  ['italian.pizza', 'Pizza', 'ピザ|pizza|披萨|披薩'],
  ['french.bistro', 'Bistro', 'フレンチビストロ|french bistro|法式小馆'],
  ['indian.indian-curry', 'Indian curry', 'インドカレー|indian curry|印度咖喱'],
  ['korean.korean-barbecue', 'Korean barbecue', '韓国焼肉|korean barbecue|韩式烤肉'],
  ['korean.bibimbap', 'Bibimbap', 'ビビンバ|bibimbap|韩式拌饭'],
  ['international.burger', 'Burgers', 'ハンバーガー|hamburger|burger|汉堡|漢堡'],
  ['international.steak', 'Steak', 'ステーキ|steak|牛排'],
  ['international.beef', 'Beef / beef tongue', '牛料理|牛タン|牛たん|beef tongue|牛舌'],
  ['international.grill', 'Yakiniku / offal', '焼肉|ホルモン|grill'],
  ['international.seafood', 'Seafood', '海鮮|魚料理|海鮮・魚介|seafood|海鲜'],
  ['international.curry', 'Curry', 'カレー|スパイスカレー|curry|咖喱'],
  ['international.creative', 'Creative cuisine', '創作料理|fusion|创作料理'],
  [
    'cafe-dessert.cafe',
    'Cafe / kissaten',
    'カフェ|喫茶店|コーヒー|珈琲|スペシャルティコーヒー|cafe|coffee|coffee shop|咖啡馆',
  ],
  ['cafe-dessert.dessert', 'Dessert / cake', 'ケーキ|スイーツ|cake|dessert|甜品'],
  ['cafe-dessert.bakery', 'Bakery / sandwiches', 'パン|サンドイッチ|bakery|sandwich|面包'],
];

export const CUISINE_OPTIONS = CATEGORIES.map(([id, label]) => ({ id, label }));
const aliasIndex = new Map(
  CATEGORIES.flatMap(([id, , aliases]) =>
    aliases.split('|').map((alias) => [normalizeText(alias), id] as const),
  ),
);

export function cuisineLabel(id: string): string {
  return CATEGORIES.find(([key]) => key === id)?.[1] ?? id;
}

/** Map source category labels (Japanese, Chinese or English) to taxonomy ids. */
export function classifyCuisines(labels: readonly string[]): string[] {
  return [...new Set(labels.flatMap((label) => aliasIndex.get(normalizeText(label)) ?? []))].sort(
    (a, b) => CATEGORIES.findIndex(([id]) => id === a) - CATEGORIES.findIndex(([id]) => id === b),
  );
}

const PREFECTURES =
  '北海道:Hokkaido 青森県:Aomori 岩手県:Iwate 宮城県:Miyagi 秋田県:Akita 山形県:Yamagata 福島県:Fukushima ' +
  '茨城県:Ibaraki 栃木県:Tochigi 群馬県:Gunma 埼玉県:Saitama 千葉県:Chiba 東京都:Tokyo 神奈川県:Kanagawa ' +
  '新潟県:Niigata 富山県:Toyama 石川県:Ishikawa 福井県:Fukui 山梨県:Yamanashi 長野県:Nagano 岐阜県:Gifu ' +
  '静岡県:Shizuoka 愛知県:Aichi 三重県:Mie 滋賀県:Shiga 京都府:Kyoto 大阪府:Osaka 兵庫県:Hyogo 奈良県:Nara ' +
  '和歌山県:Wakayama 鳥取県:Tottori 島根県:Shimane 岡山県:Okayama 広島県:Hiroshima 山口県:Yamaguchi ' +
  '徳島県:Tokushima 香川県:Kagawa 愛媛県:Ehime 高知県:Kochi 福岡県:Fukuoka 佐賀県:Saga 長崎県:Nagasaki ' +
  '熊本県:Kumamoto 大分県:Oita 宮崎県:Miyazaki 鹿児島県:Kagoshima 沖縄県:Okinawa';

export const PREFECTURE_OPTIONS = PREFECTURES.split(' ').map((entry, index) => {
  const [name, label] = entry.split(':');
  return { code: `JP-${String(index + 1).padStart(2, '0')}`, name, label };
});

/** A prefecture is recognized only when its full Japanese or English name appears. */
export function prefectureOf(address: string): string | undefined {
  const matches = PREFECTURE_OPTIONS.filter(
    ({ name, label }) =>
      address.includes(name) || new RegExp(`(?:^|[^a-z])${label}(?:$|[^a-z])`, 'iu').test(address),
  );
  return matches.length === 1 ? matches[0].code : undefined;
}

export function prefectureLabel(code?: string): string | undefined {
  return PREFECTURE_OPTIONS.find((entry) => entry.code === code)?.label;
}

// Restaurant overview copy: one prose language, sourced names kept intact.

const CHINESE_NAMES = new Map(
  (
    '焼鳥:烧鸟 焼き鳥:烧鸟 やきとり:烧鸟 鳥料理:鸡肉料理 鶏料理:鸡肉料理 串焼:串烧 串焼き:串烧 和食:日式料理 ' +
    'ラーメン:拉面 餃子:饺子 寿司:寿司 洋食:西式料理 海鮮:海鲜 バー:酒吧 パン:面包 スペイン料理:西班牙料理 ' +
    '居酒屋:居酒屋 とんかつ:炸猪排 カレー:咖喱 ハンバーガー:汉堡 カフェ:咖啡馆 喫茶店:咖啡馆 うどん:乌冬面 ' +
    'そば:荞麦面 天ぷら:天妇罗 焼肉:烤肉 ケーキ:蛋糕 中華料理:中餐 イタリアン:意式料理 フレンチ:法式料理'
  )
    .split(' ')
    .map((pair) => pair.split(':') as [string, string]),
);

const YAKITORI = /^(?:焼鳥|焼き鳥|やきとり|yakitori)$/iu;
const YAKITORI_ADJACENT = /^(?:鳥料理|鶏料理|串焼|串焼き)$/u;

/** Up to `limit` distinct, specific labels; area names and yakitori synonyms are dropped. */
export function compactCategories(labels: readonly string[], area = '', limit = 2): string[] {
  const clean = labels.map((label) => label.normalize('NFC').trim()).filter(Boolean);
  const hasYakitori = clean.some((label) => YAKITORI.test(label));
  const seen = new Set<string>();
  return clean
    .filter((label) => {
      const key = YAKITORI.test(label) ? 'yakitori' : normalizeText(label);
      const isArea = key.length >= 2 && normalizeText(area).includes(key);
      if (isArea || seen.has(key) || (hasYakitori && YAKITORI_ADJACENT.test(label))) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function composeOverview(
  categories: readonly string[],
  dishes: readonly string[],
  area: string,
) {
  const cuisines = [
    ...new Set(
      compactCategories(categories, area).map((label) => CHINESE_NAMES.get(label) ?? label),
    ),
  ];
  const picked = dishes.filter((dish) => !categories.includes(dish)).slice(0, 3);
  return [
    cuisines.length ? `主营${cuisines.join('、')}。` : '',
    area ? `位于${area}。` : '',
    picked.length ? `招牌菜包括${picked.join('、')}。` : '',
  ].join('');
}
