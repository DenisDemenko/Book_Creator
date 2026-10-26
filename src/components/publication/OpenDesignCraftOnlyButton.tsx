import React, { useEffect, useRef, useState } from 'react';
import { MonitorUp } from 'lucide-react';

/** Посилання «лише вікно DesignCraft»: скрипт запуску відкриває редактор і виходить — без Студії, входу та Claude Code. */
export const DESIGNCRAFT_ONLY_URL = 'designcraft-studio://open?mode=designcraft';

interface Props {
  /** Вигляд: основна кнопка чи компактна (у кроках інструкції). */
  compact?: boolean;
}

/**
 * Відкриває DesignCraft на комп'ютері автора БЕЗ Claude Code: для правки копії шаблону й ручної верстки.
 * Той самий механізм, що й головна кнопка (протокол designcraft-studio://), тому браузер не каже, чи спрацювало:
 * якщо за 3 с сторінка не втратила фокус — підказуємо, що посилання не встановлене або застаріле.
 */
export const OpenDesignCraftOnlyButton: React.FC<Props> = ({ compact = false }) => {
  const [state, setState] = useState<'idle' | 'sent' | 'silent'>('idle');
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setState('idle');
    if (timer.current) window.clearTimeout(timer.current);
    let reacted = false;
    const react = () => {
      reacted = true;
    };
    window.addEventListener('blur', react, { once: true });
    document.addEventListener('visibilitychange', react, { once: true });
    timer.current = window.setTimeout(() => {
      window.removeEventListener('blur', react);
      document.removeEventListener('visibilitychange', react);
      setState(reacted ? 'sent' : 'silent');
    }, 3000);
    window.location.href = DESIGNCRAFT_ONLY_URL;
  };

  return (
    <span className="inline-flex flex-col gap-1" data-open-designcraft-only-wrap>
      <a
        href={DESIGNCRAFT_ONLY_URL}
        onClick={onClick}
        data-open-designcraft-only
        title="Відкриває лише вікно DesignCraft: Claude Code не запускається, вхід в акаунт не потрібен."
        className={
          compact
            ? 'inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 font-bold text-cyan-100 hover:bg-cyan-500/20'
            : 'inline-flex items-center gap-2 rounded-xl border border-cyan-500/60 bg-slate-900 px-4 py-2 text-xs font-bold text-cyan-100 hover:bg-slate-800'
        }
      >
        <MonitorUp className="h-3.5 w-3.5" /> Відкрити лише DesignCraft (без Claude Code)
      </a>
      {state === 'sent' && (
        <span className="max-w-xs text-[10px] text-slate-400" data-only-sent>
          Запит надіслано. Якщо браузер питає дозвіл відкрити програму — погодьтесь: відкриється вікно DesignCraft.
        </span>
      )}
      {state === 'silent' && (
        <span className="max-w-xs text-[10px] text-amber-300" data-only-silent>
          Нічого не відбулося. Найімовірніше, посилання не встановлене або застаріле: завантажте інсталятор у блоці
          «Графічний редактор DesignCraft» (крок 1), запустіть його й натисніть кнопку ще раз. Або відкрийте DesignCraft з меню «Пуск».
        </span>
      )}
    </span>
  );
};
