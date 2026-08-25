export type SkillCategory =
  | "content_structure"   // Зміст & Структура
  | "drama_characters"    // Персонажі & Драматургія
  | "style_expression"    // Стиль & Образність
  | "expertise_logic"     // Експертність & Логіка
  | "impact_pedagogy";    // Вплив & Педагогіка

export interface MicroExercise {
  id: string;
  title: string;
  task: string;
  promptPlaceholder: string;
  constraint: string;
  sampleAnswer?: string;
}

export interface QuizOption {
  text: string;
  isCorrect: boolean;
  explanation: string;
}

export interface SkillQuiz {
  question: string;
  scenario: string;
  options: QuizOption[];
}

export interface SkillItem {
  id: number;
  numberStr: string;
  title: string;
  category: SkillCategory;
  categoryName: string;
  iconName: string;
  colorHex: string;
  badgeBg: string;
  badgeText: string;
  subSkills: [string, string, string, string]; // 4 criteria from infographic
  shortDescription: string;
  fullDescription: string;
  whyItMatters: string;
  doAndDonts: {
    do: string;
    dont: string;
  }[];
  realWorldExample: {
    bookOrAuthor: string;
    context: string;
    quoteOrSnippet: string;
  };
  microExercises: MicroExercise[];
  quiz: SkillQuiz;
  defaultProgress: number;
}

export interface FlowStep {
  id: number;
  title: string;
  action: string;
  iconName: string;
  color: string;
  description: string;
  sampleTransformation: {
    before: string;
    after: string;
    explanation: string;
  };
}

export interface DiagnosticAnswer {
  skillId: number;
  level: number; // 1 to 5
}

export interface UserSkillProgress {
  [skillId: number]: {
    skillId?: number;
    progress: number; // 0-100
    isMastered: boolean;
    lastTrained?: string;
    completedExercises?: string[];
    customNotes?: string;
  };
}

export interface EmotionalArcPoint {
  chapter: number;
  title: string;
  score: number; // -10 to +10
  tension: number; // 0 to 100
  note: string;
}
