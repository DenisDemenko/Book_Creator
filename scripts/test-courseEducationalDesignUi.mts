import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('../src/components/CourseStudioView.tsx', import.meta.url), 'utf8');
const legacy = await readFile(new URL('../src/components/CourseStudioLegacy.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/CourseEducationalDesignPanel.tsx', import.meta.url), 'utf8');

console.log('\nCourse educational design UI regression contract:');

assert.match(shell, /CourseStudioView as LegacyCourseStudioView/);
assert.match(shell, /data-course-studio-workspace/);
assert.match(shell, /Дизайн навчальних матеріалів/);
assert.match(shell, /CourseEducationalDesignPanel/);
assert.match(shell, /Зміст курсу не дублюється/);
console.log('  ✓ educational design is an additive sibling workspace around the preserved course editor');

assert.match(shell, /\/api\/courses/);
assert.match(shell, /\/api\/courses\/\$\{selectedId\}/);
assert.match(shell, /data-course-design-tab/);
assert.match(shell, /Оберіть курс/);
console.log('  ✓ design workspace resolves a real stored course and keeps an explicit course selector');

assert.match(legacy, /Створити курс/);
assert.match(legacy, /Дерево курсу/);
assert.match(legacy, /Готовність/);
assert.match(legacy, /Опублікувати/);
console.log('  ✓ legacy authoring/publishing workspace remains intact');

for (const label of ['Методичка', 'Інструкція', 'Вправи / домашнє']) {
  assert.ok(panel.includes(label), `Educational design category is missing: ${label}`);
}
assert.match(panel, /\/api\/pdf\/designcraft\/theme-preview/);
assert.match(panel, /educationalTemplateId: templateId/);
assert.match(panel, /localStorage/);
console.log('  ✓ panel keeps three educational categories, DesignCraft preview, and presentation-only preferences');

console.log('\nCourse educational design UI regression contract passed.');
