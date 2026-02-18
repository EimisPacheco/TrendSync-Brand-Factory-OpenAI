import { useState, useEffect, useRef, useCallback } from 'react';
import { Rocket, Search, Palette, Image, Video, RefreshCw, ExternalLink } from 'lucide-react';
import { startPipeline, getPipelineStatus } from '../../lib/api-client';
import type { PipelineConfig, PipelineStatus } from '../../lib/api-client';
import { PipelineStepCard } from './PipelineStepCard';

interface PipelineRunnerProps {
  config: PipelineConfig;
  disabled?: boolean;
}

const STEPS = [
  { key: 'trends', label: 'Trend Analysis', description: 'Analyzing real-time fashion trends with Google Search', icon: <Search size={16} /> },
  { key: 'collection', label: 'Collection Planning', description: 'Generating collection plan with AI thinking', icon: <Palette size={16} /> },
  { key: 'images', label: 'Image Generation', description: 'Creating product images with Gemini Flash Image', icon: <Image size={16} /> },
  { key: 'video', label: 'Ad Video', description: '"Future You" ad video with Veo 3.1', icon: <Video size={16} /> },
];

export function PipelineRunner({ config, disabled }: PipelineRunnerProps) {
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollStatus = useCallback(async (id: string) => {
    try {
      const s = await getPipelineStatus(id);
      setStatus(s);
      if (s.status === 'complete' || s.status === 'failed') {
        stopPolling();
        if (s.status === 'failed') {
          setError(s.error || 'Pipeline failed');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch status');
      stopPolling();
    }
  }, [stopPolling]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setStatus(null);
    setPipelineId(null);

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
          {status.result.products.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {status.result.products.map((p, i) => (
                <div key={i} className="flex-shrink-0 text-center">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-16 h-16 object-cover rounded-lg neumorphic-sm" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg neumorphic-sm flex items-center justify-center text-pastel-muted">
                      <Image size={20} />
                    </div>
                  )}
                  <p className="text-xs text-pastel-muted mt-1 truncate max-w-[64px]">{p.name}</p>
                </div>
              ))}
            </div>
          )}
          {status.result.ad_video && (
            <a
              href={String((status.result.ad_video as Record<string, unknown>).stitched_video_url || '#')}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs text-pastel-accent hover:underline"
            >
              <ExternalLink size={12} /> View Ad Video
            </a>
          )}
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
