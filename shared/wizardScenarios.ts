/** Shared UI/prompt contracts; no provider or browser dependencies. */
export interface ScenarioField { key:string; label:string; hint:string; required?:boolean }
export interface BookScenario { id:string; title:string; description:string; rule:string; fields:ScenarioField[]; extra?:boolean; documentary?:boolean }
const f=(key:string,label:string,hint='',required=false):ScenarioField=>({key,label,hint,required});
export const BOOK_SCENARIOS:BookScenario[]=[
 {id:'idea',title:'Із задуму',description:'Від ідеї до героїв, конфлікту й глав.',rule:'Розвивай задум автора; спочатку визнач центральний конфлікт та ставки.',fields:[f('centralQuestion','Головне питання книги','Що має з’ясувати читач?')]},
 {id:'conflict',title:'Із конфлікту',description:'Сильна ситуація та протилежні цілі.',rule:'Зберігай конфлікт. Події є наслідками рішень сторін; не підмінюй їх випадковим розв’язанням.',fields:[f('sides','Сторони та їхні цілі','Хто чого хоче?',true),f('stakes','Ставки','Що втратить кожна сторона?',true)]},
 {id:'world',title:'Зі світу або локації',description:'Історія за правилами вашого світу.',rule:'Правила світу є каноном. Порушення рівноваги та розв’язка можливі за цими правилами.',fields:[f('worldRules','Правила світу','Можливості, обмеження, епоха, місця',true),f('disruption','Що порушує рівновагу?')]},
 {id:'existing_materials',title:'Із готових матеріалів',description:'Чернетки, документи, нотатки й уривки.',rule:'Опирайся на затверджені матеріали. Не змінюй авторські факти без дозволу. Відокремлюй прогалини й запропоновані доповнення.',fields:[f('preserve','Що зберегти без змін?'),f('missing','Що потрібно дописати?')]},
 {id:'lived_experience',title:'Із реального досвіду',description:'Спогади, практика й дозволені історії.',rule:'Не вигадуй документальних фактів. Використовуй дозволені джерела, псевдоніми й межі розкриття. Гіпотези не є психологічними або медичними висновками.',documentary:true,fields:[f('facts','Підтверджені події','Дати, досвід, спостереження',true),f('privacy','Межі розкриття й псевдоніми','Що не можна включати до книги?',true)]},
 {id:'characters_photos',title:'Із героїв і фотографій',description:'Ваші герої та затверджені образи.',rule:'Зберігай героїв, імена та затверджену зовнішність. Мотиви й біографії беруться з описів автора, не виводяться з фотографій.',fields:[f('relationships','Зв’язки та суперечності','Хто знайомий із ким?'),f('invention','Що можна вигадувати?','Ситуації, діалоги, другорядні ролі')]},
 {id:'interview',title:'Книга через інтерв’ю',description:'Ваші відповіді утворять зміст.',rule:'Теми спираються на відповіді автора. Не вигадуй його досвід; нерозкриті теми перетворюй на питання для наступного інтерв’ю.',extra:true,documentary:true,fields:[f('topic','Про що й для кого ваша книга?','',true),f('beginning','З чого все почалося?','',true),f('turningPoint','Яка подія змінила ваш підхід?'),f('example','Який конкретний приклад це ілюструє?'),f('lesson','Якого висновку ви дійшли?'),f('readerAction','Що читач зможе зробити після книги?')]},
 {id:'series',title:'Продовження книги або серії',description:'Попередній канон і новий конфлікт.',rule:'Не переписуй минуле серії. Враховуй незавершені лінії, вік, часовий стрибок та стан героїв. Результат є новою книгою; вихідний том залишається незмінним.',extra:true,fields:[f('previousCanon','Канон і незавершені лінії','Можна завантажити попередній текст',true),f('timeJump','Скільки часу минуло?'),f('newConflict','Новий конфлікт','',true)]},
 {id:'mystery',title:'Детектив від розгадки',description:'Істина → докази → хибні версії.',rule:'Істина задана автором і не змінюється. Розрізняй істину, знання персонажів і читача. Підказка має джерело, час відкриття й логічний наслідок.',extra:true,fields:[f('truth','Що сталося насправді?','Винуватець, мотив, спосіб',true),f('clues','Докази та підказки','',true),f('falseLeads','Хибні версії'),f('reveal','Коли розкрити істину?')]},
 {id:'labyrinth',title:'Книга-лабіринт',description:'Місця, переходи, вибори й наслідки.',rule:'Будуй прохідні переходи між відомими місцями. Вибір має наслідок і веде до наступного місця або фіналу. Не переміщуй героя без переходу; він знає лише доступні маршрути.',extra:true,fields:[f('locations','Місця та рівні','Вузли карти, коридори, мости',true),f('routes','Доступні переходи','Звідки й куди можна пройти?',true),f('endings','Умови фіналів','',true)]},
 {id:'collective',title:'Спільна книга учасників',description:'Внески з явним зазначенням авторства.',rule:'Зберігай походження й авторство внесків. Не публікуй приватні матеріали; суперечливі версії подавай на узгодження. Не вигадуй згоду учасників.',extra:true,documentary:true,fields:[f('contributors','Учасники та внески','Хто надав який матеріал?',true),f('permissions','Що дозволено використати?','Публічність, псевдоніми, межі редагування',true),f('editorialPolicy','Як узгоджуємо різні голоси?')]},
 {id:'practical',title:'Практична книга для читача',description:'Проблема → приклад → вправа → результат.',rule:'Розділи ведуть до конкретного результату читача. Дай пояснення, підтверджений приклад, вправу та критерій перевірки; не нав’язуй художню подорож героя.',extra:true,documentary:true,fields:[f('reader','Для кого книга?','',true),f('problem','Яку проблему вирішуємо?','',true),f('outcome','Що читач зможе зробити?','',true)]},
];
export const STORY_MODELS=[
 {id:'hero_journey',title:'Шлях змін героя',description:'Випробування змінюють спосіб дії героя.',beats:['Початковий стан і суперечність','Виклик і рішення діяти','Випробування та їхня ціна','Криза старого способу дії','Вирішальний вибір','Наслідки й новий стан']},
 {id:'psychotypes',title:'Зіткнення характерів і цілей',description:'Несумісні бажання загострюють спільну ситуацію.',beats:['Несумісні цілі сторін','Взаємна залежність','Дія та протидія','Зростання ціни конфлікту','Вирішальний вибір сторін','Наслідки для стосунків']},
 {id:'vedic_archetypes',title:'Зміна станів і цінностей',description:'Ведична літературна оптика: інерція → дія → ясність.',beats:['Інерція та невидима ціна','Поштовх до дії','Надмірність та її наслідки','Перегляд мотивів','Усвідомлений вибір','Новий баланс']},
 {id:'buddhist_skandhas',title:'Зміна сприйняття',description:'Буддійська літературна оптика: подія, відчуття, тлумачення, реакція.',beats:['Подія і точка зору','Тілесний та чуттєвий досвід','Розпізнавання і тлумачення','Звичні реакції','Переосмислення сприйняття','Свідомо обраний наслідок']},
 {id:'documentary',title:'Тема, досвід і висновки',description:'Нонфікшн із джерелами та прикладами.',beats:['Питання читача','Контекст і джерела','Підтверджені приклади','Різні тлумачення та межі знань','Висновок автора','Наступні практичні кроки']},
] as const;
export interface WizardSource {
 id:string;kind:'file'|'photo'|'url'|'note';title:string;text:string;approved:boolean;
 url?:string;assetId?:string;characterId?:string;retrievedAt?:string;
}
export interface WizardScenarioState {
 reviewConfirmed?:boolean;structureConfirmed?:boolean;
 entryMode?:string;scenarioInputs?:Record<string,string>;audience?:string;tone?:string;
 targetCastSize?:number;sourceMaterials?:WizardSource[];sourcesPermission?:boolean;
 canonicalSourceBookId?:string;compositionPlan?:string;
}
export function bookScenario(id?:string):BookScenario { return BOOK_SCENARIOS.find(s=>s.id===id)??BOOK_SCENARIOS[0]; }
export function storyModel(id?:string) { return STORY_MODELS.find(m=>m.id===id)??STORY_MODELS[0]; }
export function scenarioErrors(value:WizardScenarioState):string[] {
 const scenario=bookScenario(value.entryMode);
 const errors=scenario.fields.filter(f=>f.required&&!value.scenarioInputs?.[f.key]?.trim()).map(f=>'Заповніть «'+f.label+'».');
 if(['existing_materials','collective'].includes(scenario.id)&&!value.sourceMaterials?.some(s=>s.approved&&s.text.trim())) errors.push('Додайте й підтвердьте хоча б одне джерело.');
 if(['lived_experience','collective'].includes(scenario.id)&&!value.sourcesPermission) errors.push('Підтвердьте дозвіл на використання матеріалів.');
 return errors;
}
export function approvedSources(value:WizardScenarioState):WizardSource[] { return (value.sourceMaterials??[]).filter(s=>s.approved&&s.text.trim()); }
