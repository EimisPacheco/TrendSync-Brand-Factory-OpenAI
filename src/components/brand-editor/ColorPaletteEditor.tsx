import { useState } from 'react';
import { Plus, X, Palette } from 'lucide-react';
import type { ColorSwatch } from '../../types/database';

interface ColorPaletteEditorProps {
  colors: ColorSwatch[];
  onChange: (colors: ColorSwatch[]) => void;
}

const DESIGNATIONS: ColorSwatch['designation'][] = ['primary', 'secondary', 'accent', 'neutral'];

export function ColorPaletteEditor({ colors, onChange }: ColorPaletteEditorProps) {
  const [newColor, setNewColor] = useState('#3B82F6');
  const [newName, setNewName] = useState('');

  const addColor = () => {
    if (!newName.trim()) return;
    const color: ColorSwatch = {
      id: crypto.randomUUID(),
      name: newName,
      hex: newColor,
      designation: 'neutral',
    };
    onChange([...colors, color]);
    setNewName('');
  };

  const removeColor = (id: string) => {
    onChange(colors.filter(c => c.id !== id));
  };

  const updateColor = (id: string, updates: Partial<ColorSwatch>) => {
    onChange(colors.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const getDesignationColor = (designation: ColorSwatch['designation']) => {
    switch (designation) {
      case 'primary': return 'bg-pastel-accent/20 text-pastel-accent border-pastel-accent/30';
      case 'secondary': return 'bg-emerald-100 text-emerald-600 border-emerald-200';
      case 'accent': return 'bg-amber-100 text-amber-600 border-amber-200';
      case 'neutral': return 'bg-pastel-bg-dark/50 text-pastel-text border-pastel-muted/30';
    }
  };

  return (
    <div className="neumorphic-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 circular-icon">
          <Palette size={20} className="text-rose-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-pastel-navy">Color Palette</h3>
          <p className="text-sm text-pastel-muted">Define approved brand colors</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {colors.map(color => (
          <div
            key={color.id}
            className="neumorphic-sm p-3 group relative"
          >
            <button
              onClick={() => removeColor(color.id)}
              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
            >
              <X size={14} className="text-white" />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <input
                type="color"
                value={color.hex}
                onChange={(e) => updateColor(color.id, { hex: e.target.value })}
                className="w-10 h-10 rounded-lg cursor-pointer border-2 border-pastel-muted/30 shadow-neumorphic-sm"
              />
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={color.name}
                  onChange={(e) => updateColor(color.id, { name: e.target.value })}
                  className="w-full bg-transparent text-pastel-navy text-sm font-medium focus:outline-none"
                />
                <p className="text-xs text-pastel-muted uppercase">{color.hex}</p>
              </div>
            </div>

            <select
              value={color.designation}
              onChange={(e) => updateColor(color.id, { designation: e.target.value as ColorSwatch['designation'] })}
              className={`w-full px-2 py-1 rounded-lg text-xs font-medium border cursor-pointer ${getDesignationColor(color.designation)}`}
            >
              {DESIGNATIONS.map(d => (
                <option key={d} value={d} className="bg-white text-pastel-navy">
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="w-12 h-12 rounded-xl cursor-pointer border-2 border-pastel-muted/30 shadow-neumorphic-sm"
        />
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Color name (e.g., Ocean Blue)"
          className="flex-1 input-neumorphic px-4 text-pastel-navy"
          onKeyDown={(e) => e.key === 'Enter' && addColor()}
        />
        <button
          onClick={addColor}
          disabled={!newName.trim()}
          className="px-6 py-2 btn-navy flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={18} />
          Add
        </button>
      </div>
    </div>
  );
}
