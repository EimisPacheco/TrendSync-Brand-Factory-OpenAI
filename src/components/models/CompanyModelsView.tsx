import { useEffect, useState } from 'react';
import { Trash2, Users, Loader2, ImageOff } from 'lucide-react';
import { toast } from 'sonner';
import type { CompanyModel } from '../../types/database';
import { listCompanyModels, deleteCompanyModel } from '../../services/db-storage';

export function CompanyModelsView() {
  const [models, setModels] = useState<CompanyModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    try {
      const data = await listCompanyModels();
      setModels(data);
    } catch (error) {
      console.error('Failed to load company models:', error);
      toast.error('Failed to load company models');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (model: CompanyModel) => {
    if (!window.confirm(`Delete model "${model.name}"? This cannot be undone.`)) return;
    setDeletingId(model.id);
    try {
      await deleteCompanyModel(model.id);
      setModels(prev => prev.filter(m => m.id !== model.id));
      toast.success(`Deleted "${model.name}"`);
    } catch (error) {
      console.error('Failed to delete model:', error);
      toast.error('Failed to delete model');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="neumorphic-card p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 circular-icon flex items-center justify-center">
            <Users size={22} className="text-pastel-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-pastel-navy">Company Models</h1>
            <p className="text-sm text-pastel-muted">
              Shared roster of fashion models for your ad videos.
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="neumorphic-card p-3 animate-pulse"
            >
              <div className="aspect-[3/4] rounded-2xl bg-pastel-bg-dark/10 mb-3" />
              <div className="h-4 bg-pastel-bg-dark/10 rounded w-3/4 mb-2" />
              <div className="h-3 bg-pastel-bg-dark/10 rounded w-full" />
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="neumorphic-card p-12 text-center">
          <div className="w-16 h-16 circular-icon flex items-center justify-center mx-auto mb-4">
            <Users size={28} className="text-pastel-muted" />
          </div>
          <h2 className="text-lg font-semibold text-pastel-navy mb-2">No models yet</h2>
          <p className="text-sm text-pastel-text-light mb-4">
            Run the seed script to populate the catalog:
          </p>
          <pre className="inline-block neumorphic-inset rounded-lg px-4 py-3 text-xs text-pastel-navy bg-pastel-bg-light/50">
            python -m scripts.seed_company_models
          </pre>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {models.map(model => (
            <div
              key={model.id}
              className="group relative neumorphic-card p-3 hover:shadow-neumorphic transition-all"
            >
              {/* Delete button (visible on hover) */}
              <button
                onClick={() => handleDelete(model)}
                disabled={deletingId === model.id}
                className="absolute top-5 right-5 z-10 p-2 rounded-full bg-white/90 shadow-neumorphic-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                title={`Delete ${model.name}`}
              >
                {deletingId === model.id ? (
                  <Loader2 size={14} className="text-red-500 animate-spin" />
                ) : (
                  <Trash2 size={14} className="text-red-500" />
                )}
              </button>

              {/* Image */}
              <div className="aspect-[3/4] rounded-2xl overflow-hidden mb-3 neumorphic-inset bg-pastel-bg-light">
                {model.image_url ? (
                  <img
                    src={model.image_url}
                    alt={model.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageOff size={32} className="text-pastel-muted" />
                  </div>
                )}
              </div>

              {/* Text */}
              <div className="px-1 pb-1">
                <h3 className="font-bold text-pastel-navy text-sm truncate">
                  {model.name}
                </h3>
                {model.description && (
                  <p
                    className="text-xs text-pastel-muted mt-1 leading-snug"
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
