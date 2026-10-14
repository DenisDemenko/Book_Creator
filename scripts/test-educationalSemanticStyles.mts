import assert from 'node:assert/strict';
import type { CourseV2 } from '../src/types';
import {
  courseToEducationalDocument,
  educationalDocumentToPreviewBook,
} from '../src/data/courseEducationalAdapter';
import { EDUCATIONAL_PDF_TEMPLATES } from '../src/data/educationalPdfTemplates';
import { educationalVisualsFor } from '../server/pdf/designcraft/educationalStyleVisuals';

const course: CourseV2 = {
  id: 'course-semantic-test',
  ownerId: 'owner-1',
  status: 'draft',
  title: 'Майстерня безпечного прототипування',
  subtitle: 'Навчальний тест',
  audience: ['учні'],
  outcomes: ['зібрати прототип'],
  highlights: ['практика', 'безпека', 'проєкт'],
  skills: [{ id: 's1', name: 'Монтаж', level: 'base', whyItMatters: '', howToDevelop: [], practiceIdeas: [] }],
  modules: [
    {
      id: 'm1',
      title: 'Модуль 1',
      summary: 'Підготовка до роботи.',
      skillIds: ['s1'],
      lessons: [
        {
          id: 'l1',
          title: 'Збірка вузла',
          goal: 'Зібрати вузол безпечно.',
          description: 'Перед початком перевірте інструмент.',
          topics: ['Підготуйте деталі', 'Зберіть вузол', 'Перевірте результат'],
          photoUrls: [],
          assignment: {
            id: 'a1',
            title: 'Практика',
            brief: 'Зберіть навчальний вузол.',
            steps: ['Крок 1', 'Крок 2'],
            deliverable: 'Фото вузла',
            acceptanceCriteria: ['Немає люфту', 'Кріплення затягнуті'],
          },
        },
      ],
    },
  ],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

assert.equal(EDUCATIONAL_PDF_TEMPLATES.length, 9);
for (const template of EDUCATIONAL_PDF_TEMPLATES) {
  const visuals = educationalVisualsFor(template.id);
  assert.equal(visuals.page.accentColor.toUpperCase(), template.preview.accentColor.toUpperCase(), `${template.id}: server accent must match gallery`);
  assert(Object.keys(visuals.entities).length >= 4, `${template.id}: block visuals must style several semantic entities`);
}

const clearSteps = educationalVisualsFor('instruction-clear-steps');
const visualFlow = educationalVisualsFor('instruction-visual-flow');
const compact = educationalVisualsFor('instruction-compact-manual');
assert(clearSteps.entities['location-time']?.enabled, 'Clear Steps must style step strips through LocationTime');
assert(visualFlow.entities['system-message']?.enabled, 'Visual Flow must style flow cards through SystemMessage');
assert(compact.entities['key-idea']?.enabled, 'Compact Manual must style compact steps through KeyIdea');

const cleanWorksheet = educationalVisualsFor('worksheet-clean');
const interactiveWorksheet = educationalVisualsFor('worksheet-interactive');
const projectWorksheet = educationalVisualsFor('worksheet-project-sheet');
assert(cleanWorksheet.entities['case-study']?.paddingMm?.bottom, 'Clean worksheet must reserve answer space');
assert(interactiveWorksheet.entities['key-idea']?.background?.kind === 'color', 'Interactive worksheet must use activity cards');
assert(projectWorksheet.entities['case-study']?.fontWeight === 700, 'Project sheet must visually emphasize project blocks');

const instruction = courseToEducationalDocument(course, 'instruction', 'instruction-visual-flow');
const preview = educationalDocumentToPreviewBook(instruction) as {
  chapters: Array<{ sections: Array<{ content: string }> }>;
};
const instructionText = preview.chapters[0].sections[0].content;
assert(instructionText.includes('[STYLE:SystemMessage]Послідовність[/STYLE]'), 'Visual Flow steps must become SystemMessage markers');
assert(instructionText.includes('[STYLE:Evidence]Критерії виконання[/STYLE]'), 'assessment must become Evidence markers');
assert(instructionText.includes('[STYLE:CaseStudy]Практика[/STYLE]'), 'practice must become CaseStudy markers');

const worksheet = courseToEducationalDocument(course, 'worksheet', 'worksheet-interactive');
const worksheetPreview = educationalDocumentToPreviewBook(worksheet) as {
  chapters: Array<{ sections: Array<{ content: string }> }>;
};
const worksheetText = worksheetPreview.chapters[0].sections[0].content;
assert(worksheetText.includes('[STYLE:KeyIdea]Практика[/STYLE]'), 'interactive homework must become KeyIdea activity cards');

console.log('Educational semantic styles: OK');
