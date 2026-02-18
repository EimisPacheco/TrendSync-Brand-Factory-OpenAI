import { useState } from 'react';
import { TrendingUp, MapPin, Calendar, Users, Loader, RefreshCw, Palette, Shirt, Layers, Sparkles, Info, Star, Globe, Footprints, Watch } from 'lucide-react';
import type { TrendInsightsJSON, TrendingItem } from '../../types/database';
import { fetchTrends as apiFetchTrends, fetchCelebrities as apiFetchCelebrities } from '../../lib/api-client';

interface CelebrityColor {
  color: string;
  hex: string;
}

interface CelebrityBasic {
  name: string;
  profession: string;
  signature_style: string;
  influence_score: number;
  signature_colors?: CelebrityColor[];
  signature_looks?: string[];
  preferred_brands?: string[];
}

const REGIONS = [
  { id: 'Los Angeles, USA', name: 'Los Angeles' },
  { id: 'New York, USA', name: 'New York' },
  { id: 'London, UK', name: 'London' },
  { id: 'Tokyo, Japan', name: 'Tokyo' },
  { id: 'Paris, France', name: 'Paris' },
  { id: 'Seoul, South Korea', name: 'Seoul' },
];

// Auto-generate seasons from current date (current + next 3 seasons)
function buildSeasons() {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const year = now.getFullYear();
  const order = ['Spring', 'Summer', 'Fall', 'Winter'] as const;
  const currentIdx = month < 3 ? 3 : month < 6 ? 0 : month < 9 ? 1 : 2;
  const currentYear = currentIdx === 3 && month < 3 ? year - 1 : year;
  const seasons: { id: string; name: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const idx = (currentIdx + i) % 4;
    const y = currentYear + Math.floor((currentIdx + i) / 4);
    const label = `${order[idx]} ${y}`;
    seasons.push({ id: label, name: label });
  }
  return seasons;
}
const SEASONS = buildSeasons();

const DEMOGRAPHICS = [
  { id: 'Gen Z (18-25)', name: 'Gen Z' },
  { id: 'Millennials (26-41)', name: 'Millennials' },
  { id: 'Gen X (42-57)', name: 'Gen X' },
];

export function TrendInsightsView() {
  const [activeTab, setActiveTab] = useState<'regional' | 'celebrity'>('regional');
  const [region, setRegion] = useState('Los Angeles, USA');
  const [season, setSeason] = useState(SEASONS[0].id);
  const [demographic, setDemographic] = useState('Gen Z (18-25)');
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<TrendInsightsJSON | null>(null);
  const [celebList, setCelebList] = useState<CelebrityBasic[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = async () => {
    setLoading(true);
    setError(null);
    setInsights(null);

    try {
      const res = await apiFetchTrends({
        season,
        region,
        demographic,
        trend_source: 'regional',
      });

      const data = res.insights;
      const transformedInsights: TrendInsightsJSON = {
        colors: (data.colors || []).map(c => ({
          ...c,
          sources: ['Gemini + Google Search'],
        })),
        silhouettes: (data.silhouettes || []).map(s => ({
          ...s,
          sources: ['Gemini + Google Search'],
        })),
        materials: (data.materials || []).map(m => ({
          ...m,
          sources: ['Gemini + Google Search'],
        })),
        themes: (data.themes || []).map(t => ({
          ...t,
          sources: ['Gemini + Google Search'],
        })),
        summary: data.summary || '',
      };

      setInsights(transformedInsights);
    } catch (err) {
      console.error('Error fetching trends:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const fetchCelebrityTrends = async () => {
    setLoading(true);
    setError(null);
    setCelebList([]);
    setInsights(null);

    try {
      // Fetch both celebrity trend insights and the celebrity list in parallel
      const [trendRes, celebRes] = await Promise.all([
        apiFetchTrends({ demographic, trend_source: 'celebrity' }),
        apiFetchCelebrities(demographic),
      ]);

      const data = trendRes.insights;
      const transformedInsights: TrendInsightsJSON = {
        colors: (data.colors || []).map(c => ({ ...c, sources: ['Gemini + Google Search'] })),
        silhouettes: (data.silhouettes || []).map(s => ({ ...s, sources: ['Gemini + Google Search'] })),
        materials: (data.materials || []).map(m => ({ ...m, sources: ['Gemini + Google Search'] })),
        themes: (data.themes || []).map(t => ({ ...t, sources: ['Gemini + Google Search'] })),
        summary: data.summary || '',
      };

      setInsights(transformedInsights);
      setCelebList((celebRes.celebrities || []) as CelebrityBasic[]);
    } catch (err) {
      console.error('Error fetching celebrity trends:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const renderTrendItem = (item: TrendingItem, icon: React.ReactNode) => (
    <div key={item.name} className="neumorphic-card p-6">
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 circular-icon">{icon}</div>
            <div>
              <h4 className="font-semibold text-pastel-navy">{item.name}</h4>
              {item.hex && (
                <div className="flex items-center gap-2 mt-1">
                  <div
                    className="w-6 h-6 rounded-full shadow-inner"
                    style={{ backgroundColor: item.hex }}
                  />
                  <span className="text-xs text-pastel-muted">{item.hex}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wider text-pastel-muted mb-0.5">Trend Confidence</span>
          <span className="text-sm font-bold text-pastel-accent">{item.confidence}%</span>
        </div>
        </div>
        <p className="text-sm text-pastel-text-light leading-relaxed mb-3">{item.description}</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 neumorphic-inset rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                item.confidence >= 85
                  ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                  : item.confidence >= 70
                  ? 'bg-gradient-to-r from-blue-400 to-blue-600'
                  : 'bg-gradient-to-r from-amber-400 to-amber-600'
              }`}
              style={{ width: `${item.confidence}%` }}
            />
          </div>
          <span className={`text-xs font-semibold whitespace-nowrap px-3 py-1.5 rounded-full transition-all ${
            item.confidence >= 85
              ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-500/30'
              : item.confidence >= 70
              ? 'bg-blue-500/20 text-blue-600 border border-blue-500/30'
              : 'bg-amber-500/20 text-amber-600 border border-amber-500/30'
          }`}>
            {item.confidence >= 85 ? 'Very High' : item.confidence >= 70 ? 'High' : 'Moderate'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 min-h-screen">
      <div className="neumorphic-card p-10">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 circular-icon">
            <TrendingUp className="text-pastel-accent" size={36} />
          </div>
          <h2 className="text-4xl font-bold text-pastel-navy">
            Trend Intelligence
          </h2>
        </div>
        <p className="text-pastel-text text-xl">
          Discover real-time fashion trends powered by Gemini AI + Google Search
        </p>
      </div>

      {/* Tabs for different trend sources */}
      <div className="neumorphic-card p-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('regional')}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'regional'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'text-pastel-text hover:neumorphic-sm'
            }`}
          >
            <Globe size={18} />
            Regional & Seasonal Trends
          </button>
          <button
            onClick={() => setActiveTab('celebrity')}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'celebrity'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'text-pastel-text hover:neumorphic-sm'
            }`}
          >
            <Star size={18} />
            Celebrity Fashion Trends
          </button>
        </div>
      </div>

      {activeTab === 'regional' ? (
        <>
          <div className="neumorphic-card p-7">
            <h3 className="text-2xl font-bold text-pastel-navy mb-6">Configure Regional Analysis</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div>
                <label className="flex items-center gap-2 text-sm text-pastel-text font-medium mb-2">
                  <MapPin size={16} className="text-pastel-teal" />
                  Region
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full input-neumorphic px-4 py-3 text-pastel-navy"
                >
                  {REGIONS.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-pastel-text font-medium mb-2">
                  <Calendar size={16} className="text-amber-500" />
                  Season
                </label>
                <select
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                  className="w-full input-neumorphic px-4 py-3 text-pastel-navy"
                >
                  {SEASONS.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm text-pastel-text font-medium mb-2">
                  <Users size={16} className="text-pastel-accent" />
                  Demographic
                </label>
                <select
                  value={demographic}
                  onChange={(e) => setDemographic(e.target.value)}
                  className="w-full input-neumorphic px-4 py-3 text-pastel-navy"
                >
                  {DEMOGRAPHICS.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={fetchTrends}
              disabled={loading}
              className="w-full py-4 px-6 btn-navy text-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={20} />
                  Analyzing Trends...
                </>
              ) : (
                <>
                  <RefreshCw size={20} />
                  Fetch Regional Trends
                </>
              )}
            </button>
          </div>

          {insights && (
            <div className="space-y-6">
              <div className="neumorphic-card p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 circular-icon">
                    <Sparkles className="text-amber-500" size={24} />
                  </div>
                  <h3 className="text-2xl font-bold text-pastel-navy">Trend Summary</h3>
                </div>
                <p className="text-pastel-text leading-relaxed text-lg">{insights.summary}</p>
              </div>

              {/* Organized by Product Categories */}
              <div className="space-y-8">
                {/* Apparel Section */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Shirt className="text-pastel-accent" size={24} />
                    <h3 className="text-xl font-bold text-pastel-navy">Apparel Trends</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Colors for Apparel */}
                    {insights.colors.slice(0, 2).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Apparel)` },
                      <Palette className="text-purple-500" size={20} />
                    ))}
                    {/* Silhouettes for Apparel */}
                    {insights.silhouettes.slice(0, 2).map(item => renderTrendItem(item, <Shirt className="text-pastel-accent" size={20} />))}
                    {/* Materials for Apparel */}
                    {insights.materials.slice(0, 2).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Fabric)` },
                      <Layers className="text-pastel-teal" size={20} />
                    ))}
                  </div>
                </div>

                {/* Footwear Section */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Footprints className="text-blue-500" size={24} />
                    <h3 className="text-xl font-bold text-pastel-navy">Footwear Trends</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Footwear specific trends */}
                    {insights.colors.slice(2, 3).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Footwear)` },
                      <Palette className="text-purple-500" size={20} />
                    ))}
                    {insights.silhouettes.slice(2, 3).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Shoe Style)` },
                      <Footprints className="text-blue-500" size={20} />
                    ))}
                    {insights.materials.slice(2, 3).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Footwear)` },
                      <Layers className="text-pastel-teal" size={20} />
                    ))}
                  </div>
                </div>

                {/* Accessories Section */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Watch className="text-amber-500" size={24} />
                    <h3 className="text-xl font-bold text-pastel-navy">Accessories Trends</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Accessories specific trends */}
                    {insights.colors.slice(3, 4).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Accessories)` },
                      <Palette className="text-purple-500" size={20} />
                    ))}
                    {insights.themes.map(item => renderTrendItem(
                      { ...item, name: `${item.name} Theme` },
                      <Sparkles className="text-amber-500" size={20} />
                    ))}
                    {insights.materials.slice(3).map(item => renderTrendItem(
                      { ...item, name: `${item.name} (Accessories)` },
                      <Layers className="text-pastel-teal" size={20} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="neumorphic-card p-7">
            <h3 className="text-2xl font-bold text-pastel-navy mb-4">Celebrity Fashion Analysis</h3>
            <p className="text-pastel-text mb-6">
              Discover fashion trends from the top 10 most influential celebrities of the past 5 years.
              The analysis includes actors, musicians, athletes, and fashion icons who shape global fashion trends.
            </p>

            <button
              onClick={fetchCelebrityTrends}
              disabled={loading}
              className="w-full py-4 px-6 btn-navy text-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={20} />
                  Analyzing Celebrity Trends...
                </>
              ) : (
                <>
                  <Star size={20} />
                  Fetch Celebrity Fashion Trends
                </>
              )}
            </button>
          </div>

          {(insights || celebList.length > 0) && (
            <div className="space-y-6">
              {/* Overview */}
              {insights && (
                <div className="neumorphic-card p-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 circular-icon">
                      <Star className="text-amber-500" size={24} />
                    </div>
                    <h3 className="text-2xl font-bold text-pastel-navy">Celebrity Fashion Overview</h3>
                  </div>
                  <p className="text-pastel-text leading-relaxed text-lg">{insights.summary}</p>
                </div>
              )}

              {/* Celebrity Cards */}
              {celebList.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {celebList.slice(0, 10).map((celeb, index) => {
                    const getEmoji = () => {
                      const n = celeb.name.toLowerCase();
                      const p = (celeb.profession || '').toLowerCase();
                      if (n.includes('taylor') || n.includes('swift')) return '👱‍♀️';
                      if (n.includes('beyonc')) return '👸🏾';
                      if (n.includes('rihanna')) return '💎';
                      if (n.includes('zendaya')) return '🎭';
                      if (n.includes('jenner')) return '📸';
                      if (n.includes('kardashian')) return '💄';
                      if (n.includes('dwayne') || n.includes('rock')) return '💪';
                      if (n.includes('serena')) return '🎾';
                      if (n.includes('blake') || n.includes('lively')) return '🌹';
                      if (n.includes('timoth')) return '🎬';
                      if (n.includes('billie')) return '🎵';
                      if (n.includes('harry')) return '🕺';
                      if (n.includes('ariana')) return '🎶';
                      if (n.includes('drake')) return '🎤';
                      if (n.includes('gigi')) return '🦋';
                      if (n.includes('bella')) return '🌹';
                      if (n.includes('dua')) return '🎙️';
                      if (n.includes('lebron')) return '🏀';
                      if (n.includes('selena')) return '⭐';
                      if (n.includes('gaga')) return '🦄';
                      if (n.includes('sydney') || n.includes('sweeney')) return '🎬';
                      if (p.includes('sing') || p.includes('music')) return '🎤';
                      if (p.includes('act')) return '🎬';
                      if (p.includes('athlete') || p.includes('sport')) return '⚡';
                      if (p.includes('model')) return '👗';
                      if (p.includes('influencer')) return '✨';
                      return '⭐';
                    };

                    const gradients = [
                      'from-purple-400 to-pink-400',
                      'from-amber-400 to-orange-400',
                      'from-blue-400 to-cyan-400',
                      'from-emerald-400 to-teal-400',
                      'from-red-400 to-rose-400',
                      'from-indigo-400 to-purple-400',
                      'from-green-400 to-lime-400',
                      'from-yellow-400 to-amber-400',
                      'from-pink-400 to-fuchsia-400',
                      'from-slate-400 to-gray-400',
                    ];

                    return (
                      <div key={index} className="neumorphic-card p-5">
                        {/* Header: Avatar + Name + Score */}
                        <div className="flex items-start gap-3 mb-3">
                          <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0">
                            <div className={`w-full h-full flex items-center justify-center text-2xl bg-gradient-to-br ${gradients[index % 10]}`}>
                              {getEmoji()}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between">
                              <div>
                                <h4 className="font-bold text-pastel-navy leading-tight">{celeb.name}</h4>
                                <p className="text-xs text-pastel-muted mt-0.5">{celeb.profession}</p>
                              </div>
                              <div className="flex flex-col items-end flex-shrink-0 ml-2">
                                <span className="text-[9px] uppercase tracking-wider text-pastel-muted">Influence</span>
                                <div className="flex items-center gap-1">
                                  <Star size={13} className="text-amber-500 fill-amber-500" />
                                  <span className="text-sm font-bold text-pastel-accent">{celeb.influence_score}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Description */}
                        <p className="text-sm text-pastel-text leading-relaxed mb-4">{celeb.signature_style}</p>

                        {/* Signature Colors */}
                        {celeb.signature_colors && celeb.signature_colors.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold text-pastel-navy mb-1.5">Signature Colors</p>
                            <div className="flex items-center gap-3">
                              {celeb.signature_colors.map((c, ci) => (
                                <div key={ci} className="flex items-center gap-1.5">
                                  <div
                                    className="w-4 h-4 rounded-full border border-white/50"
                                    style={{ backgroundColor: c.hex || '#808080', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
                                  />
                                  <span className="text-xs text-pastel-text">{c.color}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Signature Looks */}
                        {celeb.signature_looks && celeb.signature_looks.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs font-semibold text-pastel-navy mb-1.5">Signature Looks</p>
                            <ul className="space-y-0.5">
                              {celeb.signature_looks.map((look, li) => (
                                <li key={li} className="text-xs text-pastel-text-light leading-relaxed">
                                  &bull; {look}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Preferred Brands */}
                        {celeb.preferred_brands && celeb.preferred_brands.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-pastel-navy mb-1.5">Preferred Brands</p>
                            <div className="flex flex-wrap gap-1.5">
                              {celeb.preferred_brands.map((brand, bi) => (
                                <span
                                  key={bi}
                                  className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-pastel-navy/90 text-white"
                                >
                                  {brand}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Common Trends from insights */}
              {insights && (
                <div className="neumorphic-card p-8">
                  <h3 className="text-xl font-bold text-pastel-navy mb-6">Common Celebrity Trends</h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Colors */}
                    <div>
                      <h4 className="font-semibold text-pastel-navy mb-3 flex items-center gap-2">
                        <Palette size={16} className="text-purple-500" />
                        Trending Colors
                      </h4>
                      <div className="space-y-2.5">
                        {insights.colors.map((color, idx) => (
                          <div key={idx} className="flex items-center gap-2.5">
                            <div
                              className="w-5 h-5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color.hex || '#808080', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
                            />
                            <span className="text-sm text-pastel-text flex-1">{color.name}</span>
                            <div className="flex flex-col items-end">
                              <span className="text-[9px] uppercase tracking-wider text-pastel-muted">Popularity</span>
                              <span className="text-xs font-semibold text-pastel-accent">{color.confidence}%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Styles */}
                    <div>
                      <h4 className="font-semibold text-pastel-navy mb-3 flex items-center gap-2">
                        <Shirt size={16} className="text-pastel-accent" />
                        Popular Styles
                      </h4>
                      <ul className="space-y-2">
                        {insights.silhouettes.map((style, idx) => (
                          <li key={idx} className="text-sm text-pastel-text">&bull; {style.name}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Materials */}
                    <div>
                      <h4 className="font-semibold text-pastel-navy mb-3 flex items-center gap-2">
                        <Layers size={16} className="text-pastel-teal" />
                        Trending Materials
                      </h4>
                      <ul className="space-y-2">
                        {insights.materials.map((material, idx) => (
                          <li key={idx} className="text-sm text-pastel-text">&bull; {material.name}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {insights.summary && (
                    <div className="mt-6 p-4 neumorphic-inset rounded-xl">
                      <p className="text-sm text-pastel-text-light leading-relaxed">
                        <Info size={16} className="inline mr-2 text-pastel-accent" />
                        {insights.summary}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && (
        <div className="neumorphic-card p-6 border-l-4 border-red-500">
          <div className="flex items-start gap-3">
            <Info className="text-red-500 mt-1" size={20} />
            <div>
              <h4 className="font-semibold text-red-600 mb-1">Error</h4>
              <p className="text-sm text-pastel-text">{error}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}