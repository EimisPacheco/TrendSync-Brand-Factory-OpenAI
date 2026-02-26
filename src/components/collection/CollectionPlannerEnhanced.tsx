import { useState, useEffect } from 'react';
import { MapPin, Calendar, Users, Shirt, Footprints, Watch, Sparkles, TrendingUp, Loader, Globe, Star, RefreshCw, Rocket } from 'lucide-react';
import { fetchTrends } from '../../lib/api-client';
import type { PipelineConfig, PipelineResult } from '../../lib/api-client';
import type { Celebrity } from '../../types/database';
import { PipelineRunner } from '../pipeline/PipelineRunner';

interface CollectionPlannerProps {
  onGenerateCollection: (config: CollectionConfig) => void;
  onPipelineComplete?: (result: PipelineResult) => void;
  loading?: boolean;
  brandId?: string;
  celebrityInsights?: Celebrity[];
  onFetchCelebrityInsights?: () => Promise<Celebrity[]>;
}

export interface CollectionConfig {
  name: string;
  region: string;
  season: string;
  demographic: string;
  trendSource: 'regional' | 'celebrity';
  categories: {
    apparel: boolean;
    footwear: boolean;
    accessories: boolean;
  };
  productCount: {
    apparel: number;
    footwear: number;
    accessories: number;
  };
}

const REGIONS = [
  { id: 'us-west', name: 'Los Angeles, USA', flag: 'US' },
  { id: 'us-east', name: 'New York, USA', flag: 'US' },
  { id: 'uk', name: 'London, UK', flag: 'GB' },
  { id: 'jp', name: 'Tokyo, Japan', flag: 'JP' },
  { id: 'kr', name: 'Seoul, South Korea', flag: 'KR' },
  { id: 'fr', name: 'Paris, France', flag: 'FR' },
  { id: 'it', name: 'Milan, Italy', flag: 'IT' },
  { id: 'br', name: 'Sao Paulo, Brazil', flag: 'BR' },
];

const SEASONS = [
  { id: 'spring-2025', name: 'Spring 2025', icon: 'sun' },
  { id: 'summer-2025', name: 'Summer 2025', icon: 'sun' },
  { id: 'fall-2025', name: 'Fall 2025', icon: 'snowflake' },
  { id: 'winter-2025', name: 'Winter 2025', icon: 'snowflake' },
  { id: 'spring-2026', name: 'Spring 2026', icon: 'sun' },
  { id: 'summer-2026', name: 'Summer 2026', icon: 'sun' },
];

const DEMOGRAPHICS = [
  { id: 'gen-z', name: 'Gen Z (18-25)', description: 'Bold, expressive, digital-native' },
  { id: 'millennials', name: 'Millennials (26-41)', description: 'Quality-focused, sustainable' },
  { id: 'gen-x', name: 'Gen X (42-57)', description: 'Classic, refined, practical' },
  { id: 'luxury', name: 'Luxury Market', description: 'High-end, exclusive, timeless' },
];

export function CollectionPlanner({ onGenerateCollection, onPipelineComplete, loading, brandId, celebrityInsights, onFetchCelebrityInsights }: CollectionPlannerProps) {
  const [activeTab, setActiveTab] = useState<'regional' | 'celebrity' | 'pipeline'>('regional');
  const [celebrities, setCelebrities] = useState<Celebrity[]>(celebrityInsights || []);
  const [loadingCelebrities, setLoadingCelebrities] = useState(false);
  const [celebrityError, setCelebrityError] = useState<string>('');
  const [config, setConfig] = useState<CollectionConfig>({
    name: '',
    region: 'us-west',
    season: 'spring-2025',
    demographic: 'gen-z',
    trendSource: 'regional',
    categories: {
      apparel: true,
      footwear: true,
      accessories: true,
    },
    productCount: {
      apparel: 4,
      footwear: 2,
      accessories: 2,
    },
  });

  const [customRegion, setCustomRegion] = useState('');
  const [customSeason, setCustomSeason] = useState('');
  const [customDemographic, setCustomDemographic] = useState('');
  const [celebrityColors, setCelebrityColors] = useState<Array<{ name: string; hex: string }>>([]);
  const [lastCelebrityDemographic, setLastCelebrityDemographic] = useState<string>('');

  // Clear celebrity colors when switching away from celebrity tab
  useEffect(() => {
    if (activeTab !== 'celebrity' && celebrityColors.length > 0) {
      setCelebrityColors([]);
      setLastCelebrityDemographic('');
    }
  }, [activeTab, celebrityColors.length]);

  // Fetch celebrities and trend colors when celebrity tab is selected
  useEffect(() => {
    if (activeTab === 'celebrity' && celebrities.length === 0 && onFetchCelebrityInsights && !loadingCelebrities) {
      setLoadingCelebrities(true);
      setCelebrityError('');
      onFetchCelebrityInsights()
        .then(fetchedCelebrities => {
          if (fetchedCelebrities && fetchedCelebrities.length > 0) {
            setCelebrities(fetchedCelebrities);
          } else {
            setCelebrityError('No celebrity data received from Gemini API. The API might be unavailable or returned empty results.');
          }
        })
        .catch(error => {
          console.error('Failed to fetch celebrity insights:', error);
          setCelebrityError(`Failed to load celebrity data: ${error.message || 'Unknown error occurred'}. Please check your Gemini API key and try again.`);
        })
        .finally(() => {
          setLoadingCelebrities(false);
        });
    }

    // Fetch celebrity trend colors when celebrity tab is active or demographic changes
    if (activeTab === 'celebrity' && config.demographic && (celebrityColors.length === 0 || lastCelebrityDemographic !== config.demographic)) {
      const fetchCelebrityColors = async () => {
        try {
          const res = await fetchTrends({
            demographic: config.demographic,
            trend_source: 'celebrity',
          });

          const insightColors = res.insights?.colors || [];
          if (insightColors.length > 0) {
            const colors = insightColors
              .filter(c => c.hex && c.hex.startsWith('#'))
              .slice(0, 4)
              .map(c => ({ name: c.name, hex: c.hex! }));

            if (colors.length > 0) {
              setCelebrityColors(colors);
              setLastCelebrityDemographic(config.demographic);
            }
          }
        } catch (error) {
          console.error('Failed to fetch celebrity colors:', error);
          setCelebrityError(`Error fetching celebrity fashion colors: ${error instanceof Error ? error.message : 'Unknown error'}`);

<system-reminder>
The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable.

</system-reminder>
        }
      };

      fetchCelebrityColors();
    }
  }, [activeTab, celebrities.length, onFetchCelebrityInsights, loadingCelebrities, config.demographic, celebrityColors.length, lastCelebrityDemographic]);

  const totalProducts =
    (config.categories.apparel ? config.productCount.apparel : 0) +
    (config.categories.footwear ? config.productCount.footwear : 0) +
    (config.categories.accessories ? config.productCount.accessories : 0);

  const handleSubmit = () => {
    const selectedRegion = REGIONS.find(r => r.id === config.region);
    const selectedSeason = SEASONS.find(s => s.id === config.season);
    const selectedDemo = DEMOGRAPHICS.find(d => d.id === config.demographic);

    const finalRegion = config.region === 'custom' ? customRegion : (selectedRegion?.name || config.region);
    const finalSeason = config.season === 'custom' ? customSeason : (selectedSeason?.name || config.season);
    const finalDemo = config.demographic === 'custom' ? customDemographic : (selectedDemo?.name || config.demographic);

    onGenerateCollection({
      ...config,
      name: config.name.trim(),
      region: finalRegion,
      season: finalSeason,
      demographic: finalDemo,
      trendSource: activeTab,
    });
  };

  return (
    <div className="space-y-6">
      <div className="neumorphic-card p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 circular-icon">
            <TrendingUp className="text-pastel-teal" size={28} />
          </div>
          <h2 className="text-2xl font-bold text-pastel-navy">Collection Planner</h2>
        </div>
        <p className="text-pastel-text-light">
          Configure your collection parameters for trend-aware, on-brand generation
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="neumorphic-card p-2">
        <div className="flex gap-2">
          <button
            onClick={() => {
              setActiveTab('regional');
              setConfig(prev => ({ ...prev, trendSource: 'regional' }));
            }}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'regional'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'text-pastel-text hover:neumorphic-sm'
            }`}
          >
            <Globe size={18} />
            Regional & Seasonal Collection
          </button>
          <button
            onClick={() => {
              setActiveTab('celebrity');
              setConfig(prev => ({ ...prev, trendSource: 'celebrity' }));
            }}
            className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === 'celebrity'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'text-pastel-text hover:neumorphic-sm'
            }`}
          >
            <Star size={18} />
            Celebrity-Inspired
          </button>
          {/* Full Pipeline tab hidden — redundant with Regional & Celebrity tabs */}
        </div>
      </div>

      {/* Content based on active tab */}
      {activeTab === 'pipeline' ? (
        /* FULL PIPELINE TAB — End-to-end AI orchestration */
        <>
          <div className="neumorphic-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <Rocket size={24} className="text-pastel-accent" />
              <div>
                <h3 className="text-lg font-semibold text-pastel-navy">Full AI Pipeline</h3>
                <p className="text-sm text-pastel-text-light">
                  End-to-end: Trends → Collection → Images → Ad Video in one run
                </p>
              </div>
            </div>

            {/* Trend Source Toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setConfig(prev => ({ ...prev, trendSource: 'regional' }))}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  config.trendSource === 'regional'
                    ? 'neumorphic-pressed text-pastel-accent'
                    : 'text-pastel-text hover:neumorphic-sm'
                }`}
              >
                <Globe size={16} />
                Regional Trends
              </button>
              <button
                onClick={() => setConfig(prev => ({ ...prev, trendSource: 'celebrity' }))}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                  config.trendSource === 'celebrity'
                    ? 'neumorphic-pressed text-pastel-accent'
                    : 'text-pastel-text hover:neumorphic-sm'
                }`}
              >
                <Star size={16} />
                Celebrity Trends
              </button>
            </div>

            {/* Pipeline config summary */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="neumorphic-sm p-3 rounded-xl">
                <p className="text-xs text-pastel-muted mb-1">Season</p>
                <p className="text-sm font-medium text-pastel-navy">
                  {SEASONS.find(s => s.id === config.season)?.name || config.season}
                </p>
              </div>
              <div className="neumorphic-sm p-3 rounded-xl">
                <p className="text-xs text-pastel-muted mb-1">Region</p>
                <p className="text-sm font-medium text-pastel-navy">
                  {REGIONS.find(r => r.id === config.region)?.name || config.region}
                </p>
              </div>
              <div className="neumorphic-sm p-3 rounded-xl">
                <p className="text-xs text-pastel-muted mb-1">Demographic</p>
                <p className="text-sm font-medium text-pastel-navy">
                  {DEMOGRAPHICS.find(d => d.id === config.demographic)?.name || config.demographic}
                </p>
              </div>
              <div className="neumorphic-sm p-3 rounded-xl">
                <p className="text-xs text-pastel-muted mb-1">Products</p>
                <p className="text-sm font-medium text-pastel-navy">{totalProducts} items</p>
              </div>
            </div>

            <p className="text-xs text-pastel-muted mb-4">
              Configure settings in the Regional or Celebrity tab, then run the full pipeline here.
            </p>

            <PipelineRunner
              config={{
                brand_id: brandId || '',
                season: SEASONS.find(s => s.id === config.season)?.name || config.season,
                region: REGIONS.find(r => r.id === config.region)?.name || config.region,
                demographic: DEMOGRAPHICS.find(d => d.id === config.demographic)?.name || config.demographic,
                categories: Object.entries(config.categories)
                  .filter(([, v]) => v)
                  .map(([k]) => k),
                product_count: totalProducts,
                trend_source: config.trendSource,
                generate_ad_video: true,
              } satisfies PipelineConfig}
              disabled={totalProducts === 0}
              onComplete={onPipelineComplete}
            />
          </div>
        </>
      ) : activeTab === 'regional' ? (
        /* ORIGINAL REGIONAL LAYOUT - 2 column grid as in original CollectionPlanner */
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Target Region */}
            <div className="neumorphic-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="text-pastel-teal" size={20} />
                <h3 className="text-lg font-semibold text-pastel-navy">Target Region</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {REGIONS.map(region => (
                  <button
                    key={region.id}
                    onClick={() => setConfig({ ...config, region: region.id })}
                    className={`p-3 rounded-xl text-left transition-all ${
                      config.region === region.id
                        ? 'neumorphic-inset text-pastel-navy'
                        : 'neumorphic-sm text-pastel-text-light hover:shadow-neumorphic'
                    }`}
                  >
                    <span className="text-lg mr-2">{getFlagEmoji(region.flag)}</span>
                    <span className="text-sm">{region.name}</span>
                  </button>
                ))}
                <button
                  onClick={() => setConfig({ ...config, region: 'custom' })}
                  className={`p-3 rounded-xl text-left transition-all ${
                    config.region === 'custom'
                      ? 'neumorphic-inset text-pastel-navy'
                      : 'neumorphic-sm text-pastel-text-light hover:shadow-neumorphic'
                  }`}
                >
                  <span className="text-sm">Custom Region</span>
                </button>
              </div>
              {config.region === 'custom' && (
                <input
                  type="text"
                  value={customRegion}
                  onChange={(e) => setCustomRegion(e.target.value)}
                  placeholder="Enter custom region (e.g., Dubai, UAE)"
                  className="w-full input-neumorphic px-4 py-3 text-pastel-navy"
                />
              )}
            </div>

            {/* Season */}
            <div className="neumorphic-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="text-amber-500" size={20} />
                <h3 className="text-lg font-semibold text-pastel-navy">Season</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {SEASONS.map(season => (
                  <button
                    key={season.id}
                    onClick={() => setConfig({ ...config, season: season.id })}
                    className={`p-3 rounded-xl text-left transition-all ${
                      config.season === season.id
                        ? 'neumorphic-inset text-pastel-navy'
                        : 'neumorphic-sm text-pastel-text-light hover:shadow-neumorphic'
                    }`}
                  >
                    <span className="text-sm font-medium">{season.name}</span>
                  </button>
                ))}
                <button
                  onClick={() => setConfig({ ...config, season: 'custom' })}
                  className={`p-3 rounded-xl text-left transition-all ${
                    config.season === 'custom'
                      ? 'neumorphic-inset text-pastel-navy'
                      : 'neumorphic-sm text-pastel-text-light hover:shadow-neumorphic'
                  }`}
                >
                  <span className="text-sm font-medium">Custom Season</span>
                </button>
              </div>
              {config.season === 'custom' && (
                <input
                  type="text"
                  value={customSeason}
                  onChange={(e) => setCustomSeason(e.target.value)}
                  placeholder="Enter custom season (e.g., Holiday 2025, Resort 2026)"
                  className="w-full input-neumorphic px-4 py-3 text-pastel-navy"
                />
              )}
            </div>

            {/* Target Demographic */}
            <div className="neumorphic-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="text-pastel-accent" size={20} />
                <h3 className="text-lg font-semibold text-pastel-navy">Target Demographic</h3>
              </div>
              <div className="space-y-2 mb-3">
                {DEMOGRAPHICS.map(demo => (
                  <button
                    key={demo.id}
                    onClick={() => setConfig({ ...config, demographic: demo.id })}
                    className={`w-full p-3 rounded-xl text-left transition-all ${
                      config.demographic === demo.id
                        ? 'neumorphic-inset'
                        : 'neumorphic-sm hover:shadow-neumorphic'
                    }`}
                  >
                    <p className={`font-medium ${config.demographic === demo.id ? 'text-pastel-navy' : 'text-pastel-text-light'}`}>
                      {demo.name}
                    </p>
                    <p className="text-xs text-pastel-muted">{demo.description}</p>
                  </button>
                ))}
                <button
                  onClick={() => setConfig({ ...config, demographic: 'custom' })}
                  className={`w-full p-3 rounded-xl text-left transition-all ${
                    config.demographic === 'custom'
                      ? 'neumorphic-inset'
                      : 'neumorphic-sm hover:shadow-neumorphic'
                  }`}
                >
                  <p className={`font-medium ${config.demographic === 'custom' ? 'text-pastel-navy' : 'text-pastel-text-light'}`}>
                    Custom Demographic
                  </p>
                  <p className="text-xs text-pastel-muted">Define your own target audience</p>
                </button>
              </div>
              {config.demographic === 'custom' && (
                <input
                  type="text"
                  value={customDemographic}
                  onChange={(e) => setCustomDemographic(e.target.value)}
                  placeholder="Enter custom demographic (e.g., Young Professionals 30-40)"
                  className="w-full input-neumorphic px-4 py-3 text-pastel-navy"
                />
              )}
            </div>

            {/* Product Categories */}
            <div className="neumorphic-card p-6">
              <h3 className="text-lg font-semibold text-pastel-navy mb-4">Product Categories</h3>
              <div className="space-y-4">
                <CategoryToggle
                  icon={<Shirt size={20} />}
                  label="Apparel"
                  description="Jackets, shirts, pants, dresses"
                  enabled={config.categories.apparel}
                  count={config.productCount.apparel}
                  onToggle={() => setConfig({
                    ...config,
                    categories: { ...config.categories, apparel: !config.categories.apparel }
                  })}
                  onCountChange={(count) => setConfig({
                    ...config,
                    productCount: { ...config.productCount, apparel: count }
                  })}
                  color="emerald"
                />
                <CategoryToggle
                  icon={<Footprints size={20} />}
                  label="Footwear"
                  description="Sneakers, boots, sandals"
                  enabled={config.categories.footwear}
                  count={config.productCount.footwear}
                  onToggle={() => setConfig({
                    ...config,
                    categories: { ...config.categories, footwear: !config.categories.footwear }
                  })}
                  onCountChange={(count) => setConfig({
                    ...config,
                    productCount: { ...config.productCount, footwear: count }
                  })}
                  color="blue"
                />
                <CategoryToggle
                  icon={<Watch size={20} />}
                  label="Accessories"
                  description="Hats, belts, bags, jewelry"
                  enabled={config.categories.accessories}
                  count={config.productCount.accessories}
                  onToggle={() => setConfig({
                    ...config,
                    categories: { ...config.categories, accessories: !config.categories.accessories }
                  })}
                  onCountChange={(count) => setConfig({
                    ...config,
                    productCount: { ...config.productCount, accessories: count }
                  })}
                  color="amber"
                />
              </div>
            </div>
          </div>

          {/* Collection Summary for Regional */}
          <div className="neumorphic-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-pastel-navy">Collection Summary</h3>
                <p className="text-sm text-pastel-muted">
                  {totalProducts} products will be generated
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-pastel-navy">{totalProducts}</p>
                <p className="text-xs text-pastel-muted">Total Items</p>
              </div>
            </div>

            <div className="mb-4">
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                placeholder="Collection name (required)"
                className={`w-full input-neumorphic px-4 py-3 text-pastel-navy ${!config.name.trim() ? 'ring-2 ring-red-300/50' : ''}`}
              />
              {!config.name.trim() && (
                <p className="text-xs text-red-400 mt-1 ml-1">Please enter a collection name to continue</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={
                loading ||
                totalProducts === 0 ||
                !config.name.trim() ||
                (config.region === 'custom' && !customRegion.trim()) ||
                (config.season === 'custom' && !customSeason.trim()) ||
                (config.demographic === 'custom' && !customDemographic.trim())
              }
              className="w-full py-4 px-6 btn-navy text-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={24} />
                  Generating Collection...
                </>
              ) : (
                <>
                  <Sparkles size={24} />
                  Generate Regional Collection
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        /* CELEBRITY TAB - Unique Layout with Celebrity Images and Info */
        <>
          <div className="neumorphic-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <Star size={24} className="text-amber-500" />
              <div>
                <h3 className="text-lg font-semibold text-pastel-navy">Celebrity Fashion Analysis</h3>
                <p className="text-sm text-pastel-text-light">
                  Collection inspired by top 10 most influential US celebrities (2020-2025)
                </p>
              </div>
            </div>

            {/* Celebrity Preview Grid */}
            <div className="neumorphic-inset p-6 rounded-xl mb-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-pastel-navy font-semibold">Featured Celebrities</p>
                {onFetchCelebrityInsights && (
                  <button
                    onClick={() => {
                      setLoadingCelebrities(true);
                      setCelebrityError('');
                      onFetchCelebrityInsights()
                        .then(fetchedCelebrities => {
                          if (fetchedCelebrities && fetchedCelebrities.length > 0) {
                            setCelebrities(fetchedCelebrities);
                          } else {
                            setCelebrityError('No celebrity data received from Gemini API. The API might be unavailable or returned empty results.');
                          }
                        })
                        .catch(error => {
                          console.error('Failed to fetch celebrity insights:', error);
                          setCelebrityError(`Failed to load celebrity data: ${error.message || 'Unknown error occurred'}. Please check your Gemini API key and try again.`);
                        })
                        .finally(() => {
                          setLoadingCelebrities(false);
                        });
                    }}
                    disabled={loadingCelebrities}
                    className="text-xs text-pastel-accent hover:text-pastel-navy transition-colors flex items-center gap-1"
                  >
                    <RefreshCw size={12} className={loadingCelebrities ? 'animate-spin' : ''} />
                    {loadingCelebrities ? 'Loading...' : celebrities.length > 0 ? 'Refresh' : 'Load Celebrities'}
                  </button>
                )}
              </div>

              {loadingCelebrities ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Loader className="animate-spin text-pastel-accent" size={32} />
                  <p className="text-xs text-pastel-muted">Fetching celebrity data from Gemini API...</p>
                </div>
              ) : celebrityError ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                    <span className="text-red-500 text-xl">⚠️</span>
                  </div>
                  <p className="text-sm text-red-600 text-center max-w-md">{celebrityError}</p>
                  {onFetchCelebrityInsights && (
                    <button
                      onClick={() => {
                        setLoadingCelebrities(true);
                        setCelebrityError('');
                        onFetchCelebrityInsights()
                          .then(fetchedCelebrities => {
                            if (fetchedCelebrities && fetchedCelebrities.length > 0) {
                              setCelebrities(fetchedCelebrities);
                            } else {
                              setCelebrityError('No celebrity data received from Gemini API. The API might be unavailable or returned empty results.');
                            }
                          })
                          .catch(error => {
                            setCelebrityError(`Failed to load celebrity data: ${error.message || 'Unknown error occurred'}. Please check your Gemini API key and try again.`);
                          })
                          .finally(() => {
                            setLoadingCelebrities(false);
                          });
                      }}
                      className="mt-2 text-xs text-pastel-accent hover:text-pastel-navy transition-colors"
                    >
                      Try Again
                    </button>
                  )}
                </div>
              ) : celebrities.length > 0 ? (
                <div className="grid grid-cols-5 gap-4">
                  {celebrities.slice(0, 10).map((celeb, idx) => {
                    // Map profession to emoji
                    const professionEmoji: Record<string, string> = {
                      'Music': '🎵',
                      'Film': '🎬',
                      'Fashion': '👗',
                      'Sports': '🏀',
                      'TV': '📺',
                      'Social Media': '📱',
                      'Art': '🎨',
                      'Comedy': '🎭'
                    };

                    return (
                      <div key={idx} className="text-center">
                        <div className="w-16 h-16 rounded-full neumorphic-sm mx-auto mb-2 flex items-center justify-center bg-gradient-to-br from-pastel-card to-white text-2xl relative">
                          {professionEmoji[celeb.profession] || '⭐'}
                          {celeb.influence_score && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-pastel-accent rounded-full flex items-center justify-center text-xs text-white font-bold">
                              {idx + 1}
                            </div>
                          )}
                        </div>
                        <p className="text-xs font-medium text-pastel-navy truncate">{celeb.name}</p>
                        <p className="text-xs text-pastel-muted truncate">{celeb.signature_style || celeb.profession}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="w-12 h-12 rounded-full bg-pastel-accent/10 flex items-center justify-center">
                    <Star className="text-pastel-accent" size={24} />
                  </div>
                  <p className="text-sm text-pastel-text text-center">No celebrity data loaded yet</p>
                  <p className="text-xs text-pastel-muted text-center max-w-md">
                    Click "Load Celebrities" above to fetch trending celebrity fashion data from Gemini API
                  </p>
                </div>
              )}

              <p className="text-xs text-pastel-muted text-center mt-4">
                {celebrities.length > 0
                  ? `✅ Successfully loaded ${Math.min(10, celebrities.length)} trending celebrities from Gemini API`
                  : celebrityError
                    ? '❌ Failed to load celebrity data - see error message above'
                    : '⚡ Ready to load real-time celebrity fashion data'
                }
              </p>
            </div>

            {/* Fashion Elements Preview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="neumorphic-sm p-4 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                  <p className="text-sm font-semibold text-pastel-navy">Celebrity Colors</p>
                </div>
                <div className="flex gap-2 mt-2">
                  {celebrityColors.length > 0 ? (
                    celebrityColors.map((color, idx) => (
                      <div
                        key={idx}
                        className="w-8 h-8 rounded"
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))
                  ) : (
                    <p className="text-xs text-pastel-muted">Loading colors...</p>
                  )}
                </div>
              </div>
              <div className="neumorphic-sm p-4 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-amber-400 rounded-full"></div>
                  <p className="text-sm font-semibold text-pastel-navy">Signature Styles</p>
                </div>
                <p className="text-xs text-pastel-text-light">Streetwear Luxe • Athleisure • Red Carpet Glam • Y2K Revival</p>
              </div>
              <div className="neumorphic-sm p-4 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
                  <p className="text-sm font-semibold text-pastel-navy">Luxury Materials</p>
                </div>
                <p className="text-xs text-pastel-text-light">Italian Leather • Silk • Cashmere • Sequins • Denim</p>
              </div>
            </div>

            {/* Target Demographic for Celebrity */}
            <div className="mb-6">
              <p className="text-sm font-semibold text-pastel-navy mb-3">Target Audience</p>
              <div className="grid grid-cols-2 gap-3">
                {DEMOGRAPHICS.map(demo => (
                  <button
                    key={demo.id}
                    onClick={() => setConfig({ ...config, demographic: demo.id })}
                    className={`p-3 rounded-xl text-left transition-all ${
                      config.demographic === demo.id
                        ? 'neumorphic-inset'
                        : 'neumorphic-sm hover:shadow-neumorphic'
                    }`}
                  >
                    <p className={`text-sm font-medium ${config.demographic === demo.id ? 'text-pastel-navy' : 'text-pastel-text-light'}`}>
                      {demo.name}
                    </p>
                    <p className="text-xs text-pastel-muted">{demo.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Product Categories for Celebrity */}
            <div>
              <p className="text-sm font-semibold text-pastel-navy mb-3">Product Selection</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <CategoryToggle
                  icon={<Shirt size={20} />}
                  label="Celebrity Apparel"
                  description="Star-inspired clothing"
                  enabled={config.categories.apparel}
                  count={config.productCount.apparel}
                  onToggle={() => setConfig({
                    ...config,
                    categories: { ...config.categories, apparel: !config.categories.apparel }
                  })}
                  onCountChange={(count) => setConfig({
                    ...config,
                    productCount: { ...config.productCount, apparel: count }
                  })}
                  color="emerald"
                />
                <CategoryToggle
                  icon={<Footprints size={20} />}
                  label="Celebrity Footwear"
                  description="Iconic shoe styles"
                  enabled={config.categories.footwear}
                  count={config.productCount.footwear}
                  onToggle={() => setConfig({
                    ...config,
                    categories: { ...config.categories, footwear: !config.categories.footwear }
                  })}
                  onCountChange={(count) => setConfig({
                    ...config,
                    productCount: { ...config.productCount, footwear: count }
                  })}
                  color="blue"
                />
                <CategoryToggle
                  icon={<Watch size={20} />}
                  label="Celebrity Accessories"
                  description="Statement pieces"
                  enabled={config.categories.accessories}
                  count={config.productCount.accessories}
                  onToggle={() => setConfig({
                    ...config,
                    categories: { ...config.categories, accessories: !config.categories.accessories }
                  })}
                  onCountChange={(count) => setConfig({
                    ...config,
                    productCount: { ...config.productCount, accessories: count }
                  })}
                  color="amber"
                />
              </div>
            </div>
          </div>

          {/* Collection Summary for Celebrity */}
          <div className="neumorphic-card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-pastel-navy">Celebrity Collection</h3>
                <p className="text-sm text-pastel-muted">
                  {totalProducts} celebrity-inspired products
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-pastel-navy">{totalProducts}</p>
                <p className="text-xs text-pastel-muted">Star Items</p>
              </div>
            </div>

            <div className="mb-4">
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                placeholder="Celebrity collection name (required)"
                className={`w-full input-neumorphic px-4 py-3 text-pastel-navy ${!config.name.trim() ? 'ring-2 ring-red-300/50' : ''}`}
              />
              {!config.name.trim() && (
                <p className="text-xs text-red-400 mt-1 ml-1">Please enter a collection name to continue</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || totalProducts === 0 || !config.name.trim()}
              className="w-full py-4 px-6 btn-navy text-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader className="animate-spin" size={24} />
                  Creating Celebrity Collection...
                </>
              ) : (
                <>
                  <Star size={24} />
                  Generate Celebrity Collection
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface CategoryToggleProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  count: number;
  onToggle: () => void;
  onCountChange: (count: number) => void;
  color: 'emerald' | 'blue' | 'amber';
}

function CategoryToggle({
  icon,
  label,
  description,
  enabled,
  count,
  onToggle,
  onCountChange,
  color,
}: CategoryToggleProps) {
  const colorClasses = {
    emerald: 'text-emerald-500',
    blue: 'text-pastel-accent',
    amber: 'text-amber-500',
  };

  return (
    <div className={`p-4 rounded-xl transition-all ${
      enabled ? 'neumorphic-inset' : 'neumorphic-sm'
    }`}>
      <div className="flex items-center justify-between">
        <button onClick={onToggle} className="flex items-center gap-3 flex-1">
          <div className={enabled ? colorClasses[color] : 'text-pastel-muted'}>{icon}</div>
          <div className="text-left">
            <p className={`font-medium ${enabled ? 'text-pastel-navy' : 'text-pastel-muted'}`}>{label}</p>
            <p className="text-xs text-pastel-muted">{description}</p>
          </div>
        </button>
        {enabled && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onCountChange(Math.max(1, count - 1))}
              className="w-8 h-8 rounded-lg neumorphic-sm text-pastel-navy hover:shadow-neumorphic transition-all"
            >
              -
            </button>
            <span className="w-8 text-center text-pastel-navy font-medium">{count}</span>
            <button
              onClick={() => onCountChange(Math.min(10, count + 1))}
              className="w-8 h-8 rounded-lg neumorphic-sm text-pastel-navy hover:shadow-neumorphic transition-all"
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}