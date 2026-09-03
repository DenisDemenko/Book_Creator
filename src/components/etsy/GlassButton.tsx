import React from 'react';
import { motion, HTMLMotionProps } from 'motion/react';

interface GlassButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'plan';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  icon?: React.ReactNode;
  isLoading?: boolean;
}

export const GlassButton: React.FC<GlassButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  icon,
  isLoading,
  className = '',
  disabled,
  ...props
}) => {
  const sizeClasses = {
    sm: 'px-4 py-2 text-xs rounded-lg',
    md: 'px-6 py-3 text-sm font-semibold rounded-xl',
    lg: 'px-8 py-3.5 text-base font-semibold rounded-xl',
  }[size];

  if (variant === 'secondary') {
    return (
      <motion.button
        whileHover={{ y: -1, scale: 1.01 }}
        whileTap={{ y: 1, scale: 0.99 }}
        disabled={disabled || isLoading}
        className={`glass-btn-secondary ${sizeClasses} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        {...props}
      >
        <span className="glass-btn-flare" aria-hidden="true" />
        {isLoading ? (
          <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin mr-1" />
        ) : (
          icon
        )}
        <span>{children}</span>
      </motion.button>
    );
  }

  // Primary & Plan & Accent use the exact user CSS .glass-btn with glowing bottom specular light & 2s diagonal white flare sweep
  return (
    <motion.button
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ y: 1, scale: 0.98 }}
      disabled={disabled || isLoading}
      className={`glass-btn ${sizeClasses} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      {...props}
    >
      <span className="glass-btn-flare" aria-hidden="true" />
      {isLoading ? (
        <span className="inline-block w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin mr-1" />
      ) : (
        icon
      )}
      <span className="tracking-wide">{children}</span>
    </motion.button>
  );
};
