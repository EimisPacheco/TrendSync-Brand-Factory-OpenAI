import { useState } from 'react';
import { Plus, X, Layers, Leaf, Sparkles, Wrench, Box } from 'lucide-react';
import type { MaterialSpec } from '../../types/database';

interface MaterialLibraryEditorProps {
  materials: MaterialSpec[];
  onChange: (materials: MaterialSpec[]) => void;
}

const CATEGORIES: { id: MaterialSpec['category']; label: string; icon: React.ReactNode; color: string }[] = [
  { id: 'sustainable', label: 'Sustainable', icon: <Leaf size={14} />, color: 'text-emerald-500' },
  { id: 'premium', label: 'Premium', icon: <Sparkles size={14} />, color: 'text-amber-500' },
  { id: 'technical', label: 'Technical', icon: <Wrench size={14} />, color: 'text-pastel-accent' },
  { id: 'standard', label: 'Standard', icon: <Box size={14} />, color: 'text-pastel-muted' },
];

const SEASONS: { id: MaterialSpec['seasons'][number]; label: string }[] = [
  { id: 'spring', label: 'Spring' },
  { id: 'summer', label: 'Summer' },
  { id: 'fall', label: 'Fall' },
  { id: 'winter', label: 'Winter' },
];

export function MaterialLibraryEditor({ materials, onChange }: MaterialLibraryEditorProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newMaterial, setNewMaterial] = useState<Partial<MaterialSpec>>({
    name: '',
    category: 'standard',
    description: '',
    seasons: ['spring', 'summer', 'fall', 'winter'],
  });

  const addMaterial = () => {
    if (!newMaterial.name?.trim()) return;
    const material: MaterialSpec = {
      id: crypto.randomUUID(),
      name: newMaterial.name,
      category: newMaterial.category || 'standard',
      description: newMaterial.description || '',
      seasons: newMaterial.seasons || [],
    };
    onChange([...materials, material]);
    setNewMaterial({ name: '', category: 'standard', description: '', seasons: ['spring', 'summer', 'fall', 'winter'] });
    setShowAdd(false);
  };

  const removeMaterial = (id: string) => {
    onChange(materials.filter(m => m.id !== id));
  };

  const getCategoryStyle = (category: MaterialSpec['category']) => {
    switch (category) {
      case 'sustainable': return 'bg-emerald-100 border-emerald-200 text-emerald-600';
      case 'premium': return 'bg-amber-100 border-amber-200 text-amber-600';
      case 'technical': return 'bg-sky-100 border-sky-200 text-pastel-accent';
      default: return 'bg-pastel-bg-dark/30 border-pastel-muted/30 text-pastel-muted';
    }
  };

  const toggleSeason = (season: MaterialSpec['seasons'][number]) => {
    const current = newMaterial.seasons || [];
    const updated = current.includes(season)
      ? current.filter(s => s !== season)
      : [...current, season];
    setNewMaterial({ ...newMaterial, seasons: updated });
  };

  return (
    <div className="neumorphic-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 circular-icon">
            <Layers size={20} className="text-pastel-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-pastel-navy">Material Library</h3>
            <p className="text-sm text-pastel-muted">Approved fabrics and materials</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 btn-navy flex items-center gap-2"
        >
          <Plus size={18} />
          Add Material
        </button>
      </div>

      {showAdd && (
        <div className="neumorphic-inset rounded-xl p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <input
              type="text"
              value={newMaterial.name}
              onChange={(e) => setNewMaterial({ ...newMaterial, name: e.target.value })}
              placeholder="Material name (e.g., Organic Cotton)"
              className="input-neumorphic px-4 py-2 text-pastel-navy"
            />
            <select
              value={newMaterial.category}
              onChange={(e) => setNewMaterial({ ...newMaterial, category: e.target.value as MaterialSpec['category'] })}
              className="input-neumorphic px-4 py-2 text-pastel-navy"
            >
              {CATEGORIES.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.label}</option>
              ))}
            </select>
          </div>
          <textarea
            value={newMaterial.description}
            onChange={(e) => setNewMaterial({ ...newMaterial, description: e.target.value })}
            placeholder="Description (e.g., Lightweight breathable fabric, GOTS certified)"
            rows={2}
            className="w-full input-neumorphic px-4 py-2 text-pastel-navy mb-4"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-pastel-muted">Seasons:</span>
              {SEASONS.map(season => (
                <button
                  key={season.id}
                  onClick={() => toggleSeason(season.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    newMaterial.seasons?.includes(season.id)
                      ? 'btn-navy'
                      : 'neumorphic-sm text-pastel-text-light hover:shadow-neumorphic'
                  }`}
                >
                  {season.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 btn-soft"
              >
                Cancel
              </button>
              <button
                onClick={addMaterial}
                disabled={!newMaterial.name?.trim()}
                className="px-4 py-2 btn-navy disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {materials.length === 0 ? (
        <div className="text-center py-8">
          <div className="circular-icon w-16 h-16 mx-auto mb-3 flex items-center justify-center">
            <Layers size={32} className="text-pastel-muted" />
          </div>
          <p className="text-pastel-text">No materials added yet</p>
          <p className="text-sm text-pastel-muted">Add approved materials for your brand</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {materials.map(material => {
            const cat = CATEGORIES.find(c => c.id === material.category);
            return (
              <div
                key={material.id}
                className="neumorphic-sm p-4 group relative"
              >
                <button
                  onClick={() => removeMaterial(material.id)}
                  className="absolute top-2 right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                >
                  <X size={14} className="text-white" />
                </button>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${getCategoryStyle(material.category)}`}>
                    {cat?.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-pastel-navy truncate">{material.name}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border ${getCategoryStyle(material.category)}`}>
                        {cat?.label}
                      </span>
                    </div>
                    <p className="text-sm text-pastel-text-light mb-2 line-clamp-2">{material.description}</p>
                    <div className="flex gap-1">
                      {material.seasons.map(season => (
                        <span key={season} className="text-xs px-2 py-0.5 neumorphic-inset rounded-lg text-pastel-muted">
                          {season.charAt(0).toUpperCase() + season.slice(1)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
