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
import type { BrandStyleJSON, CollectionItem } from './types/database';
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
import { fetchCelebrities as apiFetchCelebrities } from './lib/api-client';
import { VoiceCompanion } from './components/voice/VoiceCompanion';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [brandId, setBrandId] = useState<string>('');
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [initialDetailTab, setInitialDetailTab] = useState<'overview' | 'fibo' | 'validation' | 'techpack' | 'design'>('overview');
  const [appReady, setAppReady] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!showDetailModal || !activeCollectionId) return;

    const interval = setInterval(async () => {
      try {
        const refreshedItems = await collectionItemStorage.getByCollectionId(activeCollectionId);
        const successfulItems = refreshedItems.filter(item => item.status === 'complete');
        setItems(successfulItems);
      } catch (e) {
        // Silently fail on poll
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [showDetailModal, activeCollectionId]);

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

  const handleLoadCollection = (collectionId: string, loadedItems: CollectionItem[]) => {
    setActiveCollectionId(collectionId);
    setItems(loadedItems);
    setCurrentView('collection');
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
              loading={generating}
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
                onSelectItem={handleSelectItem}
                onViewValidation={handleViewValidation}
                onViewTechPack={handleViewTechPack}
                onDeleteItem={handleDeleteCollectionItem}
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

export default App;
