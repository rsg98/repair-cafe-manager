import React from 'react';
import { ItemStatus } from '../../types';

interface StatusBadgeProps {
  status: ItemStatus;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<ItemStatus, { label: string; bg: string; text: string; border: string }> = {
  REGISTERED: {
    label: 'Registered',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-300'
  },
  WAITING_PAT1: {
    label: 'Waiting Initial PAT',
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-300'
  },
  IN_PAT1: {
    label: 'In Initial PAT',
    bg: 'bg-amber-200',
    text: 'text-amber-900',
    border: 'border-amber-400'
  },
  WAITING_REPAIR: {
    label: 'Waiting Repair',
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    border: 'border-blue-300'
  },
  IN_REPAIR: {
    label: 'Under Repair',
    bg: 'bg-blue-200',
    text: 'text-blue-900',
    border: 'border-blue-400'
  },
  WAITING_PAT2: {
    label: 'Waiting Final PAT',
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    border: 'border-purple-300'
  },
  IN_PAT2: {
    label: 'In Final PAT',
    bg: 'bg-purple-200',
    text: 'text-purple-900',
    border: 'border-purple-400'
  },
  READY_FOR_COLLECTION: {
    label: 'Ready for Collection',
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    border: 'border-emerald-300'
  },
  COMPLETED: {
    label: 'Collected / Complete',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-300'
  },
  TAKEN_HOME: {
    label: 'Taken Home by Volunteer',
    bg: 'bg-sky-100',
    text: 'text-sky-800',
    border: 'border-sky-300'
  },
  UNFIXABLE: {
    label: 'Unfixable / Quarantined',
    bg: 'bg-rose-100',
    text: 'text-rose-800',
    border: 'border-rose-300'
  }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const config = statusConfig[status] || {
    label: status,
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-300'
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 font-medium',
    md: 'text-xs md:text-sm px-2.5 py-1 font-semibold',
    lg: 'text-sm md:text-base px-3.5 py-1.5 font-bold'
  }[size];

  return (
    <span className={`inline-flex items-center rounded-full border ${config.bg} ${config.text} ${config.border} ${sizeClasses}`}>
      {config.label}
    </span>
  );
};
