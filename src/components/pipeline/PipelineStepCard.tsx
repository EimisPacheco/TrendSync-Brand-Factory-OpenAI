import { Check, Loader, AlertCircle, Clock } from 'lucide-react';
import type { ReactNode } from 'react';

interface PipelineStepCardProps {
  icon: ReactNode;
  label: string;
  description: string;
  status: 'pending' | 'active' | 'done' | 'error';
  message?: string;
  progress?: { current: number; total: number };
}

export function PipelineStepCard({
  icon,
  label,
  description,
  status,
  message,
  progress,
}: PipelineStepCardProps) {
  const statusStyles = {
    pending: 'neumorphic-sm opacity-60',
    active: 'neumorphic-inset border-l-4 border-pastel-accent',
    done: 'neumorphic-sm border-l-4 border-emerald-400',
    error: 'neumorphic-sm border-l-4 border-red-400',
  };

  return (
    <div className={`p-4 rounded-xl transition-all ${statusStyles[status]}`}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0">
          {status === 'done' ? (
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check size={16} className="text-emerald-600" />
            </div>
          ) : status === 'active' ? (
            <div className="w-8 h-8 rounded-full bg-pastel-accent/10 flex items-center justify-center">
              <Loader size={16} className="text-pastel-accent animate-spin" />
            </div>
          ) : status === 'error' ? (
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <AlertCircle size={16} className="text-red-500" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-pastel-muted">
              <Clock size={16} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={status === 'active' ? 'text-pastel-accent' : 'text-pastel-muted'}>{icon}</span>
            <p className={`font-semibold text-sm ${
              status === 'done' ? 'text-emerald-700' :
              status === 'active' ? 'text-pastel-navy' :
              status === 'error' ? 'text-red-700' :
              'text-pastel-muted'
            }`}>
              {label}
            </p>
          </div>
          <p className="text-xs text-pastel-muted mt-0.5">{message || description}</p>
        </div>

        {progress && status === 'active' && (
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold text-pastel-navy">{progress.current}/{progress.total}</p>
          </div>
        )}
      </div>
    </div>
  );
}
