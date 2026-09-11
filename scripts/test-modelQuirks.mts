/**
 * Самонавчання контракту моделі (server/modelQuirks.ts).
 * Запуск: npm run test:model-quirks
 *
 * Формулювання помилок узяті дослівно з відповідей провайдерів — саме на
 * них система й має вчитись, а не на вигаданих.
 */
const { DEFAULT_QUIRKS, adaptQuirks, buildOpenAiBody, quirksFor, rememberQuirks, __resetLearnedQuirks } =
  await import('../server/modelQuirks');

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

__resetLearnedQuirks();

console.log('Помилка, через яку все й почалось (GPT-4o у власника):');
{
  const msg = "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
  const next = adaptQuirks('gpt-4o', msg);
  t('розпізнано як помилку параметра', next !== null);
  t('перемкнено на max_completion_tokens', next?.tokenParam === 'max_completion_tokens');
  t('решта параметрів не зачеплена', next?.supportsTemperature === true && next?.supportsJsonMode === true);
}

console.log('\nІнші формулювання того самого:');
t('«Unrecognized request argument: max_tokens»',
  adaptQuirks('m1', 'Unrecognized request argument supplied: max_tokens')?.tokenParam === 'max_completion_tokens');
t('«model does not support max_tokens»',
  adaptQuirks('m2', 'This model does not support max_tokens')?.tokenParam === 'max_completion_tokens');

console.log('\nTemperature:');
t('«Unsupported value: temperature»',
  adaptQuirks('m3', "Unsupported value: 'temperature' does not support 0.7 with this model")?.supportsTemperature === false);
t('«only the default (1) value is supported»',
  adaptQuirks('m4', "Unsupported value: 'temperature' only the default (1) value is supported")?.supportsTemperature === false);

console.log('\nРежим JSON:');
t('«response_format is not supported»',
  adaptQuirks('m5', "Unsupported parameter: 'response_format' is not supported with this model")?.supportsJsonMode === false);

console.log('\nЩО НЕ МАЄ вважатись помилкою параметра (повтор безглуздий):');
t('невалідний ключ', adaptQuirks('m6', 'Authentication Fails, Your api key: ****3986 is invalid') === null);
t('вичерпано квоту', adaptQuirks('m7', 'You exceeded your current quota, please check your plan and billing details') === null);
t('немає балансу', adaptQuirks('m8', 'Insufficient Balance') === null);
t('ліміт частоти', adaptQuirks('m9', 'Rate limit reached for requests') === null);
t('порожнє повідомлення', adaptQuirks('m10', '') === null);
t('модель не існує', adaptQuirks('m11', 'The model `gpt-9` does not exist') === null);

console.log('\nВивчене запам\'ятовується й не «довчається» вдруге:');
{
  __resetLearnedQuirks();
  const first = adaptQuirks('gpt-x', "Unsupported parameter: 'max_tokens' is not supported. Use 'max_completion_tokens' instead.");
  t('перший раз — є що виправити', first !== null);
  rememberQuirks('gpt-x', first!);
  t('запам\'ятано', quirksFor('gpt-x').tokenParam === 'max_completion_tokens');
  t('та сама помилка вдруге вже нічого не змінює (немає циклу)',
    adaptQuirks('gpt-x', "Unsupported parameter: 'max_tokens' is not supported. Use 'max_completion_tokens' instead.") === null);
  t('інша модель не зачеплена', quirksFor('gpt-4o-mini').tokenParam === 'max_tokens');
}

console.log('\nТіло запиту будується за вивченим:');
{
  const messages = [{ role: 'user', content: 'hi' }];
  const wide = buildOpenAiBody({ modelId: 'a', messages, json: true, quirks: DEFAULT_QUIRKS });
  t('типово: max_tokens + temperature + response_format',
    'max_tokens' in wide && 'temperature' in wide && 'response_format' in wide);

  const narrow = buildOpenAiBody({
    modelId: 'b', messages, json: true,
    quirks: { tokenParam: 'max_completion_tokens', supportsTemperature: false, supportsJsonMode: false },
  });
  t('звужено: max_completion_tokens', 'max_completion_tokens' in narrow && !('max_tokens' in narrow));
  t('звужено: temperature не надсилається', !('temperature' in narrow));
  t('звужено: response_format не надсилається', !('response_format' in narrow));
  t('модель і повідомлення на місці в обох', wide.model === 'a' && narrow.model === 'b');
  t('json:false не додає response_format навіть коли модель уміє',
    !('response_format' in buildOpenAiBody({ modelId: 'c', messages, quirks: DEFAULT_QUIRKS })));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);
