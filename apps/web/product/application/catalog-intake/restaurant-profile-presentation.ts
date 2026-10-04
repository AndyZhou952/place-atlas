/** Public-facing copy uses one prose language and keeps sourced names intact. */

function normalizedLabels(values: readonly string[]): string[] {
  return values.map((value) => value.normalize('NFC').trim()).filter(Boolean);
}

function categoryKey(value: string): string {
  const normalized = value.normalize('NFC').toLowerCase().replace(/\s/gu, '');
  if (/^(?:焼鳥|焼き鳥|やきとり|yakitori)$/u.test(normalized))
    return 'yakitori';
  if (/^(?:鳥料理|鶏料理)$/u.test(normalized)) return 'chicken-cuisine';
  if (/^(?:串焼|串焼き)$/u.test(normalized)) return 'skewers';
  return normalized;
}

function isAreaLabel(value: string, area?: string): boolean {
  const label = value.normalize('NFC').toLowerCase().replace(/\s/gu, '');
  const locality = area?.normalize('NFC').toLowerCase().replace(/\s/gu, '');
  return Boolean(locality && label.length >= 2 && locality.includes(label));
}

const chineseCuisineNames: Readonly<Record<string, string>> = {
  yakitori: '烧鸟',
  'chicken-cuisine': '鸡肉料理',
  skewers: '串烧',
  和食: '日式料理',
  豚串: '猪肉串',
  ラーメン: '拉面',
  餃子: '饺子',
  寿司: '寿司',
  洋食: '西式料理',
  海鮮: '海鲜',
  バー: '酒吧',
  パン: '面包',
  スペイン料理: '西班牙料理',
  現代スペイン料理: '现代西班牙料理',
  汁なし担々麺: '无汤担担面',
  居酒屋: '居酒屋',
  とんかつ: '炸猪排',
  カレー: '咖喱',
  ハンバーガー: '汉堡',
  hamburgers: '汉堡',
  hamburger: '汉堡',
  burgers: '汉堡',
  american: '美式料理',
  americancuisine: '美式料理',
  'fast food': '快餐',
  modernbarbecue: '现代烧烤',
  australianbarbecue: '澳式烧烤',
  modernaustralianbarbecue: '澳式烧烤',
  barbecue: '烧烤',
  bar: '酒吧',
  italian: '意式料理',
  french: '法式料理',
  chinese: '中式料理',
  korean: '韩式料理',
  ramen: '拉面',
  sushi: '寿司',
  curry: '咖喱',
  udon: '乌冬面',
  カフェ: '咖啡馆',
  喫茶店: '咖啡馆',
  cafe: '咖啡馆',
  café: '咖啡馆',
  coffee: '咖啡馆',
  coffeeshop: '咖啡馆',
  specialtycoffee: '精品咖啡',
  汉堡: '汉堡',
  美式快餐: '美式快餐',
};

function summaryCuisine(value: string): string {
  const key = categoryKey(value);
  return Object.hasOwn(chineseCuisineNames, key)
    ? chineseCuisineNames[key]
    : value;
}

export function compactRestaurantCategories(
  values: readonly string[],
  limit = 2,
  area?: string,
): string[] {
  const labels = normalizedLabels(values).filter(
    (value) => !isAreaLabel(value, area),
  );
  const hasYakitori = labels.some((value) => categoryKey(value) === 'yakitori');
  const barbecuePriority: Readonly<Record<string, number>> = {
    barbecue: 0,
    modernbarbecue: 1,
    australianbarbecue: 2,
    modernaustralianbarbecue: 3,
  };
  const bestBarbecue = labels
    .map(categoryKey)
    .filter((key) => Object.hasOwn(barbecuePriority, key))
    .sort((left, right) => barbecuePriority[right] - barbecuePriority[left])[0];
  const seen = new Set<string>();
  return labels.filter((value) => {
    const key = categoryKey(value);
    // Bird cuisine and generic skewers can describe a yakitori shop, but they
    // remain distinct categories when no explicit yakitori label is present.
    if (hasYakitori && (key === 'chicken-cuisine' || key === 'skewers'))
      return false;
    if (
      bestBarbecue &&
      Object.hasOwn(barbecuePriority, key) &&
      key !== bestBarbecue
    )
      return false;
    if (seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  });
}

function compactRestaurantDishes(
  categories: readonly string[],
  dishes: readonly string[],
  limit: number,
  area?: string,
): string[] {
  const categoryKeys = new Set(categories.map(categoryKey));
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const dish of normalizedLabels(dishes)) {
    if (isAreaLabel(dish, area)) continue;
    const key = categoryKey(dish);
    if (categoryKeys.has(key) || seen.has(key)) continue;
    if (
      categoryKeys.has('yakitori') &&
      (key === 'chicken-cuisine' || key === 'skewers')
    )
      continue;
    seen.add(key);
    selected.push(dish);
    if (selected.length === limit) break;
  }
  return selected;
}

export function compactRestaurantTags(
  categories: readonly string[],
  dishes: readonly string[],
  area?: string,
): string[] {
  const selectedCategories = compactRestaurantCategories(categories, 2, area);
  return [
    ...selectedCategories,
    ...compactRestaurantDishes(selectedCategories, dishes, 2, area),
  ];
}

export function composeRestaurantSummary(input: {
  readonly categories?: readonly string[];
  readonly dishes?: readonly string[];
  readonly area?: string;
}): string | undefined {
  const categories = compactRestaurantCategories(
    input.categories ?? [],
    2,
    input.area,
  );
  const cuisines = [...new Set(categories.map(summaryCuisine))];
  const dishes = compactRestaurantDishes(
    categories,
    input.dishes ?? [],
    3,
    input.area,
  );
  const area = input.area?.normalize('NFC').trim();
  const sentences = [
    cuisines.length ? `主营${cuisines.join('、')}。` : undefined,
    area ? `位于${area}。` : undefined,
    dishes.length ? `招牌菜包括${dishes.join('、')}。` : undefined,
  ].filter(Boolean);
  return sentences.length ? sentences.join('') : undefined;
}
