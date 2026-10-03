import type { AtlasCatalogEntry } from './atlas-item.ts';
import type { RestaurantClassification } from './restaurant-classification-types.ts';
export type { RestaurantClassification } from './restaurant-classification-types.ts';
import { normalizeSearchText as normalize } from '../decision/search-policy.ts';

export interface CuisineFamily {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly categories: readonly {
    readonly id: string;
    readonly label: string;
    readonly aliases: readonly string[];
  }[];
}

// Labels are a small, stable browsing taxonomy informed by restaurant genre lists.
// Cross-country dishes stay separate until a cuisine is explicitly recorded.
export const CUISINE_TAXONOMY: readonly CuisineFamily[] = [
  {
    id: 'chinese',
    label: 'Chinese',
    aliases: ['中華料理', '中国料理', '中国菜', 'chinese'],
    categories: [
      {
        id: 'chinese.dim-sum',
        label: 'Dim sum',
        aliases: ['点心', '飲茶', 'dim sum'],
      },
      {
        id: 'chinese.beijing',
        label: 'Beijing cuisine',
        aliases: ['北京料理', '北京菜', 'peking cuisine', 'beijing cuisine'],
      },
      {
        id: 'chinese.shanghai',
        label: 'Shanghainese',
        aliases: ['上海料理', '本帮菜', '本幫菜', 'shanghainese'],
      },
      {
        id: 'chinese.sichuan',
        label: 'Sichuan cuisine',
        aliases: ['四川料理', '川菜', '四川菜', 'sichuan'],
      },
      {
        id: 'chinese.cantonese',
        label: 'Cantonese',
        aliases: ['広東料理', '粤菜', '粵菜', 'cantonese'],
      },
      {
        id: 'chinese.hunan',
        label: 'Hunan cuisine',
        aliases: ['湖南料理', '湘菜', 'hunan'],
      },
      {
        id: 'chinese.dumplings',
        label: 'Dumplings',
        aliases: ['餃子', '饺子', '餃子専門店', 'dumplings'],
      },
    ],
  },
  {
    id: 'japanese',
    label: 'Japanese',
    aliases: ['和食', '日本料理', '日本菜', 'japanese'],
    categories: [
      {
        id: 'japanese.ramen',
        label: 'Ramen / tsukemen',
        aliases: [
          'ラーメン',
          'らーめん',
          'らぁ麺',
          'つけ麺',
          'ramen',
          'tsukemen',
          '拉面',
          '拉麵',
        ],
      },
      {
        id: 'japanese.sushi',
        label: 'Sushi',
        aliases: ['寿司', '鮨', 'すし', '回転寿司', 'sushi'],
      },
      {
        id: 'japanese.udon',
        label: 'Udon',
        aliases: ['うどん', 'udon', '乌冬', '烏冬'],
      },
      {
        id: 'japanese.soba',
        label: 'Soba',
        aliases: ['そば', '蕎麦', 'soba'],
      },
      {
        id: 'japanese.yakitori',
        label: 'Yakitori',
        aliases: [
          '焼き鳥',
          '焼鳥',
          '鳥料理',
          '串焼き',
          'yakitori',
          '烧鸟',
          '燒鳥',
        ],
      },
      {
        id: 'japanese.tonkatsu',
        label: 'Tonkatsu',
        aliases: ['とんかつ', '豚カツ', 'tonkatsu', '炸猪排'],
      },
      {
        id: 'japanese.tempura',
        label: 'Tempura / tendon',
        aliases: ['天ぷら', '天婦羅', '天丼', 'tempura'],
      },
      {
        id: 'japanese.unagi',
        label: 'Unagi',
        aliases: ['うなぎ', '鰻', 'unagi'],
      },
      {
        id: 'japanese.shabu-sukiyaki',
        label: 'Shabu-shabu / sukiyaki',
        aliases: ['しゃぶしゃぶ', 'すき焼き', 'shabu shabu', 'sukiyaki'],
      },
      {
        id: 'japanese.izakaya',
        label: 'Izakaya',
        aliases: ['居酒屋', 'izakaya'],
      },
      {
        id: 'japanese.japanese-curry',
        label: 'Japanese curry',
        aliases: ['日本式カレー', '欧風カレー', '日式咖喱', 'japanese curry'],
      },
      {
        id: 'japanese.yoshoku',
        label: 'Yoshoku',
        aliases: ['洋食', 'yoshoku'],
      },
    ],
  },
  {
    id: 'thai',
    label: 'Thai',
    aliases: ['タイ料理', '泰国菜', '泰國菜', 'thai'],
    categories: [
      {
        id: 'thai.thai-curry',
        label: 'Thai curry',
        aliases: ['タイカレー', 'thai curry'],
      },
      {
        id: 'thai.thai-noodles',
        label: 'Thai noodles',
        aliases: ['タイラーメン', 'pad thai', '泰式炒河粉'],
      },
    ],
  },
  {
    id: 'american',
    label: 'American',
    aliases: ['アメリカ料理', '美国菜', '美國菜', 'american'],
    categories: [
      {
        id: 'american.steak',
        label: 'American steak',
        aliases: ['アメリカンステーキ', 'american steak', '美式牛排'],
      },
      {
        id: 'american.barbecue',
        label: 'American barbecue',
        aliases: ['american barbecue', '美式烧烤'],
      },
    ],
  },
  {
    id: 'italian',
    label: 'Italian',
    aliases: ['イタリアン', 'イタリア料理', 'italian', '意大利菜'],
    categories: [
      {
        id: 'italian.pasta',
        label: 'Pasta',
        aliases: ['パスタ', 'pasta', '意大利面', '義大利麵'],
      },
      {
        id: 'italian.pizza',
        label: 'Pizza',
        aliases: ['ピザ', 'pizza', '披萨', '披薩'],
      },
    ],
  },
  {
    id: 'french',
    label: 'French',
    aliases: ['フレンチ', 'フランス料理', 'french', '法国菜', '法國菜'],
    categories: [
      {
        id: 'french.bistro',
        label: 'Bistro',
        aliases: ['フレンチビストロ', 'french bistro', '法式小馆'],
      },
    ],
  },
  {
    id: 'indian',
    label: 'Indian',
    aliases: ['インド料理', 'indian', '印度菜'],
    categories: [
      {
        id: 'indian.indian-curry',
        label: 'Indian curry',
        aliases: ['インドカレー', 'indian curry', '印度咖喱'],
      },
    ],
  },
  {
    id: 'korean',
    label: 'Korean',
    aliases: ['韓国料理', 'korean', '韩国菜', '韓國菜'],
    categories: [
      {
        id: 'korean.korean-barbecue',
        label: 'Korean barbecue',
        aliases: ['韓国焼肉', 'korean barbecue', '韩式烤肉'],
      },
      {
        id: 'korean.bibimbap',
        label: 'Bibimbap',
        aliases: ['ビビンバ', 'bibimbap', '韩式拌饭'],
      },
    ],
  },
  {
    id: 'international',
    label: 'International',
    aliases: ['international', 'fusion cuisine'],
    categories: [
      {
        id: 'international.burger',
        label: 'Burgers',
        aliases: ['ハンバーガー', 'hamburger', 'burger', '汉堡', '漢堡'],
      },
      {
        id: 'international.steak',
        label: 'Steak',
        aliases: ['ステーキ', 'steak', '牛排'],
      },
      {
        id: 'international.beef',
        label: 'Beef / beef tongue',
        aliases: ['牛料理', '牛タン', '牛たん', 'beef tongue', '牛舌'],
      },
      {
        id: 'international.grill',
        label: 'Yakiniku / offal',
        aliases: ['焼肉', 'ホルモン', 'grill'],
      },
      {
        id: 'international.seafood',
        label: 'Seafood',
        aliases: ['海鮮', '魚料理', '海鮮・魚介', 'seafood', '海鲜'],
      },
      {
        id: 'international.curry',
        label: 'Curry',
        aliases: ['カレー', 'スパイスカレー', 'curry', '咖喱'],
      },
      {
        id: 'international.creative',
        label: 'Creative cuisine',
        aliases: ['創作料理', 'fusion', '创作料理'],
      },
    ],
  },
  {
    id: 'cafe-dessert',
    label: 'Cafe / dessert',
    aliases: ['cafe & dessert', '咖啡甜品'],
    categories: [
      {
        id: 'cafe-dessert.cafe',
        label: 'Cafe / kissaten',
        aliases: [
          'カフェ',
          '喫茶店',
          'コーヒー',
          '珈琲',
          'スペシャルティコーヒー',
          'cafe',
          'coffee',
          'coffee shop',
          '咖啡馆',
        ],
      },
      {
        id: 'cafe-dessert.dessert',
        label: 'Dessert / cake',
        aliases: ['ケーキ', 'スイーツ', 'cake', 'dessert', '甜品'],
      },
      {
        id: 'cafe-dessert.bakery',
        label: 'Bakery / sandwiches',
        aliases: ['パン', 'サンドイッチ', 'bakery', 'sandwich', '面包'],
      },
    ],
  },
];
// ISO 3166-2 identifiers; matching requires an explicit administrative name in the address.
const SUBDIVISIONS: readonly {
  code: string;
  name: string;
  aliases: readonly string[];
}[] = [
  { code: 'JP-01', name: '北海道', aliases: ['北海道', 'Hokkaido'] },
  { code: 'JP-02', name: '青森県', aliases: ['青森県', 'Aomori'] },
  { code: 'JP-03', name: '岩手県', aliases: ['岩手県', 'Iwate'] },
  { code: 'JP-04', name: '宮城県', aliases: ['宮城県', 'Miyagi'] },
  { code: 'JP-05', name: '秋田県', aliases: ['秋田県', 'Akita'] },
  { code: 'JP-06', name: '山形県', aliases: ['山形県', 'Yamagata'] },
  { code: 'JP-07', name: '福島県', aliases: ['福島県', 'Fukushima'] },
  { code: 'JP-08', name: '茨城県', aliases: ['茨城県', 'Ibaraki'] },
  { code: 'JP-09', name: '栃木県', aliases: ['栃木県', 'Tochigi'] },
  { code: 'JP-10', name: '群馬県', aliases: ['群馬県', 'Gunma'] },
  { code: 'JP-11', name: '埼玉県', aliases: ['埼玉県', 'Saitama'] },
  { code: 'JP-12', name: '千葉県', aliases: ['千葉県', 'Chiba'] },
  { code: 'JP-13', name: '東京都', aliases: ['東京都', 'Tokyo'] },
  { code: 'JP-14', name: '神奈川県', aliases: ['神奈川県', 'Kanagawa'] },
  { code: 'JP-15', name: '新潟県', aliases: ['新潟県', 'Niigata'] },
  { code: 'JP-16', name: '富山県', aliases: ['富山県', 'Toyama'] },
  { code: 'JP-17', name: '石川県', aliases: ['石川県', 'Ishikawa'] },
  { code: 'JP-18', name: '福井県', aliases: ['福井県', 'Fukui'] },
  { code: 'JP-19', name: '山梨県', aliases: ['山梨県', 'Yamanashi'] },
  { code: 'JP-20', name: '長野県', aliases: ['長野県', 'Nagano'] },
  { code: 'JP-21', name: '岐阜県', aliases: ['岐阜県', 'Gifu'] },
  { code: 'JP-22', name: '静岡県', aliases: ['静岡県', 'Shizuoka'] },
  { code: 'JP-23', name: '愛知県', aliases: ['愛知県', 'Aichi'] },
  { code: 'JP-24', name: '三重県', aliases: ['三重県', 'Mie'] },
  { code: 'JP-25', name: '滋賀県', aliases: ['滋賀県', 'Shiga'] },
  { code: 'JP-26', name: '京都府', aliases: ['京都府', 'Kyoto'] },
  { code: 'JP-27', name: '大阪府', aliases: ['大阪府', 'Osaka'] },
  { code: 'JP-28', name: '兵庫県', aliases: ['兵庫県', 'Hyogo'] },
  { code: 'JP-29', name: '奈良県', aliases: ['奈良県', 'Nara'] },
  { code: 'JP-30', name: '和歌山県', aliases: ['和歌山県', 'Wakayama'] },
  { code: 'JP-31', name: '鳥取県', aliases: ['鳥取県', 'Tottori'] },
  { code: 'JP-32', name: '島根県', aliases: ['島根県', 'Shimane'] },
  { code: 'JP-33', name: '岡山県', aliases: ['岡山県', 'Okayama'] },
  { code: 'JP-34', name: '広島県', aliases: ['広島県', 'Hiroshima'] },
  { code: 'JP-35', name: '山口県', aliases: ['山口県', 'Yamaguchi'] },
  { code: 'JP-36', name: '徳島県', aliases: ['徳島県', 'Tokushima'] },
  { code: 'JP-37', name: '香川県', aliases: ['香川県', 'Kagawa'] },
  { code: 'JP-38', name: '愛媛県', aliases: ['愛媛県', 'Ehime'] },
  { code: 'JP-39', name: '高知県', aliases: ['高知県', 'Kochi'] },
  { code: 'JP-40', name: '福岡県', aliases: ['福岡県', 'Fukuoka'] },
  { code: 'JP-41', name: '佐賀県', aliases: ['佐賀県', 'Saga'] },
  { code: 'JP-42', name: '長崎県', aliases: ['長崎県', 'Nagasaki'] },
  { code: 'JP-43', name: '熊本県', aliases: ['熊本県', 'Kumamoto'] },
  { code: 'JP-44', name: '大分県', aliases: ['大分県', 'Oita'] },
  { code: 'JP-45', name: '宮崎県', aliases: ['宮崎県', 'Miyazaki'] },
  { code: 'JP-46', name: '鹿児島県', aliases: ['鹿児島県', 'Kagoshima'] },
  { code: 'JP-47', name: '沖縄県', aliases: ['沖縄県', 'Okinawa'] },
  { code: 'CN-AH', name: '安徽省', aliases: ['安徽省', 'Anhui'] },
  { code: 'CN-BJ', name: '北京市', aliases: ['北京市', 'Beijing'] },
  { code: 'CN-CQ', name: '重庆市', aliases: ['重庆市', 'Chongqing'] },
  { code: 'CN-FJ', name: '福建省', aliases: ['福建省', 'Fujian'] },
  { code: 'CN-GD', name: '广东省', aliases: ['广东省', 'Guangdong'] },
  { code: 'CN-GS', name: '甘肃省', aliases: ['甘肃省', 'Gansu'] },
  {
    code: 'CN-GX',
    name: '广西壮族自治区',
    aliases: ['广西壮族自治区', 'Guangxi'],
  },
  { code: 'CN-GZ', name: '贵州省', aliases: ['贵州省', 'Guizhou'] },
  { code: 'CN-HA', name: '河南省', aliases: ['河南省', 'Henan'] },
  { code: 'CN-HB', name: '湖北省', aliases: ['湖北省', 'Hubei'] },
  { code: 'CN-HE', name: '河北省', aliases: ['河北省', 'Hebei'] },
  { code: 'CN-HI', name: '海南省', aliases: ['海南省', 'Hainan'] },
  { code: 'CN-HL', name: '黑龙江省', aliases: ['黑龙江省', 'Heilongjiang'] },
  { code: 'CN-HN', name: '湖南省', aliases: ['湖南省', 'Hunan'] },
  { code: 'CN-JL', name: '吉林省', aliases: ['吉林省', 'Jilin'] },
  { code: 'CN-JS', name: '江苏省', aliases: ['江苏省', 'Jiangsu'] },
  { code: 'CN-JX', name: '江西省', aliases: ['江西省', 'Jiangxi'] },
  { code: 'CN-LN', name: '辽宁省', aliases: ['辽宁省', 'Liaoning'] },
  {
    code: 'CN-NM',
    name: '内蒙古自治区',
    aliases: ['内蒙古自治区', 'Inner Mongolia'],
  },
  {
    code: 'CN-NX',
    name: '宁夏回族自治区',
    aliases: ['宁夏回族自治区', 'Ningxia'],
  },
  { code: 'CN-QH', name: '青海省', aliases: ['青海省', 'Qinghai'] },
  { code: 'CN-SC', name: '四川省', aliases: ['四川省', 'Sichuan'] },
  { code: 'CN-SD', name: '山东省', aliases: ['山东省', 'Shandong'] },
  { code: 'CN-SH', name: '上海市', aliases: ['上海市', 'Shanghai'] },
  { code: 'CN-SN', name: '陕西省', aliases: ['陕西省', 'Shaanxi'] },
  { code: 'CN-SX', name: '山西省', aliases: ['山西省', 'Shanxi'] },
  { code: 'CN-TJ', name: '天津市', aliases: ['天津市', 'Tianjin'] },
  {
    code: 'CN-XJ',
    name: '新疆维吾尔自治区',
    aliases: ['新疆维吾尔自治区', 'Xinjiang'],
  },
  { code: 'CN-XZ', name: '西藏自治区', aliases: ['西藏自治区', 'Tibet'] },
  { code: 'CN-YN', name: '云南省', aliases: ['云南省', 'Yunnan'] },
  { code: 'CN-ZJ', name: '浙江省', aliases: ['浙江省', 'Zhejiang'] },
  { code: 'US-AL', name: 'Alabama', aliases: ['Alabama'] },
  { code: 'US-AK', name: 'Alaska', aliases: ['Alaska'] },
  { code: 'US-AZ', name: 'Arizona', aliases: ['Arizona'] },
  { code: 'US-AR', name: 'Arkansas', aliases: ['Arkansas'] },
  { code: 'US-CA', name: 'California', aliases: ['California'] },
  { code: 'US-CO', name: 'Colorado', aliases: ['Colorado'] },
  { code: 'US-CT', name: 'Connecticut', aliases: ['Connecticut'] },
  { code: 'US-DE', name: 'Delaware', aliases: ['Delaware'] },
  { code: 'US-FL', name: 'Florida', aliases: ['Florida'] },
  { code: 'US-GA', name: 'Georgia', aliases: ['Georgia'] },
  { code: 'US-HI', name: 'Hawaii', aliases: ['Hawaii'] },
  { code: 'US-ID', name: 'Idaho', aliases: ['Idaho'] },
  { code: 'US-IL', name: 'Illinois', aliases: ['Illinois'] },
  { code: 'US-IN', name: 'Indiana', aliases: ['Indiana'] },
  { code: 'US-IA', name: 'Iowa', aliases: ['Iowa'] },
  { code: 'US-KS', name: 'Kansas', aliases: ['Kansas'] },
  { code: 'US-KY', name: 'Kentucky', aliases: ['Kentucky'] },
  { code: 'US-LA', name: 'Louisiana', aliases: ['Louisiana'] },
  { code: 'US-ME', name: 'Maine', aliases: ['Maine'] },
  { code: 'US-MD', name: 'Maryland', aliases: ['Maryland'] },
  { code: 'US-MA', name: 'Massachusetts', aliases: ['Massachusetts'] },
  { code: 'US-MI', name: 'Michigan', aliases: ['Michigan'] },
  { code: 'US-MN', name: 'Minnesota', aliases: ['Minnesota'] },
  { code: 'US-MS', name: 'Mississippi', aliases: ['Mississippi'] },
  { code: 'US-MO', name: 'Missouri', aliases: ['Missouri'] },
  { code: 'US-MT', name: 'Montana', aliases: ['Montana'] },
  { code: 'US-NE', name: 'Nebraska', aliases: ['Nebraska'] },
  { code: 'US-NV', name: 'Nevada', aliases: ['Nevada'] },
  { code: 'US-NH', name: 'New Hampshire', aliases: ['New Hampshire'] },
  { code: 'US-NJ', name: 'New Jersey', aliases: ['New Jersey'] },
  { code: 'US-NM', name: 'New Mexico', aliases: ['New Mexico'] },
  { code: 'US-NY', name: 'New York', aliases: ['New York'] },
  { code: 'US-NC', name: 'North Carolina', aliases: ['North Carolina'] },
  { code: 'US-ND', name: 'North Dakota', aliases: ['North Dakota'] },
  { code: 'US-OH', name: 'Ohio', aliases: ['Ohio'] },
  { code: 'US-OK', name: 'Oklahoma', aliases: ['Oklahoma'] },
  { code: 'US-OR', name: 'Oregon', aliases: ['Oregon'] },
  { code: 'US-PA', name: 'Pennsylvania', aliases: ['Pennsylvania'] },
  { code: 'US-RI', name: 'Rhode Island', aliases: ['Rhode Island'] },
  { code: 'US-SC', name: 'South Carolina', aliases: ['South Carolina'] },
  { code: 'US-SD', name: 'South Dakota', aliases: ['South Dakota'] },
  { code: 'US-TN', name: 'Tennessee', aliases: ['Tennessee'] },
  { code: 'US-TX', name: 'Texas', aliases: ['Texas'] },
  { code: 'US-UT', name: 'Utah', aliases: ['Utah'] },
  { code: 'US-VT', name: 'Vermont', aliases: ['Vermont'] },
  { code: 'US-VA', name: 'Virginia', aliases: ['Virginia'] },
  { code: 'US-WA', name: 'Washington', aliases: ['Washington'] },
  { code: 'US-WV', name: 'West Virginia', aliases: ['West Virginia'] },
  { code: 'US-WI', name: 'Wisconsin', aliases: ['Wisconsin'] },
  { code: 'US-WY', name: 'Wyoming', aliases: ['Wyoming'] },
  {
    code: 'US-DC',
    name: 'District of Columbia',
    aliases: ['District of Columbia'],
  },
];

// Display labels are separate from stored address names and multilingual matching aliases.
export function subdivisionDisplayName(
  code: string,
  fallback?: string,
): string {
  const subdivision = SUBDIVISIONS.find((entry) => entry.code === code);
  return (
    subdivision?.aliases.find((alias) => /^[A-Za-z]/u.test(alias)) ??
    fallback ??
    code
  );
}

const COUNTRY_CODES = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  ),
);
const countryDisplays = ['en', 'zh-Hans', 'ja'].map(
  (locale) => new Intl.DisplayNames([locale], { type: 'region' }),
);
const countryNames = [...COUNTRY_CODES].map((code) => ({
  code,
  names: [...new Set(countryDisplays.map((display) => display.of(code)))],
}));

export function classifyRestaurant(
  item: Pick<AtlasCatalogEntry, 'kind' | 'tags'> & {
    readonly address?: string;
    readonly intakeEvidence?: {
      readonly addressProposal?: { readonly value: string };
      readonly ownerFields?: {
        readonly categories?: readonly string[];
        readonly address?: string;
      };
      readonly profile?: {
        readonly categories?: { readonly value: readonly string[] };
      };
    };
    readonly reviewEvidence?: {
      readonly addressProposal?: { readonly value: string };
      readonly ownerFields?: {
        readonly categories?: readonly string[];
        readonly address?: string;
      };
      readonly profile?: {
        readonly categories?: { readonly value: readonly string[] };
      };
    };
  },
): RestaurantClassification {
  const evidence = item.intakeEvidence ?? item.reviewEvidence;
  const labels =
    item.kind === 'food'
      ? [
          ...new Set(
            evidence?.ownerFields?.categories ??
              evidence?.profile?.categories?.value ??
              item.tags,
          ),
        ]
      : [];
  const normalized = new Set(labels.map(normalize));
  const cuisines: { familyId: string; categoryId?: string }[] = [];
  for (const family of CUISINE_TAXONOMY) {
    const matches = family.categories.filter((category) =>
      category.aliases.some((alias) => normalized.has(normalize(alias))),
    );
    for (const category of matches)
      cuisines.push({ familyId: family.id, categoryId: category.id });
    if (
      !matches.length &&
      family.aliases.some((alias) => normalized.has(normalize(alias)))
    )
      cuisines.push({ familyId: family.id });
  }
  const address =
    item.address ??
    evidence?.ownerFields?.address ??
    evidence?.addressProposal?.value ??
    '';
  return {
    cuisines,
    geography: classifyGeography(address),
    basis: { cuisineLabels: labels, address },
  };
}

export function withRestaurantClassification<T extends AtlasCatalogEntry>(
  item: T,
): T & { readonly classification: RestaurantClassification } {
  return { ...item, classification: classifyRestaurant(item) };
}

function classifyGeography(
  address: string,
): RestaurantClassification['geography'] {
  const matches = SUBDIVISIONS.filter((division) =>
    division.aliases.some((alias) =>
      division.code.startsWith('US-')
        ? new RegExp(
            `(?:^|[,，])\\s*(?:State of )?${alias}(?: State)?(?:\\s+\\d{5}(?:-\\d{4})?|\\s*,\\s*(?:USA|United States))(?=\\s|,|$)`,
            'iu',
          ).test(address)
        : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(alias)
          ? address.includes(alias)
          : new RegExp(`(?:^|[^a-z])${alias}(?:$|[^a-z])`, 'iu').test(address),
    ),
  );
  // A state abbreviation is reliable only in the conventional state + ZIP address position.
  const zipState = /(?:,|\s)([A-Z]{2})\s+\d{5}(?:-\d{4})?(?=\s|,|$)/u.exec(
    address,
  )?.[1];
  if (zipState) {
    const division = SUBDIVISIONS.find(
      (entry) => entry.code === `US-${zipState}`,
    );
    if (division && !matches.some((entry) => entry.code === division.code))
      matches.push(division);
  }
  const countryPatterns: readonly [string, RegExp][] = [
    ['JP', /(?:日本|\bJapan\b)/iu],
    ['CN', /(?:中国|中國|\bChina\b)/iu],
    ['US', /\b(?:USA|United States|U\.S\.A\.)\b/iu],
    ['TH', /(?:泰国|泰國|ประเทศไทย|\bThailand\b)/iu],
    ['GB', /\b(?:United Kingdom|UK)\b/iu],
    ['FR', /(?:法国|法國|\bFrance\b)/iu],
    ['IT', /(?:意大利|\bItaly\b)/iu],
    ['IN', /(?:印度|\bIndia\b)/iu],
    ['KR', /(?:韩国|韓國|대한민국|\bSouth Korea\b)/iu],
  ];
  const countries = new Set([
    ...matches.map((entry) => entry.code.slice(0, 2)),
    ...countryPatterns
      .filter(([, pattern]) => pattern.test(address))
      .map(([code]) => code),
    ...countryNames
      .filter(({ names }) =>
        names.some(
          (name) =>
            name !== undefined &&
            address
              .split(/[,，]/u)
              .some((component) => normalize(component) === normalize(name)),
        ),
      )
      .map(({ code }) => code),
  ]);
  if (countries.size === 1 && matches.length === 1) {
    const division = matches[0];
    return {
      countryCode: division.code.slice(0, 2),
      subdivisionCode: division.code,
      subdivisionName: division.name,
    };
  }
  return countries.size === 1 ? { countryCode: [...countries][0] } : {};
}

export function isRestaurantClassification(
  value: unknown,
): value is RestaurantClassification {
  if (
    !record(value) ||
    !Array.isArray(value.cuisines) ||
    !record(value.geography) ||
    !record(value.basis)
  )
    return false;
  if (
    !Array.isArray(value.basis.cuisineLabels) ||
    !value.basis.cuisineLabels.every((label) => typeof label === 'string') ||
    typeof value.basis.address !== 'string'
  )
    return false;
  const seen = new Set<string>();
  for (const cuisine of value.cuisines) {
    if (
      !record(cuisine) ||
      typeof cuisine.familyId !== 'string' ||
      (cuisine.categoryId !== undefined &&
        typeof cuisine.categoryId !== 'string')
    )
      return false;
    const family = CUISINE_TAXONOMY.find(
      (entry) => entry.id === cuisine.familyId,
    );
    if (
      !family ||
      (cuisine.categoryId !== undefined &&
        !family.categories.some((entry) => entry.id === cuisine.categoryId))
    )
      return false;
    const key = cuisine.familyId + ':' + (cuisine.categoryId ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const geography = value.geography;
  if (
    geography.countryCode !== undefined &&
    (typeof geography.countryCode !== 'string' ||
      !COUNTRY_CODES.has(geography.countryCode))
  )
    return false;
  if (geography.subdivisionCode !== undefined) {
    const division = SUBDIVISIONS.find(
      (entry) => entry.code === geography.subdivisionCode,
    );
    if (
      !division ||
      geography.countryCode !== division.code.slice(0, 2) ||
      geography.subdivisionName !== division.name
    )
      return false;
  } else if (geography.subdivisionName !== undefined) return false;
  return true;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
