import { useState } from 'react';
import { Plus, X, Ban } from 'lucide-react';

interface NegativePromptsEditorProps {
  prompts: string[];
  onChange: (prompts: string[]) => void;
}

const COMMON_NEGATIVES = [
  'blurry',
  'low quality',
  'distorted',
  'watermark',
  'text overlay',
  'duplicate',
  'cropped',
  'out of frame',
  'bad anatomy',
  'deformed',
  'mutation',
  'disfigured',
  'bad proportions',
  'extra limbs',
];

export function NegativePromptsEditor({ prompts, onChange }: NegativePromptsEditorProps) {
  const [newPrompt, setNewPrompt] = useState('');

  const addPrompt = (prompt: string) => {
    const trimmed = prompt.trim().toLowerCase();
    if (!trimmed || prompts.includes(trimmed)) return;
    onChange([...prompts, trimmed]);
    setNewPrompt('');
  };

  const removePrompt = (prompt: string) => {
    onChange(prompts.filter(p => p !== prompt));
  };

  const suggestedPrompts = COMMON_NEGATIVES.filter(p => !prompts.includes(p));

  return (
    <div className="neumorphic-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 circular-icon">
          <Ban size={20} className="text-red-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-pastel-navy">Negative Prompts</h3>
          <p className="text-sm text-pastel-muted">Elements to exclude from generations</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {prompts.map(prompt => (
          <span
            key={prompt}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-100 text-red-600 rounded-xl text-sm border border-red-200"
          >
            {prompt}
            <button
              onClick={() => removePrompt(prompt)}
              className="ml-1 hover:text-red-700 transition-colors"
            >
              <X size={14} />
            </button>
          </span>
        ))}
        {prompts.length === 0 && (
          <p className="text-pastel-muted text-sm">No negative prompts added</p>
        )}
      </div>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="Add negative prompt..."
          className="flex-1 input-neumorphic px-4 py-2 text-pastel-navy"
          onKeyDown={(e) => e.key === 'Enter' && addPrompt(newPrompt)}
        />
        <button
          onClick={() => addPrompt(newPrompt)}
          disabled={!newPrompt.trim()}
          className="px-4 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2 shadow-neumorphic-sm"
        >
          <Plus size={18} />
          Add
        </button>
      </div>

      {suggestedPrompts.length > 0 && (
        <div>
          <p className="text-xs text-pastel-muted mb-2">Suggested:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.slice(0, 8).map(prompt => (
              <button
                key={prompt}
                onClick={() => addPrompt(prompt)}
                className="px-3 py-1 neumorphic-sm text-pastel-text-light rounded-lg text-sm hover:shadow-neumorphic transition-all"
              >
                + {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
