import { useState, useEffect, useRef, useCallback } from 'react';
import { Rocket, Search, Palette, Image, Video, RefreshCw } from 'lucide-react';
import { startPipeline, getPipelineStatus } from '../../lib/api-client';
import type { PipelineConfig, PipelineStatus, PipelineResult } from '../../lib/api-client';
import { PipelineStepCard } from './PipelineStepCard';

interface PipelineRunnerProps {
  config: PipelineConfig;
  disabled?: boolean;
  onComplete?: (result: PipelineResult) => void;
}

const STEPS = [
  { key: 'trends', label: 'Trend Analysis', description: 'Analyzing real-time fashion trends with Google Search', icon: <Search size={16} /> },
  { key: 'collection', label: 'Collection Planning', description: 'Generating collection plan with Gemini 3 Pro thinking', icon: <Palette size={16} /> },
  { key: 'images', label: 'Image Generation', description: 'Creating product images with Gemini 3 Pro Image', icon: <Image size={16} /> },
  { key: 'video', label: 'Product Videos', description: 'Per-product showcase videos with Veo 3.1', icon: <Video size={16} /> },
];

export function PipelineRunner({ config, disabled, onComplete }: PipelineRunnerProps) {
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const lastLoggedRef = useRef<string>('');
  const loggedStepsRef = useRef<Set<string>>(new Set());

  const pollStatus = useCallback(async (id: string) => {
    try {
      const s = await getPipelineStatus(id);
      setStatus(s);

      // Log each step transition
      const logKey = `${s.current_step}:${s.message}`;
      if (logKey !== lastLoggedRef.current) {
        lastLoggedRef.current = logKey;
        const stepLabel = STEPS.find(st => st.key === s.current_step)?.label || s.current_step;
        console.log(
          `%c[Pipeline] [${stepLabel}] ${s.message}`,
          'color: #6366f1; font-weight: bold'
        );
        if (s.step_data && Object.keys(s.step_data).length > 0) {
          console.log(`%c[Pipeline] [${stepLabel}] step_data:`, 'color: #8b5cf6', s.step_data);
        }
      }

      // Log per-step AI results (persisted, not overwritten)
      if (s.step_results) {
        for (const [stepKey, stepResult] of Object.entries(s.step_results)) {
          if (!loggedStepsRef.current.has(stepKey) && stepResult && Object.keys(stepResult).length > 0) {
            loggedStepsRef.current.add(stepKey);
            const stepLabel = STEPS.find(st => st.key === stepKey)?.label || stepKey;
            console.log(
              `%c[Pipeline] [${stepLabel}] AI RESULT:`,
              'color: #f59e0b; font-weight: bold; font-size: 13px',
              stepResult
            );
          }
        }
      }

      if (s.status === 'complete' || s.status === 'failed') {
        stopPolling();
        if (s.status === 'failed') {
          console.error('[Pipeline] FAILED:', s.error);
          setError(s.error || 'Pipeline failed');
        }
        if (s.status === 'complete' && s.result) {
          console.log('%c[Pipeline] COMPLETE — Full result:', 'color: #10b981; font-weight: bold', s.result);
          if (onComplete && !completedRef.current) {
            completedRef.current = true;
            onComplete(s.result);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch status');
      stopPolling();
    }
  }, [stopPolling, onComplete]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setStatus(null);
    setPipelineId(null);
    completedRef.current = false;
    lastLoggedRef.current = '';
    loggedStepsRef.current = new Set();

    try {
      const res = await startPipeline(config);
      setPipelineId(res.pipeline_id);

      // Start polling
      pollingRef.current = setInterval(() => pollStatus(res.pipeline_id), 2000);
      // Immediate first poll
      await pollStatus(res.pipeline_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start pipeline');
    } finally {
      setStarting(false);
    }
  };

  const handleRetry = () => {
    stopPolling();
    handleStart();
  };

  function getStepStatus(stepKey: string): 'pending' | 'active' | 'done' | 'error' {
    if (!status) return 'pending';
    if (status.status === 'failed' && status.current_step === stepKey) return 'error';
    if (status.completed_steps.includes(stepKey)) return 'done';
    if (status.current_step === stepKey) return 'active';
    return 'pending';
  }

  const isRunning = pipelineId && status && status.status === 'running';
  const isComplete = status?.status === 'complete';
  const isFailed = status?.status === 'failed';

  return (
    <div className="space-y-4">
      {/* Pipeline Steps */}
      <div className="space-y-2">
        {STEPS.map((step) => {
          const stepStatus = getStepStatus(step.key);
          const stepData = status?.current_step === step.key ? status.step_data : undefined;
          const progress = stepData && typeof stepData.current === 'number' && typeof stepData.total === 'number'
            ? { current: stepData.current as number, total: stepData.total as number }
            : undefined;
          const message = status?.current_step === step.key ? status.message : undefined;

          return (
            <PipelineStepCard
              key={step.key}
              icon={step.icon}
              label={step.label}
              description={step.description}
              status={stepStatus}
              message={message}
              progress={progress}
            />
          );
        })}
      </div>

      {/* Results */}
      {isComplete && status.result && (
        <div className="neumorphic-inset p-4 rounded-xl">
          <p className="text-sm font-semibold text-emerald-700 mb-2">Pipeline Complete!</p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-pastel-muted">Collection</p>
              <p className="text-pastel-navy font-medium">{status.result.collection_name}</p>
            </div>
            <div>
              <p className="text-pastel-muted">Products</p>
              <p className="text-pastel-navy font-medium">{status.result.product_count} items</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-emerald-600">
            Collection saved to library. View it in the Product Gallery below.
          </p>
        </div>
      )}

      {/* Error */}
      {isFailed && error && (
        <div className="neumorphic-inset p-4 rounded-xl border-l-4 border-red-400">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Action Button */}
      {!isRunning && !starting && (
        <button
          onClick={isFailed ? handleRetry : handleStart}
          disabled={disabled || starting}
          className="w-full py-4 px-6 btn-navy text-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isFailed ? (
            <>
              <RefreshCw size={24} />
              Retry Pipeline
            </>
          ) : isComplete ? (
            <>
              <RefreshCw size={24} />
              Run Again
            </>
          ) : (
            <>
              <Rocket size={24} />
              Run Full Pipeline
            </>
          )}
        </button>
      )}

      {(isRunning || starting) && (
        <div className="text-center py-3">
          <p className="text-sm text-pastel-accent animate-pulse">
            Pipeline running... {status?.message || 'Starting up...'}
          </p>
        </div>
      )}
    </div>
  );
}
