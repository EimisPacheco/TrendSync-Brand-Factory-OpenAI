import { useEffect, useState } from 'react';
import { Package, Users, Check, ImageOff, Loader2 } from 'lucide-react';
import type { CompanyModel } from '../../types/database';
import { listCompanyModels } from '../../services/db-storage';
import { Modal } from '../ui/Modal';

interface ModelSelectionModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (modelId: string | null) => void;
  videoType: 'ad' | 'product';
}

type Selection = { kind: 'item-only' } | { kind: 'model'; id: string };

export function ModelSelectionModal({
  open,
  onClose,
  onConfirm,
  videoType,
}: ModelSelectionModalProps) {
  const [models, setModels] = useState<CompanyModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: 'item-only' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelection({ kind: 'item-only' });
    setError(null);
    setLoading(true);
    listCompanyModels()
      .then(data => setModels(data))
      .catch(err => {
        console.error('Failed to load company models:', err);
        setError('Failed to load models');
      })
      .finally(() => setLoading(false));
  }, [open]);

  const handleGenerate = () => {
    if (selection.kind === 'item-only') {
      onConfirm(null);
    } else {
      onConfirm(selection.id);
    }
  };

  const title =
    videoType === 'ad'
      ? 'Select a model for your ad video (or skip)'
      : 'Select a model for your product video (or skip)';

  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: "Item only" tile */}
        <div className="md:col-span-1">
          <button
            type="button"
            onClick={() => setSelection({ kind: 'item-only' })}
            className={`w-full text-left neumorphic-card p-6 transition-all ${
              selection.kind === 'item-only'
                ? 'ring-2 ring-pastel-accent shadow-neumorphic'
                : 'hover:shadow-neumorphic'
            }`}
          >
            <div className="aspect-[3/4] rounded-2xl neumorphic-inset bg-pastel-bg-light flex items-center justify-center mb-4 relative">
              <Package size={48} className="text-pastel-muted" />
              {selection.kind === 'item-only' && (
                <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-pastel-accent flex items-center justify-center shadow-neumorphic-sm">
                  <Check size={16} className="text-white" />
                </div>
              )}
            </div>
            <h3 className="font-bold text-pastel-navy mb-1">Item only</h3>
            <p className="text-xs text-pastel-muted leading-snug">
              Skip — render with the product image only.
            </p>
          </button>
        </div>

        {/* Right column: scrollable model grid */}
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Users size={16} className="text-pastel-accent" />
            <h3 className="font-semibold text-pastel-navy text-sm">Choose a model</h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={28} className="animate-spin text-pastel-accent" />
            </div>
          ) : error ? (
            <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-red-600">
              {error}
            </div>
          ) : models.length === 0 ? (
            <div className="neumorphic-inset rounded-xl p-6 text-center text-sm text-pastel-muted">
              No company models available. Run the seed script first.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
              {models.map(model => {
                const isSelected =
                  selection.kind === 'model' && selection.id === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelection({ kind: 'model', id: model.id })}
                    className={`text-left neumorphic-card p-2 transition-all ${
                      isSelected
                        ? 'ring-2 ring-pastel-accent shadow-neumorphic'
                        : 'hover:shadow-neumorphic'
                    }`}
                  >
                    <div className="aspect-[3/4] rounded-xl overflow-hidden mb-2 neumorphic-inset bg-pastel-bg-light relative">
                      {model.image_url ? (
                        <img
                          src={model.image_url}
                          alt={model.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageOff size={24} className="text-pastel-muted" />
                        </div>
                      )}
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-pastel-accent flex items-center justify-center shadow-neumorphic-sm">
                          <Check size={14} className="text-white" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-bold text-pastel-navy truncate px-1">
                      {model.name}
                    </p>
                    {model.description && (
                      <p
                        className="text-[10px] text-pastel-muted px-1 leading-snug"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {model.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-pastel-bg-dark/10">
        <button
          type="button"
          onClick={onClose}
          className="btn-soft px-5 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          className="btn-navy px-5 py-2 text-sm"
        >
          Generate
        </button>
      </div>
    </Modal>
  );
}
