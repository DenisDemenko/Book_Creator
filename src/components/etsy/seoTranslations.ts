// Comprehensive Etsy SEO Translation & Buyer Intent Dictionary (EN -> UA)

export interface SeoTranslationItem {
  english: string;
  ukrainian: string;
  category: string;
  intent: string;
  synonyms?: string[];
}

// Master dictionary of Etsy SEO vocabulary categorized
export const ETSY_SEO_DICTIONARY: SeoTranslationItem[] = [
  // Gift & Occasions
  { english: 'personalized gift', ukrainian: 'персоналізований подарунок', category: 'Подарунки', intent: 'Пошук подарунка з індивідуальним імʼям або датою' },
  { english: 'custom gift', ukrainian: 'подарунок під замовлення / кастомний', category: 'Подарунки', intent: 'Індивідуальне виготовлення за побажаннями клієнта' },
  { english: 'anniversary gift', ukrainian: 'подарунок на річницю', category: 'Події', intent: 'Подарунок для пари, чоловіка чи дружини на ювілей стосунків' },
  { english: 'groomsmen gift', ukrainian: 'подарунок дружкам нареченого', category: 'Весілля', intent: 'Оптові або іменні подарунки для чоловічої весільної команди' },
  { english: 'bridesmaid gift', ukrainian: 'подарунок подружкам нареченої', category: 'Весілля', intent: 'Подарункові бокси, прикраси або халати для подруг нареченої' },
  { english: 'gift for him', ukrainian: 'подарунок для нього (чоловіка/хлопця)', category: 'Подарунки', intent: 'Широкий пошуковий запит на чоловічі товари' },
  { english: 'gift for her', ukrainian: 'подарунок для неї (жінки/дівчини)', category: 'Подарунки', intent: 'Пошуковий запит на жіночі прикраси, декор та аксесуари' },
  { english: 'gift for mom', ukrainian: 'подарунок для мами', category: 'Подарунки', intent: 'День матері, день народження, душевні памʼятні сувеніри' },
  { english: 'gift for dad', ukrainian: 'подарунок для тата', category: 'Подарунки', intent: 'День батька, шкіряні вироби, інструменти, деревʼяні органайзери' },
  { english: 'housewarming gift', ukrainian: 'подарунок на новосілля', category: 'Дім', intent: 'Кухонний декор, свічки, килимки, ключники, посуд' },
  { english: 'wedding keepsake', ukrainian: 'памʼятний весільний сувенір', category: 'Весілля', intent: 'Речі на все життя: гравійовані скриньки, сертифікати, келихи' },
  { english: 'birthday gift', ukrainian: 'подарунок на день народження', category: 'Події', intent: 'Універсальний подарунковий пошук' },
  { english: 'christmas gift', ukrainian: 'різдвяний подарунок', category: 'Свята', intent: 'Сезонний пік Q4 листопад-грудень' },
  { english: 'valentines gift', ukrainian: 'подарунок на День святого Валентина', category: 'Свята', intent: 'Лютий, парні речі, сердечка, романтичні прикраси' },
  { english: 'mothers day gift', ukrainian: 'подарунок до Дня матері', category: 'Свята', intent: 'Квітень-травень, квіткові мотиви, кулони з іменами дітей' },
  { english: 'fathers day gift', ukrainian: 'подарунок до Дня батька', category: 'Свята', intent: 'Травень-червень, чоловічі аксесуари з гравіюванням' },

  // Craft & Handcrafted Styles
  { english: 'handmade', ukrainian: 'ручна робота / зроблено власноруч', category: 'Крафт', intent: 'Ключовий маркер автентичності на платформі Etsy' },
  { english: 'artisan crafted', ukrainian: 'створено майстром / ремісничий', category: 'Крафт', intent: 'Преміальний акцент на високій кваліфікації автора' },
  { english: 'handcrafted', ukrainian: 'виготовлено вручну', category: 'Крафт', intent: 'Підтвердження відсутності масового фабричного виробництва' },
  { english: 'cottagecore', ukrainian: 'котеджкор (сільський затишний стиль)', category: 'Стиль', intent: 'Естетика природи, льону, трав, квітів та вінтажного спокою' },
  { english: 'rustic', ukrainian: 'рустик (натуральний, грубуватий, сільський)', category: 'Стиль', intent: 'Необроблене дерево, темний метал, натуральна текстура' },
  { english: 'boho / bohemian', ukrainian: 'бохо / богемний стиль', category: 'Стиль', intent: 'Макраме, бахрома, теплі земляні тони, вільний дух' },
  { english: 'minimalist', ukrainian: 'мінімалістичний', category: 'Стиль', intent: 'Чисті лінії, відсутність зайвого декору, лаконічність' },
  { english: 'vintage aesthetic', ukrainian: 'вінтажна естетика / під старовину', category: 'Стиль', intent: 'Ностальгічний вигляд виробів з минулих епох' },
  { english: 'cozy aesthetic', ukrainian: 'затишна естетика', category: 'Стиль', intent: 'Теплі пледи, свічки, керамічні чашки, осінній вайб' },
  { english: 'mid century modern', ukrainian: 'модерн середини століття (50-60-ті)', category: 'Стиль', intent: 'Геометричний дизайн інтерʼєру та меблів' },
  { english: 'scandinavian design', ukrainian: 'скандинавський дизайн (хюґе)', category: 'Стиль', intent: 'Світлі тони, функціональність, дерево, затишок' },

  // Materials & Techniques
  { english: 'genuine leather', ukrainian: 'натуральна шкіра', category: 'Матеріали', intent: 'Гарантія якості для гаманців, сумок, ременів' },
  { english: 'distressed leather', ukrainian: 'шкіра з вінтажним ефектом потертості (Crazy Horse)', category: 'Матеріали', intent: 'Популярний брутальний матеріал для чоловічих аксесуарів' },
  { english: 'ceramic pottery', ukrainian: 'кераміка / гончарні вироби', category: 'Матеріали', intent: 'Глиняний обпалений посуд, вази, кашпо' },
  { english: 'stoneware', ukrainian: 'камʼяна кераміка (високотемпературна глина)', category: 'Матеріали', intent: 'Міцний, термостійкий посуд преміум-класу' },
  { english: 'botanical glaze', ukrainian: 'рослинна / ботанічна полива', category: 'Матеріали', intent: 'Глазур з відбитками листя, квітів або натуральних відтінків' },
  { english: 'acrylic', ukrainian: 'акрил / оргскло', category: 'Матеріали', intent: 'Прозорі або матові таблички, весільні вивіски, органайзери' },
  { english: 'frosted acrylic', ukrainian: 'матовий акрил (ефект паморозі)', category: 'Матеріали', intent: 'Трендовий матеріал для весільного декору та меню' },
  { english: 'gold foil', ukrainian: 'золоте фольгування / тиснення золотом', category: 'Матеріали', intent: 'Розкішний блиск на поліграфії та запрошеннях' },
  { english: 'linen fabric', ukrainian: 'лляна тканина / натуральний льон', category: 'Матеріали', intent: 'Дихаючий одяг, скатертини, постільна білизна' },
  { english: 'merino wool', ukrainian: 'вовна мериноса', category: 'Матеріали', intent: 'Супермʼяка гіпоалергенна вовна для пледів та шарфів' },
  { english: 'chunky knit', ukrainian: 'груба / обʼємна вʼязка (товста пряжа)', category: 'Техніка', intent: 'Великі петлі, фактурні пледи та кардигани' },
  { english: 'custom engraved', ukrainian: 'лазерне гравіювання під замовлення', category: 'Техніка', intent: 'Нанесення імені, цитати, фото на дерево/метал/шкіру' },
  { english: 'custom embroidered', ukrainian: 'машинна або ручна вишивка під замовлення', category: 'Техніка', intent: 'Вишиті худі, світшоти з портретами улюбленців, кепки' },
  { english: '3d printed', ukrainian: 'надруковано на 3D-принтері', category: 'Техніка', intent: 'Рухомі фігурки, органайзери, кастомні деталі' },
  { english: 'silk pla', ukrainian: 'шовковий шовковисто-глянцевий PLA пластик', category: 'Матеріали', intent: 'Ефект металевого/шовкового блиску без фарбування' },
  { english: 'raw crystal', ukrainian: 'необроблений натуральний кристал', category: 'Матеріали', intent: 'Природні мінерали, необроблені самоцвіти в ювелірці' },
  { english: 'birthstone', ukrainian: 'камінь-оберіг за місяцем народження', category: 'Ювелірка', intent: 'Індивідуальні каблучки, кулони та сережки під дату народження' },
  { english: 'solid gold / 14k gold', ukrainian: 'справжнє золото 14 карат (585 проба)', category: 'Матеріали', intent: 'Преміальні ювелірні вироби довговічного носіння' },
  { english: 'sterling silver 925', ukrainian: 'срібло 925 проби', category: 'Матеріали', intent: 'Гіпоалергенні якісні прикраси' },
  { english: 'led neon sign', ukrainian: 'світлодіодна неонова вивіска', category: 'Декор', intent: 'Яскраві написи для кімнат, барів, весіль, студій' },

  // Digital Products & Templates
  { english: 'digital planner', ukrainian: 'цифровий щоденник / планер', category: 'Digital', intent: 'Інтерактивний PDF для планшетів' },
  { english: 'goodnotes planner', ukrainian: 'планер для додатку GoodNotes', category: 'Digital', intent: 'Оптимізовано для рукописного вводу з Apple Pencil' },
  { english: 'hyperlinked pdf', ukrainian: 'PDF з інтерактивними клікабельними вкладками', category: 'Digital', intent: 'Миттєвий перехід між місяцями, днями та розділами' },
  { english: 'instant download', ukrainian: 'миттєве завантаження (цифровий файл)', category: 'Digital', intent: 'Файл доступний відразу після оплати без доставки' },
  { english: 'editable canva template', ukrainian: 'шаблон, що редагується в Canva', category: 'Digital', intent: 'Покупець може самостійно змінити текст та фото онлайн' },
  { english: 'printable wall art', ukrainian: 'картина / постер для самостійного друку', category: 'Digital', intent: 'Файли високої роздільної здатності для домашнього друку' },
  { english: 'adhd friendly', ukrainian: 'адаптовано для людей з СДУГ (структуровано)', category: 'Digital', intent: 'Візуальні чеклісти, тайм-блоки, мінімум хаосу' },
  { english: 'notion template', ukrainian: 'шаблон бази даних Notion', category: 'Digital', intent: 'Система організації життя, бізнесу або навчання' },
  { english: 'svg cut file', ukrainian: 'векторний файл SVG для плотера (Cricut/Silhouette)', category: 'Digital', intent: 'Файли для різки наліпок, термотрансферу та дерева' },

  // Commercial Triggers & Listing Attributes
  { english: 'bestseller', ukrainian: 'хіт продажів / бестселер', category: 'Маркетинг', intent: 'Найвищий соціальний доказ попиту' },
  { english: 'free shipping', ukrainian: 'безкоштовна доставка', category: 'Маркетинг', intent: 'Критичний фактор ранжування алгоритму Etsy' },
  { english: 'fast dispatch / express', ukrainian: 'швидка відправка замовлення', category: 'Маркетинг', intent: 'Для термінових подарунків покупцям' },
  { english: 'eco friendly / sustainable', ukrainian: 'екологічний / сталий розвиток', category: 'Маркетинг', intent: 'Перероблені матеріали, без пластику в упаковці' },
  { english: 'high quality', ukrainian: 'висока якість виконання', category: 'Маркетинг', intent: 'Підкреслення преміальності матеріалів' },
  { english: 'one of a kind (ooak)', ukrainian: 'в єдиному екземплярі / неповторний', category: 'Маркетинг', intent: 'Ексклюзивні авторські твори мистецтва' },
  { english: 'bifold wallet', ukrainian: 'гаманець подвійного складання (книжечка)', category: 'Товари', intent: 'Класична модель чоловічого портмоне' },
  { english: 'slim minimalist wallet', ukrainian: 'тонкий компактний картхолдер / гаманець', category: 'Товари', intent: 'Зручно носити в передній кишені джинсів' },
  { english: 'pet portrait', ukrainian: 'портрет домашнього улюбленця (собаки/кота)', category: 'Товари', intent: 'Високомаржинальна ніша з сильною емоційною привʼязкою' },
  { english: 'welcome sign', ukrainian: 'вітальна табличка на вхід (для свята чи дому)', category: 'Товари', intent: 'Головний акцент вхідної фотозони весілля чи свята' }
];

// Word-by-word translation map for real-time phrase decomposition
const WORD_TRANSLATIONS: Record<string, string> = {
  // Nouns
  'gift': 'подарунок',
  'gifts': 'подарунки',
  'mug': 'кухоль / чашка',
  'mugs': 'кухлі / чашки',
  'wallet': 'гаманець / портмоне',
  'wallets': 'гаманці',
  'planner': 'планер / щоденник',
  'planners': 'планери',
  'dress': 'сукня',
  'dresses': 'сукні',
  'sign': 'вивіска / табличка',
  'signs': 'вивіски / таблички',
  'ring': 'каблучка',
  'rings': 'каблучки',
  'necklace': 'кольє / намисто',
  'pendant': 'підвіска / кулон',
  'blanket': 'плед / ковдра',
  'throw': 'покривало / плед',
  'sweatshirt': 'світшот',
  'hoodie': 'худі / толстовка',
  'shirt': 'сорочка / футболка',
  'dragon': 'дракон',
  'pottery': 'гончарство / кераміка',
  'candle': 'свічка',
  'candles': 'свічки',
  'decor': 'декор для інтерʼєру',
  'decoration': 'прикраса / оформлення',
  'invitation': 'запрошення',
  'invitations': 'запрошення',
  'template': 'шаблон',
  'templates': 'шаблони',
  'card': 'листівка / картка',
  'cards': 'листівки',
  'print': 'принт / постер',
  'prints': 'принти',
  'art': 'мистецтво / арт',
  'portrait': 'портрет',
  'jewelry': 'прикраси / ювелірні вироби',
  'leather': 'шкіра (матеріал)',
  'wood': 'дерево',
  'wooden': 'деревʼяний',
  'ceramic': 'керамічний',
  'stoneware': 'камʼяна кераміка',
  'linen': 'льон / лляний',
  'wool': 'вовна',
  'acrylic': 'акрил / оргскло',
  'gold': 'золото / золотий',
  'silver': 'срібло / срібний',
  'crystal': 'кристал / мінерал',
  'glass': 'скло',
  'dog': 'собака',
  'cat': 'кіт',
  'pet': 'домашній улюбленець',
  'pets': 'домашні улюбленці',
  'coffee': 'кава',
  'tea': 'чай',
  'men': 'чоловіки / для чоловіків',
  'women': 'жінки / для жінок',
  'mom': 'мама',
  'dad': 'тато',
  'husband': 'чоловік (у шлюбі)',
  'wife': 'дружина',
  'boyfriend': 'хлопець',
  'girlfriend': 'дівчина',
  'couple': 'пара',
  'wedding': 'весілля / весільний',
  'anniversary': 'річниця / ювілей',
  'birthday': 'день народження',
  'christmas': 'Різдво',
  'keepsake': 'памʼятна річ / сувенір',
  'baby': 'малюк / немовля',
  'home': 'дім',
  'kitchen': 'кухня',
  'wall': 'стіна / настінний',

  // Adjectives & Styles
  'handmade': 'ручної роботи',
  'handcrafted': 'виготовлений вручну',
  'artisan': 'ремісничий / майстерний',
  'custom': 'під замовлення / індивідуальний',
  'personalized': 'персоналізований / іменний',
  'engraved': 'гравійований',
  'embroidered': 'вишитий',
  'printed': 'друкований',
  'digital': 'цифровий',
  'minimalist': 'мінімалістичний',
  'rustic': 'рустикальний / сільський',
  'vintage': 'вінтажний',
  'boho': 'бохо / богемний',
  'cottagecore': 'котеджкор',
  'aesthetic': 'естетичний',
  'cozy': 'затишний',
  'unique': 'унікальний',
  'chunky': 'обʼємний / товстий',
  'knit': 'вʼязаний',
  'knitted': 'вʼязаний',
  'bifold': 'подвійного складання',
  'slim': 'тонкий / компактний',
  'oversized': 'вільного крою (оверсайз)',
  'midi': 'довжина міді',
  'botanical': 'ботанічний / рослинний',
  'frosted': 'матовий',
  'raw': 'необроблений / природний',
  'birthstone': 'камінь місяця народження',
  'articulated': 'рухомий / шарнірний',
  'neon': 'неоновий',
  'cute': 'милий',
  'floral': 'квітковий',
  'editable': 'з можливістю редагування',
  'printable': 'для друку',
  'hyperlinked': 'з інтерактивними посиланнями',
  'undated': 'без фіксованих дат',
  'daily': 'щоденний',
  'weekly': 'тижневий',
  'monthly': 'місячний',
  'instant': 'миттєвий',
  'download': 'завантаження',
  'suite': 'комплект / набір',
  'pack': 'набір / пак',
  'bundle': 'комплект зі знижкою',
  'set': 'набір'
};

/**
 * Translates an arbitrary Etsy SEO tag into Ukrainian with intent and breakdown
 */
export function translateEtsyTag(tag: string): {
  original: string;
  ukrainian: string;
  category: string;
  buyerIntent: string;
  wordsBreakdown: { en: string; ua: string }[];
} {
  const normalized = tag.toLowerCase().trim();

  // 1. Direct match in dictionary
  const directMatch = ETSY_SEO_DICTIONARY.find(
    (item) => item.english.toLowerCase() === normalized
  );

  if (directMatch) {
    const words = normalized.split(/\s+/);
    const breakdown = words.map((w) => ({
      en: w,
      ua: WORD_TRANSLATIONS[w] || w,
    }));

    return {
      original: tag,
      ukrainian: directMatch.ukrainian,
      category: directMatch.category,
      buyerIntent: directMatch.intent,
      wordsBreakdown: breakdown,
    };
  }

  // 2. Multi-word composite translation
  const words = normalized.split(/\s+/).filter(Boolean);
  const translatedWords = words.map((w) => WORD_TRANSLATIONS[w] || w);
  const compositeUa = translatedWords.join(' ');

  // Detect category from words
  let detectedCategory = 'Загальне';
  if (normalized.includes('gift') || normalized.includes('personalized') || normalized.includes('custom')) {
    detectedCategory = 'Подарунки';
  } else if (normalized.includes('wedding') || normalized.includes('groomsmen') || normalized.includes('bridesmaid')) {
    detectedCategory = 'Весілля';
  } else if (normalized.includes('digital') || normalized.includes('planner') || normalized.includes('template') || normalized.includes('svg')) {
    detectedCategory = 'Digital товари';
  } else if (normalized.includes('ring') || normalized.includes('gold') || normalized.includes('jewelry') || normalized.includes('silver')) {
    detectedCategory = 'Ювелірка & Прикраси';
  } else if (normalized.includes('mug') || normalized.includes('decor') || normalized.includes('pottery') || normalized.includes('blanket')) {
    detectedCategory = 'Дім & Декор';
  } else if (normalized.includes('leather') || normalized.includes('wallet') || normalized.includes('dress') || normalized.includes('hoodie')) {
    detectedCategory = 'Одяг & Аксесуари';
  }

  const breakdown = words.map((w) => ({
    en: w,
    ua: WORD_TRANSLATIONS[w] || w,
  }));

  const buyerIntent = `Пошуковий запит цільових покупців за ключовими критеріями: "${compositeUa}". Використовується для точного потрапляння в алгоритми пошуку Etsy.`;

  return {
    original: tag,
    ukrainian: compositeUa,
    category: detectedCategory,
    buyerIntent,
    wordsBreakdown: breakdown,
  };
}
