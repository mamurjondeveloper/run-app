import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  className = '',
  id,
  ...props
}) => {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {label && (
        <label htmlFor={id} className="text-xs font-semibold text-zinc-400 tracking-wider uppercase">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <div className="absolute left-3.5 text-zinc-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          id={id}
          className={`w-full bg-zinc-900/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/80 focus:ring-1 focus:ring-green-500/80 transition-all duration-200 ${icon ? 'pl-11' : ''} ${error ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500' : ''} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <span className="text-xs text-red-400 font-medium leading-none">
          {error}
        </span>
      )}
    </div>
  );
};
