import { useState } from 'react';
import { Eye, Shield, FileText, ChevronRight, Shirt, Footprints, Watch, CheckCircle, AlertTriangle, XCircle, Trash2 } from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { getComplianceBadge } from '../../lib/brand-guardian';

interface ProductGalleryProps {
  items: CollectionItem[];
  onSelectItem: (item: CollectionItem) => void;
  onViewValidation: (item: CollectionItem) => void;
  onViewTechPack: (item: CollectionItem) => void;
  onDeleteItem?: (itemId: string) => void;
}

export function ProductGallery({ items, onSelectItem, onViewValidation, onViewTechPack, onDeleteItem }: ProductGalleryProps) {
  const [filter, setFilter] = useState<'all' | 'apparel' | 'footwear' | 'accessories'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'compliance' | 'status'>('name');

  const filteredItems = items.filter(item => filter === 'all' || item.category === filter);

  const sortedItems = [...filteredItems].sort((a, b) => {
    switch (sortBy) {
      case 'compliance':
        return b.brand_compliance_score - a.brand_compliance_score;
      case 'status':
        return a.status.localeCompare(b.status);
      default:
        return a.name.localeCompare(b.name);
    }
  });

  const getCategoryIcon = (category: CollectionItem['category']) => {
    switch (category) {
      case 'apparel': return <Shirt size={16} />;
      case 'footwear': return <Footprints size={16} />;
      case 'accessories': return <Watch size={16} />;
    }
  };

  const getStatusBadge = (status: CollectionItem['status']) => {
    switch (status) {
      case 'complete':
        return { icon: CheckCircle, color: 'text-emerald-600', bg: 'neumorphic-inset', label: 'Complete' };
      case 'validating':
        return { icon: Shield, color: 'text-pastel-accent', bg: 'neumorphic-inset', label: 'Validating' };
      case 'generating':
        return { icon: AlertTriangle, color: 'text-amber-600', bg: 'neumorphic-inset', label: 'Generating' };
      case 'failed':
        return { icon: XCircle, color: 'text-red-500', bg: 'neumorphic-inset', label: 'Failed' };
      default:
        return { icon: AlertTriangle, color: 'text-pastel-muted', bg: 'neumorphic-inset', label: 'Pending' };
    }
  };

  const stats = {
    total: items.length,
    apparel: items.filter(i => i.category === 'apparel').length,
    footwear: items.filter(i => i.category === 'footwear').length,
    accessories: items.filter(i => i.category === 'accessories').length,
    avgCompliance: items.length > 0
      ? Math.round(items.reduce((sum, i) => sum + i.brand_compliance_score, 0) / items.length)
      : 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-pastel-navy">Product Gallery</h2>
          <p className="text-pastel-text-light">
            {stats.total} products | Avg. compliance: {stats.avgCompliance}%
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="input-neumorphic px-3 py-2 text-pastel-navy text-sm"
          >
            <option value="all">All Categories</option>
            <option value="apparel">Apparel ({stats.apparel})</option>
            <option value="footwear">Footwear ({stats.footwear})</option>
            <option value="accessories">Accessories ({stats.accessories})</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="input-neumorphic px-3 py-2 text-pastel-navy text-sm"
          >
            <option value="name">Sort by Name</option>
            <option value="compliance">Sort by Compliance</option>
            <option value="status">Sort by Status</option>
          </select>
        </div>
      </div>

      {sortedItems.length === 0 ? (
        <div className="neumorphic-card p-12 text-center">
          <div className="circular-icon w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Shirt size={32} className="text-pastel-muted" />
          </div>
          <p className="text-pastel-text">No products yet</p>
          <p className="text-sm text-pastel-muted">Generate a collection to see products here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedItems.map(item => {
            const badge = getComplianceBadge(item.brand_compliance_score);
            const status = getStatusBadge(item.status);
            const StatusIcon = status.icon;

            return (
              <div
                key={item.id}
                className="neumorphic-card overflow-hidden group hover:shadow-neumorphic-lg transition-all duration-300"
              >
                <div className="aspect-square bg-gradient-to-br from-pastel-bg-light to-pastel-bg relative">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="circular-icon p-4">
                        <div className="text-pastel-muted">
                          {getCategoryIcon(item.category)}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="absolute top-3 left-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${status.bg} ${status.color}`}>
                      <StatusIcon size={12} />
                      {status.label}
                    </span>
                  </div>

                  <div className="absolute top-3 right-3">
                    <div className={`px-3 py-1.5 rounded-lg neumorphic-sm ${badge.color}`} title="Brand Compliance Score">
                      <div className="text-[9px] uppercase tracking-wider opacity-80">Compliance</div>
                      <div className="text-sm font-bold">{Math.round(item.brand_compliance_score)}%</div>
                    </div>
                  </div>

                  <div className="absolute inset-0 bg-pastel-navy/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={() => onSelectItem(item)}
                      className="p-2 neumorphic-sm rounded-lg hover:shadow-neumorphic transition-all"
                      title="View Details"
                    >
                      <Eye size={20} className="text-pastel-navy" />
                    </button>
                    <button
                      onClick={() => onViewValidation(item)}
                      className="p-2 neumorphic-sm rounded-lg hover:shadow-neumorphic transition-all"
                      title="View Validation"
                    >
                      <Shield size={20} className="text-pastel-navy" />
                    </button>
                    <button
                      onClick={() => onViewTechPack(item)}
                      className="p-2 neumorphic-sm rounded-lg hover:shadow-neumorphic transition-all"
                      title="View Tech Pack"
                    >
                      <FileText size={20} className="text-pastel-navy" />
                    </button>
                    {onDeleteItem && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete "${item.name}"? This cannot be undone.`)) {
                            onDeleteItem(item.id);
                          }
                        }}
                        className="p-2 neumorphic-sm rounded-lg hover:shadow-neumorphic transition-all"
                        title="Delete Item"
                      >
                        <Trash2 size={20} className="text-red-500" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex items-center gap-2 text-xs text-pastel-muted mb-1">
                    {getCategoryIcon(item.category)}
                    <span className="capitalize">{item.subcategory}</span>
                  </div>
                  <h3 className="font-semibold text-pastel-navy truncate mb-1">{item.name}</h3>
                  <p className="text-sm text-pastel-text-light truncate">{item.design_story}</p>

                  {item.design_spec_json?.colors && item.design_spec_json.colors.length > 0 && (
                    <div className="flex items-center gap-2 mt-3">
                      {/* Show only the primary/first color as the predominant one */}
                      <div
                        className="w-7 h-7 rounded-full shadow-neumorphic-sm ring-2 ring-pastel-bg-light"
                        style={{ backgroundColor: item.design_spec_json.colors[0].hex || '#888888' }}
                        title={`Primary: ${item.design_spec_json.colors[0].name}`}
                      />
                      {item.design_spec_json.colors.length > 1 && (
                        <span className="text-xs text-pastel-muted">
                          +{item.design_spec_json.colors.length - 1} more
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => onSelectItem(item)}
                    className="mt-3 w-full py-2 px-3 btn-soft text-sm flex items-center justify-center gap-1"
                  >
                    View Details
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
