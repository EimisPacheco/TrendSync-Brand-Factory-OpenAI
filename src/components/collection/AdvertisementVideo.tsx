import { useState, useRef, useEffect, useCallback } from 'react';
import { Video, Play, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { collectionItemStorage } from '../../services/db-storage';
import { startProductVideo, getProductVideoStatus } from '../../lib/api-client';
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
  const [videoId, setVideoId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState<string | null>(null);
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

  const pollVideoStatus = useCallback(async (id: string) => {
    try {
      const s = await getProductVideoStatus(id);
      setStatusMsg(s.message || '');

      if (s.status === 'complete') {
        stopPolling();
        setGenerating(false);

        // Build video source
        const videoSrc = s.video_base64
          ? `data:video/mp4;base64,${s.video_base64}`
          : s.video_url || null;

        if (videoSrc) {
          // Persist to DB
          await collectionItemStorage.update(item.id, {
            video_url: videoSrc,
          });
          onUpdateItem({ video_url: videoSrc });
          toast.success('Advertisement video created!');
        } else {
          setError('Video generated but no data returned');
        }
      } else if (s.status === 'failed') {
        stopPolling();
        setGenerating(false);
        setError(s.error || 'Video generation failed');
        toast.error('Video generation failed');
      }
    } catch (e) {
      stopPolling();
      setGenerating(false);
      setError(e instanceof Error ? e.message : 'Failed to check video status');
    }
  }, [item.id, onUpdateItem, stopPolling]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setStatusMsg('Starting video generation...');

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
      });

      setVideoId(res.video_id);

      // Poll every 8 seconds
      pollingRef.current = setInterval(() => pollVideoStatus(res.video_id), 8000);
      // Immediate first poll
      await pollVideoStatus(res.video_id);
    } catch (e) {
      setGenerating(false);
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
            <p className="text-xs text-pastel-muted">8-second product showcase with Veo 3.1</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {/* Video player */}
        {hasVideo && (
          <div className="w-full max-w-2xl">
            <video
              controls
              className="w-full rounded-xl shadow-neumorphic"
              src={item.video_url!}
              poster={item.image_url || undefined}
            />
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
            <div className="flex items-center justify-center gap-3 text-xs text-pastel-muted">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-pastel-accent animate-pulse" />
                Veo 3.1
              </div>
              <span>|</span>
              <span>8-second scene</span>
              <span>|</span>
              <span>16:9</span>
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

        {/* Empty state / generate button */}
        {!hasVideo && !generating && (
          <div className="text-center space-y-4">
            <div className="w-24 h-24 mx-auto rounded-2xl neumorphic-inset flex items-center justify-center">
              <Video size={40} className="text-pastel-muted" />
            </div>
            <div>
              <p className="text-sm text-pastel-text">No advertisement video yet</p>
              <p className="text-xs text-pastel-muted mt-1">
                Generate a 8-second cinematic product showcase video
                that matches the product image exactly.
              </p>
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

        {/* Product reference */}
        {!hasVideo && !generating && item.image_url && (
          <div className="neumorphic-inset p-3 rounded-xl flex items-center gap-3 max-w-sm">
            <img
              src={item.image_url}
              alt={item.name}
              className="w-16 h-16 rounded-lg object-contain bg-white"
            />
            <div className="text-xs">
              <p className="font-medium text-pastel-navy">{item.name}</p>
              <p className="text-pastel-muted">This image will be used as reference so the video matches the product exactly.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
