/**
 * «Аналітика ринку Etsy» у плаваючому вікні поверх студії.
 *
 * ЧОМУ ВІКНО, А НЕ ВКЛАДКА. Аналітику дивляться, не полишаючи роботи над
 * книгою: автор звіряє ціни ніші й повертається до рукопису. Вкладка на всю
 * ширину вимагає піти зі студії й повернутись, гублячи місце в тексті.
 *
 * ЧОМУ ВІКНО НЕ РОЗМОНТОВУЄТЬСЯ ПІСЛЯ ЗАКРИТТЯ. У вкладці «Аудит лістинга»
 * автор друкує назву, теги й опис руками — це кілька хвилин роботи, які
 * ніде не зберігаються. Якби закриття розмонтовувало екран, випадковий
 * Escape стирав би все набране, і причину автор зрозумів би не одразу.
 * Тому після першого відкриття вікно лишається змонтованим і лише
 * ховається: повернення відновлює і набраний текст, і завантажений звіт, і
 * обрану вкладку. Побічний виграш — повторне відкриття не робить запитів
 * до `/api/market/settings` і `/topics` заново.
 */
import React, { useEffect, useState } from 'react';
import { LineChart } from 'lucide-react';
import { DraggablePanel } from './DraggablePanel';
import { MarketIntelligenceView } from './MarketIntelligenceView';
import type { AuthUser } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface MarketIntelligenceWindowProps {
  open: boolean;
  onClose: () => void;
  authUser: AuthUser | null;
  onGoToSubscription?: () => void;
}

export const MarketIntelligenceWindow: React.FC<MarketIntelligenceWindowProps> = ({
  open,
  onClose,
  authUser,
  onGoToSubscription,
}) => {
  const { t } = useLanguage();

  /** Чи відкривали вікно бодай раз: до першого відкриття не монтуємо нічого. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Escape закриває — але саме ХОВАЄ, а не стирає (див. шапку файлу), тож
  // втратити набране в аудиті випадковим натисканням неможливо.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div hidden={!open}>
      {/*
        Розмиття студії позаду — те саме, що в модальних вікнах студії
        (`bg-black/80 backdrop-blur-md`), лише трохи прозоріше: під цим вікном
        автор час від часу звіряється з текстом книги, і повністю глухий фон
        тут заважав би більше, ніж допомагав.

        Клік по фону НЕ закриває. Вікно перетягують за шапку й тягнуть за
        краї, тож курсор регулярно опиняється поза ним, а у вкладці аудиту
        стоїть кілька полів із ручним введенням: закриття по фону рано чи
        пізно стерло б набране. Лишаються два передбачувані способи —
        хрестик і Escape.
      */}
      <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-md" aria-hidden="true" />

      <DraggablePanel
        title={
          <span className="flex items-center gap-2">
            <LineChart className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            {t('marketIntel.heading')}
          </span>
        }
        onClose={onClose}
        storageKey="nova.market.window"
        initialWidth={1180}
        initialHeight={800}
        minWidth={480}
        minHeight={360}
        zIndex={45}
        className="overflow-hidden"
        headerClassName="bg-slate-900/90"
        bodyClassName="flex min-h-0 overflow-hidden"
      >
        <MarketIntelligenceView
          embedded
          authUser={authUser}
          onGoToSubscription={onGoToSubscription}
        />
      </DraggablePanel>
    </div>
  );
};
