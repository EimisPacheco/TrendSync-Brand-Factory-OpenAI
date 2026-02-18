import { useState } from 'react';
import { Shield, XCircle, AlertTriangle, Info, Wand2, CheckCircle, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import type { Violation, BrandStyleJSON, FIBOPromptJSON } from '../../types/database';
import { validateFIBOPrompt, applyAutoFixes, getComplianceBadge, type ValidationResult, type ValidationWithFixes } from '../../lib/brand-guardian';

interface ValidationPanelProps {
  prompt: FIBOPromptJSON;
  brandStyle: BrandStyleJSON;
  onApplyFixes?: (result: ValidationWithFixes) => void;
}

export function ValidationPanel({ prompt, brandStyle, onApplyFixes }: ValidationPanelProps) {
  const [validation, setValidation] = useState<ValidationResult>(() =>
    validateFIBOPrompt(prompt, brandStyle)
  );
  const [expanded, setExpanded] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);

  const badge = getComplianceBadge(validation.complianceScore);

  const handleApplyFixes = () => {
    setApplying(true);
    setTimeout(() => {
      const result = applyAutoFixes(prompt, brandStyle, validation);
      setValidation(result);
      onApplyFixes?.(result);
      setApplying(false);
    }, 800);
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const getSeverityStyles = (severity: Violation['severity']) => {
    switch (severity) {
      case 'critical': return {
        cardBg: 'bg-gradient-to-br from-rose-50/80 via-pink-50/60 to-rose-50/80',
        iconBg: 'bg-rose-100/50',
        icon: XCircle,
        iconColor: 'text-rose-400',
        badgeBg: 'bg-rose-400',
        badgeText: 'text-white',
        borderAccent: 'border-l-rose-300',
      };
      case 'warning': return {
        cardBg: 'bg-gradient-to-br from-amber-50/80 via-yellow-50/60 to-amber-50/80',
        iconBg: 'bg-amber-100/50',
        icon: AlertTriangle,
        iconColor: 'text-amber-400',
        badgeBg: 'bg-amber-400',
        badgeText: 'text-white',
        borderAccent: 'border-l-amber-300',
      };
      case 'suggestion': return {
        cardBg: 'bg-gradient-to-r from-sky-50 to-blue-50',
        iconBg: 'bg-sky-100',
        icon: Info,
        iconColor: 'text-sky-500',
        badgeBg: 'bg-sky-500',
        badgeText: 'text-white',
        borderAccent: 'border-l-sky-400',
      };
    }
  };

  const criticalCount = validation.violations.filter(v => v.severity === 'critical').length;
  const warningCount = validation.violations.filter(v => v.severity === 'warning').length;
  const suggestionCount = validation.violations.filter(v => v.severity === 'suggestion').length;

  return (
    <div className="neumorphic-card overflow-hidden">
      <div className="p-6 border-b border-pastel-muted/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 circular-icon flex items-center justify-center">
              <Shield size={24} className="text-emerald-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-pastel-navy">Brand Guardian</h3>
              <p className="text-sm text-pastel-muted">Real-time compliance validation</p>
            </div>
          </div>
          <div className={`px-4 py-2 neumorphic-sm rounded-xl`}>
            <div className="text-3xl font-bold text-pastel-navy">{Math.round(validation.complianceScore)}%</div>
            <div className={`text-sm font-medium ${badge.color}`}>{badge.label}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="neumorphic-inset rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-rose-400">{criticalCount}</div>
            <div className="text-xs text-pastel-muted">Critical</div>
          </div>
          <div className="neumorphic-inset rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-amber-400">{warningCount}</div>
            <div className="text-xs text-pastel-muted">Warnings</div>
          </div>
          <div className="neumorphic-inset rounded-xl p-3 text-center">
            <div className="text-2xl font-bold text-sky-500">{suggestionCount}</div>
            <div className="text-xs text-pastel-muted">Suggestions</div>
          </div>
        </div>

        {validation.autoFixesAvailable > 0 && (
          <button
            onClick={handleApplyFixes}
            disabled={applying}
            className="w-full py-3 px-4 btn-navy flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {applying ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Applying Fixes...
              </>
            ) : (
              <>
                <Wand2 size={20} />
                Auto-Fix All ({validation.autoFixesAvailable} issues)
              </>
            )}
          </button>
        )}

        {validation.violations.length === 0 && (
          <div className="flex items-center gap-3 p-4 neumorphic-inset rounded-xl">
            <CheckCircle className="text-emerald-500" size={24} />
            <div>
              <p className="font-medium text-emerald-600">All checks passed!</p>
              <p className="text-sm text-pastel-muted">This prompt is fully compliant with brand guidelines</p>
            </div>
          </div>
        )}
      </div>

      {validation.violations.length > 0 && (
        <div className="p-4 space-y-3">
          {validation.violations.map(violation => {
            const styles = getSeverityStyles(violation.severity);
            const Icon = styles.icon;
            const isExpanded = expanded.includes(violation.id);

            return (
              <div
                key={violation.id}
                className={`rounded-xl overflow-hidden shadow-soft border-l-4 ${styles.borderAccent} ${styles.cardBg}`}
              >
                <button
                  onClick={() => toggleExpand(violation.id)}
                  className="w-full p-4 text-left flex items-start gap-3 hover:bg-white/30 transition-colors"
                >
                  <div className={`p-2 rounded-lg ${styles.iconBg} flex-shrink-0`}>
                    <Icon size={18} className={styles.iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${styles.badgeBg} ${styles.badgeText}`}>
                        {violation.severity.toUpperCase()}
                      </span>
                      <span className="text-xs text-pastel-muted bg-white/50 px-2 py-0.5 rounded-full">{violation.category}</span>
                    </div>
                    <p className="text-sm text-pastel-navy font-medium leading-relaxed">{violation.message}</p>
                  </div>
                  <div className={`p-1.5 rounded-lg ${isExpanded ? 'bg-white/50' : ''} transition-colors`}>
                    {isExpanded ? (
                      <ChevronUp size={18} className="text-pastel-muted" />
                    ) : (
                      <ChevronDown size={18} className="text-pastel-muted" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4">
                    <div className="bg-white/60 rounded-xl p-4 space-y-3 shadow-inner">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-pastel-muted uppercase tracking-wide">Detected Value</span>
                        <code className="bg-rose-100/60 text-rose-600 px-3 py-1 rounded-lg text-xs font-mono">
                          {typeof violation.detected === 'object'
                            ? JSON.stringify(violation.detected)
                            : String(violation.detected)}
                        </code>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-pastel-muted uppercase tracking-wide">Allowed Range</span>
                        <code className="bg-emerald-100/60 text-emerald-600 px-3 py-1 rounded-lg text-xs font-mono">
                          {typeof violation.allowed === 'object'
                            ? `${(violation.allowed as { min: number; max: number }).min} - ${(violation.allowed as { min: number; max: number }).max}`
                            : String(violation.allowed)}
                        </code>
                      </div>
                      {violation.autoFixAvailable && violation.fixedValue !== undefined && (
                        <div className="flex items-center justify-between pt-3 border-t border-pastel-muted/20">
                          <span className="text-xs font-medium text-pastel-accent uppercase tracking-wide flex items-center gap-1">
                            <Zap size={12} />
                            Auto-fix Available
                          </span>
                          <code className="bg-sky-100 text-sky-700 px-3 py-1 rounded-lg text-xs font-mono">
                            {String(violation.fixedValue)}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
