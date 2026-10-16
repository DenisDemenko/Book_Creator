export interface JevHeroArcAssessment {
  intensities: number[];
  confidences: Array<number | null>;
  provider: 'jev';
  model: string;
}

export async function assessHeroArcWithJev(input: {
  heroName?: string;
  context: string;
  constructorAnswers?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<JevHeroArcAssessment> {
  const response = await fetch('/api/semantic/jev/hero-arc', {
    method: 'POST',
    credentials: 'include',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      heroName: input.heroName,
      context: input.context,
      constructorAnswers: input.constructorAnswers ?? {},
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.error || 'JEV Hero Arc assessment failed'));
  if (!Array.isArray(payload?.intensities) || payload.intensities.length !== 14) {
    throw new Error('JEV повернув некоректну кількість точок Hero Arc.');
  }
  return payload as JevHeroArcAssessment;
}

export function buildHeroArcAssessmentContext(input: {
  seed?: string;
  genre?: string;
  synopsis?: string;
  compositionPlan?: string;
  cast?: Array<{
    id?: string;
    firstName?: string;
    lastName?: string;
    psychotype?: string;
    vedicRole?: string;
    poltiRoleName?: string;
    hook?: string;
    appearance?: string;
    goal?: string;
    flaw?: string;
  }>;
  parts?: Array<{
    partNumber?: number;
    partTitle?: string;
    frameworkStage?: string;
    chapters?: Array<{
      chapterNumber?: number;
      chapterTitle?: string;
      summary?: string;
      turningPoint?: string;
      involvedCharacterIds?: string[];
      involvedCharacters?: string[];
    }>;
  }>;
}): string {
  const lines: string[] = [];
  if (input.seed?.trim()) lines.push(`Задум: ${input.seed.trim()}`);
  if (input.genre?.trim()) lines.push(`Жанр: ${input.genre.trim()}`);

  const cast = input.cast ?? [];
  if (cast.length) {
    lines.push('Персонажі:');
    for (const c of cast) {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.replace(/\s+/g, ' ').trim();
      const details = [c.poltiRoleName, c.psychotype, c.vedicRole, c.goal, c.flaw, c.hook, c.appearance]
        .filter(Boolean)
        .join(' · ');
      lines.push(`- ${name || c.id || 'Персонаж'}${details ? `: ${details}` : ''}`);
    }
  }

  if (input.synopsis?.trim()) lines.push(`Синопсис:\n${input.synopsis.trim()}`);
  if (input.compositionPlan?.trim()) lines.push(`Композиційний план:\n${input.compositionPlan.trim()}`);

  for (const part of input.parts ?? []) {
    lines.push(`Частина ${part.partNumber ?? ''} ${part.partTitle ?? ''}${part.frameworkStage ? ` · ${part.frameworkStage}` : ''}`.trim());
    for (const chapter of part.chapters ?? []) {
      const people = (chapter.involvedCharacters ?? []).join(', ');
      lines.push([
        `Глава ${chapter.chapterNumber ?? ''}. ${chapter.chapterTitle ?? ''}`.trim(),
        chapter.summary?.trim() || '',
        chapter.turningPoint ? `Поворот: ${chapter.turningPoint}` : '',
        people ? `Учасники: ${people}` : '',
      ].filter(Boolean).join(' — '));
    }
  }

  return lines.join('\n').slice(0, 40_000);
}
