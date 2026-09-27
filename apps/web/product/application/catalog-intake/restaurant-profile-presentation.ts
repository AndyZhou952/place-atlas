/** Public-facing copy uses one prose language and keeps sourced names intact. */

function normalizedLabels(values: readonly string[]): string[] {
  return values.map((value) => value.normalize('NFC').trim()).filter(Boolean);
}

function categoryKey(value: string): string {
  const normalized = value.normalize('NFC').toLowerCase().replace(/\s/gu, '');
  if (
    /^(?:焼鳥|焼き鳥|やきとり|鳥料理|鶏料理|串焼|串焼き|yakitori)$/u.test(
      normalized,
    )
  ) {
    return 'yakitori';
  }
  return normalized;
}

export function compactRestaurantCategories(
  values: readonly string[],
  limit = 2,
): string[] {
  const seen = new Set<string>();
  return normalizedLabels(values).filter((value) => {
    const key = categoryKey(value);
    if (seen.has(key) || seen.size >= limit) return false;
    seen.add(key);
    return true;
  });
}

export function compactRestaurantTags(
  categories: readonly string[],
  dishes: readonly string[],
): string[] {
  const selectedCategories = compactRestaurantCategories(categories);
  const seen = new Set(selectedCategories.map(categoryKey));
  const selectedDishes: string[] = [];
  for (const dish of normalizedLabels(dishes)) {
    const key = categoryKey(dish);
    if (seen.has(key)) continue;
    seen.add(key);
    selectedDishes.push(dish);
    if (selectedDishes.length === 2) break;
  }
  return [...selectedCategories, ...selectedDishes];
}

export function composeRestaurantSummary(input: {
  readonly categories?: readonly string[];
  readonly dishes?: readonly string[];
  readonly area?: string;
}): string | undefined {
  const categories = compactRestaurantCategories(input.categories ?? []);
  const dishes = normalizedLabels(input.dishes ?? []).slice(0, 3);
  const area = input.area?.normalize('NFC').trim();
  const sentences = [
    categories.length ? `主营${categories.join('、')}。` : undefined,
    area ? `位于${area}。` : undefined,
    dishes.length ? `招牌菜包括${dishes.join('、')}。` : undefined,
  ].filter(Boolean);
  return sentences.length ? sentences.join('') : undefined;
}
