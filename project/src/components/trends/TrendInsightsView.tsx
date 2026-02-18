import { useState } from 'react';
import { TrendingUp, MapPin, Calendar, Users, Loader, RefreshCw, Palette, Shirt, Layers, Sparkles, Info, Star, Globe, Footprints, Watch } from 'lucide-react';
import type { TrendInsightsJSON, TrendingItem } from '../../types/database';
import { useAuth } from '../../contexts/AuthContext';
import { getGeminiApiKey } from '../../lib/api-keys';

interface CelebrityStyle {
  name: string;
  image_url?: string; // Image URL from non-Wikipedia sources
  profession: string;
  fashionStyle: string;
  signature_looks: string[];
  key_colors: { name: string; hex: string; description: string }[];
  preferred_brands: string[];
  influence_score: number;
}

interface CelebrityTrendsJSON {
  overview: string;
  celebrities: CelebrityStyle[];
  common_trends: {
    colors: { name: string; hex: string; popularity: number }[];
    styles: string[];
    materials: string[];
  };
  fashion_insights: string;
}

const REGIONS = [
  { id: 'Los Angeles, USA', name: 'Los Angeles' },
  { id: 'New York, USA', name: 'New York' },
  { id: 'London, UK', name: 'London' },
  { id: 'Tokyo, Japan', name: 'Tokyo' },
  { id: 'Paris, France', name: 'Paris' },
  { id: 'Seoul, South Korea', name: 'Seoul' },
];

const SEASONS = [
  { id: 'Spring 2025', name: 'Spring 2025' },
  { id: 'Summer 2025', name: 'Summer 2025' },
  { id: 'Fall 2025', name: 'Fall 2025' },
  { id: 'Winter 2025', name: 'Winter 2025' },
  { id: 'Spring 2026', name: 'Spring 2026' },
  { id: 'Summer 2026', name: 'Summer 2026' },
];

const DEMOGRAPHICS = [
  { id: 'Gen Z (18-25)', name: 'Gen Z' },
  { id: 'Millennials (26-41)', name: 'Millennials' },
  { id: 'Gen X (42-57)', name: 'Gen X' },
];

export function TrendInsightsView() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'regional' | 'celebrity'>('regional');
  const [region, setRegion] = useState('Los Angeles, USA');
  const [season, setSeason] = useState('Spring 2025');
  const [demographic, setDemographic] = useState('Gen Z (18-25)');
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<TrendInsightsJSON | null>(null);
  const [celebrityInsights, setCelebrityInsights] = useState<CelebrityTrendsJSON | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = async () => {
    if (!user) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    setInsights(null);

    try {
      const geminiApiKey = await getGeminiApiKey(user.id);

      const { GeminiTrendService } = await import('../../services/gemini-trends');
      const trendService = new GeminiTrendService(geminiApiKey);
      const result = await trendService.fetchTrends({
        region,
        season,
        demographic,
        trendSource: 'regional',
      });

      const transformedInsights: TrendInsightsJSON = {
        colors: result.colors.map(c => ({
          ...c,
          sources: ['Gemini + Google Search'],
        })),
        silhouettes: result.silhouettes.map(s => ({
          ...s,
          sources: ['Gemini + Google Search'],
        })),
        materials: result.materials.map(m => ({
          ...m,
          sources: ['Gemini + Google Search'],
        })),
        themes: result.themes.map(t => ({
          ...t,
          sources: ['Gemini + Google Search'],
        })),
        summary: result.summary,
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
    if (!user) {
      setError('User not authenticated');
      return;
    }

    setLoading(true);
    setError(null);
    setCelebrityInsights(null);

    try {
      const geminiApiKey = await getGeminiApiKey(user.id);

      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-preview-05-20',
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
        tools: [{ googleSearch: {} } as any],
      });

      const prompt = `Search for and analyze the fashion styles of the 10 most influential US-based celebrities from 2020-2025.
Include actors, musicians, athletes, and influencers.

Return JSON:
{
  "overview": "Brief summary",
  "celebrities": [
    {
      "name": "Celebrity Name",
      "profession": "Actor/Singer/etc",
      "fashionStyle": "Style description",
      "signature_looks": ["Look 1", "Look 2"],
      "key_colors": [{"name": "Color", "hex": "#HEXCODE", "description": "why"}],
      "preferred_brands": ["Brand 1", "Brand 2"],
      "influence_score": 95
    }
  ],
  "common_trends": {
    "colors": [{"name": "Color", "hex": "#HEXCODE", "popularity": 85}],
    "styles": ["Style 1"],
    "materials": ["Material 1"]
  },
  "fashion_insights": "Analysis"
}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      let jsonContent = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) jsonContent = jsonMatch[0];
      jsonContent = jsonContent.replace(/,\s*([}\]])/g, '$1');

      const celebrityData = JSON.parse(jsonContent);
      setCelebrityInsights(celebrityData);
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

          {celebrityInsights && (
            <div className="space-y-6">
              <div className="neumorphic-card p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 circular-icon">
                    <Star className="text-amber-500" size={24} />
                  </div>
                  <h3 className="text-2xl font-bold text-pastel-navy">Celebrity Fashion Overview</h3>
                </div>
                <p className="text-pastel-text leading-relaxed text-lg">{celebrityInsights?.overview}</p>
              </div>

              {/* Celebrity Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {celebrityInsights?.celebrities?.slice(0, 10).map((celeb, index) => (
                  <div key={index} className="neumorphic-card p-6">
                    <div className="space-y-4">
                      <div className="flex items-start gap-4">
                        {/* Celebrity Avatar - Emoji-based design */}
                        <div className="w-20 h-20 rounded-full overflow-hidden neumorphic-sm flex-shrink-0">
                          <div className={`w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br ${
                            // Unique gradient for each celebrity based on index
                            index % 10 === 0 ? 'from-purple-500 to-pink-500' :
                            index % 10 === 1 ? 'from-blue-500 to-cyan-500' :
                            index % 10 === 2 ? 'from-amber-500 to-orange-500' :
                            index % 10 === 3 ? 'from-emerald-500 to-teal-500' :
                            index % 10 === 4 ? 'from-red-500 to-rose-500' :
                            index % 10 === 5 ? 'from-indigo-500 to-purple-500' :
                            index % 10 === 6 ? 'from-green-500 to-lime-500' :
                            index % 10 === 7 ? 'from-yellow-500 to-amber-500' :
                            index % 10 === 8 ? 'from-pink-500 to-fuchsia-500' :
                            'from-gray-500 to-slate-500'
                          }`}>
                            {(() => {
                              // Map celebrity names to representative emojis
                              const nameLower = celeb.name.toLowerCase();
                              const professionLower = (celeb.profession || '').toLowerCase();

                              // Celebrity-specific emojis based on name or profession
                              if (nameLower.includes('taylor') || nameLower.includes('swift')) return '👱‍♀️';
                              if (nameLower.includes('beyonc')) return '👸🏾';
                              if (nameLower.includes('drake')) return '🎤';
                              if (nameLower.includes('rihanna')) return '💎';
                              if (nameLower.includes('kardashian')) return '💄';
                              if (nameLower.includes('jenner')) return '📸';
                              if (nameLower.includes('lebron')) return '🏀';
                              if (nameLower.includes('serena')) return '🎾';
                              if (nameLower.includes('zendaya')) return '🎭';
                              if (nameLower.includes('timoth')) return '🎬';
                              if (nameLower.includes('billie')) return '🎵';
                              if (nameLower.includes('ariana')) return '🎶';
                              if (nameLower.includes('dua')) return '🎙️';
                              if (nameLower.includes('harry')) return '🕺';
                              if (nameLower.includes('selena')) return '⭐';
                              if (nameLower.includes('justin')) return '🎸';
                              if (nameLower.includes('kanye') || nameLower.includes('ye')) return '🎧';
                              if (nameLower.includes('travis')) return '🔥';
                              if (nameLower.includes('megan')) return '🐎';
                              if (nameLower.includes('doja')) return '🐱';
                              if (nameLower.includes('cardi')) return '💅';
                              if (nameLower.includes('nicki')) return '👑';
                              if (nameLower.includes('bruno')) return '🎩';
                              if (nameLower.includes('gaga')) return '🦄';
                              if (nameLower.includes('madonna')) return '👸';
                              if (nameLower.includes('bella')) return '🌹';
                              if (nameLower.includes('gigi')) return '🦋';
                              if (nameLower.includes('kendall')) return '👗';
                              if (nameLower.includes('hailey')) return '💫';
                              if (nameLower.includes('dwayne') || nameLower.includes('rock')) return '💪';
                              if (nameLower.includes('kevin')) return '😂';
                              if (nameLower.includes('simone')) return '🤸‍♀️';
                              if (nameLower.includes('naomi')) return '🏃‍♀️';

                              // Profession-based fallbacks
                              if (professionLower.includes('sing') || professionLower.includes('music')) return '🎤';
                              if (professionLower.includes('act')) return '🎬';
                              if (professionLower.includes('athlete') || professionLower.includes('sport')) return '⚡';
                              if (professionLower.includes('model')) return '👗';
                              if (professionLower.includes('influencer')) return '✨';
                              if (professionLower.includes('fashion')) return '👠';

                              // Default emoji
                              return '⭐';
                            })()}
                          </div>
                        </div>

                        <div className="flex-1">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-bold text-lg text-pastel-navy">{celeb.name}</h4>
                              <p className="text-sm text-pastel-muted">{celeb.profession}</p>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-[10px] uppercase tracking-wider text-pastel-muted mb-0.5">Influence</span>
                              <div className="flex items-center gap-1">
                                <Star size={14} className="text-amber-500 fill-current" />
                                <span className="text-sm font-bold text-pastel-accent">{celeb.influence_score}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <p className="text-sm text-pastel-text leading-relaxed">{celeb.fashionStyle}</p>

                      {/* Key Colors */}
                      {celeb.key_colors && celeb.key_colors.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-pastel-text mb-2">Signature Colors</p>
                          <div className="flex gap-2 flex-wrap">
                            {celeb.key_colors.slice(0, 3).map((color, idx) => (
                              <div key={idx} className="flex items-center gap-1">
                                <div
                                  className="w-5 h-5 rounded-full shadow-neumorphic-sm"
                                  style={{ backgroundColor: color.hex }}
                                  title={color.name}
                                />
                                <span className="text-xs text-pastel-muted">{color.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Signature Looks */}
                      {celeb.signature_looks && celeb.signature_looks.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-pastel-text mb-1">Signature Looks</p>
                          <ul className="text-xs text-pastel-text-light space-y-1">
                            {celeb.signature_looks.slice(0, 2).map((look, idx) => (
                              <li key={idx}>• {look}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Brands */}
                      {celeb.preferred_brands && celeb.preferred_brands.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-pastel-text mb-1">Preferred Brands</p>
                          <div className="flex flex-wrap gap-1">
                            {celeb.preferred_brands.slice(0, 3).map((brand, idx) => (
                              <span key={idx} className="text-xs px-2 py-1 bg-pastel-bg-light rounded-full">
                                {brand}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Common Trends */}
              {celebrityInsights?.common_trends && (
                <div className="neumorphic-card p-8">
                  <h3 className="text-xl font-bold text-pastel-navy mb-6">Common Celebrity Trends</h3>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Colors */}
                    <div>
                      <h4 className="font-semibold text-pastel-navy mb-3 flex items-center gap-2">
                        <Palette size={16} className="text-purple-500" />
                        Trending Colors
                      </h4>
                      <div className="space-y-2">
                        {celebrityInsights?.common_trends?.colors?.map((color, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full shadow-neumorphic-sm"
                              style={{ backgroundColor: color.hex }}
                            />
                            <span className="text-sm text-pastel-text">{color.name}</span>
                            <div className="ml-auto flex flex-col items-end">
                              <span className="text-[9px] uppercase tracking-wider text-pastel-muted">Popularity</span>
                              <span className="text-xs font-semibold text-pastel-accent">{color.popularity}%</span>
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
                        {celebrityInsights?.common_trends?.styles?.map((style, idx) => (
                          <li key={idx} className="text-sm text-pastel-text">• {style}</li>
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
                        {celebrityInsights?.common_trends?.materials?.map((material, idx) => (
                          <li key={idx} className="text-sm text-pastel-text">• {material}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {celebrityInsights?.fashion_insights && (
                    <div className="mt-6 p-4 neumorphic-inset rounded-xl">
                      <p className="text-sm text-pastel-text-light leading-relaxed">
                        <Info size={16} className="inline mr-2 text-pastel-accent" />
                        {celebrityInsights?.fashion_insights}
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