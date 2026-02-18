import { TrendingUp, Layers, Shield, Sparkles, ArrowRight, CheckCircle, Star, Globe, MessageSquare, FileText, Mail, Palette } from 'lucide-react';
import type { View } from '../layout/Sidebar';

interface DashboardProps {
  onNavigate: (view: View) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  return (
    <div className="space-y-8">
      <div className="neumorphic-card p-10">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold text-pastel-navy mb-5">
            Welcome to TrendSync Brand Factory
          </h1>
          <p className="text-lg text-pastel-text leading-relaxed mb-8">
            Create trend-aware, on-brand fashion collections powered by Gemini AI trend intelligence
            (including celebrity fashion analysis) and Bria FIBO deterministic image generation.
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => onNavigate('collection')}
              className="btn-navy px-8 py-4 font-semibold flex items-center gap-2"
            >
              <Sparkles size={22} />
              Create New Collection
            </button>
            <button
              onClick={() => onNavigate('brand-guardian')}
              className="btn-soft px-8 py-4 font-semibold flex items-center gap-2"
            >
              <Shield size={22} />
              Try Brand Guardian Demo
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <QuickActionCard
          icon={<TrendingUp className="text-pastel-teal" size={28} />}
          title="Trend Intelligence"
          description="Discover regional, seasonal & celebrity fashion trends using Gemini AI"
          action="Explore Trends"
          onClick={() => onNavigate('trends')}
        />
        <QuickActionCard
          icon={<Shield className="text-emerald-500" size={28} />}
          title="Brand Guardian"
          description="Validate FIBO prompts against your brand style rules in real-time"
          action="Run Validation"
          onClick={() => onNavigate('brand-guardian')}
          featured
        />
        <QuickActionCard
          icon={<Layers className="text-pastel-accent" size={28} />}
          title="Brand Style Editor"
          description="Configure colors, camera settings, lighting, and material rules"
          action="Edit Style"
          onClick={() => onNavigate('brand-style')}
        />
      </div>

      <div className="neumorphic-card p-8">
        <h2 className="text-2xl font-bold text-pastel-navy mb-8">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <WorkflowStep
            number={1}
            title="Set Brand Rules"
            description="Define your color palette, camera settings, and material library"
          />
          <WorkflowStep
            number={2}
            title="Discover Trends"
            description="Gemini AI analyzes regional & celebrity fashion trends"
          />
          <WorkflowStep
            number={3}
            title="Generate & Validate"
            description="Brand Guardian ensures compliance before FIBO generation"
          />
          <WorkflowStep
            number={4}
            title="Export Tech Packs"
            description="Manufacturing-ready specs with supplier recommendations"
            isLast
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="neumorphic-card p-7">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 circular-icon">
              <Globe className="text-pastel-teal" size={24} />
            </div>
            <h3 className="text-xl font-bold text-pastel-navy">Trend Sources</h3>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Globe className="text-pastel-accent mt-1" size={20} />
              <div>
                <p className="font-semibold text-pastel-navy">Regional & Seasonal</p>
                <p className="text-sm text-pastel-text-light">Location-based fashion trends by season</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Star className="text-amber-500 mt-1" size={20} />
              <div>
                <p className="font-semibold text-pastel-navy">Celebrity Fashion</p>
                <p className="text-sm text-pastel-text-light">Top 10 US celebrity style influences</p>
              </div>
            </div>
          </div>
        </div>

        <div className="neumorphic-card p-7">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 circular-icon">
              <Layers className="text-pastel-accent" size={24} />
            </div>
            <h3 className="text-xl font-bold text-pastel-navy">Product Detail Tabs</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Palette className="text-purple-500" size={16} />
              <span className="text-sm text-pastel-text">Overview</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="text-amber-500" size={16} />
              <span className="text-sm text-pastel-text">FIBO Prompt</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="text-emerald-500" size={16} />
              <span className="text-sm text-pastel-text">Validation</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="text-blue-500" size={16} />
              <span className="text-sm text-pastel-text">Tech Pack</span>
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare className="text-pastel-teal" size={16} />
              <span className="text-sm text-pastel-text">Adjust Design</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="text-pink-500" size={16} />
              <span className="text-sm text-pastel-text">Email & PDF</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="neumorphic-card p-7 hover:shadow-neumorphic-lg transition-all duration-300">
          <h3 className="text-xl font-bold text-pastel-navy mb-6">Key Features</h3>
          <ul className="space-y-3">
            <FeatureItem>Regional, seasonal & celebrity-based trend analysis</FeatureItem>
            <FeatureItem>Real-time Brand Guardian validation with auto-fix</FeatureItem>
            <FeatureItem>Multi-tab product details: Overview, FIBO, Validation, Tech Pack & Design Adjustments</FeatureItem>
            <FeatureItem>PDF tech pack generation & email distribution via Resend</FeatureItem>
            <FeatureItem>AI-powered design chat with brand compliance</FeatureItem>
            <FeatureItem>Celebrity fashion insights from top 10 US influencers</FeatureItem>
          </ul>
        </div>

        <div className="neumorphic-card p-7 hover:shadow-neumorphic-lg transition-all duration-300">
          <h3 className="text-xl font-bold text-pastel-navy mb-6">Categories Supported</h3>
          <div className="grid grid-cols-3 gap-4">
            <CategoryCard
              title="Apparel"
              items={['Jackets', 'Shirts', 'Pants', 'Dresses']}
              color="emerald"
            />
            <CategoryCard
              title="Footwear"
              items={['Sneakers', 'Boots', 'Sandals', 'Loafers']}
              color="blue"
            />
            <CategoryCard
              title="Accessories"
              items={['Hats', 'Belts', 'Bags', 'Jewelry']}
              color="amber"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface QuickActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  featured?: boolean;
}

function QuickActionCard({ icon, title, description, action, onClick, featured }: QuickActionCardProps) {
  return (
    <div className={`neumorphic-card p-7 hover:shadow-neumorphic-lg transition-all duration-300 group ${featured ? 'ring-2 ring-pastel-accent/30' : ''}`}>
      {featured && (
        <span className="inline-block px-4 py-1.5 neumorphic-inset text-pastel-accent text-xs font-semibold rounded-full mb-4">
          Demo Focus
        </span>
      )}
      <div className="mb-5 p-4 circular-icon w-fit">{icon}</div>
      <h3 className="text-xl font-bold text-pastel-navy mb-3">{title}</h3>
      <p className="text-sm text-pastel-text-light mb-5 leading-relaxed">{description}</p>
      <button
        onClick={onClick}
        className="text-sm font-semibold text-pastel-accent flex items-center gap-1 hover:gap-3 transition-all"
      >
        {action}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

interface WorkflowStepProps {
  number: number;
  title: string;
  description: string;
  isLast?: boolean;
}

function WorkflowStep({ title, description, isLast }: WorkflowStepProps) {
  return (
    <div className="relative">
      <div className="neumorphic-sm p-5 h-full hover:shadow-neumorphic transition-all duration-300 group">
        <h4 className="font-bold text-pastel-navy mb-2 text-base">{title}</h4>
        <p className="text-sm text-pastel-text-light leading-relaxed">{description}</p>
      </div>
      {!isLast && (
        <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2 z-10">
          <ArrowRight className="text-pastel-muted" size={20} />
        </div>
      )}
    </div>
  );
}

function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm text-pastel-text">
      <div className="p-1.5 circular-icon">
        <CheckCircle className="text-emerald-500 flex-shrink-0" size={18} />
      </div>
      <span>{children}</span>
    </li>
  );
}

interface CategoryCardProps {
  title: string;
  items: string[];
  color: 'emerald' | 'blue' | 'amber';
}

function CategoryCard({ title, items, color }: CategoryCardProps) {
  const colors = {
    emerald: 'text-emerald-600',
    blue: 'text-pastel-accent',
    amber: 'text-amber-600',
  };

  return (
    <div className="text-center neumorphic-inset p-3 rounded-xl">
      <h4 className={`font-bold ${colors[color]} mb-3 text-base`}>{title}</h4>
      <ul className="text-xs text-pastel-muted space-y-1.5">
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
