import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shell = await readFile(new URL('../src/components/CourseStudioView.tsx', import.meta.url), 'utf8');
const legacy = await readFile(new URL('../src/components/CourseStudioLegacy.tsx', import.meta.url), 'utf8');
const panel = await readFile(new URL('../src/components/CourseEducationalDesignPanel.tsx', import.meta.url), 'utf8');
const designer = await readFile(new URL('../src/components/EducationalTemplateDesigner.tsx', import.meta.url), 'utf8');

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

assert.match(shell, /const \[coursesLoaded, setCoursesLoaded\] = useState\(false\)/);
assert.match(shell, /if \(mode === 'design' && !coursesLoaded && !loadingList\) void loadCourses\(\)/);
assert.match(shell, /setCoursesLoaded\(true\)/);
assert.doesNotMatch(shell, /mode === 'design' && courses\.length === 0 && !loadingList/);
console.log('  ✓ empty course lists are treated as loaded and cannot trigger an automatic refetch loop');

assert.match(shell, /data-course-content-workspace/);
assert.match(shell, /mode === 'course' \? '' : 'hidden'/);
assert.match(shell, /<LegacyCourseStudioView onOpenWizard=\{onOpenWizard\} initialCourseId=\{initialCourseId\} lang=\{lang\} \/>/);
assert.match(shell, /\{mode === 'design' \? \(/);
assert.match(shell, /data-course-design-workspace/);
assert.doesNotMatch(shell, /\{mode === 'course' \? \(\s*<div[^>]*>\s*<LegacyCourseStudioView/s);
console.log('  ✓ course authoring editor stays mounted while design workspace is shown, preserving unsaved local state');

assert.match(legacy, /Створити курс/);
assert.match(legacy, /Дерево курсу/);
assert.match(legacy, /Готовність/);
assert.match(legacy, /Надіслати на модерацію/);  // з 27.10.2026 кнопка названа чесно: курс іде на модерацію, а не одразу у вітрину
console.log('  ✓ legacy authoring/publishing workspace remains intact');

for (const label of ['Методичка', 'Інструкція', 'Вправи / домашнє']) {
  assert.ok(panel.includes(label), `Educational design category is missing: ${label}`);
}
assert.match(panel, /\/api\/pdf\/designcraft\/theme-preview/);
assert.match(panel, /educationalTemplateId: templateId/);
assert.match(panel, /customTheme: options\.customTheme/);
assert.match(panel, /nova-course-educational-custom-themes/);
assert.match(panel, /EducationalTemplateDesigner/);
assert.match(panel, /setDesignerTemplateId\(template\.id\)/);
console.log('  ✓ panel keeps three categories, DesignCraft preview, custom themes, and a real Customize handoff');

assert.match(designer, /data-educational-designer-mode/);
assert.match(designer, /Designer Mode/);
assert.match(designer, /basedOn = template\.rendererBaseTheme/);
assert.match(designer, /Зберегти тему/);
assert.match(designer, /PDF preview/);
for (const semanticLabel of [
  'Мета / ключова ідея',
  'Практика / проєкт',
  'Безпека / оцінювання',
  'Матеріали / flow-картки',
  'Крок інструкції',
  'Рефлексія / питання',
]) {
  assert.ok(designer.includes(semanticLabel), `Designer semantic control is missing: ${semanticLabel}`);
}
console.log('  ✓ educational Designer Mode edits presentation only and exposes semantic block controls');

assert.doesNotMatch(designer, /fetch\(['"]\/api\/courses/);
assert.doesNotMatch(designer, /PUT.*\/api\/courses|PATCH.*\/api\/courses/s);
console.log('  ✓ Designer Mode does not mutate CourseV2 content APIs');

console.log('\nCourse educational design UI regression contract passed.');
