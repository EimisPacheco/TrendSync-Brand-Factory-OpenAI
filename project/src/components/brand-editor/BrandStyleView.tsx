import { useState, useEffect } from 'react';
import { BrandStyleEditor } from './BrandStyleEditor';
import { brandStyleStorage } from '../../services/db-storage';
import { DEFAULT_BRAND_STYLE } from '../../lib/defaults';
import type { BrandStyleJSON } from '../../types/database';

interface BrandStyleViewProps {
  brandId: string;
  onSave: (style: BrandStyleJSON) => void;
}

export function BrandStyleView({ brandId, onSave }: BrandStyleViewProps) {
  const [currentStyle, setCurrentStyle] = useState<BrandStyleJSON | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (brandId) {
      brandStyleStorage.getByBrandId(brandId)
        .then(style => setCurrentStyle(style))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [brandId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="neumorphic-card p-6 text-center">
          <p className="text-pastel-text-light">Loading brand style...</p>
        </div>
      </div>
    );
  }

  return (
    <BrandStyleEditor
      brandId={brandId}
      initialStyle={currentStyle || DEFAULT_BRAND_STYLE}
      onSave={onSave}
    />
  );
}
