import { useState, useRef, useEffect, useCallback } from 'react';
import { Video, Play, Loader2, RefreshCw, AlertTriangle, Timer } from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { collectionItemStorage } from '../../services/db-storage';
import { startProductVideo, getProductVideoStatus } from '../../lib/api-client';
import { formatElapsed } from '../../lib/format';
import { toast } from 'sonner';

interface AdvertisementVideoProps {
  item: CollectionItem;
  brandId: string;
  onUpdateItem: (updates: Partial<CollectionItem>) => void;
}

/** Convert an image URL (or data URI) to raw base64 string. */
async function getImageBase64(imageUrl: string | null | undefined): Promise<string> {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('data:')) {
    return imageUrl.split(',')[1] || '';
  }
  try {
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    const reader = new FileReader();
    return await new Promise<string>((resolve) => {
      reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

export function AdvertisementVideo({ item, brandId, onUpdateItem }: AdvertisementVideoProps) {
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Sora accepts 8, 16, and 20-second clips in this UI.
  const [durationSeconds, setDurationSeconds] = useState<8 | 16 | 20>(8);
  // Wall-clock timer for the video-generation pipeline.
  const [videoStartedAt, setVideoStartedAt] = useState<number | null>(null);
  const [videoElapsedMs, setVideoElapsedMs] = useState(0);
  const [lastVideoDurationMs, setLastVideoDurationMs] = useState<number | null>(null);
  // Ref mirror of videoStartedAt so async polling callbacks can read the
  // start time without re-binding pollVideoStatus on every render.
  const videoStartedAtRef = useRef<number | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1 Hz ticker — only running while a video generation is in flight.
  useEffect(() => {
    if (!generating || videoStartedAt == null) return;
    const id = setInterval(() => setVideoElapsedMs(Date.now() - videoStartedAt), 1000);
    return () => clearInterval(id);
  }, [generating, videoStartedAt]);

  /** Mark the run finished: stash final duration, clear start markers. */
  const finalizeVideoTimer = () => {
    if (videoStartedAtRef.current != null) {
      setLastVideoDurationMs(Date.now() - videoStartedAtRef.current);
    }
    videoStartedAtRef.current = null;
    setVideoStartedAt(null);
  };

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const pollVideoStatus = useCallback(async (id: string) => {
    try {
      const s = await getProductVideoStatus(id);
      setStatusMsg(s.message || '');

      if (s.status === 'complete') {
        stopPolling();
        setGenerating(false);
        finalizeVideoTimer();

        // Build video source
        const videoSrc = s.video_base64
          ? `data:video/mp4;base64,${s.video_base64}`
          : s.video_url || null;

        const tookLabel = videoStartedAtRef.current
          ? formatElapsed(Date.now() - videoStartedAtRef.current)
          : '';

        if (videoSrc) {
          // Persist to DB
          await collectionItemStorage.update(item.id, {
            video_url: videoSrc,
          });
          onUpdateItem({ video_url: videoSrc });
          toast.success(tookLabel ? `Advertisement video created in ${tookLabel}!` : 'Advertisement video created!');
        } else {
          setError('Video generated but no data returned');
        }
      } else if (s.status === 'failed') {
        stopPolling();
        setGenerating(false);
        finalizeVideoTimer();
        setError(s.error || 'Video generation failed');
        toast.error('Video generation failed');
      }
    } catch (e) {
      stopPolling();
      setGenerating(false);
      finalizeVideoTimer();
      setError(e instanceof Error ? e.message : 'Failed to check video status');
    }
  }, [item.id, onUpdateItem, stopPolling]);

  const handleGenerate = async () => {
    // Sora reference images may not contain human faces, so product video
    // generation is intentionally product-only.
    const modelId: string | null = null;

    setGenerating(true);
    setError(null);
    setStatusMsg('Starting OpenAI Sora video generation...');
    const startedAt = Date.now();
    videoStartedAtRef.current = startedAt;
    setVideoStartedAt(startedAt);
    setVideoElapsedMs(0);
    setLastVideoDurationMs(null);

    try {
      const imageB64 = await getImageBase64(item.image_url);

      const res = await startProductVideo({
        product: {
          name: item.name,
          category: item.category,
          description: item.design_story || '',
          color_story: item.design_spec_json?.inspiration || '',
          material: item.design_spec_json?.materials?.[0]?.name || '',
        },
        brand_id: brandId,
        image_base64: imageB64 || undefined,
        model_id: modelId,
        model_image_url: null,
        duration_seconds: durationSeconds,
      });

      // Poll every 8 seconds
      pollingRef.current = setInterval(() => pollVideoStatus(res.video_id), 8000);
      // Immediate first poll
      await pollVideoStatus(res.video_id);
    } catch (e) {
      setGenerating(false);
      finalizeVideoTimer();
      setError(e instanceof Error ? e.message : 'Failed to start video generation');
      toast.error('Failed to start video generation');
    }
  };

  const hasVideo = !!item.video_url;

  return (
    <div className="h-[600px] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-pastel-bg-light">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center">
            <Video size={16} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-pastel-navy">Advertisement Video</h3>
            <p className="text-xs text-pastel-muted">OpenAI Sora product showcase</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {/* Video player — caps at 60% viewport height so 9:16 portrait
            videos never overflow the modal. object-contain + auto width
            keeps the aspect ratio for both landscape and portrait. */}
        {hasVideo && (
          <div className="w-full flex flex-col items-center justify-center min-h-0 gap-2">
            <video
              controls
              // Loading the first frame of the actual MP4 as the static
              // thumbnail (instead of the product image as the poster) keeps
              // the player at the video's true aspect ratio — no layout
              // jump when the user hits play.
              preload="metadata"
              className="rounded-xl shadow-neumorphic max-w-full"
              style={{
                maxHeight: '60vh',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
              }}
              src={item.video_url!}
            />
            {!generating && lastVideoDurationMs != null && (
              <div className="neumorphic-inset px-3 py-1 rounded-xl text-xs text-pastel-muted flex items-center gap-1.5">
                <Timer size={12} className="text-pastel-accent" />
                Generated in <span className="font-semibold text-pastel-navy">{formatElapsed(lastVideoDurationMs)}</span>
              </div>
            )}
          </div>
        )}

        {/* Generating state */}
        {generating && (
          <div className="text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-pastel-bg flex items-center justify-center">
              <Loader2 size={40} className="text-pastel-accent animate-spin" />
            </div>
            <div>
              <p className="text-sm font-medium text-pastel-navy">Generating advertisement video...</p>
              <p className="text-xs text-pastel-muted mt-1">{statusMsg || 'This may take a few minutes'}</p>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-pastel-accent neumorphic-inset px-3 py-1.5 rounded-xl tabular-nums w-fit mx-auto">
              <Timer size={14} />
              {formatElapsed(videoElapsedMs)}
            </div>
            <div className="flex items-center justify-center gap-3 text-xs text-pastel-muted">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-pastel-accent animate-pulse" />
                OpenAI Sora
              </div>
              <span>|</span>
              <span>{durationSeconds}-second scene</span>
              <span>|</span>
              <span>product reference</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && !generating && (
          <div className="neumorphic-inset p-4 rounded-xl border-l-4 border-red-400 w-full max-w-md">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-red-500" />
              <p className="text-sm font-medium text-red-700">Generation Failed</p>
            </div>
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Empty state — product preview + caption */}
        {!hasVideo && !generating && (
          <div className="flex flex-col items-center gap-4">
            {item.image_url ? (
              <div className="relative">
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="w-48 h-48 rounded-2xl object-contain bg-white shadow-neumorphic"
                />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-2xl neumorphic-inset flex items-center justify-center">
                <Video size={40} className="text-pastel-muted" />
              </div>
            )}
            <div className="text-center max-w-md">
              <p className="text-sm font-medium text-pastel-navy">{item.name}</p>
              <p className="text-xs text-pastel-muted mt-1">
                Generate a cinematic product showcase that matches this product image exactly.
                Sora currently accepts product-only reference images.
              </p>
            </div>
          </div>
        )}

        {/* Duration selector — segmented control. Only shown pre-generation
            and when there isn't already a video saved. Render time and Sora
            cost both scale roughly linearly with duration. */}
        {!hasVideo && !generating && (
          <div className="w-full max-w-md">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs font-medium text-pastel-navy">Video length</p>
              <p className="text-xs text-pastel-muted">
                {durationSeconds === 8 && '~2 min · cheapest'}
                {durationSeconds === 16 && '~4 min · richer'}
                {durationSeconds === 20 && '~5 min · longest'}
              </p>
            </div>
            <div role="radiogroup" aria-label="Video length" className="neumorphic-inset rounded-2xl p-1 grid grid-cols-3 gap-1">
              {([8, 16, 20] as const).map((d) => {
                const active = durationSeconds === d;
                return (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDurationSeconds(d)}
                    className={
                      'rounded-xl py-2 text-sm font-medium transition-all ' +
                      (active
                        ? 'bg-pastel-navy text-white shadow-neumorphic-sm'
                        : 'text-pastel-muted hover:text-pastel-navy')
                    }
                  >
                    {d}s
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {!generating && (
            <button
              onClick={handleGenerate}
              className="px-6 py-3 btn-navy text-sm flex items-center gap-2"
            >
              {hasVideo ? (
                <>
                  <RefreshCw size={16} />
                  Regenerate Video
                </>
              ) : (
                <>
                  <Play size={16} />
                  Create Advertisement Video
                </>
              )}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
