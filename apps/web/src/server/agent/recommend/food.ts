// Food terms in Recommend. The model names foods in its own words; requests and saved
// restaurants are both reduced to the same keys, so a cuisine with no saved match finds nothing
// instead of being ignored.
import { classifyCuisines } from '../../../shared/cuisine.ts';
import { normalizeText } from '../../../shared/text.ts';

/** Dish-level terms the interpreter has always used. */
const CANONICAL: Readonly<Record<string, readonly string[]>> = {
  ramen: ['ramen', 'ラーメン', 'らーめん', '拉面', '拉麵'],
  sushi: ['sushi', '寿司', '壽司', 'すし'],
  curry: ['curry', 'カレー', '咖喱', '咖哩'],
  yakitori: ['yakitori', '焼き鳥', '焼鳥', 'やきとり', '烧鸟'],
  beef_tongue: ['beef_tongue', 'beef tongue', '牛タン', '牛たん', '牛舌'],
  coffee: ['coffee', 'コーヒー', '咖啡', 'cafe', 'café', 'カフェ', '喫茶店'],
};

/** National cuisines; a saved label containing one of these names belongs to the family. */
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  french: ['french', 'フレンチ', 'フランス料理', '法餐', '法国菜', '法國菜', '法式'],
  italian: ['italian', 'イタリアン', 'イタリア料理', '意大利菜', '義大利菜', '意式'],
  chinese: ['chinese', '中華', '中国料理', '中餐', '中国菜', '中國菜'],
  korean: ['korean', '韓国料理', '韩国料理', '韓國料理', '韩餐'],
  thai: ['thai', 'タイ料理', '泰国菜', '泰國菜'],
  indian: ['indian', 'インド料理', '印度菜'],
  american: ['american', 'アメリカ料理', '美式'],
  spanish: ['spanish', 'スペイン料理', 'スペインバル', '西班牙菜'],
};

const key = (value: string) => normalizeText(value).replaceAll('ー', '');
const matches = (aliases: readonly string[], value: string, contains: boolean) =>
  aliases.some((alias) => (contains ? key(value).includes(key(alias)) : key(value) === key(alias)));
const canonical = (value: string, contains = false) =>
  Object.keys(CANONICAL).filter((term) => matches(CANONICAL[term], value, contains));
const families = (value: string, contains = false) =>
  Object.keys(FAMILIES).filter((family) => matches(FAMILIES[family], value, contains));

/** The single key a requested food is matched by. */
export function foodKey(term: string): string {
  return canonical(term)[0] ?? classifyCuisines([term])[0] ?? families(term)[0] ?? key(term);
}

/** Every key a saved restaurant's labels (tags and cuisine labels) answer to. */
export function itemFoodKeys(labels: readonly string[]): string[] {
  return [
    ...new Set(
      labels.flatMap((label) => {
        const cuisines = classifyCuisines([label]);
        return [
          label,
          key(label),
          ...canonical(label, true),
          ...cuisines,
          ...cuisines.map((id) => id.split('.')[0]).filter((family) => family in FAMILIES),
          ...families(label, true),
        ];
      }),
    ),
  ];
}
