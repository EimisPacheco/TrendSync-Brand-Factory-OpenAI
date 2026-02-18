import { Sparkles, Palette, Brain, Shield, TrendingUp, Zap, ArrowRight, Layers } from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
}

export function LandingPage({ onGetStarted }: LandingPageProps) {
  return (
    <div className="min-h-screen pastel-gradient relative overflow-hidden">
      <div className="absolute top-0 -left-40 w-96 h-96 bg-white/30 rounded-full mix-blend-normal filter blur-3xl opacity-50 animate-float-1" />
      <div className="absolute top-40 -right-40 w-96 h-96 bg-pastel-accent/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-2" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-pastel-teal/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-3" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-16">
          <div className="w-24 h-24 circular-icon flex items-center justify-center mx-auto mb-6">
            <Layers className="text-pastel-navy" size={48} />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-pastel-navy mb-4">
            TrendSync Brand Factory
          </h1>
          <p className="text-xl md:text-2xl text-pastel-text-light mb-3">
            AI-Powered Fashion Design Studio
          </p>
          <p className="text-base text-pastel-muted max-w-2xl mx-auto mb-8">
            Transform your creative vision into stunning fashion collections with the power of AI.
            Generate trend-driven designs, validate brand consistency, and create production-ready tech packs in minutes.
          </p>

          <button
            onClick={onGetStarted}
            className="btn-navy text-lg px-8 py-4 inline-flex items-center gap-3 hover:scale-105 transition-transform"
          >
            Get Started
            <ArrowRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          <div className="neumorphic-card p-6 hover:scale-105 transition-transform">
            <div className="w-12 h-12 circular-icon flex items-center justify-center mb-4">
              <Brain className="text-pastel-accent" size={24} />
            </div>
            <h3 className="text-xl font-semibold text-pastel-navy mb-2">AI-Powered Design</h3>
            <p className="text-pastel-muted text-sm">
              Generate complete fashion collections powered by Google Gemini AI and real-time trend analysis from Google Search.
            </p>
          </div>

          <div className="neumorphic-card p-6 hover:scale-105 transition-transform">
            <div className="w-12 h-12 circular-icon flex items-center justify-center mb-4">
              <Palette className="text-pastel-teal" size={24} />
            </div>
            <h3 className="text-xl font-semibold text-pastel-navy mb-2">Brand Style Editor</h3>
            <p className="text-pastel-muted text-sm">
              Define your unique brand identity with custom color palettes, lighting, materials, and camera settings.
            </p>
          </div>

          <div className="neumorphic-card p-6 hover:scale-105 transition-transform">
            <div className="w-12 h-12 circular-icon flex items-center justify-center mb-4">
              <Shield className="text-pastel-accent" size={24} />
            </div>
            <h3 className="text-xl font-semibold text-pastel-navy mb-2">Brand Guardian</h3>
            <p className="text-pastel-muted text-sm">
              Automatically validate every design against your brand guidelines to ensure perfect consistency across collections.
            </p>
          </div>

          <div className="neumorphic-card p-6 hover:scale-105 transition-transform">
            <div className="w-12 h-12 circular-icon flex items-center justify-center mb-4">
              <TrendingUp className="text-pastel-teal" size={24} />
            </div>
            <h3 className="text-xl font-semibold text-pastel-navy mb-2">Trend Intelligence</h3>
            <p className="text-pastel-muted text-sm">
              Stay ahead with AI-powered insights on regional trends, celebrity fashion, and emerging color palettes.
            </p>
          </div>

          <div className="neumorphic-card p-6 hover:scale-105 transition-transform">
            <div className="w-12 h-12 circular-icon flex items-center justify-center mb-4">
              <Sparkles className="text-pastel-accent" size={24} />
            </div>
            <h3 className="text-xl font-semibold text-pastel-navy mb-2">FIBO Image Gen</h3>
            <p className="text-pastel-muted text-sm">
              Generate high-quality, production-ready fashion images using Bria's advanced FIBO API technology.
            </p>
          </div>

          <div className="neumorphic-card p-6 hover:scale-105 transition-transform">
            <div className="w-12 h-12 circular-icon flex items-center justify-center mb-4">
              <Zap className="text-pastel-teal" size={24} />
            </div>
            <h3 className="text-xl font-semibold text-pastel-navy mb-2">Tech Pack Export</h3>
            <p className="text-pastel-muted text-sm">
              Generate detailed technical specifications and manufacturing-ready PDF documents for each design.
            </p>
          </div>
        </div>

        <div className="neumorphic-card p-8 md:p-12 text-center max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-pastel-navy mb-4">
            Built for Fashion Professionals
          </h2>
          <p className="text-pastel-text-light mb-8">
            Whether you're a solo designer, creative director, or part of a fashion brand team,
            TrendSync Brand Factory empowers you to create faster, smarter, and with perfect brand consistency.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="neumorphic-inset p-4 rounded-xl">
              <p className="text-2xl font-bold text-pastel-accent mb-1">⚡ Fast</p>
              <p className="text-sm text-pastel-muted">Collections in minutes</p>
            </div>
            <div className="neumorphic-inset p-4 rounded-xl">
              <p className="text-2xl font-bold text-pastel-teal mb-1">🎨 Creative</p>
              <p className="text-sm text-pastel-muted">Unlimited design iterations</p>
            </div>
            <div className="neumorphic-inset p-4 rounded-xl">
              <p className="text-2xl font-bold text-pastel-navy mb-1">✨ Consistent</p>
              <p className="text-sm text-pastel-muted">AI-validated brand identity</p>
            </div>
          </div>

          <button
            onClick={onGetStarted}
            className="btn-navy text-lg px-8 py-4 inline-flex items-center gap-3 hover:scale-105 transition-transform"
          >
            Start Creating Now
            <ArrowRight size={20} />
          </button>
        </div>

        <footer className="text-center mt-16 text-pastel-muted text-sm">
          <p>Powered by Google Gemini AI • Bria FIBO • Supabase</p>
        </footer>
      </div>
    </div>
  );
}
