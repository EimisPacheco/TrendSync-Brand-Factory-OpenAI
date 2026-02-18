import { useState, useEffect } from 'react';
import { Save, Key, CheckCircle2, AlertCircle, Loader, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';

export function Settings() {
  const { user } = useAuth();
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [user]);

  const loadSettings = async () => {
    if (!user) return;

    setLoadingData(true);
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('gemini_api_key')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data?.gemini_api_key) {
        setGeminiApiKey(data.gemini_api_key);
      }
    } catch (error: any) {
      console.error('Error loading settings:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    if (!geminiApiKey.trim()) {
      toast.error('Please enter a valid API key');
      return;
    }

    setLoading(true);
    setSaved(false);

    try {
      const { data: existing } = await supabase
        .from('user_settings')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from('user_settings')
          .update({
            gemini_api_key: geminiApiKey,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_settings')
          .insert({
            user_id: user.id,
            gemini_api_key: geminiApiKey
          });

        if (error) throw error;
      }

      setSaved(true);
      toast.success('Settings saved successfully');
      setTimeout(() => setSaved(false), 3000);
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingData) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader className="animate-spin text-pastel-accent" size={32} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-pastel-navy mb-2">Settings</h1>
        <p className="text-pastel-text-light">Manage your API keys and preferences</p>
      </div>

      <div className="neumorphic-card p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 circular-icon flex items-center justify-center flex-shrink-0">
            <Key className="text-pastel-accent" size={24} />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-pastel-navy mb-1">Google Gemini API Key</h2>
            <p className="text-sm text-pastel-muted mb-4">
              Your API key is required for AI-powered design generation and trend analysis.
              Get your free API key from the{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-pastel-accent hover:underline font-medium"
              >
                Google AI Studio
              </a>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-pastel-navy mb-2">
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full input-neumorphic pl-4 pr-12 py-3 text-pastel-navy font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-pastel-muted hover:text-pastel-navy transition-colors"
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="neumorphic-inset p-4 rounded-xl bg-pastel-accent/5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="text-pastel-accent flex-shrink-0 mt-0.5" size={16} />
                  <div className="text-xs text-pastel-muted">
                    <p className="font-semibold text-pastel-navy mb-1">Security Note:</p>
                    <p>
                      Your API key is stored securely in the database and is never exposed to other users.
                      Only use API keys from trusted sources and never share them publicly.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={loading || !geminiApiKey.trim()}
                className="btn-navy flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader className="animate-spin" size={18} />
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <CheckCircle2 size={18} />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    Save Settings
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="neumorphic-card p-6 mt-6 bg-gradient-to-br from-pastel-teal/10 to-pastel-accent/10">
        <h3 className="font-semibold text-pastel-navy mb-3">How to get your Gemini API Key</h3>
        <ol className="space-y-2 text-sm text-pastel-muted">
          <li className="flex gap-2">
            <span className="font-semibold text-pastel-navy">1.</span>
            <span>Visit <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-pastel-accent hover:underline">Google AI Studio</a></span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-pastel-navy">2.</span>
            <span>Sign in with your Google account</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-pastel-navy">3.</span>
            <span>Click "Create API Key" or "Get API Key"</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-pastel-navy">4.</span>
            <span>Copy the generated API key and paste it above</span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-pastel-navy">5.</span>
            <span>Click "Save Settings" to store your key securely</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
