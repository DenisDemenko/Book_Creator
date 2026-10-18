import type { Book, Character, BookIllustration } from '../../types';
import type { CharacterDraft } from './CharacterDraftEditor';
export interface SessionPortraitAsset { participantId: string; imageUrl: string; promptUsed: string; modelUsed: string; style: string; }
export async function generateSessionCharacterPortrait(book: Book, draft: CharacterDraft): Promise<SessionPortraitAsset> {
  const name = draft.fictionalName.trim();
  if (!name) throw new Error('Спочатку введіть вигадане ім’я героя.');
  const prompt = ['Original fictional character portrait; do not recreate any real participant or likeness.',
    name, draft.bookRole, draft.archetype, draft.goal, draft.conflict, draft.portraitPrompt,
    'fictional book illustration', draft.portraitStyle].filter(Boolean).join('. ');
  const character: Character = {
    id: 'draft-portrait', bookId: book.id, name, role: 'minor', appearance: {},
    personality: { strengths: [], weaknesses: [], fears: [], desires: [], goals: [], motivation: '', internalConflict: '' },
    biography: '', relationships: [], tags: ['fictionalized'],
  };
  const response = await fetch('/api/ai/generate-character-art', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      character, prompt, genre: book.genre, visualBible: book.visualBible,
      textModelId: book.preferredAiModelId, bookId: book.id, stylePreset: draft.portraitStyle,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.imageUrl !== 'string' || !data.imageUrl) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Сервіс генерації не повернув портрет.');
  }
  return { participantId: draft.participantId, imageUrl: data.imageUrl, promptUsed: data.promptUsed || prompt, modelUsed: data.modelUsed || 'AI', style: draft.portraitStyle };
}
export function attachSessionPortraits(book: Book, ids: Record<string, string>, assets: SessionPortraitAsset[]): Book {
  const characters = book.characters.map(character => {
    const participantId = Object.keys(ids).find(id => ids[id] === character.id);
    const asset = assets.find(a => a.participantId === participantId);
    return asset ? { ...character, avatarUrl: asset.imageUrl } : character;
  });
  const illustrations: BookIllustration[] = assets.filter(a => !!ids[a.participantId]).map(asset => ({
    id: 'portrait-' + ids[asset.participantId], url: asset.imageUrl,
    caption: 'Портрет героя ' + (characters.find(c => c.id === ids[asset.participantId])?.name || ''),
    promptUsed: asset.promptUsed, style: asset.style, aspectRatio: '1:1',
    modelUsed: asset.modelUsed, source: 'ai' as const, createdAt: new Date().toISOString(),
  }));
  return { ...book, characters, illustrations: [...(book.illustrations || []), ...illustrations] };
}
