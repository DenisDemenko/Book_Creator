import { UserRole, RoleInfo, RolePermission, NavigationTab, UserProfile } from '../types';

export const ALL_ROLES: RoleInfo[] = [
  {
    id: 'admin',
    nameUk: 'Адміністратор сайту',
    nameEn: 'Site Administrator',
    badgeEmoji: '👑',
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    bgGradient: 'from-amber-500/20 to-orange-500/10 border-amber-500/50',
    descriptionUk: 'Повний контроль над проектом, налаштуваннями системи, правами доступу, базою даних та експортом.',
    descriptionEn: 'Full access to all platform features, system settings, RBAC role management, and export pipelines.',
    responsibilitiesUk: [
      'Управління ролями та матрицею дозволів',
      'Повний доступ до редагування тексту, коду та структури',
      'Керування налаштуваннями проекту та відновленням даних',
      'Аудит журналу змін (ChangeLog)',
      'Експорт та публікація у всіх форматах'
    ],
    responsibilitiesEn: [
      'Managing roles and the permission matrix',
      'Full access to editing text, code, and structure',
      'Managing project settings and data recovery',
      'Auditing the change log (ChangeLog)',
      'Export and publishing in all formats'
    ],
    permissions: {
      canEditContent: true,
      canEditTranslation: true,
      canEditVisuals: true,
      canEditLayout: true,
      canExport: true,
      canImportBook: true,
      canManageCharacters: true,
      canManagePlot: true,
      canUseAi: true,
      canManageSettings: true,
      canViewAuditLog: true,
      canManageRoles: true,
      canGenerateImages: true,
      canPublish: true,
      canPublishExternal: true,
      canManageApiKeys: true,
      isReadOnly: false,
      allowedTabs: [
'express',
'dashboard',
        'subscription',
        'api-keys',
        'start',
        'editor',
        'mastery',
        'toc',
        'qr-footnotes',
        'scenario',
        'mindboard',
        'characters',
        'ai-studio',
        'illustrations',
        'layout',
        'preview',
        'cover',
        'changelog',
        'export',
        'media',
        'kdp-format',
        'courses',
        'pdf-editor',
        'knowledge',
        'trainers',
        'structure',
        'portfolio',
        'publishing',
        'admin'
      ]
    },
    defaultPersona: {
      name: 'Олександр (Адміністратор)',
      email: 'admin@novastudio.ua',
      avatar: '👑'
    }
  },
  {
    id: 'writer',
    nameUk: 'Письменник',
    nameEn: 'Writer / Author',
    badgeEmoji: '✍️',
    badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    bgGradient: 'from-indigo-500/20 to-blue-500/10 border-indigo-500/50',
    descriptionUk: 'Створення рукопису, розробка сюжетних ліній, персонажів, сценарних арок та використання AI помічника.',
    descriptionEn: 'Manuscript writing, scene creation, narrative structure, character lore, and generative text editing.',
    responsibilitiesUk: [
      'Написання та редагування тексту книги',
      'Створення глав, розділів та структури змісту',
      'Розвиток майстерності та виконання практичних завдань',
      'Розробка досьє та взаємозв’язків персонажів',
      'Сценарне планування та емоційні арки',
      'Робота з AI Редактором та стилістикою'
    ],
    responsibilitiesEn: [
      'Writing and editing the book text',
      'Creating chapters, sections, and the table of contents structure',
      'Developing mastery and completing practical exercises',
      'Building character dossiers and relationships',
      'Scenario planning and emotional arcs',
      'Working with the AI Editor and stylistics'
    ],
    permissions: {
      canEditContent: true,
      canEditTranslation: false,
      canEditVisuals: false,
      canEditLayout: false,
      canExport: false,
      canImportBook: true,
      canManageCharacters: true,
      canManagePlot: true,
      canUseAi: true,
      canManageSettings: false,
      canViewAuditLog: true,
      canManageRoles: false,
      canGenerateImages: true,
      canPublish: true,
      canPublishExternal: true,
      canManageApiKeys: true,
      isReadOnly: false,
      allowedTabs: [
'express',
'dashboard',
        'subscription',
        'api-keys',
        'start',
        'editor',
        'mastery',
        'toc',
        'qr-footnotes',
        'scenario',
        'mindboard',
        'characters',
        'ai-studio',
        'preview',
        'changelog',
        'kdp-format',
        'courses',
        'knowledge',
        'trainers',
        'structure',
        'portfolio',
        'publishing'
      ]
    },
    defaultPersona: {
      name: 'Ярослав Вороний (Автор)',
      email: 'author@novastudio.ua',
      avatar: '✍️'
    }
  },
  {
    id: 'designer',
    nameUk: 'Дизайнер',
    nameEn: 'Designer / Illustrator',
    badgeEmoji: '🎨',
    badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
    bgGradient: 'from-purple-500/20 to-pink-500/10 border-purple-500/50',
    descriptionUk: 'Розробка обкладинки книги, концепт-арту, ілюстрацій, Visual Bible, колірної палітри та медіатеки.',
    descriptionEn: 'Book cover typography, illustration generation, visual bible styling, spine calculation, and asset management.',
    responsibilitiesUk: [
      'Створення та 3D візуалізація обкладинки книги',
      'Генерація ілюстрацій та робота з Visual Bible',
      'Налаштування візуального стилю та палітри видання',
      'Управління медіатекою зображень та референсів',
      'Перегляд книги для візуальної відповідності'
    ],
    responsibilitiesEn: [
      'Creating and 3D-visualizing the book cover',
      'Generating illustrations and working with the Visual Bible',
      'Setting the visual style and color palette of the edition',
      'Managing the image and reference media library',
      'Reviewing the book for visual consistency'
    ],
    permissions: {
      canEditContent: false,
      canEditTranslation: false,
      canEditVisuals: true,
      canEditLayout: false,
      canExport: false,
      canImportBook: true,
      canManageCharacters: false,
      canManagePlot: false,
      canUseAi: true,
      canManageSettings: false,
      canViewAuditLog: false,
      canManageRoles: false,
      canGenerateImages: true,
      canPublish: false,
      canPublishExternal: false,
      canManageApiKeys: false,
      isReadOnly: false,
      allowedTabs: [
        'subscription',
        'api-keys',
        'cover',
        'illustrations',
        'media',
        'preview',
        'start',
        'characters',
        'layout'
      ]
    },
    defaultPersona: {
      name: 'Катерина Світлична (Дизайнер)',
      email: 'design@novastudio.ua',
      avatar: '🎨'
    }
  },
  {
    id: 'translator',
    nameUk: 'Перекладач',
    nameEn: 'Translator / Localizer',
    badgeEmoji: '🌐',
    badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    bgGradient: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/50',
    descriptionUk: 'Двомовна адаптація рукопису, переклад назв, синопсису та тексту розділів (English Edition).',
    descriptionEn: 'Bilingual book localization, translation split-view, English metadata management, and foreign edition export.',
    responsibilitiesUk: [
      'Переклад тексту розділів у двомовному режимі (Split View)',
      'Локалізація назв книги, глав та змісту англійською',
      'Складання англомовного синопсису та опису героїв',
      'Використання ШІ для контекстного перекладу термінів',
      'Експорт рукопису англійською мовою (English Edition)'
    ],
    responsibilitiesEn: [
      'Translating chapter text in bilingual mode (Split View)',
      'Localizing the book title, chapters, and table of contents into English',
      'Writing the English synopsis and character descriptions',
      'Using AI for contextual translation of terms',
      'Exporting the manuscript in English (English Edition)'
    ],
    permissions: {
      canEditContent: false, // Original Ukrainian source is protected
      canEditTranslation: true,
      canEditVisuals: false,
      canEditLayout: false,
      canExport: true, // Specifically for English edition export
      canImportBook: true,
      canManageCharacters: false,
      canManagePlot: false,
      canUseAi: true,
      canManageSettings: false,
      canViewAuditLog: false,
      canManageRoles: false,
      canGenerateImages: true,
      canPublish: false,
      canPublishExternal: false,
      canManageApiKeys: false,
      isReadOnly: false,
      allowedTabs: [
        'subscription',
        'api-keys',
        'editor',
        'toc',
        'qr-footnotes',
        'preview',
        'export',
        'start'
      ]
    },
    defaultPersona: {
      name: 'Дмитро Коваль (Перекладач)',
      email: 'translator@novastudio.ua',
      avatar: '🌐'
    }
  },
  {
    id: 'publisher',
    nameUk: 'Видавець',
    nameEn: 'Publisher / Production Editor',
    badgeEmoji: '🏛️',
    badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    bgGradient: 'from-rose-500/20 to-amber-500/10 border-rose-500/50',
    descriptionUk: 'Контроль стандартів друку, налаштування верстки, розрахунок корінця, аудит Amazon KDP та експорт накладів.',
    descriptionEn: 'Print layout setup, gutter calculation, Amazon KDP compliance audits, production exports, and quality control.',
    responsibilitiesUk: [
      'Налаштування обрізних форматів (Trim sizes) та полів',
      'Розрахунок внутрішнього корінця (Gutter) та товщини корінця',
      'Аудит відповідності поліграфічним стандартам Amazon KDP',
      'Експорт готових до друку PDF, EPUB, DOCX файлів',
      'Оформлення Front Matter (титул, копірайт, присвята, зміст)'
    ],
    responsibilitiesEn: [
      'Setting up trim sizes and margins',
      'Calculating the inside gutter and spine thickness',
      'Auditing compliance with Amazon KDP print standards',
      'Exporting print-ready PDF, EPUB, and DOCX files',
      'Formatting front matter (title page, copyright, dedication, contents)'
    ],
    permissions: {
      canEditContent: false,
      canEditTranslation: false,
      canEditVisuals: false,
      canEditLayout: true,
      canExport: true,
      canImportBook: true,
      canManageCharacters: false,
      canManagePlot: false,
      canUseAi: true,
      canManageSettings: true,
      canViewAuditLog: true,
      canManageRoles: false,
      canGenerateImages: true,
      canPublish: true,
      canPublishExternal: true,
      canManageApiKeys: false,
      isReadOnly: false,
      allowedTabs: [
        'subscription',
        'api-keys',
        'layout',
        'export',
        'cover',
        'toc',
        'preview',
        'changelog',
        'start',
        'qr-footnotes',
        'kdp-format',
        'pdf-editor',
        'publishing'
      ]
    },
    defaultPersona: {
      name: 'Вікторія Гнатюк (Головний Редактор)',
      email: 'publisher@novastudio.ua',
      avatar: '🏛️'
    }
  },
  {
    id: 'reader',
    nameUk: 'Читач',
    nameEn: 'Reader / Beta Reviewer',
    badgeEmoji: '📖',
    badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
    bgGradient: 'from-cyan-500/20 to-sky-500/10 border-cyan-500/50',
    descriptionUk: 'Режим читання книги з комфортним розворотом, перегляд змісту та досьє персонажів без права редагування.',
    descriptionEn: 'Read-only book presentation mode, interactive table of contents, and character lore card inspection.',
    responsibilitiesUk: [
      'Комфортне читання твору в книжковому розвороті',
      'Навігація по змісту та главам книги',
      'Ознайомлення з досьє героїв та ілюстраціями',
      'Безпечний перегляд рукопису без випадкових змін',
      'Тестування читацького досвіду (Бета-рідінг)'
    ],
    responsibilitiesEn: [
      'Comfortable reading of the work in a book-spread view',
      'Navigating the table of contents and chapters',
      'Browsing character dossiers and illustrations',
      'Safe viewing of the manuscript without accidental changes',
      'Testing the reading experience (beta reading)'
    ],
    permissions: {
      canEditContent: false,
      canEditTranslation: false,
      canEditVisuals: false,
      canEditLayout: false,
      canExport: false,
      canImportBook: false,
      canManageCharacters: false,
      canManagePlot: false,
      canUseAi: false,
      canManageSettings: false,
      canViewAuditLog: false,
      canManageRoles: false,
      canGenerateImages: false,
      canPublish: false,
      canPublishExternal: false,
      canManageApiKeys: false,
      isReadOnly: true,
      allowedTabs: [
        'subscription',
        'api-keys',
        'preview',
        'toc',
        'characters',
        'start'
      ]
    },
    defaultPersona: {
      name: 'Анна Мельник (Бета-читач)',
      email: 'reader@novastudio.ua',
      avatar: '📖'
    }
  },
  {
    id: 'guest',
    nameUk: 'Гість',
    nameEn: 'Guest / Visitor',
    badgeEmoji: '👤',
    badgeColor: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
    bgGradient: 'from-slate-500/20 to-slate-700/10 border-slate-500/50',
    descriptionUk: 'Відкритий вхід без реєстрації. Можна оглянути платформу та демонстраційну книгу, але генерація зображень недоступна — замість неї показуються заглушки.',
    descriptionEn: 'Open access without registration. Explore the platform and the demo book; AI image generation is disabled and replaced with placeholders.',
    responsibilitiesUk: [
      'Огляд можливостей платформи без реєстрації',
      'Читання демонстраційної книги та досьє персонажів',
      'Перегляд заглушок замість згенерованих зображень',
      'Реєстрація для доступу до генерації через ШІ'
    ],
    responsibilitiesEn: [
      'Exploring the platform features without registration',
      'Reading the demo book and character dossiers',
      'Viewing placeholders instead of generated images',
      'Registering to unlock AI generation'
    ],
    permissions: {
      canEditContent: false,
      canEditTranslation: false,
      canEditVisuals: false,
      canEditLayout: false,
      canExport: false,
      canImportBook: false,
      canManageCharacters: false,
      canManagePlot: false,
      canUseAi: false,
      canManageSettings: false,
      canViewAuditLog: false,
      canManageRoles: false,
      canGenerateImages: false,
      canPublish: false,
      canPublishExternal: false,
      canManageApiKeys: false,
      isReadOnly: true,
      allowedTabs: [
'express',
'subscription',
        'start',
        'editor',
        'toc',
        'characters',
        'illustrations',
        'preview',
        'cover'
      ]
    },
    defaultPersona: {
      name: 'Гість',
      email: 'guest@novastudio.ua',
      avatar: '👤'
    }
  }
];

export const ROLE_CONFIGS_MAP: Record<UserRole, RoleInfo> = ALL_ROLES.reduce(
  (acc, role) => {
    acc[role.id] = role;
    return acc;
  },
  {} as Record<UserRole, RoleInfo>
);

export function getRoleInfo(role?: UserRole | string | null): RoleInfo {
  if (!role) return ROLE_CONFIGS_MAP.admin;
  return ROLE_CONFIGS_MAP[role as UserRole] || ROLE_CONFIGS_MAP.admin;
}

export function getRolePermissions(role?: UserRole | string | null): RolePermission {
  return getRoleInfo(role).permissions;
}

export function hasPermission(role: UserRole | string | undefined | null, permissionKey: keyof RolePermission): boolean {
  const perms = getRolePermissions(role);
  return !!perms[permissionKey];
}

export function canAccessTab(role: UserRole | string | undefined | null, tab: NavigationTab): boolean {
  if (role === 'admin') return true;
  const perms = getRolePermissions(role);
  return perms.allowedTabs.includes(tab);
}

export function getDefaultTabForRole(role?: UserRole | string | null): NavigationTab {
  switch (role) {
    case 'admin':
      return 'dashboard';
    case 'writer':
      return 'editor';
    case 'designer':
      return 'cover';
    case 'translator':
      return 'editor';
    case 'publisher':
      return 'layout';
    case 'reader':
      return 'preview';
    default:
      return 'start';
  }
}

export const PRESET_USERS: UserProfile[] = ALL_ROLES.map((r) => ({
  id: `user-${r.id}`,
  name: r.defaultPersona.name,
  email: r.defaultPersona.email,
  role: r.id,
  avatarUrl: undefined,
  bio: r.descriptionUk,
}));
