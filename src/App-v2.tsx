import { useState, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import { Sidebar, type View } from './components/layout';
import { Dashboard } from './components/dashboard';
import { BrandStyleView } from './components/brand-editor/BrandStyleView';
import { ValidationDemo } from './components/brand-guardian';
import { CollectionPlanner, ProductGallery, ProductDetailModal, CollectionLibrary, type CollectionConfig } from './components/collection';
import { TrendInsightsView } from './components/trends';
import { Settings } from './components/settings';
import { ProgressBar, ProductGallerySkeleton } from './components/ui';
import { RedisHealthCheck } from './components/dashboard/RedisHealthCheck';
import { useAuth } from './contexts/AuthContext';
import { AuthPage } from './components/auth';
import { LandingPage } from './components/landing';
import type { BrandStyleJSON, Collection, CollectionItem } from './types/database';
import {
  CollectionGeneratorV2,
  type GenerationProgress,
  CollectionGeneratorError,
} from './services/collection-generator-v2';
import {
  brandStorage,
  brandStyleStorage,
  collectionItemStorage,
  collectionStorage,
} from './services/db-storage';
import { DEFAULT_BRAND_STYLE } from './lib/defaults';
import { fetchCelebrities as apiFetchCelebrities, generateLookbook } from './lib/api-client';
import type { PipelineResult } from './lib/api-client';
import { VoiceCompanion } from './components/voice/VoiceCompanion';
import { uploadProductImage, isSupabaseStorageUrl, needsMigration } from './lib/image-storage';
import { supabase as supabaseClient } from './lib/supabase';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [brandId, setBrandId] = useState<string>('');
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [initialDetailTab, setInitialDetailTab] = useState<'overview' | 'fibo' | 'validation' | 'techpack' | 'design' | 'video'>('overview');
  const [exportingLookbook, setExportingLookbook] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<Collection | null>(null);

  const initializeBrand = useCallback(async () => {
    if (!user) return;

    try {
      const userBrands = await brandStorage.getByUserId(user.id);
      let brand = userBrands[0];

      if (!brand) {
        brand = await brandStorage.create({
          user_id: user.id,
          name: 'My Brand',
          description: 'My fashion brand on TrendSync Brand Factory',
          logo_url: null,
        });
        await brandStyleStorage.save(brand.id, DEFAULT_BRAND_STYLE, user.id);
        toast.success('Brand created!', { description: 'You can now start designing collections.' });
      }

      setBrandId(brand.id);

      const allCollections = await collectionStorage.getByBrandId(brand.id);
      if (allCollections.length > 0) {
        const latestCollection = allCollections[0];
        setActiveCollectionId(latestCollection.id);
        setActiveCollection(latestCollection);
        const loadedItems = await collectionItemStorage.getByCollectionId(latestCollection.id);
        const successfulItems = loadedItems.filter(item => item.status === 'complete');
        setItems(successfulItems);
      }
    } catch (error) {
      console.error('Failed to initialize brand:', error);
      toast.error('Failed to load brand data');
    } finally {
      setAppReady(true);
    }
  }, [user]);

  useEffect(() => {
    if (user && !authLoading) {
      initializeBrand();
    }
  }, [user, authLoading, initializeBrand]);

  // Items are refreshed on modal close (onClose callback) — no polling needed.
  // Polling was causing unsaved in-memory edits (from voice/design agent) to revert.

  if (authLoading) {
    return (
      <div className="min-h-screen pastel-gradient flex items-center justify-center">
        <div className="neumorphic-card p-8 text-center">
          <div className="w-16 h-16 circular-icon flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-2xl font-bold text-pastel-navy">TS</span>
          </div>
          <p className="text-pastel-text-light">Loading TrendSync Brand Factory...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (showLanding) {
      return <LandingPage onGetStarted={() => setShowLanding(false)} />;
    }
    return <AuthPage />;
  }

  if (!appReady) {
    return (
      <div className="min-h-screen pastel-gradient flex items-center justify-center">
        <div className="neumorphic-card p-8 text-center">
          <div className="w-16 h-16 circular-icon flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-2xl font-bold text-pastel-navy">TS</span>
          </div>
          <p className="text-pastel-text-light">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  const handleSaveBrandStyle = async (styleJson: BrandStyleJSON) => {
    if (!brandId || !user) {
      toast.error('No brand selected');
      return;
    }
    try {
      await brandStyleStorage.save(brandId, styleJson, user.id);
      toast.success('Brand style saved successfully!');
    } catch (error) {
      toast.error('Failed to save brand style', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleGenerateCollection = async (config: CollectionConfig) => {
    if (!brandId || !user) {
      toast.error('Brand not initialized');
      return;
    }

    const briaApiKey = import.meta.env.VITE_BRIA_API_KEY;
    if (!briaApiKey) {
      toast.error('Bria API key not configured', { description: 'Please add VITE_BRIA_API_KEY to your .env file' });
      return;
    }

    setItems([]);
    setGenerating(true);
    const toastId = toast.loading('Starting collection generation...');

    try {
      const generator = new CollectionGeneratorV2(
        briaApiKey,
        (progress) => {
          setGenerationProgress(progress);
          if (progress.message) toast.loading(progress.message, { id: toastId });
        }
      );

      const result = await generator.generateCollection(config, brandId);

      setActiveCollectionId(result.collectionId);
      const generatedItems = await collectionItemStorage.getByCollectionId(result.collectionId);
      setItems(generatedItems);

      if (result.stats.failed === 0) {
        toast.success('Collection generated successfully!', {
          id: toastId,
          description: `Created ${result.stats.successful} products with brand validation.`,
        });
      } else if (result.stats.successful > 0) {
        toast.warning('Collection partially generated', {
          id: toastId,
          description: `${result.stats.successful} succeeded, ${result.stats.failed} failed.`,
        });
      } else {
        toast.error('Collection generation failed', { id: toastId, description: 'All products failed to generate images.' });
      }
    } catch (error) {
      console.error('Failed to generate collection:', error);
      if (error instanceof CollectionGeneratorError) {
        toast.error(`Failed at ${error.stage}`, {
          id: toastId,
          description: error.message,
          action: { label: 'Retry', onClick: () => handleGenerateCollection(config) },
        });
      } else {
        toast.error('Collection generation failed', {
          id: toastId,
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      }
    } finally {
      setGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handlePipelineComplete = async (result: PipelineResult) => {
    if (!brandId || !user) {
      toast.error('Brand not initialized');
      return;
    }

    const toastId = toast.loading('Saving collection to library...');

    try {
      // 1. Create the collection record
      const apparelCount = result.products.filter(p => !['footwear', 'accessories'].includes((p.category || '').toLowerCase())).length;
      const footwearCount = result.products.filter(p => (p.category || '').toLowerCase().includes('footwear')).length;
      const accessoriesCount = result.products.filter(p => (p.category || '').toLowerCase().includes('accessor')).length;

      const collection = await collectionStorage.create({
        brand_id: brandId,
        name: result.collection_name || 'Pipeline Collection',
        season: result.season || '',
        region: result.region || '',
        target_demographic: result.demographic || '',
        status: 'complete',
        collection_plan_json: {
          productCount: {
            apparel: apparelCount,
            footwear: footwearCount,
            accessories: accessoriesCount,
          },
          heroItems: result.products.slice(0, 1).map(p => p.name),
          colorStory: result.products.map(p => p.color_story).filter(Boolean).join('; '),
          trendAlignment: result.trend_insights?.summary || '',
        },
        trend_insights_json: {
          colors: result.trend_insights?.colors?.map(c => ({
            name: c.name,
            hex: c.hex || '',
            confidence: 0.8,
            description: '',
          })) || [],
          materials: result.trend_insights?.materials?.map(m => ({
            name: m.name,
            confidence: 0.8,
            description: '',
          })) || [],
          silhouettes: result.trend_insights?.silhouettes?.map(s => ({
            name: s.name,
            confidence: 0.8,
            description: '',
          })) || [],
          themes: [],
          summary: result.trend_insights?.summary || '',
        },
      });

      // 2. Create collection items
      const itemsToCreate = result.products.map((p, i) => {
        const imgSrc = p.image_base64
          ? `data:image/png;base64,${p.image_base64}`
          : p.image_url;

        // Map pipeline category to DB category
        let category: 'apparel' | 'footwear' | 'accessories' = 'apparel';
        const cat = (p.category || '').toLowerCase();
        if (cat.includes('shoe') || cat.includes('boot') || cat.includes('sneaker') || cat.includes('footwear')) {
          category = 'footwear';
        } else if (cat.includes('accessor') || cat.includes('bag') || cat.includes('hat') || cat.includes('jewelry')) {
          category = 'accessories';
        }

        // Parse colors from color_story — extract hex codes
        const colorMatch = p.color_story?.match(/#[0-9A-Fa-f]{6}/g) || [];
        let colors = colorMatch.map((hex: string, ci: number) => ({
          name: ci === 0 ? 'Primary' : 'Secondary',
          hex,
          usage: ci === 0 ? 'primary' : 'accent',
        }));

        // Fallback: if no hex codes found in color_story, use trend insight colors
        if (colors.length === 0 && result.trend_insights?.colors?.length > 0) {
          const trendColors = result.trend_insights.colors.slice(0, 2);
          colors = trendColors.map((tc, ci) => ({
            name: tc.name || (ci === 0 ? 'Primary' : 'Secondary'),
            hex: tc.hex || '#808080',
            usage: ci === 0 ? 'primary' : 'accent',
          }));
        }

        return {
          collection_id: collection.id,
          sku: `PIPE-${Date.now()}-${i}`,
          name: p.name,
          category,
          subcategory: p.category || 'tops',
          design_story: p.description || '',
          target_persona: '',
          price_tier: 'mid' as const,
          design_spec_json: {
            silhouette: '',
            fit: '',
            colors,
            materials: [{ name: p.material || '', placement: 'primary' }],
            details: [],
            inspiration: p.color_story || '',
          },
          fibo_prompt_json: {
            positive: p.description || '',
            negative: '',
            seed: Math.floor(Math.random() * 999999),
            steps: 30,
            guidance: 7.5,
          },
          brand_compliance_score: p.compliance_score ?? 0,
          status: 'complete' as const,
          image_url: imgSrc || null,
          video_url: null,
        };
      });

      // 2b. Upload images to Supabase Storage in parallel
      await Promise.all(
        itemsToCreate.map(async (item) => {
          if (item.image_url && !isSupabaseStorageUrl(item.image_url)) {
            const path = `collections/${collection.id}/${item.sku}`;
            const publicUrl = await uploadProductImage(item.image_url, path);
            if (publicUrl) {
              item.image_url = publicUrl;
            }
            // Falls back to original data URL if upload fails
          }
        })
      );

      const savedItems = await collectionItemStorage.createMany(itemsToCreate);

      // 3. Update React state to show gallery
      setActiveCollectionId(collection.id);
      setActiveCollection(collection);
      setItems(savedItems);

      toast.success(`Collection "${result.collection_name}" saved!`, {
        id: toastId,
        description: `${savedItems.length} products saved to library.`,
      });
    } catch (error) {
      console.error('Failed to save pipeline results:', error);
      toast.error('Failed to save collection', {
        id: toastId,
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleSelectItem = (item: CollectionItem) => {
    setSelectedItem(item);
    setInitialDetailTab('overview');
    setShowDetailModal(true);
  };

  const handleViewValidation = (item: CollectionItem) => {
    setSelectedItem(item);
    setInitialDetailTab('validation');
    setShowDetailModal(true);
  };

  const handleViewTechPack = (item: CollectionItem) => {
    setSelectedItem(item);
    setInitialDetailTab('techpack');
    setShowDetailModal(true);
  };

  const handleLoadCollection = async (collectionId: string, loadedItems: CollectionItem[]) => {
    setActiveCollectionId(collectionId);
    setItems(loadedItems);
    setCurrentView('collection');
    // Fetch full collection metadata for the gallery header
    try {
      const col = await collectionStorage.getById(collectionId);
      setActiveCollection(col);
    } catch {
      setActiveCollection(null);
    }
  };

  const handleDeleteCollectionItem = async (itemId: string) => {
    try {
      await collectionItemStorage.delete(itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      toast.success('Item deleted');
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error('Failed to delete item');
    }
  };

  const handleExportLookbook = async () => {
    if (items.length === 0) return;
    setExportingLookbook(true);
    try {
      const products = items.map(item => ({
        product: {
          name: item.name,
          sku: item.sku,
          category: item.category,
          subcategory: item.subcategory,
          price_tier: item.price_tier,
          target_persona: item.target_persona,
          description: item.design_story || '',
          material: item.design_spec_json?.materials?.map((m: { name?: string }) => typeof m === 'string' ? m : m.name).join(', ') || '',
          color_story: item.design_spec_json?.colors?.map((c: { name?: string; hex?: string }) => typeof c === 'string' ? c : `${c.name} (${c.hex})`).join(', ') || '',
        },
      }));

      const result = await generateLookbook({
        products,
        brand_name: 'TrendSync',
      });

      // Download the PDF
      const binaryString = atob(result.pdf_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lookbook-${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Lookbook exported with ${result.product_count} products!`);
    } catch (error) {
      console.error('Lookbook export failed:', error);
      toast.error('Failed to export lookbook');
    } finally {
      setExportingLookbook(false);
    }
  };

  const handleFetchCelebrityInsights = async () => {
    const res = await apiFetchCelebrities('millennials');
    return res.celebrities;
  };

  const renderContent = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentView} />;

      case 'brand-style':
        return (
          <BrandStyleView
            brandId={brandId}
            onSave={handleSaveBrandStyle}
          />
        );

      case 'brand-guardian':
        return <ValidationDemo />;

      case 'collection':
        return (
          <div className="space-y-8">
            <CollectionPlanner
              onGenerateCollection={handleGenerateCollection}
              onPipelineComplete={handlePipelineComplete}
              loading={generating}
              brandId={brandId}
              onFetchCelebrityInsights={handleFetchCelebrityInsights}
            />
            {generating && generationProgress && (
              <div className="neumorphic-card p-6">
                <h3 className="text-lg font-semibold text-pastel-navy mb-4">
                  {generationProgress.message || 'Generating collection...'}
                </h3>
                {generationProgress.stage === 'generating_images' && generationProgress.total && (
                  <ProgressBar current={generationProgress.current || 0} total={generationProgress.total} />
                )}
              </div>
            )}
            {generating && items.length === 0 ? (
              <ProductGallerySkeleton count={6} />
            ) : items.length > 0 ? (
              <ProductGallery
                items={items}
                collection={activeCollection}
                onSelectItem={handleSelectItem}
                onViewValidation={handleViewValidation}
                onViewTechPack={handleViewTechPack}
                onDeleteItem={handleDeleteCollectionItem}
                onExportLookbook={handleExportLookbook}
                exportingLookbook={exportingLookbook}
              />
            ) : null}
          </div>
        );

      case 'collection-library':
        return (
          <CollectionLibrary
            brandId={brandId}
            onLoadCollection={handleLoadCollection}
          />
        );

      case 'trends':
        return <TrendInsightsView />;

      case 'settings':
        return <Settings />;

      default:
        return <Dashboard onNavigate={setCurrentView} />;
    }
  };

  return (
    <div className="min-h-screen pastel-gradient relative overflow-hidden">
      <Toaster position="top-right" expand={true} richColors closeButton />
      <div className="absolute top-0 -left-40 w-96 h-96 bg-white/30 rounded-full mix-blend-normal filter blur-3xl opacity-50 animate-float-1" />
      <div className="absolute top-40 -right-40 w-96 h-96 bg-pastel-accent/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-2" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-pastel-teal/20 rounded-full mix-blend-normal filter blur-3xl opacity-40 animate-float-3" />
      <Sidebar currentView={currentView} onNavigate={setCurrentView} />
      <main className="relative ml-64 p-8 z-10">{renderContent()}</main>
      <ProductDetailModal
        item={selectedItem}
        isOpen={showDetailModal}
        brandId={brandId}
        initialTab={initialDetailTab}
        onItemUpdated={(updatedItem) => {
          // Update the item in the collection grid in real-time
          setItems(prev => prev.map(i =>
            i.id === updatedItem.id ? { ...i, ...updatedItem } : i
          ));
          // Also update selectedItem so the modal stays in sync
          setSelectedItem(prev => prev && prev.id === updatedItem.id ? { ...prev, ...updatedItem } : prev);
        }}
        onClose={async () => {
          setShowDetailModal(false);
          setSelectedItem(null);
          try {
            if (activeCollectionId) {
              const refreshedItems = await collectionItemStorage.getByCollectionId(activeCollectionId);
              const successfulItems = refreshedItems.filter(item => item.status === 'complete');
              setItems(successfulItems);
            }
          } catch (e) {
            // Silently fail
          }
        }}
      />
      <VoiceCompanion
        currentView={currentView}
        onNavigate={setCurrentView}
        brandName="My Brand"
        productItem={selectedItem}
        brandId={brandId}
        onUpdateItem={(updates) => {
          if (selectedItem) {
            setSelectedItem(prev => prev ? { ...prev, ...updates } : prev);
            setItems(prev => prev.map(i =>
              i.id === selectedItem.id ? { ...i, ...updates } : i
            ));
          }
        }}
      />
    </div>
  );
}

function App() {
  return <AppContent />;
}

// ── Migration utility (run via browser console: window.__migrateImages()) ──
async function migrateExistingImages() {
  console.log('[migrate] Starting image migration to Supabase Storage...');
  const { data: items, error } = await supabaseClient
    .from('collection_items')
    .select('id, sku, collection_id, image_url')
    .not('image_url', 'is', null);

  if (error || !items) {
    console.error('[migrate] Failed to fetch items:', error);
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    if (!item.image_url || isSupabaseStorageUrl(item.image_url)) {
      skipped++;
      continue;
    }
    if (!needsMigration(item.image_url)) {
      skipped++;
      continue;
    }

    const path = `collections/${item.collection_id}/${item.sku}`;
    const publicUrl = await uploadProductImage(item.image_url, path);
    if (publicUrl) {
      const { error: updateErr } = await supabaseClient
        .from('collection_items')
        .update({ image_url: publicUrl })
        .eq('id', item.id);
      if (updateErr) {
        console.warn(`[migrate] DB update failed for ${item.sku}:`, updateErr.message);
        failed++;
      } else {
        console.log(`[migrate] ✓ ${item.sku} → ${publicUrl}`);
        migrated++;
      }
    } else {
      console.warn(`[migrate] ✗ ${item.sku} — upload failed (likely 403 or broken URL)`);
      failed++;
    }
  }

  console.log(`[migrate] Done! Migrated: ${migrated}, Skipped: ${skipped}, Failed: ${failed}`);
}

(window as any).__migrateImages = migrateExistingImages;

export default App;
