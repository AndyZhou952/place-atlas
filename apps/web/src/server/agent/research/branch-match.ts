// Is this page about the selected branch? Chains share names, and Google, Tabelog and official
// sites format the same Japanese address differently, so identity rests on the selected place's
// street numbers, postal code, town and map pin, never on a name alone or on what the Owner typed.
import { isTabelogRestaurantListing } from './instructions.ts';
import type { SearchEvidence } from './web-search.ts';

type Evidence = SearchEvidence;
type Point = { readonly latitude: number; readonly longitude: number };

/** Map pins of the selected place and of the source, when both are known. */
export interface IdentityPoints {
  readonly selected?: Point;
  readonly source?: Point;
}

/** Within 100 m, by an equirectangular approximation that is exact enough at this scale. */
function pinsAgree(points: IdentityPoints | undefined): boolean {
  const { selected, source } = points ?? {};
  if (!selected || !source) return false;
  const radians = Math.PI / 180;
  const x =
    (source.longitude - selected.longitude) *
    radians *
    Math.cos(((source.latitude + selected.latitude) / 2) * radians);
  const y = (source.latitude - selected.latitude) * radians;
  return Math.hypot(x, y) * 6_371_000 <= 100;
}

export function supported(value: unknown, sources: Evidence[]): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.quote === 'string' &&
    record.quote.length >= 4 &&
    sources.some(
      (source) => source.url === record.url && source.content.includes(record.quote as string),
    )
  );
}

export function supportedIdentity(
  proof: { url?: unknown } | undefined,
  identity: unknown,
  sources: Evidence[],
  subject: {
    transientName: string;
    transientAddress: string;
    ownerQuery: string;
  },
): boolean {
  if (!supported(identity, sources) || !identity || typeof identity !== 'object') return false;
  const record = identity as { url: string; quote: string };
  if (
    !matchesSelectedBranch(
      record.quote,
      subject.transientName,
      subject.transientAddress,
      subject.ownerQuery,
    )
  )
    return false;
  if (record.url === proof?.url) return true;
  if (typeof proof?.url !== 'string') return false;
  const factSource = sources.find((source) => source.url === proof.url);
  if (!factSource) return false;
  try {
    if (new URL(record.url).origin !== new URL(proof.url).origin) return false;
  } catch {
    return false;
  }
  // A cross-page identity is safe only when the fact page is explicitly named
  // for that branch. A generic menu/reservations page can contain other units.
  const selectedName = branchKey(subject.transientName);
  const beforeStreet = record.quote.split(/(?<!\d)\d{1,4}\s+[A-Za-z]/u)[0];
  const label = branchKey(beforeStreet ?? '');
  return (
    label.includes(selectedName) &&
    label.length >= selectedName.length + 4 &&
    branchKey(factSource.title).includes(label) &&
    branchKey(factSource.content).includes(label)
  );
}

function branchKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '');
}

export function canonicalListingUrl(value: string): string | undefined {
  if (!isTabelogRestaurantListing(value)) return undefined;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/^\/(?:en|tw|cn|kr)\//u, '/');
  url.search = '';
  url.hash = '';
  return url.href;
}

function normalizeJapaneseBlockNumerals(value: string): string {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  return value.replace(/([一二三四五六七八九十]+)丁目/gu, (whole, numeral: string) => {
    const ten = numeral.indexOf('十');
    const number =
      ten < 0
        ? digits[numeral]
        : (ten === 0 ? 1 : digits[numeral.slice(0, ten)]) * 10 +
          (ten === numeral.length - 1 ? 0 : digits[numeral.slice(ten + 1)]);
    return number && number <= 99 ? `${number}丁目` : whole;
  });
}

export function initialResearchQuery(subject: {
  readonly transientName: string;
  readonly transientAddress: string;
  readonly ownerQuery: string;
}): string {
  const name = subject.transientName.slice(0, 200).trim();
  const ownerHint = subject.ownerQuery.slice(0, 160).trim();
  const plainName = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  const comparableName = (value: string) => plainName(normalizeJapaneseBlockNumerals(value));
  const equivalentOwnerName =
    ownerHint &&
    plainName(name) !== plainName(ownerHint) &&
    comparableName(name) === comparableName(ownerHint);
  const addressHint = streetNumbers(subject.transientAddress)[0];
  // Only the selected place's own name and address: loose typed text can sink this search.
  const parts = [equivalentOwnerName ? ownerHint : name];
  if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name)) {
    const buildingSuffix = subject.transientAddress
      .normalize('NFKC')
      .match(/\d{1,4}[-‐‑‒–—−ー]\d{1,4}(?:[-‐‑‒–—−ー]\d{1,4})?\s+(.+)$/u)?.[1];
    const buildingHint = buildingSuffix
      ?.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{3,}/gu)
      ?.join(' ')
      .slice(0, 80);
    if (buildingHint && !parts.some((part) => part.includes(buildingHint)))
      parts.push(buildingHint);
  }
  if (addressHint && !parts.some((part) => part.includes(addressHint))) {
    parts.push(addressHint);
  }
  return `${parts.join(' ')} site:tabelog.com`;
}

/**
 * The selected name and its city or ward only. It survives what can sink the first query
 * (building names, block numbers); the selected branch still has to match. A romanized selected
 * name rarely finds a Japanese listing, so then the Owner's Japanese words are the fallback hint.
 */
export function simplerResearchQuery(subject: {
  readonly transientName: string;
  readonly transientAddress: string;
  readonly ownerQuery?: string;
}): string {
  const address = subject.transientAddress.normalize('NFKC');
  const area =
    address
      .replace(/^.*?(?:東京都|北海道|京都府|大阪府|[\p{Script=Han}]{2,3}県)/u, '')
      .match(
        /[\p{Script=Han}\p{Script=Katakana}ー]+?市(?:[\p{Script=Han}\p{Script=Katakana}ー]+?区)?|[\p{Script=Han}\p{Script=Katakana}ー]+?区/u,
      )?.[0] ?? address.match(/\b([A-Za-z]+)[\s-](?:City|Ward|ku)\b/u)?.[1];
  const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const ownerHint = subject.ownerQuery?.slice(0, 160).trim() ?? '';
  const name =
    !japanese.test(subject.transientName) && japanese.test(ownerHint)
      ? ownerHint
      : subject.transientName.slice(0, 200).trim();
  return `${[name, area].filter(Boolean).join(' ')} site:tabelog.com`;
}

export function isGoogleMapsRatingUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'maps.google.com' && url.pathname.startsWith('/maps')) ||
        ((url.hostname === 'google.com' || url.hostname === 'www.google.com') &&
          url.pathname.startsWith('/maps')))
    );
  } catch {
    return false;
  }
}

const japaneseLocalities: Record<string, string> = {
  // Google commonly renders Tokyo wards as English "City" while Japanese
  // listings use the Japanese ward suffix. These aliases only corroborate identity.
  adachi: '足立区',
  arakawa: '荒川区',
  bunkyo: '文京区',
  chiyoda: '千代田区',
  chuo: '中央区',
  edogawa: '江戸川区',
  itabashi: '板橋区',
  katsushika: '葛飾区',
  kita: '北区',
  koto: '江東区',
  meguro: '目黒区',
  minato: '港区',
  nakano: '中野区',
  nerima: '練馬区',
  ota: '大田区',
  setagaya: '世田谷区',
  shibuya: '渋谷区',
  shinagawa: '品川区',
  shinjuku: '新宿区',
  suginami: '杉並区',
  sumida: '墨田区',
  taito: '台東区',
  toshima: '豊島区',
  nishishinjuku: '西新宿',
  ikebukuro: '池袋',
  ginza: '銀座',
  azabujuban: '麻布十番',
};

/** A missing lot is not a conflicting lot. Require independent building anchors. */
function matchesOmittedBuildingLot(
  selectedAddress: string,
  sourceAddress: string,
  sourcePostalCode: string | undefined,
  selectedNumbers: string[],
  sourceNumbers: string[],
): boolean {
  if (
    selectedNumbers.length !== 1 ||
    sourceNumbers.length !== 1 ||
    selectedNumbers[0].split('-').length !== 3 ||
    sourceNumbers[0].split('-').length !== 2 ||
    selectedNumbers[0].split('-').slice(0, 2).join('-') !== sourceNumbers[0]
  )
    return false;
  const postalCode = selectedAddress
    .normalize('NFKC')
    .match(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/u)?.[0]
    ?.replace(/\D/gu, '');
  if (!postalCode || postalCode !== sourcePostalCode) return false;
  const city = selectedAddress
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/\b([a-z]+) city\b/u)?.[1];
  // The ward as Google writes it in Japanese (東京都中央区) or in English (Chuo City, Tokyo).
  const ward =
    selectedAddress.normalize('NFKC').match(/東京都(\p{Script=Han}+?区)/u)?.[1] ??
    (city && /\bTokyo\b/iu.test(selectedAddress) ? japaneseLocalities[city] : undefined);
  // Restrict the exception to a corroborated Tokyo ward, not numbers alone.
  if (!ward?.endsWith('区') || !sourceAddress.includes(`東京都${ward}`)) return false;
  // A Japanese provider address also names its town (銀座 in 銀座4丁目1-1): the listing's must be the
  // same town, not 西銀座 or another town sharing the postcode and building name.
  const town = (value: string) =>
    value
      .normalize('NFKC')
      .replace(/\s/gu, '')
      .match(new RegExp(`東京都${ward}([^\\d]*?)\\d`, 'u'))?.[1];
  const selectedTown = town(selectedAddress);
  if (/東京都/u.test(selectedAddress) && (!selectedTown || selectedTown !== town(sourceAddress)))
    return false;
  const building = (value: string) => {
    const address = value.normalize('NFKC').replace(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/gu, ' ');
    const suffix = address.match(
      /\d{1,4}(?:[-‐‑‒–—−ー]|ch[ōo]me|丁目)+\d{1,4}(?:[-‐‑‒–—−ー]+\d{1,4})?(?:[-‐‑‒–—−ー]*先)?\s+(.+)$/iu,
    )?.[1];
    if (!suffix) return undefined;
    const floor = suffix.match(/(?:地下\s*(\d+)\s*(?:F|階)|B\s*(\d+)\s*F?|(\d+)\s*(?:F|階))$/iu);
    if (!floor) return undefined;
    let label = suffix.slice(0, floor.index).trim().toLowerCase();
    if (label.replace(/\s/gu, '').length < 5) return undefined;
    // Normalize written number suffixes, not arbitrary brand transliteration.
    const writtenDigits: Record<string, string> = {
      ワン: '1',
      ツー: '2',
      スリー: '3',
      フォー: '4',
      ファイブ: '5',
      シックス: '6',
      セブン: '7',
      エイト: '8',
      ナイン: '9',
      テン: '10',
    };
    label = label.replace(
      /(?:ワン|ツー|スリー|フォー|ファイブ|シックス|セブン|エイト|ナイン|テン)$/u,
      (word) => writtenDigits[word],
    );
    for (const [latin, japanese] of Object.entries(japaneseLocalities))
      if (label.startsWith(latin)) {
        label = japanese + label.slice(latin.length);
        break;
      }
    return {
      label: label.replace(/[\p{P}\p{Z}\s]/gu, ''),
      floor: floor[1] || floor[2] ? `b${floor[1] ?? floor[2]}` : floor[3],
    };
  };
  const selected = building(selectedAddress);
  const source = building(sourceAddress);
  return Boolean(
    selected && source && selected.label === source.label && selected.floor === source.floor,
  );
}

function floorNumber(value: string): number | undefined {
  const floor = value
    .normalize('NFKC')
    .toLowerCase()
    .match(/(?:地下\s*(\d+)\s*(?:f|階)|\bb\s*(\d+)\s*f?\b|(?<!\d)(\d+)\s*(?:f\b|階))/u);
  return floor
    ? floor[1] || floor[2]
      ? -Number(floor[1] || floor[2])
      : Number(floor[3])
    : undefined;
}

/** Floor numbers are building metadata, never another component of the street lot. */
function streetNumbers(value: string): string[] {
  return (
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/gu, ' ')
      .replace(/(?:地下\s*\d+\s*階|\b(?:b\s*)?\d+\s*f\b|\d+\s*階)/gu, ' ')
      .replace(/ch[ōo]me|丁目|番地|番|号/gu, '-')
      .replace(/[\s‐‑‒–—−ー]/gu, '-')
      .replace(/-+/gu, '-')
      .match(/\d{1,4}-\d{1,4}(?:-\d{1,4})?/gu) ?? []
  );
}

/**
 * The whole locality before the lot (city, ward and town) in Japanese script, without the
 * prefecture: 西合成町 is another town than 合成町, not a spelling of it.
 */
function japaneseLocality(value: string): string {
  const local = value
    .normalize('NFKC')
    .replace(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/gu, ' ')
    .replace(/^.*?(?:東京都|北海道|京都府|大阪府|[\p{Script=Han}]{2,3}県)/u, '')
    .replace(/\s/gu, '');
  return (local.slice(0, local.search(/\d/u)).match(/[\p{L}ー]+$/u)?.[0] ?? '')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '');
}

/**
 * Outside central Tokyo a branch is often a short Japanese name at a single lot number (no
 * hyphenated block), and Google and Tabelog can file it under neighbouring postcodes. Such a
 * listing is the selected branch only when every independent anchor agrees: the listing's exact
 * name is the provider name or a whole word the Owner typed, the single lot is the same, the
 * postcodes share their area prefix, no floor differs, and the provider's Japanese locality (city,
 * ward and town) is the listing's, or the listing adds a district before that town and both map pins
 * agree. A romanized provider address cannot be read against Japanese town names, and a prefecture
 * or postal area is no substitute, so it stays unknown.
 */
function matchesSingleLotBranch(
  name: string,
  address: string,
  ownerQuery: string,
  sourceAddress: string,
  sourcePostalCode: string | undefined,
  sourceName: string,
  points: IdentityPoints | undefined,
): boolean {
  const key = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  const listed = key(sourceName);
  const ownerWords = ownerQuery.split(/\s+/u).map(key);
  if (
    listed.length < 2 ||
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(listed) ||
    (key(name) !== listed && !ownerWords.includes(listed))
  )
    return false;
  const postalCode = (value: string) =>
    value
      .normalize('NFKC')
      .match(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/u)?.[0]
      ?.replace(/\D/gu, '');
  const selectedPostalCode = postalCode(address);
  const sourceCode = sourcePostalCode ?? postalCode(sourceAddress);
  if (selectedPostalCode && sourceCode && selectedPostalCode.slice(0, 3) !== sourceCode.slice(0, 3))
    return false;
  // A floor only one side states is not a conflict; two different floors are.
  const selectedFloor = floorNumber(address);
  const sourceFloor = floorNumber(sourceAddress);
  if (selectedFloor !== undefined && sourceFloor !== undefined && selectedFloor !== sourceFloor)
    return false;
  const lots = (value: string) =>
    value
      .normalize('NFKC')
      .replace(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/gu, ' ')
      .replace(/(?:地下\s*\d+\s*階|\b(?:b\s*)?\d+\s*f\b|\d+\s*階)/giu, ' ')
      .match(/\d+/gu) ?? [];
  const selectedLots = lots(address);
  const sourceLots = lots(sourceAddress);
  if (selectedLots.length !== 1 || sourceLots.length !== 1 || selectedLots[0] !== sourceLots[0])
    return false;
  const selected = japaneseLocality(address);
  const source = japaneseLocality(sourceAddress);
  const municipality = selected.match(/^.*[市区郡]/u)?.[0] ?? '';
  const town = selected.slice(municipality.length);
  if (
    !municipality ||
    town.length < 2 ||
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(town)
  )
    return false;
  if (selected === source) return true;
  // A listing can put a district before the same town (…区<district><town>). A one-character prefix
  // names another town (西合成町); a longer district still needs both map pins within 100 m.
  return (
    source.length >= selected.length + 2 &&
    source.startsWith(municipality) &&
    source.endsWith(town) &&
    pinsAgree(points)
  );
}

/**
 * Is the listed name the selected name with or without a branch word (`same`), in another script
 * so the two cannot be compared (`unknown`, a romanized Google name beside a Japanese listing), or
 * another shop's name (`different`)?
 */
function nameAffinity(selected: string, listed: string): 'same' | 'unknown' | 'different' {
  const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const forms = (value: string) => {
    const words = value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
      .split(/[\p{P}\p{Z}\s]+/u)
      .filter(Boolean);
    // 恵比寿店 or 本店 as the last word names the branch, not the shop.
    const shop = words.length > 1 && words.at(-1)?.endsWith('店') ? words.slice(0, -1) : words;
    return [words.join(''), shop.join('')];
  };
  const contains = (longer: string, shorter: string) =>
    shorter.length >= (japanese.test(shorter) || longer === shorter ? 2 : 4) &&
    longer.includes(shorter);
  const left = forms(selected);
  const right = forms(listed);
  if (left.some((a) => right.some((b) => contains(a, b) || contains(b, a)))) return 'same';
  return japanese.test(left[1]) === japanese.test(right[1]) ? 'different' : 'unknown';
}

/**
 * The selected place is anchored on Google's Japanese address and map pin. A listing in the same
 * town at the same block number, with the same postcode or a pin within 100 m, is that place even
 * when the names differ by a branch word, and whatever the Owner typed. A block, building or floor
 * can hold several shops, so the address alone never decides: a listed name in the same script that
 * is not part of the selected name (or the reverse) is another shop. A name in another script cannot
 * be compared and needs every anchor: a three-part block number, the postcode and the pin.
 */
function matchesAnchoredAddress(
  name: string,
  address: string,
  sourceAddress: string,
  sourcePostalCode: string | undefined,
  sourceName: string,
  points: IdentityPoints | undefined,
): boolean {
  const selectedAddress = normalizeJapaneseBlockNumerals(address);
  const listedAddress = normalizeJapaneseBlockNumerals(sourceAddress);
  const selectedFloor = floorNumber(selectedAddress);
  const sourceFloor = floorNumber(listedAddress);
  if (selectedFloor !== undefined && sourceFloor !== undefined && selectedFloor !== sourceFloor)
    return false;
  const sourceNumbers = streetNumbers(listedAddress);
  const blocks = streetNumbers(selectedAddress).filter((numbers) =>
    sourceNumbers.includes(numbers),
  );
  const town = japaneseLocality(selectedAddress);
  if (!blocks.length || !/[市区郡]./u.test(town) || town !== japaneseLocality(listedAddress))
    return false;
  const postalCode = (value: string) =>
    value
      .normalize('NFKC')
      .match(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/u)?.[0]
      ?.replace(/\D/gu, '');
  const selectedPostalCode = postalCode(selectedAddress);
  const samePostalCode = Boolean(
    selectedPostalCode && selectedPostalCode === (sourcePostalCode ?? postalCode(listedAddress)),
  );
  // A two-part number names a whole block, not a lot: it needs the postcode too.
  const threePart = blocks.some((numbers) => numbers.split('-').length === 3);
  if (!threePart && !samePostalCode) return false;
  const names = nameAffinity(name, sourceName);
  if (names === 'same') return samePostalCode || pinsAgree(points);
  return names === 'unknown' && threePart && samePostalCode && pinsAgree(points);
}

export function matchesSelectedBranch(
  quote: string,
  name: string,
  address: string,
  ownerQuery: string,
  sourceAddress?: string,
  sourcePostalCode?: string,
  sourceName?: string,
  points?: IdentityPoints,
): boolean {
  const normalize = (value: string) =>
    normalizeJapaneseBlockNumerals(value)
      .normalize('NFKC')
      .toLowerCase()
      // Normalize equivalent kana spellings across sources. Whole-name and
      // address checks below still establish the selected branch identity.
      .replace(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
      // Dictation can expand small ゥ to ウ (including half-width ｳ).
      // Fold this spelling while retaining all other letters and branch checks.
      .replace(/ぅ/gu, 'う')
      .replace(/\brd\b/gu, 'road')
      .replace(/\bst\b/gu, 'street')
      .replace(/\bave\b/gu, 'avenue')
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  if (
    sourceAddress &&
    sourceName &&
    matchesSingleLotBranch(
      name,
      address,
      ownerQuery,
      sourceAddress,
      sourcePostalCode,
      sourceName,
      points,
    )
  )
    return true;
  if (
    sourceAddress &&
    sourceName &&
    matchesAnchoredAddress(name, address, sourceAddress, sourcePostalCode, sourceName, points)
  )
    return true;
  const text = normalize(quote);
  const selectedName = normalize(name);
  const selectedAddress = normalize(address);
  const addressText = sourceAddress ? normalize(sourceAddress) : text;
  const aliases = ownerQuery
    .split(/\s+/u)
    .map(normalize)
    // A neighborhood in the query is location context, not proof that a
    // different business with that neighborhood in its name is the match.
    .filter((alias) => !sourceAddress || !addressText.includes(alias));
  const selectedOwnerName = normalize(ownerQuery);
  const listedName = sourceName ? normalize(sourceName) : '';
  const nameMatches =
    (selectedName.length >= 2 && text.includes(selectedName)) ||
    // A selected Google name can be romanized while the exact Japanese shop
    // name was supplied by the owner. Require the full listed name at the
    // start of that query; two-character fragments alone remain insufficient.
    (listedName.length >= 4 &&
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(listedName) &&
      (selectedOwnerName.startsWith(listedName) ||
        // The owner may omit a branch suffix while still supplying a
        // distinctive name and area. Street and postcode must agree.
        (selectedOwnerName.length >= 5 && listedName.startsWith(selectedOwnerName)))) ||
    aliases.some(
      (alias) =>
        ((alias.length >= 4 && /^[a-z]+$/u.test(alias)) ||
          (!sourceName &&
            alias.length >= 3 &&
            /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(alias))) &&
        !/\d/u.test(alias) &&
        text.includes(alias),
    ) ||
    (aliases.length > 0 &&
      aliases.every(
        (alias) =>
          alias.length >= 3 &&
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(alias) &&
          !/\d/u.test(alias) &&
          text.includes(alias),
      ));
  if (!nameMatches) return false;
  if (selectedAddress.length >= 8 && addressText.includes(selectedAddress)) return true;
  // Street/block numbers survive Japanese/English address formatting, unlike city names.
  // A name match alone is insufficient for chains; ambiguous address evidence stays unknown.
  const selectedFloor = floorNumber(address);
  const sourceFloor = sourceAddress ? floorNumber(sourceAddress) : undefined;
  if (selectedFloor !== undefined && sourceFloor !== undefined && selectedFloor !== sourceFloor)
    return false;
  const selectedNumbers = streetNumbers(address);
  const sourceNumbers = streetNumbers(sourceAddress ?? quote);
  const matchingNumbers = selectedNumbers.filter((numbers) => sourceNumbers.includes(numbers));
  if (!matchingNumbers.length)
    return Boolean(
      sourceAddress &&
      listedName.length >= 5 &&
      (selectedName === listedName || selectedOwnerName === listedName) &&
      matchesOmittedBuildingLot(
        address,
        sourceAddress,
        sourcePostalCode,
        selectedNumbers,
        sourceNumbers,
      ),
    );
  const selectedPostalCode = address
    .normalize('NFKC')
    .match(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/u)?.[0]
    ?.replace(/\D/gu, '');
  // A two-part number is common in central Tokyo but less distinctive than a
  // three-part Japanese block address. Require the exact postal code too.
  if (
    matchingNumbers.every((numbers) => numbers.split('-').length === 2) &&
    (!selectedPostalCode || selectedPostalCode !== sourcePostalCode)
  )
    return false;
  if (selectedPostalCode && sourcePostalCode) {
    if (selectedPostalCode === sourcePostalCode) return true;
    // Google can report a building's dedicated postal code while a listing
    // uses the neighborhood code. Only override the mismatch when the same
    // street number, brand, and distinctive Japanese building name agree. The building name
    // follows the street number; the prefecture, ward and town before it are not one.
    const selectedBuildingNames =
      address
        .normalize('NFKC')
        .replace(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/gu, ' ')
        .replace(/^\D*/u, '')
        .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{6,}/gu) ?? [];
    if (
      !selectedBuildingNames.some((name) =>
        addressText.includes(normalize(name.replace(/[内階]+$/gu, ''))),
      )
    )
      return false;
  }
  // Common bilingual ward/neighborhood aliases are corroboration, never identity
  // by themselves. Unmapped addresses stay unknown rather than matching numbers alone.
  const latinAddress = address
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/gu, '');
  const selectedCity = address
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/\b([a-z]+) city\b/u)?.[1];
  if (
    selectedCity &&
    japaneseLocalities[selectedCity] &&
    !addressText.includes(normalize(japaneseLocalities[selectedCity])) &&
    !addressText.includes(`${selectedCity}ku`) &&
    !addressText.includes(`${selectedCity}city`)
  )
    return false;
  const ownerLocality = ownerQuery
    .split(/\s+/u)
    .map(normalize)
    .filter(
      (token) =>
        token.length >= 2 &&
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token) &&
        !selectedName.includes(token) &&
        addressText.includes(token),
    );
  if (ownerLocality.length) return true;
  const locality = address.normalize('NFKC').match(/[\p{Script=Han}ぁ-んァ-ヶ]+[区市郡]/gu) ?? [];
  if (locality.length)
    return locality.some((part) =>
      addressText.includes(
        normalize(part.replace(/^(?:東京都|北海道|京都府|大阪府|.{2,3}県)/u, '')),
      ),
    );
  return Object.entries(japaneseLocalities).some(
    ([latin, japanese]) =>
      latinAddress.includes(latin) &&
      (addressText.includes(normalize(japanese)) || addressText.includes(latin)),
  );
}

export function numericToken(quote: string, score: number): boolean {
  return (quote.match(/\d+(?:\.\d+)?/gu) ?? []).some((value) => Number(value) === score);
}

export function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}
export function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
