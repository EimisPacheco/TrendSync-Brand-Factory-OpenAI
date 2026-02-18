import { useState } from 'react';
import { Layers, Mail, Lock, User, ArrowRight, Loader, Copy, CheckCircle2, Shield } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  const { signIn, signUp } = useAuth();

  const copyToClipboard = async (text: string, type: 'email' | 'password') => {
    await navigator.clipboard.writeText(text);
    if (type === 'email') {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } else {
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await signIn(email, password);
        if (error) setError(error.message);
      } else {
        if (!fullName.trim()) {
          setError('Please enter your full name');
          setLoading(false);
          return;
        }
        const { error } = await signUp(email, password, fullName);
        if (error) {
          setError(error.message);
        } else {
          setSuccess('Account created! You can now sign in.');
          setMode('login');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pastel-gradient relative overflow-hidden flex items-center justify-center">
      <div className="absolute top-0 -left-40 w-96 h-96 bg-white/30 rounded-full mix-blend-normal filter blur-3xl opacity-50 animate-float-1" />
      <div className="absolute top-40 -right-40 w-96 h-96 bg-pastel-accent/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-2" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-pastel-teal/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-3" />

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="w-20 h-20 circular-icon flex items-center justify-center mx-auto mb-4">
            <Layers className="text-pastel-navy" size={36} />
          </div>
          <h1 className="text-3xl font-bold text-pastel-navy">TrendSync Brand Factory</h1>
          <p className="text-pastel-text-light mt-1">AI-Powered Fashion Design Studio</p>
        </div>

        <div className="neumorphic-card p-6 mb-6 bg-gradient-to-br from-pastel-accent/10 to-pastel-teal/10">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-pastel-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-lg">🎓</span>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-pastel-navy text-sm mb-1">Demo Account for Hackathon Judges</h3>
              <p className="text-xs text-pastel-muted mb-3">Use these credentials to explore all features with admin access</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="neumorphic-inset p-3 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-pastel-muted mb-1">Email</p>
                  <p className="text-sm font-mono font-semibold text-pastel-navy">demo@trendsync.ai</p>
                </div>
                <button
                  onClick={() => copyToClipboard('demo@trendsync.ai', 'email')}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                  title="Copy email"
                >
                  {copiedEmail ? (
                    <CheckCircle2 size={16} className="text-green-600" />
                  ) : (
                    <Copy size={16} className="text-pastel-muted" />
                  )}
                </button>
              </div>
            </div>

            <div className="neumorphic-inset p-3 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-pastel-muted mb-1">Password</p>
                  <p className="text-sm font-mono font-semibold text-pastel-navy">TrendSync2025!</p>
                </div>
                <button
                  onClick={() => copyToClipboard('TrendSync2025!', 'password')}
                  className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                  title="Copy password"
                >
                  {copiedPassword ? (
                    <CheckCircle2 size={16} className="text-green-600" />
                  ) : (
                    <Copy size={16} className="text-pastel-muted" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              setEmail('demo@trendsync.ai');
              setPassword('TrendSync2025!');
              setMode('login');
              setError('');
            }}
            className="w-full mt-3 py-2.5 btn-navy text-sm flex items-center justify-center gap-2"
          >
            <ArrowRight size={14} />
            Use Demo Credentials
          </button>

          <div className="mt-3 flex items-center gap-2 text-xs text-pastel-muted">
            <Shield className="w-3 h-3" />
            <span>Admin Role • Full Platform Access</span>
          </div>
        </div>

        <div className="neumorphic-card p-8">
          <div className="flex gap-2 mb-8">
            <button
              onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                mode === 'login'
                  ? 'neumorphic-inset text-pastel-navy'
                  : 'text-pastel-text-light hover:text-pastel-navy'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
              className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                mode === 'signup'
                  ? 'neumorphic-inset text-pastel-navy'
                  : 'text-pastel-text-light hover:text-pastel-navy'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-pastel-navy mb-1.5">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-pastel-muted" size={18} />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    className="w-full input-neumorphic pl-10 pr-4 py-3 text-pastel-navy"
                    required
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-pastel-navy mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-pastel-muted" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full input-neumorphic pl-10 pr-4 py-3 text-pastel-navy"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-pastel-navy mb-1.5">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-pastel-muted" size={18} />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
                  className="w-full input-neumorphic pl-10 pr-4 py-3 text-pastel-navy"
                  minLength={6}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 btn-navy text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-6"
            >
              {loading ? (
                <Loader className="animate-spin" size={20} />
              ) : (
                <>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-pastel-muted mt-6">
          Powered by Supabase Auth & Gemini AI
        </p>
      </div>
    </div>
  );
}
