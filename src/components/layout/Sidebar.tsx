import { Home, Palette, Shield, Layers, TrendingUp, Settings, LogOut, FolderOpen } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export type View = 'dashboard' | 'brand-style' | 'brand-guardian' | 'collection' | 'collection-library' | 'trends' | 'settings';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const NAV_ITEMS: { id: View; label: string; icon: React.ReactNode; description: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <Home size={20} />, description: 'Overview & quick actions' },
  { id: 'brand-style', label: 'Brand Style', icon: <Palette size={20} />, description: 'Visual rules editor' },
  { id: 'brand-guardian', label: 'Brand Guardian', icon: <Shield size={20} />, description: 'Validation demo' },
  { id: 'collection', label: 'Collections', icon: <Layers size={20} />, description: 'Plan & generate' },
  { id: 'collection-library', label: 'Collection Library', icon: <FolderOpen size={20} />, description: 'Browse & manage saved' },
  { id: 'trends', label: 'Trend Intel', icon: <TrendingUp size={20} />, description: 'Market insights' },
];

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const { profile, user, signOut } = useAuth();

  const displayName = profile?.full_name || user?.email?.split('@')[0] || 'User';
  const initials = displayName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

  return (
    <aside className="w-64 neumorphic-lg flex flex-col h-screen fixed left-0 top-0 z-50 m-4 rounded-3xl overflow-hidden">
      <div className="p-6 border-b border-pastel-muted/20">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 circular-icon flex items-center justify-center">
            <span className="text-xl font-bold text-pastel-navy">TS</span>
          </div>
          <div>
            <h1 className="font-bold text-pastel-navy text-lg">TrendSync Brand Factory</h1>
            <p className="text-xs text-pastel-muted">AI Fashion Studio</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-300 ${
              currentView === item.id
                ? 'neumorphic-inset text-pastel-navy'
                : 'text-pastel-text-light hover:neumorphic-sm hover:text-pastel-navy'
            }`}
          >
            <div className={`${currentView === item.id ? 'text-pastel-accent' : ''}`}>
              {item.icon}
            </div>
            <div>
              <p className="font-semibold">{item.label}</p>
              <p className="text-xs opacity-70">{item.description}</p>
            </div>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-pastel-muted/20">
        <button
          onClick={() => onNavigate('settings')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-300 ${
            currentView === 'settings'
              ? 'neumorphic-inset text-pastel-navy'
              : 'text-pastel-text-light hover:neumorphic-sm hover:text-pastel-navy'
          }`}
        >
          <Settings size={20} />
          <span className="font-semibold">Settings</span>
        </button>
      </div>

      <div className="p-4 neumorphic-inset m-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 circular-icon flex items-center justify-center">
            <span className="text-sm font-bold text-pastel-navy">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-pastel-navy truncate">{displayName}</p>
            <p className="text-xs text-pastel-muted truncate">{profile?.role || 'Designer'}</p>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-lg text-pastel-muted hover:text-red-500 hover:neumorphic-sm transition-all"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
