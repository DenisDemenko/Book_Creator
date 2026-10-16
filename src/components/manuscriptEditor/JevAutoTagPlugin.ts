import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { CharacterMentionEntry } from './CharacterMentionPlugin';
import { entityBySlug, parseAnyEntityTags, type CoreEntity } from '../../utils/coreEntities';
import {
  classifyBookEntitiesWithJev,
  canonicalTag,
  loadJevBookEntityCandidates,
  mergeJevEntityCandidates,
  type JevEntityCandidate,
} from '../../utils/jevSemanticClient';

export interface JevAutoTagOptions {
  getCharacters: () => CharacterMentionEntry[];
  getCoreEntities: () => CoreEntity[];
  threshold: number;
  isEnglishUi: () => boolean;
}

export const jevAutoTagKey = new PluginKey('novaJevAutoTag');

type BookAwareCharacterMentionEntry = CharacterMentionEntry & { bookId?: string };

function clean(value: string): string {
  return value.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function collectLocalCandidates(docText: string, characters: CharacterMentionEntry[]): JevEntityCandidate[] {
  const out = new Map<string, JevEntityCandidate>();

  // These are the live Character objects supplied by EditorView, so this
  // layer includes character changes that have not reached the server copy
  // yet. The type is intentionally narrower than Character because the
  // mention decoration needs only identity/name fields.
  for (const character of characters) {
    const name = clean(`${character.name || ''} ${character.surname || ''}`);
    if (!character.id || !name) continue;
    out.set(`character:${character.id}`, {
      id: character.id,
      slug: 'character',
      name,
      description: character.alias ? `Псевдонім: ${clean(character.alias)}` : undefined,
    });
  }

  // Current TipTap document may contain canonical tags that are newer than
  // the server autosave. Keep them in the whitelist as an immediate local
  // overlay, but only for slugs that already exist in Core Entity Registry.
  for (const tag of parseAnyEntityTags(docText)) {
    const entity = entityBySlug(tag.entity?.slug ?? tag.slug);
    const name = clean(tag.value || '');
    if (!entity || !name) continue;
    const key = `${entity.slug}:${name.toLocaleLowerCase()}`;
    if (!out.has(key)) {
      out.set(key, {
        id: key,
        slug: entity.slug,
        name,
        description: entity.nameUk,
      });
    }
  }

  return Array.from(out.values());
}

function resolveBookId(characters: CharacterMentionEntry[]): string | null {
  for (const character of characters as BookAwareCharacterMentionEntry[]) {
    const id = clean(character.bookId || '');
    if (id) return id;
  }
  return null;
}

function closeExistingMenu(): void {
  document.querySelectorAll('[data-nova-jev-context-menu]').forEach((node) => node.remove());
}

function placeMenu(menu: HTMLElement, x: number, y: number): void {
  const width = 260;
  const height = 88;
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/**
 * Context-menu bridge for semantic tagging.
 *
 * JEV gets a whitelist assembled from two layers:
 * 1) the authenticated server copy of the WHOLE book (characters, approved
 *    world/locations, chapters, sections, scenes, theme/motifs, images,
 *    knowledge sources and canonical manuscript tags);
 * 2) live local characters/current-document tags, so unsaved edits are not
 *    lost between autosaves.
 *
 * No layer may invent an entity: every candidate slug must already exist in
 * Core Entity Registry, and the server contract keeps proposedNewEntities [].
 */
export const JevAutoTagPlugin = Extension.create<JevAutoTagOptions>({
  name: 'novaJevAutoTag',

  addOptions() {
    return {
      getCharacters: () => [],
      getCoreEntities: () => [],
      threshold: 0.65,
      isEnglishUi: () => false,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: jevAutoTagKey,
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const mouse = event as MouseEvent;
              const { from, to, empty } = view.state.selection;
              if (empty || from === to) return false;

              const selectedText = view.state.doc.textBetween(from, to, '\n', '\n').trim();
              if (!selectedText) return false;

              event.preventDefault();
              closeExistingMenu();

              const english = options.isEnglishUi();
              const menu = document.createElement('div');
              menu.dataset.novaJevContextMenu = 'true';
              menu.style.position = 'fixed';
              menu.style.zIndex = '120';
              menu.style.width = '260px';
              menu.style.padding = '6px';
              menu.style.borderRadius = '14px';
              menu.style.background = '#020617';
              menu.style.border = '1px solid rgba(16,185,129,.45)';
              menu.style.boxShadow = '0 20px 45px rgba(0,0,0,.45)';
              placeMenu(menu, mouse.clientX, mouse.clientY);

              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = english ? '✦ Add tags automatically' : '✦ Проставити теги автоматично';
              button.style.width = '100%';
              button.style.padding = '10px 12px';
              button.style.border = '0';
              button.style.borderRadius = '10px';
              button.style.background = 'transparent';
              button.style.color = '#e2e8f0';
              button.style.textAlign = 'left';
              button.style.cursor = 'pointer';
              button.style.fontSize = '13px';

              const note = document.createElement('div');
              note.textContent = english
                ? 'JEV checks only existing whole-book entities.'
                : 'JEV перевіряє лише наявні сутності всієї книги.';
              note.style.padding = '4px 12px 7px';
              note.style.fontSize = '10px';
              note.style.color = '#64748b';

              button.addEventListener('mouseenter', () => {
                button.style.background = 'rgba(16,185,129,.12)';
              });
              button.addEventListener('mouseleave', () => {
                button.style.background = 'transparent';
              });

              button.addEventListener('click', async () => {
                button.disabled = true;
                button.textContent = english ? 'JEV is analyzing…' : 'JEV аналізує…';

                try {
                  const wholeDocText = view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n');
                  const characters = options.getCharacters();
                  const localCandidates = collectLocalCandidates(wholeDocText, characters);
                  const bookId = resolveBookId(characters);

                  let serverCandidates: JevEntityCandidate[] = [];
                  let registrySource: 'whole-book' | 'local-fallback' = 'local-fallback';
                  if (bookId) {
                    try {
                      serverCandidates = await loadJevBookEntityCandidates(bookId);
                      registrySource = 'whole-book';
                    } catch (registryError) {
                      // Autosave/server copy being temporarily unavailable must
                      // not break the editor. We continue with the conservative
                      // local whitelist and expose the source in the result event.
                      console.warn('[jev-autotag] whole-book registry unavailable:', registryError);
                    }
                  }

                  const candidates = mergeJevEntityCandidates(serverCandidates, localCandidates);
                  if (!candidates.length) {
                    throw new Error(
                      english
                        ? 'There are no persisted book entities available for tagging.'
                        : 'Немає збережених сутностей книги, з якими JEV може зіставити текст.',
                    );
                  }

                  const result = await classifyBookEntitiesWithJev(selectedText, candidates, options.threshold);
                  const existing = new Set(
                    parseAnyEntityTags(selectedText).map((tag) => {
                      const entity = entityBySlug(tag.entity?.slug ?? tag.slug);
                      return entity ? `${entity.slug}:${clean(tag.value || '').toLocaleLowerCase()}` : '';
                    }),
                  );

                  const tags = result.matches
                    .filter((match) => entityBySlug(match.slug))
                    .filter((match) => !existing.has(`${match.slug}:${clean(match.name).toLocaleLowerCase()}`))
                    .map((match) => canonicalTag(match));

                  if (tags.length) {
                    view.dispatch(view.state.tr.insertText(`${tags.join(' ')}\n`, from));
                  }

                  closeExistingMenu();
                  window.dispatchEvent(
                    new CustomEvent('nova:jev-autotag-result', {
                      detail: {
                        added: tags.length,
                        matches: result.matches,
                        provider: result.provider,
                        model: result.model,
                        candidateCount: candidates.length,
                        registrySource,
                      },
                    }),
                  );
                } catch (error) {
                  const message = String((error as Error)?.message || error);
                  button.disabled = false;
                  button.textContent = english ? 'JEV error — retry' : 'Помилка JEV — повторити';
                  note.textContent = message;
                  note.style.color = '#fca5a5';
                }
              });

              menu.append(button, note);
              document.body.appendChild(menu);

              const close = (click: MouseEvent) => {
                if (!menu.contains(click.target as Node)) {
                  closeExistingMenu();
                  document.removeEventListener('mousedown', close, true);
                }
              };
              setTimeout(() => document.addEventListener('mousedown', close, true), 0);
              return true;
            },
          },
        },
      }),
    ];
  },
});
