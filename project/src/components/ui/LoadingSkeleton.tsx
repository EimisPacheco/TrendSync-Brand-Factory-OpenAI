export function ProductCardSkeleton() {
  return (
    <div className="neumorphic-card p-4 animate-pulse">
      <div className="w-full h-48 bg-pastel-muted/30 rounded-lg mb-4" />
      <div className="space-y-3">
        <div className="h-5 bg-pastel-muted/30 rounded w-3/4" />
        <div className="h-4 bg-pastel-muted/20 rounded w-1/2" />
        <div className="h-3 bg-pastel-muted/20 rounded w-2/3" />
        <div className="flex gap-2 mt-4">
          <div className="h-8 bg-pastel-muted/30 rounded w-20" />
          <div className="h-8 bg-pastel-muted/30 rounded w-24" />
        </div>
      </div>
    </div>
  );
}

export function ProductGallerySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function TrendCardSkeleton() {
  return (
    <div className="neumorphic-card p-6 animate-pulse">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 bg-pastel-muted/30 rounded-full" />
        <div className="flex-1">
          <div className="h-5 bg-pastel-muted/30 rounded w-32 mb-2" />
          <div className="h-3 bg-pastel-muted/20 rounded w-24" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-pastel-muted/20 rounded w-full" />
        <div className="h-3 bg-pastel-muted/20 rounded w-5/6" />
      </div>
    </div>
  );
}

export function CollectionPlannerSkeleton() {
  return (
    <div className="neumorphic-card p-8 animate-pulse">
      <div className="h-8 bg-pastel-muted/30 rounded w-48 mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <div className="h-5 bg-pastel-muted/30 rounded w-32 mb-3" />
          <div className="h-12 bg-pastel-muted/20 rounded" />
        </div>
        <div>
          <div className="h-5 bg-pastel-muted/30 rounded w-32 mb-3" />
          <div className="h-12 bg-pastel-muted/20 rounded" />
        </div>
      </div>
      <div className="h-12 bg-pastel-muted/30 rounded w-40" />
    </div>
  );
}

export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-8 h-8 border-3',
    lg: 'w-12 h-12 border-4'
  };

  return (
    <div
      className={`${sizeClasses[size]} border-pastel-accent border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function ProgressBar({ current, total, className = '' }: { current: number; total: number; className?: string }) {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));

  return (
    <div className={`w-full ${className}`}>
      <div className="flex justify-between text-sm text-pastel-text-light mb-2">
        <span>{current} of {total}</span>
        <span>{Math.round(percentage)}%</span>
      </div>
      <div className="w-full h-2 bg-pastel-muted/30 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-pastel-accent to-pastel-teal transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function LoadingOverlay({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="neumorphic-card p-8 max-w-sm w-full mx-4 text-center">
        <Spinner size="lg" className="mx-auto mb-4" />
        <p className="text-lg font-semibold text-pastel-navy">{message}</p>
      </div>
    </div>
  );
}
