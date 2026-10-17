import React from 'react';

interface CardTokenProps {
  number?: number | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dimmed?: boolean;
}

export const CardToken: React.FC<CardTokenProps> = ({ number, size = 'md', dimmed = false }) => {
  if (number === undefined || number === null) {
    return (
      <span className="inline-flex items-center justify-center font-mono text-xs text-slate-400 bg-slate-100 rounded px-2 py-0.5 border border-dashed border-slate-300">
        No Card
      </span>
    );
  }

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs font-bold',
    md: 'w-9 h-9 text-sm font-extrabold',
    lg: 'w-12 h-12 text-lg font-black',
    xl: 'w-16 h-16 text-2xl font-black'
  }[size];

  return (
    <div 
      className={`inline-flex items-center justify-center rounded-lg font-mono tracking-tight ${sizeClasses} ${
        dimmed
          ? 'bg-slate-400 text-white border border-slate-500 shadow-none'
          : 'bg-emerald-700 text-white shadow-sm border border-emerald-800'
      }`}
      title={`Physical Card #${number}${dimmed ? ' (Completed)' : ''}`}
    >
      #{number}
    </div>
  );
};
