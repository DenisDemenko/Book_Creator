import { adaptivePolicyError } from './adaptiveWorkflow';
/**
 * Граф процесу ШІ (AI Workflow Graph) — формат `fusion-workflow/1`, реєстр
 * вузлів і перевірка (Т5.2 В1, `PLAN_GRAPH_STUDIO.md`; ТЗ Graph Studio §5,
 * §35–36, §38, §39 №6, 7, 28).
 *
 * Модуль чистий (без мережі й бази): його читають і канва Graph Studio, і
 * сервер (збереження версій, перевірка перед тестом і публікацією), і —
 * у Т5.4 — рушій виконання.
 *
 * Мовне правило ТЗ §0: машинні ID — стабільні англійські (`JEV_CHOICE`,
 * `confidence_policy`), назви в інтерфейсі — «English (Український)».
 *
 * **Розкладки у визначенні немає.** Координати вузлів на канві живуть
 * окремо (`graph_layouts`), тому перетягування вузла не змінює ні
 * визначення, ні хешу версії, ні семантики (критерій №28).
 */

import { canonicalJson, type LocalizedName } from './ontology';
import { exprError } from './workflowExpr';

export const WORKFLOW_FORMAT = 'fusion-workflow/1';
export const CONTINUITY_CHECKS = ['time', 'age', 'knowledge', 'place', 'object', 'causality'] as const;

// ---------------------------------------------------------------------------
// Палітра (§35) і реєстр вузлів (§5.2, §36)
// ---------------------------------------------------------------------------

export type PaletteGroupId = 'core' | 'story_core' | 'ai' | 'jev' | 'control' | 'validation' | 'human' | 'output';

export interface PaletteGroup {
  id: PaletteGroupId;
  /** Як у ТЗ: `CORE`, `STORY CORE`… */
  code: string;
  name: LocalizedName;
  color: string;
  order: number;
}

export const PALETTE_GROUPS: PaletteGroup[] = [
  { id: 'core', code: 'CORE', name: { en: 'Core', uk: 'Основні' }, color: '#64748b', order: 1 },
  { id: 'story_core', code: 'STORY CORE', name: { en: 'Story Core', uk: 'Семантичне ядро' }, color: '#0ea5e9', order: 2 },
  { id: 'ai', code: 'AI', name: { en: 'AI', uk: 'ШІ' }, color: '#8b5cf6', order: 3 },
  { id: 'jev', code: 'JEV', name: { en: 'Jev', uk: 'Jev' }, color: '#f59e0b', order: 4 },
  { id: 'control', code: 'CONTROL', name: { en: 'Control', uk: 'Керування' }, color: '#14b8a6', order: 5 },
  { id: 'validation', code: 'VALIDATION', name: { en: 'Validation', uk: 'Перевірка' }, color: '#ef4444', order: 6 },
  { id: 'human', code: 'HUMAN', name: { en: 'Human', uk: 'Людина' }, color: '#22c55e', order: 7 },
  { id: 'output', code: 'OUTPUT', name: { en: 'Output', uk: 'Вихід' }, color: '#ec4899', order: 8 },
];

export type ParamType = 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'enum' | 'string_list' | 'json';

export interface ParamDef {
  /** Машинний ключ параметра (§5.3: `temperature`, `cost_limit`…). */
  id: string;
  name: LocalizedName;
  type: ParamType;
  required?: boolean;
  min?: number;
  max?: number;
  /** Для `enum`. */
  options?: string[];
  /** Для `string_list`: скільки елементів щонайменше. */
  minItems?: number;
  default?: unknown;
  hint?: string;
}

export interface NodeTypeDef {
  /** Машинний тип вузла (`LLM`, `JEV_CHOICE`). */
  id: string;
  group: PaletteGroupId;
  name: LocalizedName;
  description: string;
  /** Скільки вхідних ребер приймає: 0 (START), 1 чи багато (MERGE). */
  inputs: 'none' | 'one' | 'many';
  /** Гілки виходу. Для `dynamicOutputs` — ще й значення параметра-списку. */
  outputs: string[];
  /** Додаткові гілки — з параметра-списку (варіанти Jev-вибору, маршрути). */
  dynamicOutputs?: string;
  /** Одна гілка може вести в кілька вузлів (PARALLEL). */
  fanOut?: boolean;
  params: ParamDef[];
}

const N = (en: string, uk: string): LocalizedName => ({ en, uk });

/** Параметри моделі §5.3 — спільні для LLM і AGENT. */
const MODEL_PARAMS: ParamDef[] = [
  { id: 'model_provider', name: N('Model provider', 'Постачальник моделі'), type: 'enum', options: ['gemini', 'openai', 'anthropic', 'deepseek', 'core_module'], required: true, default: 'core_module' },
  { id: 'model', name: N('Model', 'Модель'), type: 'string', hint: 'Порожньо — модель модуля «Ядра AI»' },
  { id: 'temperature', name: N('Temperature', 'Температура'), type: 'number', min: 0, max: 2, default: 0.4 },
  { id: 'max_tokens', name: N('Max tokens', 'Найбільше токенів'), type: 'integer', min: 1, max: 200000, default: 2048 },
  { id: 'timeout', name: N('Timeout, s', 'Тайм-аут, с'), type: 'integer', min: 1, max: 600, default: 60 },
  { id: 'retry_count', name: N('Retry count', 'Повторів'), type: 'integer', min: 0, max: 5, default: 1 },
  { id: 'system_prompt', name: N('System prompt', 'Системна інструкція'), type: 'text' },
  { id: 'context_policy', name: N('Context policy', 'Політика контексту'), type: 'enum', options: ['scene', 'chapter', 'entity_scope', 'book_summary', 'none'], default: 'scene' },
  { id: 'output_schema', name: N('Output schema', 'Схема виходу'), type: 'json' },
  { id: 'entity_scope', name: N('Entity scope', 'Область сутностей'), type: 'string_list', hint: 'Типи сутностей (slug онтології)' },
  { id: 'relation_scope', name: N('Relation scope', 'Область зв\'язків'), type: 'string_list' },
  { id: 'confidence_policy', name: N('Confidence policy', 'Політика впевненості'), type: 'enum', options: ['propose_only', 'auto_accept_above_threshold', 'human_review_below_threshold'], default: 'propose_only' },
  { id: 'cost_policy', name: N('Cost-aware routing', 'Політика вибору моделі за вартістю'), type: 'json', hint: 'Необов’язково: version, budgetUsd, latencyTargetMs, complexity/risk 0–1, candidates (modelId, tier, тарифи за 1M токенів, latencyMs).' },
  { id: 'cost_limit', name: N('Cost limit, $', 'Ліміт витрат, $'), type: 'number', min: 0, max: 100, default: 0.5 },
  // Т5.4: повтор і відновлення (§30).
  { id: 'backoff', name: N('Backoff', 'Пауза між повторами'), type: 'enum', options: ['none', 'exponential'], default: 'exponential' },
  { id: 'on_timeout', name: N('On timeout', 'Якщо тайм-аут'), type: 'enum', options: ['fail', 'alternate_model'], default: 'fail' },
  { id: 'on_provider_error', name: N('On provider error', 'Якщо збій постачальника'), type: 'enum', options: ['fail', 'alternate_model'], default: 'fail' },
  { id: 'alternate_model', name: N('Alternate model', 'Резервна модель'), type: 'string', hint: 'Id моделі для повтору після збою чи тайм-ауту' },
];

/**
 * Спільні поля вузлів Jev (§36): питання, вхідний стан, поріг, відображення,
 * журналювання. Поріг (§8.2) — для NOUL і GATE це імовірність «так»; для
 * решти — найменша впевненість, нижче якої рішення йде резервним маршрутом
 * (0 — без порогу).
 */
const jevCommon = (threshold: number, hint: string): ParamDef[] => [
  { id: 'question', name: N('Question / Definition', 'Питання / визначення'), type: 'text', required: true, hint: '{{input.ключ}} і {{змінна}} підставляються зі стану' },
  { id: 'input_state', name: N('Input state', 'Вхідний стан'), type: 'string_list', hint: 'Ключі стану, які бачить Jev: input.*, vars.*, output, confidence; порожньо — вхід, змінні й вихід' },
  { id: 'threshold', name: N('Threshold', 'Поріг'), type: 'number', min: 0, max: 1, default: threshold, hint },
  { id: 'output_mapping', name: N('Output mapping', 'Відображення виходу'), type: 'json', hint: '{"змінна": "поле"}: selected, distribution, confidence, probability, score, value, source…; без нього — vars.<id вузла>' },
  { id: 'logging', name: N('Logging', 'Журналювання'), type: 'boolean', default: true },
];

/** Дії маршрутизації за впевненістю (§16). */
export const CONFIDENCE_ACTIONS = ['AUTO_ROUTE', 'SECOND_OPINION', 'HUMAN_REVIEW', 'FALLBACK'];
export const DECISION_IMPORTANCE = ['low', 'medium', 'high', 'critical'];
export const DECISION_RISK = ['low', 'medium', 'high'];

/**
 * Т5.5: маршрутизація за впевненістю (§16) і узгодження кількох моделей
 * (§17) — на кожен вузол окремо. Типово все AUTO_ROUTE і без узгодження:
 * вузол поводиться як просте рішення.
 */
const JEV_ROUTING: ParamDef[] = [
  { id: 'confidence_high', name: N('High confidence from', 'Висока впевненість від'), type: 'number', min: 0, max: 1, default: 0.9 },
  { id: 'confidence_medium', name: N('Medium confidence from', 'Середня впевненість від'), type: 'number', min: 0, max: 1, default: 0.6 },
  { id: 'on_high', name: N('On high confidence', 'Якщо впевненість висока'), type: 'enum', options: CONFIDENCE_ACTIONS, default: 'AUTO_ROUTE' },
  { id: 'on_medium', name: N('On medium confidence', 'Якщо середня'), type: 'enum', options: CONFIDENCE_ACTIONS, default: 'AUTO_ROUTE', hint: 'Невідома впевненість (запасний LLM її не дає) — середня' },
  { id: 'on_low', name: N('On low confidence', 'Якщо низька'), type: 'enum', options: CONFIDENCE_ACTIONS, default: 'AUTO_ROUTE' },
  { id: 'second_opinion_model', name: N('Second opinion model', 'Модель другої перевірки'), type: 'string', hint: 'Порожньо — модель AI-2 з «Ядра AI»' },
  { id: 'importance', name: N('Importance', 'Важливість рішення'), type: 'enum', options: DECISION_IMPORTANCE, default: 'medium' },
  { id: 'risk', name: N('Risk', 'Ризик рішення'), type: 'enum', options: DECISION_RISK, default: 'low' },
  { id: 'consensus_from_importance', name: N('Consensus from importance', 'Узгодження моделей від важливості'), type: 'enum', options: ['never', 'medium', 'high', 'critical'], default: 'never' },
  { id: 'consensus_from_risk', name: N('Consensus from risk', 'Узгодження моделей від ризику'), type: 'enum', options: ['never', 'medium', 'high'], default: 'never' },
  { id: 'consensus_budget', name: N('Consensus budget, $', 'Узгодження — поки витрати запуску менші, $'), type: 'number', min: 0, max: 100, default: 0.05 },
  { id: 'consensus_model_a', name: N('Consensus model A', 'Модель A узгодження'), type: 'string', hint: 'Порожньо — модель AI-2 з «Ядра AI»' },
  { id: 'consensus_model_b', name: N('Consensus model B', 'Модель B узгодження'), type: 'string', hint: 'Порожньо — модель AI-1 з «Ядра AI»' },
];

const JEV_CONFIDENCE_HINT = 'Найменша впевненість; нижче — резервний маршрут (0 — без порогу)';
const JEV_PROBABILITY_HINT = 'Імовірність «так», від якої відповідь — «так» (§8.2)';
const jevParams = (own: ParamDef[], probability = false): ParamDef[] => [
  ...jevCommon(probability ? 0.6 : 0, probability ? JEV_PROBABILITY_HINT : JEV_CONFIDENCE_HINT),
  ...own,
  ...JEV_ROUTING,
];

const REVIEW_ACTIONS = ['SECOND_OPINION', 'HUMAN_REVIEW'];
/** Т5.5: чи потрібна вузлу гілка `review` (§16 — друга перевірка чи людина, §17 — розбіжність моделей). */
export function needsReviewBranch(node: Pick<WorkflowNode, 'type' | 'params'>): boolean {
  if (!node.type?.startsWith('JEV_')) return false;
  const p = node.params ?? {};
  return ['on_high', 'on_medium', 'on_low'].some((k) => REVIEW_ACTIONS.includes(String(p[k] ?? ''))) || (!!p.consensus_from_importance && p.consensus_from_importance !== 'never') || (!!p.consensus_from_risk && p.consensus_from_risk !== 'never');
}

/** Т5.5: реєстр напрямків маршрутизатора (порожньо — гілки на канві). */
export const routerRegistry = (node: Pick<WorkflowNode, 'type' | 'params'>): string => (node.type === 'JEV_ROUTER' && typeof node.params?.registry === 'string' ? node.params.registry.trim() : '');

export const DESTINATION_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Питання пакета рішень Jev (§22). */
export interface BundleQuestion {
  id: string;
  kind: 'choice' | 'score' | 'noul';
  question: string;
  options?: string[];
  levels?: string[];
}

/** Операції Story Core API (§33) — графи не мають довільного SQL. */
export const STORY_CORE_READ_OPS = ['get_schema', 'get_schema_version', 'get_entity', 'search_entities', 'get_relations', 'get_mentions', 'get_sources'];

export const NODE_TYPES: NodeTypeDef[] = [
  // CORE
  { id: 'START', group: 'core', name: N('Start', 'Початок'), description: 'Вхід процесу: вхідні дані запуску.', inputs: 'none', outputs: ['out'],
    params: [{ id: 'input_schema', name: N('Input schema', 'Схема входу'), type: 'json' },{id:'collaboration_events',name:N('Collaboration events','Події співпраці'),type:'json',hint:'Список типів подій для явного запуску production-процесу людиною.'}] },
  { id: 'END', group: 'core', name: N('End', 'Завершення'), description: 'Кінець гілки процесу.', inputs: 'many', outputs: [], params: [] },
  { id: 'SUBGRAPH', group: 'core', name: N('Subgraph', 'Підграф'), description: 'Виклик іншого опублікованого процесу.', inputs: 'one', outputs: ['out'],
    params: [{ id: 'workflow_id', name: N('Workflow', 'Процес'), type: 'string', required: true }] },
  // STORY CORE
  { id: 'QUERY', group: 'story_core', name: N('Query', 'Запит'), description: 'Читання семантичного ядра операцією Story Core API (§33).', inputs: 'one', outputs: ['out'],
    params: [
      { id: 'operation', name: N('Operation', 'Операція'), type: 'enum', options: STORY_CORE_READ_OPS, required: true, default: 'search_entities' },
      { id: 'entity_scope', name: N('Entity scope', 'Область сутностей'), type: 'string_list' },
      { id: 'limit', name: N('Limit', 'Скільки'), type: 'integer', min: 1, max: 500, default: 50 },
    ] },
  { id: 'CONTEXT', group: 'story_core', name: N('Context', 'Контекст'), description: 'Збирає контекст для моделі в межах області (§37: Context Scope).', inputs: 'one', outputs: ['out'],
    params: [
      { id: 'context_policy', name: N('Context policy', 'Політика контексту'), type: 'enum', options: ['scene', 'chapter', 'entity_scope', 'book_summary'], required: true, default: 'scene' },
      { id: 'entity_scope', name: N('Entity scope', 'Область сутностей'), type: 'string_list' },
      { id: 'max_tokens', name: N('Max tokens', 'Найбільше токенів'), type: 'integer', min: 1, max: 200000, default: 8000 },
    ] },
  { id: 'MEMORY', group: 'story_core', name: N('Memory', 'Пам\'ять'), description: 'Пам\'ять героя (Т2.6): що він знає й пам\'ятає на момент сцени.', inputs: 'one', outputs: ['out'],
    params: [{ id: 'scope', name: N('Scope', 'Область'), type: 'enum', options: ['character', 'scene', 'chapter'], required: true, default: 'character' }] },
  // AI
  { id: 'PROMPT', group: 'ai', name: N('Prompt', 'Інструкція для моделі'), description: 'Шаблон інструкції з версією.', inputs: 'one', outputs: ['out'],
    params: [
      { id: 'template', name: N('Template', 'Шаблон'), type: 'text', required: true },
      { id: 'prompt_version', name: N('Prompt version', 'Версія інструкції'), type: 'string' },
    ] },
  { id: 'LLM', group: 'ai', name: N('LLM', 'Велика мовна модель'), description: 'Виклик моделі з параметрами §5.3.', inputs: 'one', outputs: ['out'], params: MODEL_PARAMS },
  { id: 'AGENT', group: 'ai', name: N('Agent', 'Агент'), description: 'Модель з інструментами й лімітом кроків.', inputs: 'one', outputs: ['out'],
    params: [...MODEL_PARAMS, { id: 'tools', name: N('Tools', 'Інструменти'), type: 'string_list' }, { id: 'max_steps', name: N('Max steps', 'Найбільше кроків'), type: 'integer', min: 1, max: 20, required: true, default: 5 }] },
  { id: 'TOOL', group: 'ai', name: N('Tool', 'Інструмент'), description: 'Виклик інструмента з реєстру платформи.', inputs: 'one', outputs: ['out'],
    params: [{ id: 'max_candidates', name: N('Candidate causes', 'Найбільше кандидатних причин'), type: 'integer', min: 1, max: 20, hint: 'Для causality_propose; до виклику Jev' }, { id: 'tool', name: N('Tool', 'Інструмент'), type: 'string', required: true }, { id: 'adaptive_policy', name: N('Adaptive policy', 'Пороги та глибина аналізу'), type: 'json', hint: 'Для adaptive_dispatch: medium, high, critical, low (skip/minimal), targets {minimal,light,normal,deep}: id підграфів. Шкала — у вузлі importance.' }, { id: 'timeout', name: N('Timeout, s', 'Тайм-аут, с'), type: 'integer', min: 1, max: 600, default: 30 }] },
  // JEV (§36; виконання — Т5.5)
  { id: 'JEV_CHOICE', group: 'jev', name: N('Jev Choice', 'Jev-вибір'), description: 'Вибір одного з варіантів; кожен варіант — окрема гілка.', inputs: 'one', outputs: ['fallback'], dynamicOutputs: 'options',
    params: jevParams([{ id: 'options', name: N('Options', 'Варіанти'), type: 'string_list', required: true, minItems: 2 }]) },
  { id: 'JEV_SCORE', group: 'jev', name: N('Jev Score', 'Jev-оцінка за шкалою'), description: 'Оцінка за шкалою.', inputs: 'one', outputs: ['out', 'fallback'],
    params: jevParams([
      { id: 'scale_min', name: N('Scale min', 'Шкала від'), type: 'number', default: 0 },
      { id: 'scale_max', name: N('Scale max', 'Шкала до'), type: 'number', default: 10 },
      { id: 'levels', name: N('Levels', 'Рівні шкали'), type: 'string_list', hint: 'Від найнижчого, 2–10; порожньо — 6 рівнів між «від» і «до»' },
    ]) },
  { id: 'JEV_NOUL', group: 'jev', name: N('Jev Noul', 'Jev-оцінка істинності'), description: 'Істинність твердження проти порогу.', inputs: 'one', outputs: ['true', 'false', 'fallback'], params: jevParams([], true) },
  { id: 'JEV_ROUTER', group: 'jev', name: N('Jev Router', 'Jev-маршрутизатор'), description: 'Направляє виконання в одну з гілок або в процес із реєстру напрямків (новий напрямок — без переписування маршрутизатора).', inputs: 'one', outputs: ['fallback'], dynamicOutputs: 'routes',
    params: jevParams([
      { id: 'registry', name: N('Destination registry', 'Реєстр напрямків'), type: 'string', hint: 'Задано — варіанти беруться з реєстру, обраний процес виконується як підпроцес (гілка out)' },
      { id: 'routes', name: N('Routes', 'Маршрути'), type: 'string_list', hint: 'Без реєстру — щонайменше дві гілки на канві' },
    ]) },
  { id: 'JEV_GATE', group: 'jev', name: N('Jev Gate', 'Jev-шлюз'), description: 'Питання + поріг + маршрут (§20): пропускає далі, коли відповідь потрібна.', inputs: 'one', outputs: ['pass', 'block', 'fallback'],
    params: jevParams([{ id: 'pass_when', name: N('Pass when', 'Пропускати, коли відповідь'), type: 'enum', options: ['true', 'false'], default: 'true', hint: '«Суперечить канону?» — пропускати, коли «ні» (false)' }], true) },
  { id: 'JEV_EVALUATOR', group: 'jev', name: N('Jev Evaluator', 'Jev-оцінювач'), description: 'Оцінка 0–10 за критеріями; не стає фактом канону (§21).', inputs: 'one', outputs: ['out', 'fallback'],
    params: jevParams([{ id: 'criteria', name: N('Criteria', 'Критерії'), type: 'string_list', required: true, minItems: 1 }]) },
  { id: 'JEV_DECISION_BUNDLE', group: 'jev', name: N('Jev Decision Bundle', 'Пакет рішень Jev'), description: 'Кілька незалежних питань Jev над одним станом одним запитом (§22).', inputs: 'one', outputs: ['out', 'fallback'],
    params: jevParams([{ id: 'questions', name: N('Questions', 'Питання'), type: 'json', required: true, hint: '[{"id","kind":"choice|score|noul","question","options"|"levels"}], 1–10' }]) },
  // CONTROL
  { id: 'CONDITION', group: 'control', name: N('Condition', 'Умова'), description: 'Розгалуження за умовою над станом.', inputs: 'one', outputs: ['true', 'false'],
    params: [{ id: 'expression', name: N('Expression', 'Умова'), type: 'string', required: true, hint: 'Напр. state.confidence >= 0.7' }] },
  { id: 'PARALLEL', group: 'control', name: N('Parallel', 'Паралельно'), description: 'Запускає кілька гілок одночасно.', inputs: 'one', outputs: ['out'], fanOut: true, params: [] },
  { id: 'MERGE', group: 'control', name: N('Merge', 'Злиття'), description: 'Чекає гілки й зливає їхній стан.', inputs: 'many', outputs: ['out'],
    params: [{ id: 'strategy', name: N('Strategy', 'Як зливати'), type: 'enum', options: ['all', 'first', 'majority'], required: true, default: 'all' }] },
  { id: 'LOOP', group: 'control', name: N('Loop', 'Цикл'), description: 'Повтор тіла з лімітом ітерацій; єдиний дозволений спосіб циклу.', inputs: 'many', outputs: ['body', 'done'],
    params: [{ id: 'max_iterations', name: N('Max iterations', 'Найбільше повторів'), type: 'integer', min: 1, max: 20, required: true, default: 3 }] },
  // VALIDATION
  { id: 'VALIDATOR', group: 'validation', name: N('Validator', 'Перевіряльник'), description: 'Перевірка виходу за схемою й правилами онтології.', inputs: 'one', outputs: ['valid', 'invalid'],
    params: [{ id: 'rules', name: N('Rules', 'Правила'), type: 'string_list' }, { id: 'output_schema', name: N('Output schema', 'Схема'), type: 'json' }] },
  { id: 'CONTINUITY_GATE', group: 'validation', name: N('Continuity Gate', 'Шлюз безперервності'), description: 'Блокує запис, що суперечить канону (§15).', inputs: 'one', outputs: ['pass', 'block'],
    params: [{ id: 'checks', name: N('Checks', 'Перевірки'), type: 'string_list', default: [...CONTINUITY_CHECKS] }] },
  // HUMAN
  { id: 'HUMAN_REVIEW', group: 'human', name: N('Human Review', 'Перевірка людиною'), description: 'Автор приймає, править або відхиляє (§24).', inputs: 'one', outputs: ['accept', 'edit', 'reject'],
    params: [{ id: 'reviewer', name: N('Reviewer', 'Хто перевіряє'), type: 'enum', options: ['author', 'editor', 'any_with_canon_write'], required: true, default: 'author' }] },
  // OUTPUT
  { id: 'PROPOSAL', group: 'output', name: N('Proposal', 'Пропозиція'), description: 'Вихід ШІ — пропозиція, не канон (§24).', inputs: 'one', outputs: ['out'],
    params: [
      { id: 'target', name: N('Target', 'Що пропонує'), type: 'enum', options: ['entity', 'relation', 'mention', 'fact', 'memory', 'text'], required: true, default: 'fact' },
      // Т5.4: поріг (№11) — нижче нього висновок не стає пропозицією.
      { id: 'min_confidence', name: N('Min confidence', 'Поріг впевненості'), type: 'number', min: 0, max: 1, default: 0 },
    ] },
  { id: 'CANON_WRITE', group: 'output', name: N('Canon Write', 'Запис у канон'), description: 'Ревізія + походження + аудит (§24, §25); лише після перевірки людиною.', inputs: 'many', outputs: ['out'],
    params: [{ id: 'target', name: N('Target', 'Що записує'), type: 'enum', options: ['entity', 'relation', 'mention', 'fact', 'memory'], required: true, default: 'fact' }] },
];

const NODE_TYPE_MAP = new Map(NODE_TYPES.map((t) => [t.id, t]));

/**
 * Вузли, які рушій уже виконує (Т5.4–Т5.7 В1). Решта зупиняє запуск
 * зрозумілою помилкою: AGENT, PARALLEL / MERGE / LOOP — пізніше.
 */
export const EXECUTABLE_NODE_TYPES = [
  'START', 'END', 'CONTEXT', 'MEMORY', 'QUERY', 'PROMPT', 'LLM', 'TOOL', 'CONDITION', 'VALIDATOR', 'PROPOSAL', 'HUMAN_REVIEW', 'CANON_WRITE', 'CONTINUITY_GATE',
  // Т5.5: шар рішень Jev і підпроцес.
  'SUBGRAPH', 'JEV_CHOICE', 'JEV_SCORE', 'JEV_NOUL', 'JEV_ROUTER', 'JEV_GATE', 'JEV_EVALUATOR', 'JEV_DECISION_BUNDLE',
];
export const isExecutableNode = (type: string): boolean => EXECUTABLE_NODE_TYPES.includes(type);
export const nodeTypeById = (id: string): NodeTypeDef | undefined => NODE_TYPE_MAP.get(id);

// ---------------------------------------------------------------------------
// Визначення
// ---------------------------------------------------------------------------

export interface WorkflowNode {
  id: string;
  type: string;
  label?: string;
  params: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  /** Гілка виходу вузла-початку (`out`, `true`, варіант Jev-вибору…). */
  fromPort: string;
  to: string;
}

export interface WorkflowDefinition {
  format: typeof WORKFLOW_FORMAT;
  /** Машинний id процесу (`ai1_mentions`). Незмінний. */
  id: string;
  name: LocalizedName;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** Позиції вузлів на канві — окремо від визначення (№28). */
export type GraphLayout = Record<string, { x: number; y: number }>;

export const WORKFLOW_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Гілки виходу вузла з урахуванням параметра-списку (варіанти, маршрути). */
export function nodeOutputs(node: WorkflowNode): string[] {
  const t = nodeTypeById(node.type);
  if (!t) return [];
  const review = needsReviewBranch(node) ? ['review'] : [];
  // Т5.5: маршрутизатор із реєстром напрямків — підпроцес і далі `out`.
  if (routerRegistry(node)) return ['out', ...t.outputs, ...review];
  const extra = t.dynamicOutputs && Array.isArray(node.params?.[t.dynamicOutputs]) ? (node.params[t.dynamicOutputs] as unknown[]).map(String).filter(Boolean) : [];
  return [...extra, ...t.outputs, ...review];
}

/** Т5.5: питання пакета рішень Jev — розбір і перевірка (null — гаразд). */
export function bundleQuestionsError(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 10) return 'від 1 до 10 питань';
  const ids = new Set<string>();
  for (const [i, q] of v.entries()) {
    const at = `питання ${i + 1}`;
    if (!q || typeof q !== 'object') return `${at}: має бути об'єктом`;
    const x = q as Record<string, unknown>;
    if (typeof x.id !== 'string' || !DESTINATION_ID_RE.test(x.id)) return `${at}: id — латиниця, цифри й «_», з літери`;
    if (ids.has(x.id)) return `${at}: id «${x.id}» повторюється`;
    ids.add(x.id);
    if (!['choice', 'score', 'noul'].includes(String(x.kind))) return `${at}: kind — choice, score чи noul`;
    if (typeof x.question !== 'string' || !x.question.trim()) return `${at}: потрібен текст питання`;
    const list = (k: string) => (Array.isArray(x[k]) ? (x[k] as unknown[]).filter((s) => typeof s === 'string' && s.trim()).length : 0);
    if (x.kind === 'choice' && list('options') < 2) return `${at}: щонайменше два варіанти (options)`;
    if (x.kind === 'score' && (list('levels') < 2 || list('levels') > 10)) return `${at}: від 2 до 10 рівнів (levels)`;
  }
  return null;
}

/** Параметри за замовчуванням для нового вузла палітри. */
export function defaultParams(type: string): Record<string, unknown> {
  const t = nodeTypeById(type);
  const out: Record<string, unknown> = {};
  for (const p of t?.params ?? []) if (p.default !== undefined) out[p.id] = Array.isArray(p.default) ? [...p.default] : p.default;
  return out;
}

/** Порожній процес: START → END. */
export function emptyWorkflow(id: string, name: LocalizedName, description = ''): WorkflowDefinition {
  return {
    format: WORKFLOW_FORMAT,
    id,
    name,
    description,
    nodes: [
      { id: 'start', type: 'START', params: {} },
      { id: 'end', type: 'END', params: {} },
    ],
    edges: [{ id: 'e-start-end', from: 'start', fromPort: 'out', to: 'end' }],
  };
}

/** Зразок §5.1: рукопис → виділення → … → перевірка людиною → запис у канон. */
export function samplePipeline(): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'START', label: 'Manuscript (Рукопис)', params: {} },
    { id: 'context', type: 'CONTEXT', label: 'Scene context (Контекст сцени)', params: defaultParams('CONTEXT') },
    { id: 'extract', type: 'LLM', label: 'Extract entities (Виділити сутності)', params: { ...defaultParams('LLM'), system_prompt: 'Виділи сутності з тегами онтології.' } },
    { id: 'classify', type: 'VALIDATOR', label: 'Classify (Класифікувати)', params: { rules: ['relation_endpoints'] } },
    { id: 'decide', type: 'JEV_GATE', label: 'Decision (Прийняти рішення)', params: { ...defaultParams('JEV_GATE'), question: 'Чи достатньо доказів у тексті?' } },
    { id: 'gate', type: 'CONTINUITY_GATE', label: 'Validate (Перевірити)', params: defaultParams('CONTINUITY_GATE') },
    { id: 'proposal', type: 'PROPOSAL', label: 'Proposal (Пропозиція)', params: { target: 'fact' } },
    { id: 'review', type: 'HUMAN_REVIEW', label: 'Human review (Перевірка людиною)', params: { reviewer: 'author' } },
    { id: 'canon', type: 'CANON_WRITE', label: 'Canon write (Запис у канон)', params: { target: 'fact' } },
    { id: 'end', type: 'END', params: {} },
  ];
  const e = (from: string, fromPort: string, to: string): WorkflowEdge => ({ id: `e-${from}-${fromPort}-${to}`, from, fromPort, to });
  return {
    format: WORKFLOW_FORMAT,
    id: 'sample_canon_pipeline',
    name: { en: 'Sample: manuscript to canon', uk: 'Зразок: від рукопису до канону' },
    description: 'Конвеєр ТЗ §5.1 — вихід ШІ стає пропозицією, у канон потрапляє лише після перевірки людиною.',
    nodes,
    edges: [
      e('start', 'out', 'context'), e('context', 'out', 'extract'), e('extract', 'out', 'classify'),
      e('classify', 'valid', 'decide'), e('classify', 'invalid', 'end'),
      e('decide', 'pass', 'gate'), e('decide', 'block', 'end'), e('decide', 'fallback', 'proposal'),
      e('gate', 'pass', 'proposal'), e('gate', 'block', 'end'),
      e('proposal', 'out', 'review'),
      e('review', 'accept', 'canon'), e('review', 'edit', 'canon'), e('review', 'reject', 'end'),
      e('canon', 'out', 'end'),
    ],
  };
}

// ---------------------------------------------------------------------------
// Перевірка
// ---------------------------------------------------------------------------

export interface WorkflowIssue {
  code: string;
  /** Де: `nodes.extract.params.temperature`, `edges.e1`. */
  path: string;
  message: string;
  /** Вузол чи ребро, до якого прив'язати підсвітку на канві. */
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowValidation {
  ok: boolean;
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
}

const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

function checkParam(p: ParamDef, v: unknown): string | null {
  if (v === undefined || v === null || v === '') return p.required ? 'обов\'язковий' : null;
  switch (p.type) {
    case 'string':
    case 'text':
      return typeof v === 'string' ? (p.required && !v.trim() ? 'обов\'язковий' : null) : 'має бути текстом';
    case 'number':
    case 'integer': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'має бути числом';
      if (p.type === 'integer' && !Number.isInteger(v)) return 'має бути цілим';
      if (p.min !== undefined && v < p.min) return `не менше ${p.min}`;
      if (p.max !== undefined && v > p.max) return `не більше ${p.max}`;
      return null;
    }
    case 'boolean':
      return typeof v === 'boolean' ? null : 'має бути так / ні';
    case 'enum':
      return typeof v === 'string' && (p.options ?? []).includes(v) ? null : `одне з: ${(p.options ?? []).join(', ')}`;
    case 'string_list': {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return 'має бути списком рядків';
      const items = (v as string[]).map((x) => x.trim()).filter(Boolean);
      if (items.length !== v.length) return 'порожній елемент';
      if (new Set(items).size !== items.length) return 'елементи повторюються';
      if (p.minItems && items.length < p.minItems) return `щонайменше ${p.minItems}`;
      if (p.required && items.length === 0) return 'обов\'язковий';
      return null;
    }
    case 'json':
      return typeof v === 'object' ? null : 'має бути об\'єктом JSON';
    default:
      return null;
  }
}

/**
 * Структурна перевірка процесу перед тестом і публікацією. Не знає про
 * інші процеси (чи опублікований підграф) — це перевіряє сервер.
 */
export function validateWorkflow(def: WorkflowDefinition): WorkflowValidation {
  const errors: WorkflowIssue[] = [];
  const warnings: WorkflowIssue[] = [];
  const err = (code: string, path: string, message: string, at: { nodeId?: string; edgeId?: string } = {}) => errors.push({ code, path, message, ...at });
  const warn = (code: string, path: string, message: string, at: { nodeId?: string; edgeId?: string } = {}) => warnings.push({ code, path, message, ...at });

  if (!def || typeof def !== 'object') return { ok: false, errors: [{ code: 'bad_definition', path: '', message: 'Визначення процесу відсутнє' }], warnings };
  if (def.format !== WORKFLOW_FORMAT) err('bad_format', 'format', `Формат має бути ${WORKFLOW_FORMAT}`);
  if (!WORKFLOW_ID_RE.test(String(def.id ?? ''))) err('bad_id', 'id', 'Id процесу — латиниця, цифри й «_», від 2 до 64 символів, з літери');
  if (!nonEmpty(def.name?.en) || !nonEmpty(def.name?.uk)) err('missing_name', 'name', 'Назва процесу потрібна англійською й українською (ТЗ §0)');
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];

  // Вузли
  const byId = new Map<string, WorkflowNode>();
  for (const n of nodes) {
    const path = `nodes.${n?.id}`;
    if (!n || !NODE_ID_RE.test(String(n.id ?? ''))) { err('bad_node_id', path, 'Id вузла — латиниця, цифри, «_» і «-», до 64 символів'); continue; }
    if (byId.has(n.id)) { err('duplicate_node', path, `Вузол «${n.id}» уже є`, { nodeId: n.id }); continue; }
    byId.set(n.id, n);
    const t = nodeTypeById(n.type);
    if (!t) { err('unknown_node_type', `${path}.type`, `Невідомий тип вузла «${n.type}»`, { nodeId: n.id }); continue; }
    const params = n.params && typeof n.params === 'object' ? n.params : {};
    for (const p of t.params) {
      const problem = checkParam(p, (params as Record<string, unknown>)[p.id]);
      if (problem) err('bad_param', `${path}.params.${p.id}`, `${t.name.uk} «${n.label || n.id}»: ${p.name.uk} — ${problem}`, { nodeId: n.id });
    }
    if (t.id === 'TOOL' && params.tool === 'adaptive_dispatch') {
      const score = nodes.find(x => x.id === 'importance' && x.type === 'JEV_SCORE');
      const problem = score ? adaptivePolicyError(params.adaptive_policy, Number(score.params.scale_min ?? 0), Number(score.params.scale_max ?? 10)) : 'Потрібен вузол importance типу JEV_SCORE';
      if (problem) err('bad_adaptive_policy', `${path}.params.adaptive_policy`, problem, { nodeId: n.id });
    }
    if (t.id === 'CONDITION' && typeof (params as Record<string, unknown>).expression === 'string') {
      const problem = exprError((params as Record<string, unknown>).expression);
      if (problem) err('bad_expression', `${path}.params.expression`, `Умова «${n.label || n.id}»: ${problem}`, { nodeId: n.id });
    }
    for (const k of Object.keys(params)) if (!t.params.some((p) => p.id === k)) warn('unknown_param', `${path}.params.${k}`, `Параметр «${k}» не належить типу ${t.id} — буде проігноровано`, { nodeId: n.id });
    if (t.dynamicOutputs) {
      const outs = nodeOutputs(n);
      if (new Set(outs).size !== outs.length) err('duplicate_branch', `${path}.params.${t.dynamicOutputs}`, `Гілки вузла «${n.label || n.id}» повторюються (зокрема з «fallback» чи «review»)`, { nodeId: n.id });
    }
    // Т5.5: шар рішень Jev — узгодженість параметрів.
    if (t.group === 'jev') {
      const pr = params as Record<string, unknown>;
      const hi = typeof pr.confidence_high === 'number' ? pr.confidence_high : 0.9;
      const mid = typeof pr.confidence_medium === 'number' ? pr.confidence_medium : 0.6;
      if (mid > hi) err('bad_confidence_levels', `${path}.params.confidence_medium`, `${t.name.uk} «${n.label || n.id}»: середня впевненість не може бути вищою за високу`, { nodeId: n.id });
      if (t.id === 'JEV_ROUTER' && !routerRegistry(n)) {
        const routes = Array.isArray(pr.routes) ? (pr.routes as unknown[]).filter((x) => typeof x === 'string' && x.trim()) : [];
        if (routes.length < 2) err('bad_param', `${path}.params.routes`, `${t.name.uk} «${n.label || n.id}»: без реєстру напрямків потрібні щонайменше дві гілки`, { nodeId: n.id });
      }
      if (t.id === 'JEV_ROUTER' && routerRegistry(n) && !DESTINATION_ID_RE.test(routerRegistry(n))) err('bad_param', `${path}.params.registry`, `${t.name.uk} «${n.label || n.id}»: реєстр — латиниця, цифри й «_», з літери`, { nodeId: n.id });
      if (t.id === 'JEV_SCORE') {
        const lv = Array.isArray(pr.levels) ? (pr.levels as unknown[]).length : 0;
        if (lv && (lv < 2 || lv > 10)) err('bad_param', `${path}.params.levels`, `${t.name.uk} «${n.label || n.id}»: рівнів шкали — від 2 до 10`, { nodeId: n.id });
        const lo = typeof pr.scale_min === 'number' ? pr.scale_min : 0;
        const up = typeof pr.scale_max === 'number' ? pr.scale_max : 10;
        if (!(lo < up)) err('bad_param', `${path}.params.scale_max`, `${t.name.uk} «${n.label || n.id}»: «шкала до» має бути більшою за «шкала від»`, { nodeId: n.id });
      }
      if (t.id === 'JEV_DECISION_BUNDLE' && pr.questions !== undefined) {
        const problem = bundleQuestionsError(pr.questions);
        if (problem) err('bad_bundle', `${path}.params.questions`, `${t.name.uk} «${n.label || n.id}»: ${problem}`, { nodeId: n.id });
      }
    }
  }
  for (const node of nodes) if (node?.type === 'CONTINUITY_GATE' && node.params?.checks !== undefined) {
    const checks = node.params.checks;
    if (!Array.isArray(checks) || !checks.length || checks.some(x => !CONTINUITY_CHECKS.includes(x as typeof CONTINUITY_CHECKS[number]))) {
      err('bad_param', `nodes.${node.id}.params.checks`, 'Continuity Gate: оберіть чинні правила безперервності', { nodeId: node.id });
    }
  }
  const starts = nodes.filter((n) => n?.type === 'START');
  const ends = nodes.filter((n) => n?.type === 'END');
  if (starts.length !== 1) err('start_count', 'nodes', starts.length ? 'Вузол START має бути один' : 'Немає вузла START');
  if (!ends.length) err('no_end', 'nodes', 'Немає вузла END');

  // Ребра
  const edgeIds = new Set<string>();
  const out = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, number>();
  for (const e of edges) {
    const path = `edges.${e?.id}`;
    if (!e || !NODE_ID_RE.test(String(e.id ?? ''))) { err('bad_edge_id', path, 'Id ребра — латиниця, цифри, «_» і «-»'); continue; }
    if (edgeIds.has(e.id)) { err('duplicate_edge', path, `Ребро «${e.id}» уже є`, { edgeId: e.id }); continue; }
    edgeIds.add(e.id);
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) { err('dangling_edge', path, 'Ребро веде з або до вузла, якого немає', { edgeId: e.id }); continue; }
    if (e.from === e.to) { err('self_loop', path, 'Вузол не може вести сам у себе', { edgeId: e.id }); continue; }
    const tTo = nodeTypeById(to.type);
    if (tTo?.inputs === 'none') { err('edge_into_start', path, 'У START ребра не входять', { edgeId: e.id }); continue; }
    const outs = nodeOutputs(from);
    if (!outs.includes(e.fromPort)) { err('bad_port', path, `У вузла «${from.label || from.id}» немає гілки «${e.fromPort}»`, { edgeId: e.id, nodeId: from.id }); continue; }
    const list = out.get(e.from) ?? [];
    if (list.some((x) => x.to === e.to && x.fromPort === e.fromPort)) { err('duplicate_edge', path, 'Таке ребро вже є', { edgeId: e.id }); continue; }
    list.push(e);
    out.set(e.from, list);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  for (const n of byId.values()) {
    const t = nodeTypeById(n.type);
    if (!t) continue;
    const list = out.get(n.id) ?? [];
    for (const port of nodeOutputs(n)) {
      const k = list.filter((e) => e.fromPort === port).length;
      if (k === 0) {
        const code = port === 'fallback' ? 'missing_fallback' : 'unconnected_branch';
        err(code, `nodes.${n.id}.outputs.${port}`, port === 'fallback'
          ? `${t.name.uk} «${n.label || n.id}»: потрібен резервний маршрут (fallback)`
          : `Гілка «${port}» вузла «${n.label || n.id}» нікуди не веде`, { nodeId: n.id });
      } else if (k > 1 && !t.fanOut) {
        err('fan_out', `nodes.${n.id}.outputs.${port}`, `Гілка «${port}» вузла «${n.label || n.id}» веде в кілька вузлів — для цього є PARALLEL`, { nodeId: n.id });
      }
    }
    if (t.inputs === 'one' && (incoming.get(n.id) ?? 0) > 1) {
      warn('many_inputs', `nodes.${n.id}`, `У «${n.label || n.id}» входить кілька ребер — виконається від кожного; для злиття є MERGE`, { nodeId: n.id });
    }
  }

  // Досяжність і цикли
  const start = starts[0];
  if (start && byId.has(start.id)) {
    const reach = new Set<string>([start.id]);
    const stack = [start.id];
    while (stack.length) for (const e of out.get(stack.pop()!) ?? []) if (!reach.has(e.to)) { reach.add(e.to); stack.push(e.to); }
    for (const n of byId.values()) if (!reach.has(n.id)) err('unreachable', `nodes.${n.id}`, `Вузол «${n.label || n.id}» недосяжний з START`, { nodeId: n.id });
    // Звідки досяжний END: зворотний обхід.
    const back = new Map<string, string[]>();
    for (const list of out.values()) for (const e of list) back.set(e.to, [...(back.get(e.to) ?? []), e.from]);
    const toEnd = new Set<string>(ends.map((n) => n.id));
    const st = [...toEnd];
    while (st.length) for (const f of back.get(st.pop()!) ?? []) if (!toEnd.has(f)) { toEnd.add(f); st.push(f); }
    for (const n of byId.values()) if (reach.has(n.id) && !toEnd.has(n.id)) err('dead_end', `nodes.${n.id}`, `З вузла «${n.label || n.id}» не дійти до END`, { nodeId: n.id });
    // Запис у канон — лише через перевірку людиною (§24): без HUMAN_REVIEW канон недосяжний.
    const reachNoReview = new Set<string>([start.id]);
    const s2 = [start.id];
    while (s2.length) {
      const cur = s2.pop()!;
      if (byId.get(cur)?.type === 'HUMAN_REVIEW') continue;
      for (const e of out.get(cur) ?? []) if (!reachNoReview.has(e.to)) { reachNoReview.add(e.to); s2.push(e.to); }
    }
    for (const n of byId.values()) if (n.type === 'CANON_WRITE' && reachNoReview.has(n.id)) err('canon_without_review', `nodes.${n.id}`, `«${n.label || n.id}»: запис у канон досяжний в обхід перевірки людиною (§24)`, { nodeId: n.id });
  }
  // Цикли — лише через LOOP (Tarjan).
  {
    let index = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];
    const visit = (v: string) => {
      idx.set(v, index); low.set(v, index); index++; stack.push(v); onStack.add(v);
      for (const e of out.get(v) ?? []) {
        if (!idx.has(e.to)) { visit(e.to); low.set(v, Math.min(low.get(v)!, low.get(e.to)!)); }
        else if (onStack.has(e.to)) low.set(v, Math.min(low.get(v)!, idx.get(e.to)!));
      }
      if (low.get(v) === idx.get(v)) {
        const c: string[] = [];
        let w: string;
        do { w = stack.pop()!; onStack.delete(w); c.push(w); } while (w !== v);
        sccs.push(c);
      }
    };
    for (const id of byId.keys()) if (!idx.has(id)) visit(id);
    for (const c of sccs) {
      if (c.length < 2) continue;
      if (!c.some((id) => byId.get(id)?.type === 'LOOP')) err('cycle_without_loop', `nodes.${c[0]}`, `Цикл ${c.join(' → ')} — повтор лише через вузол LOOP з лімітом`, { nodeId: c[0] });
    }
  }
  for (const n of byId.values()) {
    if (n.type === 'SUBGRAPH' && n.params?.workflow_id === def.id) err('self_subgraph', `nodes.${n.id}.params.workflow_id`, 'Процес не може викликати сам себе', { nodeId: n.id });
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Семантика: хеш і різниця
// ---------------------------------------------------------------------------

/**
 * Семантичний відбиток визначення: канонічний JSON без порядку вузлів і
 * ребер. Розкладки тут немає за побудовою (№28); порядок у масивах —
 * теж не семантика (вузол, перетягнутий у палітрі першим, — той самий граф).
 */
export function workflowSemanticJson(def: WorkflowDefinition): string {
  const byId = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
  return canonicalJson({ ...def, nodes: byId(def.nodes ?? []), edges: byId(def.edges ?? []) });
}

export interface WorkflowDiff {
  nodes: { added: string[]; removed: string[]; changed: { id: string; fields: string[] }[] };
  edges: { added: string[]; removed: string[] };
  meta: string[];
  changed: boolean;
}

export function diffWorkflows(before: WorkflowDefinition, after: WorkflowDefinition): WorkflowDiff {
  const a = new Map(before.nodes.map((n) => [n.id, n]));
  const b = new Map(after.nodes.map((n) => [n.id, n]));
  const added = after.nodes.filter((n) => !a.has(n.id)).map((n) => n.id);
  const removed = before.nodes.filter((n) => !b.has(n.id)).map((n) => n.id);
  const changed: { id: string; fields: string[] }[] = [];
  for (const [id, n] of b) {
    const o = a.get(id);
    if (!o) continue;
    const fields: string[] = [];
    if (o.type !== n.type) fields.push('type');
    if ((o.label ?? '') !== (n.label ?? '')) fields.push('label');
    for (const k of new Set([...Object.keys(o.params ?? {}), ...Object.keys(n.params ?? {})])) if (canonicalJson(o.params?.[k]) !== canonicalJson(n.params?.[k])) fields.push(`params.${k}`);
    if (fields.length) changed.push({ id, fields });
  }
  const key = (e: WorkflowEdge) => `${e.from}:${e.fromPort}>${e.to}`;
  const ea = new Set(before.edges.map(key));
  const eb = new Set(after.edges.map(key));
  const edges = { added: [...eb].filter((k) => !ea.has(k)), removed: [...ea].filter((k) => !eb.has(k)) };
  const meta = (['name', 'description'] as const).filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k]));
  return { nodes: { added, removed, changed }, edges, meta, changed: added.length + removed.length + changed.length + edges.added.length + edges.removed.length + meta.length > 0 };
}

/** Чиста розкладка: лише вузли визначення, числа скінченні й обмежені. */
export function sanitizeLayout(def: WorkflowDefinition | { nodes: { id: string }[] } | null, layout: unknown): GraphLayout {
  const ids = def ? new Set(def.nodes.map((n) => n.id)) : null;
  const out: GraphLayout = {};
  if (!layout || typeof layout !== 'object') return out;
  for (const [id, p] of Object.entries(layout as Record<string, unknown>)) {
    if (ids && !ids.has(id)) continue;
    const x = Number((p as { x?: unknown })?.x);
    const y = Number((p as { y?: unknown })?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) continue;
    out[id] = { x: Math.round(x), y: Math.round(y) };
  }
  return out;
}
