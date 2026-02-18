import { useState, useEffect } from 'react';
import { Search, Trash2, Calendar, MapPin, Users, Layers, Loader2, FolderOpen } from 'lucide-react';
import { collectionStorage, collectionItemStorage } from '../../services/db-storage';
import type { Collection, CollectionItem } from '../../types/database';
import { toast } from 'sonner';

interface CollectionLibraryProps {
  brandId: string;
  onLoadCollection: (collectionId: string, items: CollectionItem[]) => void;
}

export function CollectionLibrary({ brandId, onLoadCollection }: CollectionLibraryProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadCollections();
  }, [brandId]);

  const loadCollections = async () => {
    setLoading(true);
    try {
      const data = await collectionStorage.getByBrandId(brandId);
      setCollections(data);
    } catch (error) {
      console.error('Failed to load collections:', error);
      toast.error('Failed to load collections');
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (collection: Collection) => {
    setLoadingId(collection.id);
    try {
      const items = await collectionItemStorage.getByCollectionId(collection.id);
      const successfulItems = items.filter(item => item.status === 'complete');
      onLoadCollection(collection.id, successfulItems);
      toast.success(`Loaded "${collection.name}" with ${successfulItems.length} items`);
    } catch (error) {
      console.error('Failed to load collection items:', error);
      toast.error('Failed to load collection items');
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (collection: Collection) => {
    if (!window.confirm(`Delete "${collection.name}" and all its items? This cannot be undone.`)) return;

    try {
      await collectionStorage.delete(collection.id);
      setCollections(prev => prev.filter(c => c.id !== collection.id));
      toast.success(`Deleted "${collection.name}"`);
    } catch (error) {
      console.error('Failed to delete collection:', error);
      toast.error('Failed to delete collection');
    }
  };

  const filtered = collections.filter(c => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name?.toLowerCase().includes(q) ||
      c.region?.toLowerCase().includes(q) ||
      c.target_demographic?.toLowerCase().includes(q) ||
      c.season?.toLowerCase().includes(q)
    );
  });

  const getItemCount = (collection: Collection): number => {
    const plan = collection.collection_plan_json as any;
    if (!plan) return 0;
    const counts = plan.productCount || {};
    return (counts.apparel || 0) + (counts.footwear || 0) + (counts.accessories || 0);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 size={48} className="text-pastel-accent animate-spin mb-4" />
        <p className="text-pastel-text-light">Loading collections...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-pastel-navy">Collection Library</h2>
          <p className="text-pastel-text-light">
            {collections.length} saved collection{collections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-pastel-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, region, season..."
            className="w-full pl-10 pr-4 py-2 input-neumorphic rounded-lg text-sm"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="neumorphic-card p-12 text-center">
          <div className="circular-icon w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <FolderOpen size={32} className="text-pastel-muted" />
          </div>
          <p className="text-pastel-text">
            {searchQuery ? 'No collections match your search' : 'No collections yet'}
          </p>
          <p className="text-sm text-pastel-muted mt-1">
            {searchQuery ? 'Try a different search term' : 'Generate a collection to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(collection => {
            const plan = collection.collection_plan_json as any;
            const isCelebrity = plan?.trendSource === 'celebrity';
            const itemCount = getItemCount(collection);

            return (
              <div
                key={collection.id}
                className="neumorphic-card overflow-hidden group hover:shadow-neumorphic-lg transition-all duration-300"
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-pastel-navy text-lg truncate flex-1 mr-2">
                      {collection.name}
                    </h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(collection); }}
                      className="p-1.5 rounded-lg text-pastel-muted hover:text-red-500 hover:neumorphic-sm transition-all flex-shrink-0"
                      title="Delete collection"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="space-y-2 mb-4">
                    {collection.season && (
                      <div className="flex items-center gap-2 text-sm text-pastel-text-light">
                        <Calendar size={14} className="text-pastel-muted flex-shrink-0" />
                        <span className="capitalize">{collection.season}</span>
                      </div>
                    )}
                    {collection.region && (
                      <div className="flex items-center gap-2 text-sm text-pastel-text-light">
                        <MapPin size={14} className="text-pastel-muted flex-shrink-0" />
                        <span>{collection.region}</span>
                      </div>
                    )}
                    {collection.target_demographic && (
                      <div className="flex items-center gap-2 text-sm text-pastel-text-light">
                        <Users size={14} className="text-pastel-muted flex-shrink-0" />
                        <span className="capitalize">{collection.target_demographic}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-pastel-text-light">
                      <Layers size={14} className="text-pastel-muted flex-shrink-0" />
                      <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {isCelebrity && plan?.celebrity && (
                    <div className="mb-3 px-3 py-2 neumorphic-inset rounded-lg">
                      <p className="text-xs text-pastel-muted">Celebrity Inspiration</p>
                      <p className="text-sm font-medium text-pastel-navy">{plan.celebrity.name || 'Celebrity-inspired'}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className={`text-xs px-2 py-1 rounded-full neumorphic-inset ${
                      collection.status === 'complete'
                        ? 'text-emerald-600'
                        : collection.status === 'failed'
                        ? 'text-red-500'
                        : 'text-amber-600'
                    }`}>
                      {collection.status === 'complete' ? 'Complete' : collection.status === 'failed' ? 'Failed' : 'Generating'}
                    </span>
                    <span className="text-xs text-pastel-muted">
                      {formatDate(collection.created_at)}
                    </span>
                  </div>

                  <button
                    onClick={() => handleLoad(collection)}
                    disabled={loadingId === collection.id}
                    className="mt-4 w-full py-2 px-3 btn-navy text-sm flex items-center justify-center gap-2 rounded-lg disabled:opacity-50"
                  >
                    {loadingId === collection.id ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <FolderOpen size={16} />
                        Open Collection
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
