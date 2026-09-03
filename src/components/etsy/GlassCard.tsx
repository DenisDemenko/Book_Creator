import React from 'react';
import { motion } from 'motion/react';

interface GlassCardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
  hoverable?: boolean;
  onClick?: () => void;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  title,
  subtitle,
  headerAction,
  badge,
  className = '',
  hoverable = false,
  onClick,
}) => {
  return (
    <motion.div
      onClick={onClick}
      whileHover={hoverable ? { y: -2, transition: { duration: 0.2 } } : undefined}
      className={`glass-card p-5 sm:p-6 ${hoverable ? 'glass-card-hover cursor-pointer' : ''} ${className}`}
    >
      {(title || subtitle || headerAction || badge) && (
        <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-white/10">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 flex-wrap">
              {typeof title === 'string' ? (
                <h3 className="text-lg font-bold tracking-tight text-white">{title}</h3>
              ) : (
                title
              )}
              {badge}
            </div>
            {subtitle && (
              <p className="text-xs text-white/70 mt-0.5">{subtitle}</p>
            )}
          </div>
          {headerAction && <div className="flex items-center gap-2">{headerAction}</div>}
        </div>
      )}
      {children}
    </motion.div>
  );
};
