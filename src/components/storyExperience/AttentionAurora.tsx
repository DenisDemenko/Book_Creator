import React from 'react';
import './attentionAurora.css';

interface AttentionAuroraProps {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  intensity?: 'soft' | 'normal' | 'strong';
  ariaLabel?: string;
}

/**
 * Ненав'язливий UX-сигнал для блоків, де щойно з'явилась важлива зміна:
 * AI-подія, новий тригер, діагностичний висновок, зміна live-session state.
 *
 * Важливо: компонент не визначає бізнес-логіку. `active` приходить із UI-state.
 * Анімація автоматично вимикається для prefers-reduced-motion.
 */
export const AttentionAurora: React.FC<AttentionAuroraProps> = ({
  active = false,
  children,
  className = '',
  style,
  intensity = 'normal',
  ariaLabel,
}) => {
  return (
    <div
      className={`story-attention-aurora story-attention-aurora--${intensity} ${active ? 'is-active' : ''} ${className}`}
      style={style}
      aria-label={ariaLabel}
      data-attention={active ? 'active' : 'idle'}
    >
      <span className="story-attention-aurora__halo" aria-hidden="true" />
      <span className="story-attention-aurora__content">{children}</span>
    </div>
  );
};
