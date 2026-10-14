import type { Book, Character, CharacterInScene, Scene } from '../types';
import type {
  CustomBookDesignTheme,
  DesignerCustomBlock,
  DesignerEntityStyle,
  DesignerSemanticSource,
  DesignerThemeEntity,
} from './customBookDesignTheme';

export type ResolvedDesignerBlockSource = Extract<DesignerSemanticSource, 'character' | 'scene' | 'conflict'>;

export interface ResolvedDesignerBlock {
  id: string;
  blockId: string;
  blockName: string;
  source: ResolvedDesignerBlockSource;
  entity: Extract<DesignerThemeEntity, 'character' | 'scene' | 'conflict'>;
  sourceId: string;
  sourceLabel: string;
  chapterId?: string;
  sectionId?: string;
  style: DesignerEntityStyle;
  /** Safe renderer-neutral fields selected by the theme. */
  fields: Record<string, string>;
  /** Deterministic plain-text fallback for renderers that do not support cards yet. */
  fallbackText: string;
}

const CHARACTER_FIELDS = [
  'name',
  'surname',
  'alias',
  'role',
  'age',
  'gender',
  'profession',
  'biography',
  'motivation',
  'internalConflict',
  'goals',
  'desires',
  'fears',
  'tags',
] as const;

const SCENE_FIELDS = [
  'title',
  'act',
  'summary',
  'location',
  'timeOfDay',
  'timelineOrder',
  'intensityScore',
  'conflict',
  'resolution',
  'participants',
] as const;

const CONFLICT_FIELDS = [
  'conflict',
  'goal',
  'resolution',
  'intensityScore',
  'character',
  'scene',
  'location',
  'timeOfDay',
] as const;

export const DESIGN_ENTITY_FIELDS = {
  character: CHARACTER_FIELDS,
  scene: SCENE_FIELDS,
  conflict: CONFLICT_FIELDS,
} as const;

function clean(value: unknown): string {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(', ');
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function nameOf(character: Character | undefined): string {
  if (!character) return '';
  return [character.name, character.surname].map(clean).filter(Boolean).join(' ') || clean(character.alias);
}

function characterField(character: Character, field: string): string {
  switch (field) {
    case 'name': return clean(character.name);
    case 'surname': return clean(character.surname);
    case 'alias': return clean(character.alias);
    case 'role': return clean(character.role);
    case 'age': return clean(character.age);
    case 'gender': return clean(character.gender);
    case 'profession': return clean(character.profession);
    case 'biography': return clean(character.biography);
    case 'motivation': return clean(character.personality?.motivation);
    case 'internalConflict': return clean(character.personality?.internalConflict);
    case 'goals': return clean(character.personality?.goals);
    case 'desires': return clean(character.personality?.desires);
    case 'fears': return clean(character.personality?.fears);
    case 'tags': return clean(character.tags);
    default: return '';
  }
}

function participantNames(scene: Scene, characters: Map<string, Character>): string {
  return scene.characters
    .map((item) => nameOf(characters.get(item.characterId)) || clean(item.characterId))
    .filter(Boolean)
    .join(', ');
}

function sceneField(scene: Scene, field: string, characters: Map<string, Character>): string {
  switch (field) {
    case 'title': return clean(scene.title);
    case 'act': return clean(scene.act);
    case 'summary': return clean(scene.summary);
    case 'location': return clean(scene.location);
    case 'timeOfDay': return clean(scene.timeOfDay);
    case 'timelineOrder': return clean(scene.timelineOrder);
    case 'intensityScore': return clean(scene.intensityScore);
    case 'conflict': return clean(scene.conflict);
    case 'resolution': return clean(scene.resolution);
    case 'participants': return participantNames(scene, characters);
    default: return '';
  }
}

function conflictField(
  scene: Scene,
  participation: CharacterInScene | undefined,
  field: string,
  characters: Map<string, Character>
): string {
  const character = participation ? characters.get(participation.characterId) : undefined;
  switch (field) {
    case 'conflict': return clean(participation?.conflict || scene.conflict);
    case 'goal': return clean(participation?.goal);
    case 'resolution': return clean(scene.resolution);
    case 'intensityScore': return clean(scene.intensityScore);
    case 'character': return nameOf(character);
    case 'scene': return clean(scene.title);
    case 'location': return clean(scene.location);
    case 'timeOfDay': return clean(scene.timeOfDay);
    default: return '';
  }
}

function selectedFields(source: ResolvedDesignerBlockSource, block?: DesignerCustomBlock): readonly string[] {
  const defaults = DESIGN_ENTITY_FIELDS[source];
  if (!block?.fields?.length) return defaults;
  const allowed = new Set(defaults as readonly string[]);
  return block.fields.filter((field) => allowed.has(field));
}

function defaultStyle(entity: ResolvedDesignerBlock['entity']): DesignerEntityStyle {
  return {
    entity,
    enabled: true,
    fontSlot: entity === 'conflict' ? 'mono' : 'heading',
    align: 'left',
    background: { kind: 'none' },
    border: { style: 'none', sides: [] },
  };
}

function styleOf(theme: CustomBookDesignTheme, entity: ResolvedDesignerBlock['entity'], block?: DesignerCustomBlock): DesignerEntityStyle {
  const base = theme.entities[entity] || defaultStyle(entity);
  return block?.style ? { ...base, ...block.style, entity } : base;
}

function matchesSelector(selector: string | undefined, values: string[]): boolean {
  const wanted = clean(selector).toLocaleLowerCase('uk-UA');
  if (!wanted) return true;
  return values.some((value) => clean(value).toLocaleLowerCase('uk-UA').includes(wanted));
}

function formatFallback(label: string, fields: Record<string, string>): string {
  const rows = Object.entries(fields).filter(([, value]) => value);
  if (!rows.length) return label;
  return [label, ...rows.map(([key, value]) => `${key}: ${value}`)].join('\n');
}

function chapterForSection(book: Book): Map<string, string> {
  const result = new Map<string, string>();
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) result.set(section.id, chapter.id);
  }
  return result;
}

function collectScenes(book: Book): Scene[] {
  const scenes: Scene[] = [];
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      if (section.scene) scenes.push(section.scene);
    }
  }
  return scenes.sort((a, b) => (a.timelineOrder ?? 0) - (b.timelineOrder ?? 0));
}

function blockDefinitions(theme: CustomBookDesignTheme, source: ResolvedDesignerBlockSource): Array<DesignerCustomBlock | undefined> {
  const custom = (theme.customBlocks || []).filter((block) => block.source === source);
  // The built-in entity style itself is also useful without an explicit custom block.
  return custom.length ? custom : [undefined];
}

export function resolveBookDesignEntityBlocks(book: Book, theme: CustomBookDesignTheme): ResolvedDesignerBlock[] {
  const result: ResolvedDesignerBlock[] = [];
  const characters = new Map((book.characters || []).map((character) => [character.id, character]));
  const scenes = collectScenes(book);
  const chapterBySection = chapterForSection(book);

  for (const definition of blockDefinitions(theme, 'character')) {
    const fields = selectedFields('character', definition);
    for (const character of book.characters || []) {
      if (!matchesSelector(definition?.selector, [character.id, character.name, character.surname || '', character.alias || '', character.role, ...(character.tags || [])])) continue;
      const style = styleOf(theme, 'character', definition);
      if (!style.enabled) continue;
      const values = Object.fromEntries(fields.map((field) => [field, characterField(character, field)]).filter(([, value]) => Boolean(value)));
      const label = nameOf(character) || 'Персонаж';
      result.push({
        id: `${definition?.id || 'character'}:${character.id}`,
        blockId: definition?.id || 'character',
        blockName: definition?.name || 'Персонаж',
        source: 'character',
        entity: 'character',
        sourceId: character.id,
        sourceLabel: label,
        style,
        fields: values,
        fallbackText: formatFallback(label, values),
      });
    }
  }

  for (const definition of blockDefinitions(theme, 'scene')) {
    const fields = selectedFields('scene', definition);
    for (const scene of scenes) {
      if (!matchesSelector(definition?.selector, [scene.id, scene.title, scene.location, scene.timeOfDay, scene.summary])) continue;
      const style = styleOf(theme, 'scene', definition);
      if (!style.enabled) continue;
      const values = Object.fromEntries(fields.map((field) => [field, sceneField(scene, field, characters)]).filter(([, value]) => Boolean(value)));
      const label = clean(scene.title) || 'Сцена';
      result.push({
        id: `${definition?.id || 'scene'}:${scene.id}`,
        blockId: definition?.id || 'scene',
        blockName: definition?.name || 'Сцена',
        source: 'scene',
        entity: 'scene',
        sourceId: scene.id,
        sourceLabel: label,
        chapterId: chapterBySection.get(scene.sectionId),
        sectionId: scene.sectionId,
        style,
        fields: values,
        fallbackText: formatFallback(label, values),
      });
    }
  }

  for (const definition of blockDefinitions(theme, 'conflict')) {
    const fields = selectedFields('conflict', definition);
    for (const scene of scenes) {
      const participations = scene.characters?.length ? scene.characters : [undefined];
      for (const participation of participations) {
        const conflict = clean(participation?.conflict || scene.conflict);
        if (!conflict) continue;
        const character = participation ? characters.get(participation.characterId) : undefined;
        if (!matchesSelector(definition?.selector, [conflict, scene.title, nameOf(character), participation?.goal || ''])) continue;
        const style = styleOf(theme, 'conflict', definition);
        if (!style.enabled) continue;
        const values = Object.fromEntries(fields.map((field) => [field, conflictField(scene, participation, field, characters)]).filter(([, value]) => Boolean(value)));
        const sourceId = `${scene.id}:${participation?.characterId || 'scene'}`;
        const label = nameOf(character) ? `${nameOf(character)} — конфлікт` : `${clean(scene.title) || 'Сцена'} — конфлікт`;
        result.push({
          id: `${definition?.id || 'conflict'}:${sourceId}`,
          blockId: definition?.id || 'conflict',
          blockName: definition?.name || 'Конфлікт',
          source: 'conflict',
          entity: 'conflict',
          sourceId,
          sourceLabel: label,
          chapterId: chapterBySection.get(scene.sectionId),
          sectionId: scene.sectionId,
          style,
          fields: values,
          fallbackText: formatFallback(label, values),
        });
      }
    }
  }

  return result;
}

export function summarizeBookDesignEntityBlocks(blocks: ResolvedDesignerBlock[]): Record<ResolvedDesignerBlockSource, number> {
  return blocks.reduce<Record<ResolvedDesignerBlockSource, number>>(
    (acc, block) => {
      acc[block.source] += 1;
      return acc;
    },
    { character: 0, scene: 0, conflict: 0 }
  );
}
