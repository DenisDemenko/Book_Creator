import assert from 'node:assert/strict';
import type { CourseV2 } from '../src/types';
import {
  courseToEducationalDocument,
  educationalDocumentToPreviewBook,
} from '../src/data/courseEducationalAdapter';
import { educationalDocumentStats } from '../src/data/educationalDocument';

const course: CourseV2 = {
  id: 'course-1',
  ownerId: 'owner-1',
  status: 'draft',
  title: 'Основи CNC',
  subtitle: 'Практичний STEAM курс',
  audience: ['12–16 років'],
  outcomes: ['Побудувати просту деталь', 'Безпечно підготувати верстат'],
  highlights: [],
  skills: [
    {
      id: 'skill-1',
      name: 'Безпечна робота',
      level: 'base',
      whyItMatters: 'Безпека',
      howToDevelop: [],
      practiceIdeas: [],
    },
  ],
  modules: [
    {
      id: 'module-1',
      title: 'Підготовка',
      summary: 'Перший модуль',
      coverPhotoUrl: 'https://example.test/module.jpg',
      introVideoUrl: 'https://example.test/intro',
      skillIds: ['skill-1'],
      lessons: [
        {
          id: 'lesson-1',
          title: 'Запуск верстата',
          goal: 'Навчитися запускати верстат',
          description: 'Перед запуском перевірте робочу зону.',
          topics: ['Огляд', 'Перевірка', 'Запуск'],
          videoUrl: 'https://example.test/video',
          photoUrls: ['https://example.test/photo.jpg'],
          durationMin: 30,
          assignment: {
            id: 'assignment-1',
            title: 'Контрольний запуск',
            brief: 'Виконайте запуск за чеклістом.',
            steps: ['Перевірте аварійну кнопку', 'Увімкніть живлення'],
            deliverable: 'Фото підготовленого робочого місця',
            acceptanceCriteria: ['Робоча зона вільна', 'Захист встановлений'],
            estimateMin: 15,
          },
        },
      ],
      finalAssignment: {
        id: 'final-1',
        title: 'Фінальний проєкт',
        brief: 'Підготуйте верстат самостійно.',
        steps: ['Підготуйте', 'Перевірте'],
        deliverable: 'Чекліст',
        acceptanceCriteria: ['Без помилок'],
      },
    },
  ],
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
};

for (const type of ['methodic', 'instruction', 'worksheet'] as const) {
  const doc = courseToEducationalDocument(course, type);
  assert.equal(doc.documentType, type);
  assert.equal(doc.modules.length, 1);
  assert.equal(doc.modules[0].id, 'module-1');
  assert.equal(doc.modules[0].lessons[0].id, 'lesson-1', 'stable lesson ids must survive projection');
  assert.equal(doc.modules[0].lessons[1].id, 'module-1-final');
  assert(doc.modules[0].lessons[0].blocks.some((item) => item.entity === 'learning-goal'));
  assert(doc.modules[0].lessons[0].blocks.some((item) => item.entity === 'assessment'));
  assert(doc.modules[0].lessons[1].blocks.some((item) => item.entity === 'project'));

  const stats = educationalDocumentStats(doc);
  assert.equal(stats.modules, 1);
  assert.equal(stats.lessons, 2);
  assert(stats.blocks >= 8);

  const preview = educationalDocumentToPreviewBook(doc);
  assert.equal(preview.title, course.title);
  const chapters = preview.chapters as Array<{ id: string; sections: Array<{ id: string; content: string }> }>;
  assert.equal(chapters[0].id, 'module-1');
  assert.equal(chapters[0].sections[0].id, 'lesson-1');
  assert(String(chapters[0].sections[0].content).includes('Мета уроку'));
}

const instruction = courseToEducationalDocument(course, 'instruction', 'instruction-clear-steps');
assert.equal(instruction.templateId, 'instruction-clear-steps');
assert(
  instruction.modules[0].lessons[0].blocks.some((item) => item.entity === 'step'),
  'instruction projection should turn topic sequence into step semantics',
);

const worksheet = courseToEducationalDocument(course, 'worksheet', 'worksheet-project-sheet');
assert(
  worksheet.modules[0].lessons[0].blocks.some((item) => item.entity === 'homework'),
  'worksheet projection should expose lesson assignment as homework',
);

console.log('Course educational adapter: OK');
