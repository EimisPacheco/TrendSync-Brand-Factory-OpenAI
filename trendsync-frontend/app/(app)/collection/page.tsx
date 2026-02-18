"use client";

import { useState, useEffect, useCallback } from "react";
import { startCollectionGeneration, getCollection, listCollections } from "@/lib/api";
import type { CollectionItem } from "@/types/database";

const CATEGORIES = ["tops", "bottoms", "dresses", "outerwear", "accessories", "knitwear"];
const SEASONS = ["Spring 2025", "Summer 2025", "Fall 2025", "Winter 2025", "Resort 2026"];
const REGIONS = ["US", "EU", "UK", "Asia", "Global"];
const DEMOGRAPHICS = ["Gen Z", "Millennials", "Gen X", "Luxury", "Streetwear"];

export default function CollectionPage() {
  const [season, setSeason] = useState("Spring 2025");
  const [region, setRegion] = useState("Global");
  const [demographic, setDemographic] = useState("Millennials");
  const [trendSource, setTrendSource] = useState<"regional" | "celebrity">("regional");
  const [selectedCategories, setSelectedCategories] = useState(["tops", "bottoms", "dresses"]);
  const [productCount, setProductCount] = useState(6);
  const [generating, setGenerating] = useState(false);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [products, setProducts] = useState<CollectionItem[]>([]);
  const [collectionName, setCollectionName] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<CollectionItem | null>(null);

  // Poll for collection status
  useEffect(() => {
    if (!pollingId) return;
    const interval = setInterval(async () => {
      try {
        const data = await getCollection(pollingId) as Record<string, unknown>;
        const status = data.status as string;

        if (status === "complete") {
          setProducts((data.products as CollectionItem[]) || []);
          setCollectionName((data.name as string) || "");
          setGenerating(false);
          setPollingId(null);
          setStatusMessage("Collection ready!");
        } else if (status === "failed") {
          setGenerating(false);
          setPollingId(null);
          setStatusMessage(`Failed: ${data.error || "Unknown error"}`);
        } else {
          setStatusMessage((data.message as string) || `Status: ${status}`);
          setProgress({
            current: (data.current as number) || 0,
            total: (data.total as number) || 0,
          });
        }
      } catch {
        // Continue polling
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [pollingId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setProducts([]);
    setStatusMessage("Starting collection generation...");
    setProgress({ current: 0, total: 0 });

    try {
      const result = await startCollectionGeneration({
        brand_id: "default",
        season,
        region,
        demographic,
        categories: selectedCategories,
        product_count: productCount,
        trend_source: trendSource,
      });

      setPollingId(result.collection_id);
    } catch (e) {
      setGenerating(false);
      setStatusMessage(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--pastel-navy)" }}>Collection Planner</h1>
        <p style={{ color: "var(--pastel-text-light)" }}>
          Plan and generate fashion collections powered by Gemini 3 Pro with thinking levels.
        </p>
      </div>

      {/* Configuration */}
      <div className="neumorphic-card p-6">
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>Collection Setup</h2>

        {/* Trend source tabs */}
        <div className="flex gap-2 mb-6">
          {(["regional", "celebrity"] as const).map((src) => (
            <button
              key={src}
              onClick={() => setTrendSource(src)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                trendSource === src ? "neumorphic-inset" : "neumorphic-sm"
              }`}
              style={{ color: "var(--pastel-navy)" }}
            >
              {src === "regional" ? "📍 Regional Trends" : "⭐ Celebrity Trends"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="text-sm font-semibold block mb-1" style={{ color: "var(--pastel-navy)" }}>Season</label>
            <select value={season} onChange={(e) => setSeason(e.target.value)} className="input-neumorphic">
              {SEASONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1" style={{ color: "var(--pastel-navy)" }}>Region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)} className="input-neumorphic">
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-semibold block mb-1" style={{ color: "var(--pastel-navy)" }}>Demographic</label>
            <select value={demographic} onChange={(e) => setDemographic(e.target.value)} className="input-neumorphic">
              {DEMOGRAPHICS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {/* Categories */}
        <div className="mb-6">
          <label className="text-sm font-semibold block mb-2" style={{ color: "var(--pastel-navy)" }}>Categories</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedCategories.includes(cat)
                    ? "btn-navy"
                    : "neumorphic-sm"
                }`}
                style={!selectedCategories.includes(cat) ? { color: "var(--pastel-text-light)" } : {}}
              >
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Product count */}
        <div className="mb-6">
          <label className="text-sm font-semibold block mb-2" style={{ color: "var(--pastel-navy)" }}>
            Products: {productCount}
          </label>
          <input
            type="range"
            min={3}
            max={12}
            value={productCount}
            onChange={(e) => setProductCount(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={generating || selectedCategories.length === 0}
          className="btn-navy w-full py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? "Generating..." : "Generate Collection"}
        </button>
      </div>

      {/* Progress */}
      {generating && (
        <div className="neumorphic-card p-6">
          <p className="text-sm font-semibold mb-2" style={{ color: "var(--pastel-navy)" }}>
            {statusMessage}
          </p>
          {progress.total > 0 && (
            <div className="w-full neumorphic-inset rounded-full h-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  background: "linear-gradient(90deg, var(--pastel-teal), var(--pastel-accent))",
                }}
              />
            </div>
          )}
          {progress.total > 0 && (
            <p className="text-xs mt-2" style={{ color: "var(--pastel-muted)" }}>
              {progress.current} / {progress.total} products
            </p>
          )}
        </div>
      )}

      {/* Product Gallery */}
      {products.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4" style={{ color: "var(--pastel-navy)" }}>
            {collectionName || "Generated Collection"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((product) => (
              <div
                key={product.id || product.product_id}
                className="neumorphic-card overflow-hidden cursor-pointer transition-all hover:translate-y-[-2px]"
                onClick={() => setSelectedProduct(product)}
              >
                {product.image_url && (
                  <div className="aspect-square bg-gray-100 relative overflow-hidden">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-semibold text-sm" style={{ color: "var(--pastel-navy)" }}>
                    {product.name}
                  </h3>
                  <p className="text-xs mt-1" style={{ color: "var(--pastel-text-light)" }}>
                    {product.category} · {product.material}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--pastel-muted)" }}>
                    {product.target_price}
                  </p>
                  {product.validation && (
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor:
                            product.validation.compliance_score >= 75
                              ? "#10b981"
                              : product.validation.compliance_score >= 50
                              ? "#f59e0b"
                              : "#ef4444",
                        }}
                      />
                      <span className="text-xs font-medium" style={{ color: "var(--pastel-muted)" }}>
                        {product.validation.compliance_score}% compliant
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            className="neumorphic-card max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold" style={{ color: "var(--pastel-navy)" }}>
                  {selectedProduct.name}
                </h2>
                <p className="text-sm" style={{ color: "var(--pastel-text-light)" }}>
                  {selectedProduct.category} · {selectedProduct.material} · {selectedProduct.target_price}
                </p>
              </div>
              <button
                onClick={() => setSelectedProduct(null)}
                className="btn-soft text-sm px-3 py-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {selectedProduct.image_url && (
                <div className="aspect-square neumorphic-inset rounded-2xl overflow-hidden">
                  <img
                    src={selectedProduct.image_url}
                    alt={selectedProduct.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="space-y-4">
                <div className="neumorphic-inset p-4 rounded-xl">
                  <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--pastel-navy)" }}>Description</h3>
                  <p className="text-sm" style={{ color: "var(--pastel-text-light)" }}>{selectedProduct.description}</p>
                </div>
                <div className="neumorphic-inset p-4 rounded-xl">
                  <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--pastel-navy)" }}>Color Story</h3>
                  <p className="text-sm" style={{ color: "var(--pastel-text-light)" }}>{selectedProduct.color_story}</p>
                </div>
                {selectedProduct.validation && (
                  <div className="neumorphic-inset p-4 rounded-xl">
                    <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--pastel-navy)" }}>Brand Compliance</h3>
                    <div className="flex items-center gap-3">
                      <div className="text-2xl font-bold" style={{ color: "var(--pastel-navy)" }}>
                        {selectedProduct.validation.compliance_score}%
                      </div>
                      <div>
                        <p className="text-xs" style={{ color: "var(--pastel-text-light)" }}>
                          {selectedProduct.validation.violations.length} violations
                        </p>
                        <p className="text-xs" style={{ color: "var(--pastel-muted)" }}>
                          {selectedProduct.validation.auto_fixes_available} auto-fixes available
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {/* Ad Video button */}
                <button className="btn-navy w-full py-3 text-sm">
                  📹 Generate Ad Video
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
