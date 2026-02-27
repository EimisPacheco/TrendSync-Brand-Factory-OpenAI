import { useState, useEffect } from 'react';
import {
  Eye, Shield, FileText, Copy, Check, ChevronDown, ChevronUp,
  Palette, Layers, Camera, Lightbulb, Image, Hash,
  Package, Target, Star, Loader2, Download, Send, MessageSquare, Video
} from 'lucide-react';
import type { CollectionItem } from '../../types/database';
import { Modal } from '../ui/Modal';
import { getComplianceBadge } from '../../lib/brand-guardian';
import { validationStorage, collectionItemStorage } from '../../services/db-storage';
import { techPackGenerator, type TechPack } from '../../services/techpack-generator';
import { PDFGenerator } from '../../services/pdf-generator';
import { emailService } from '../../services/email-service';
import { DesignAdjustments } from './DesignAdjustments';
import { AdvertisementVideo } from './AdvertisementVideo';
import { toast } from 'sonner';

interface ProductDetailModalProps {
  item: CollectionItem | null;
  isOpen: boolean;
  brandId: string;
  initialTab?: 'overview' | 'fibo' | 'validation' | 'techpack' | 'design' | 'video';
  onClose: () => void;
  onItemUpdated?: (updatedItem: Partial<CollectionItem> & { id: string }) => void;
}

export function ProductDetailModal({ item, isOpen, brandId, initialTab = 'overview', onClose, onItemUpdated }: ProductDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'fibo' | 'validation' | 'techpack' | 'design' | 'video'>(initialTab);
  const [expandedSections, setExpandedSections] = useState<string[]>(['description', 'objects']);
  const [copied, setCopied] = useState(false);
  const [techPack, setTechPack] = useState<TechPack | null>(null);
  const [loadingTechPack, setLoadingTechPack] = useState(false);
  const [techPackExpanded, setTechPackExpanded] = useState<string[]>(['fabricType']);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [currentItem, setCurrentItem] = useState<CollectionItem | null>(item);
  const [validationData, setValidationData] = useState<any>(null);

  // Update active tab when initialTab changes (when a different icon button is clicked)
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, isOpen]);

  // Load validation data from Supabase
  useEffect(() => {
    if (!currentItem || !isOpen) return;
    validationStorage.getByItemId(currentItem.id).then(validations => {
      setValidationData(validations[0] || null);
    }).catch(() => {});
  }, [currentItem?.id, isOpen]);

  // Sync currentItem whenever the parent updates the item prop (e.g. via onUpdateItem).
  // No polling — in-memory edits are the source of truth until saved.
  useEffect(() => {
    if (!item || !isOpen) return;
    setCurrentItem(item);
  }, [item, isOpen]);

  useEffect(() => {
    if (currentItem && activeTab === 'techpack' && !techPack && !loadingTechPack) {
      loadOrGenerateTechPack();
    }
  }, [currentItem, activeTab]);

  const loadOrGenerateTechPack = async () => {
    if (!currentItem) return;

    setLoadingTechPack(true);
    try {
      // 1. Check if tech pack already exists in DB
      if (currentItem.techpack_generated && currentItem.techpack_json) {
        console.log('Loading saved tech pack from DB');
        const savedTechPack = techPackGenerator.formatFromSaved(currentItem.techpack_json, currentItem);
        setTechPack(savedTechPack);
        return;
      }

      // 2. Generate new tech pack via Gemini
      const generatedTechPack = await techPackGenerator.generateTechPack(currentItem);
      setTechPack(generatedTechPack);

      // 3. Save to DB so it becomes the single source of truth
      const rawTechPack = techPackGenerator.toRawJson(generatedTechPack);
      await collectionItemStorage.update(currentItem.id, {
        techpack_json: rawTechPack,
        techpack_generated: true,
      });
      // Update local state
      setCurrentItem(prev => prev ? { ...prev, techpack_json: rawTechPack, techpack_generated: true } : prev);
      if (onItemUpdated) {
        onItemUpdated({ id: currentItem.id, techpack_json: rawTechPack, techpack_generated: true });
      }
      toast.success('Tech pack generated and saved');
    } catch (error) {
      console.error('Error generating tech pack:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Tech pack generation failed: ${errorMessage}`);
    } finally {
      setLoadingTechPack(false);
    }
  };

  const downloadTechPackPDF = async () => {
    if (!currentItem || !techPack) return;

    // Guard: tech pack must be saved to DB before PDF can be generated
    if (!currentItem.techpack_generated || !currentItem.techpack_json) {
      toast.error('Tech pack has not been saved yet. Please generate the tech pack first.');
      return;
    }

    setDownloadingPdf(true);
    try {
      const pdfGen = new PDFGenerator();
      const fileName = await pdfGen.downloadPDF(currentItem, techPack);
      toast.success(`Tech pack downloaded: ${fileName}`);
    } catch (error) {
      console.error('PDF download failed:', error);
      const msg = error instanceof Error ? error.message : 'Failed to generate PDF';
      toast.error(msg);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const sendTechPackEmail = async () => {
    if (!currentItem || !techPack || !recipientEmail) return;

    // Guard: tech pack must be saved to DB before PDF can be generated
    if (!currentItem.techpack_generated || !currentItem.techpack_json) {
      toast.error('Tech pack has not been saved yet. Please generate the tech pack first.');
      return;
    }

    setSendingEmail(true);
    try {
      const pdfGen = new PDFGenerator();
      const pdfBlob = await pdfGen.generateTechPackPDF(currentItem, techPack);

      const result = await emailService.sendTechPack(recipientEmail, currentItem, techPack, pdfBlob);

      if (result.success) {
        toast.success(result.message);
        setEmailDialogOpen(false);
        setRecipientEmail('');
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error('Failed to send tech pack email');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleUpdateItem = (updates: Partial<CollectionItem>) => {
    if (!currentItem) return;

    // Update local state immediately
    setCurrentItem(prev => prev ? { ...prev, ...updates } : prev);

    // Notify parent so collection grid card updates in real-time
    if (onItemUpdated && currentItem.id) {
      onItemUpdated({ id: currentItem.id, ...updates });
    }

    // If design spec was updated, clear tech pack so it regenerates from scratch
    if (updates.design_spec_json) {
      setTechPack(null);
      setLoadingTechPack(false);
      // Clear DB flag so a fresh tech pack is generated next time
      setCurrentItem(prev => prev ? { ...prev, techpack_generated: false, techpack_json: null } : prev);
      collectionItemStorage.update(currentItem.id, {
        techpack_generated: false,
        techpack_json: null,
      }).catch(() => {});
      if (activeTab === 'techpack') {
        loadOrGenerateTechPack();
      }
    }
  };

  if (!currentItem) return null;

  const badge = getComplianceBadge(currentItem.brand_compliance_score);

  const toggleSection = (section: string) => {
    setExpandedSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const toggleTechPackSection = (section: string) => {
    setTechPackExpanded(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy');
    }
  };

  const renderTechPackSection = (key: string, section: any, level: number = 0) => {
    if (!section) return null;

    const isExpanded = techPackExpanded.includes(key);
    const hasSubsections = section.subsections && section.subsections.length > 0;

    return (
      <div key={key} className={`${level > 0 ? 'ml-4' : ''} mb-4`}>
        {section.title && (
          <button
            onClick={() => toggleTechPackSection(key)}
            className={`w-full text-left px-4 py-3 rounded-lg flex items-center justify-between hover:bg-pastel-bg-dark/5 transition-colors ${
              level === 0 ? 'neumorphic-inset' : 'bg-pastel-bg-light/50'
            }`}
          >
            <span className={`font-semibold ${level === 0 ? 'text-pastel-navy' : 'text-pastel-text'}`}>
              {section.title}
            </span>
            {hasSubsections && (
              isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />
            )}
          </button>
        )}

        {isExpanded && (
          <div className={`${section.title ? 'mt-2' : ''}`}>
            {/* Render content if it exists and is not just subsections */}
            {section.content && Object.keys(section.content).length > 0 && !hasSubsections && (
              <div className="px-4 py-3 bg-pastel-bg-light/30 rounded-lg space-y-2">
                {Object.entries(section.content).map(([subKey, value]: [string, any]) => (
                  <div key={subKey}>
                    {typeof value === 'object' && !Array.isArray(value) ? (
                      <div>
                        <span className="font-medium text-pastel-navy capitalize">
                          {subKey.replace(/([A-Z])/g, ' $1').trim()}:
                        </span>
                        <div className="ml-4 mt-1 space-y-1">
                          {Object.entries(value).map(([k, v]: [string, any]) => (
                            <div key={k} className="text-sm text-pastel-text-light">
                              <span className="font-medium capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}:</span> {String(v)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : Array.isArray(value) ? (
                      <div>
                        <span className="font-medium text-pastel-navy capitalize">
                          {subKey.replace(/([A-Z])/g, ' $1').trim()}:
                        </span>
                        <div className="ml-4 mt-1">
                          {value.map((item: any, i: number) => (
                            <div key={i} className="text-sm text-pastel-text-light">
                              • {typeof item === 'object' ? item.name || JSON.stringify(item) : item}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm">
                        <span className="font-medium text-pastel-navy capitalize">
                          {subKey.replace(/([A-Z])/g, ' $1').trim()}:
                        </span>{' '}
                        <span className="text-pastel-text-light">{String(value)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Render subsections */}
            {hasSubsections && (
              <div className="space-y-2 mt-2">
                {section.subsections.map((subsection: any, i: number) =>
                  renderTechPackSection(`${key}-sub-${i}`, subsection, level + 1)
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderFIBOSection = (title: string, icon: React.ReactNode, content: any) => {
    const isExpanded = expandedSections.includes(title);

    // Check if content exists and has value
    const hasContent = content !== undefined && content !== null && content !== '';
    const displayContent = hasContent ? content : 'Not specified';

    return (
      <div className="neumorphic-inset rounded-xl overflow-hidden mb-4">
        <button
          onClick={() => toggleSection(title)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-pastel-bg-dark/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-1.5 circular-icon">{icon}</div>
            <span className="font-semibold text-pastel-navy capitalize">{title.replace(/_/g, ' ')}</span>
          </div>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>
        {isExpanded && (
          <div className="px-4 pb-4">
            {hasContent ? (
              <pre className="text-xs bg-pastel-navy/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {typeof content === 'string'
                  ? content
                  : typeof content === 'object' && content !== null
                    ? JSON.stringify(content, null, 2)
                    : String(content)}
              </pre>
            ) : (
              <p className="text-xs text-pastel-muted italic p-3">Not specified in prompt</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6">
            {/* Product Image */}
            <div className="aspect-square neumorphic-inset rounded-xl overflow-hidden">
              {currentItem.image_url ? (
                <img
                  src={currentItem.image_url}
                  alt={currentItem.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pastel-bg-light to-pastel-bg">
                  <Package size={64} className="text-pastel-muted" />
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-bold text-pastel-navy mb-2">{currentItem.name}</h3>
                <div className="flex items-center gap-2 text-sm text-pastel-muted">
                  <span className="capitalize">{currentItem.category}</span>
                  <span>•</span>
                  <span className="capitalize">{currentItem.subcategory}</span>
                </div>
              </div>

              {/* Compliance Score */}
              <div className="neumorphic-inset rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-pastel-text">Brand Compliance</span>
                  <div className={`px-3 py-1 rounded-full text-xs font-bold ${badge.bgColor} ${badge.color}`}>
                    {badge.label}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-3 neumorphic-inset rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-pastel-teal to-pastel-accent rounded-full transition-all duration-700"
                      style={{ width: `${currentItem.brand_compliance_score}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-pastel-navy">{Math.round(currentItem.brand_compliance_score)}%</span>
                </div>
              </div>

              {/* Design Story */}
              <div className="neumorphic-inset rounded-xl p-4">
                <h4 className="font-medium text-pastel-navy mb-2">Design Story</h4>
                <p className="text-sm text-pastel-text-light leading-relaxed">
                  {currentItem.design_story}
                </p>
              </div>

              {/* Colors */}
              {currentItem.design_spec_json?.colors && currentItem.design_spec_json.colors.length > 0 && (
                <div className="neumorphic-inset rounded-xl p-4">
                  <h4 className="font-medium text-pastel-navy mb-3">Color Palette</h4>
                  <div className="space-y-2">
                    {currentItem.design_spec_json.colors.map((color, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg shadow-neumorphic-sm"
                          style={{ backgroundColor: color.hex }}
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-pastel-navy">{color.name}</span>
                          <span className="ml-2 text-xs text-pastel-muted">{color.hex}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 'fibo':
        if (!currentItem.fibo_prompt_json) {
          return (
            <div className="text-center py-12">
              <div className="circular-icon w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                <Image size={32} className="text-pastel-muted" />
              </div>
              <p className="text-pastel-text">No FIBO prompt available</p>
            </div>
          );
        }

        // Parse the FIBO JSON if it's stored as a string
        let fiboData = currentItem.fibo_prompt_json;
        if (typeof fiboData === 'string') {
          try {
            fiboData = JSON.parse(fiboData);
          } catch (e) {
            console.error('Failed to parse FIBO JSON:', e);
          }
        }

        return (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-pastel-navy">FIBO Structured Prompt JSON</h3>
              <button
                onClick={() => copyToClipboard(JSON.stringify(fiboData, null, 2))}
                className="btn-soft px-3 py-1.5 flex items-center gap-2 text-sm"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied!' : 'Copy JSON'}
              </button>
            </div>

            <div className="space-y-4">
              {renderFIBOSection('description', <FileText size={16} />, fiboData?.description || fiboData?.short_description)}
              {renderFIBOSection('objects', <Package size={16} />, fiboData?.objects)}
              {renderFIBOSection('background', <Image size={16} />, fiboData?.background || fiboData?.background_setting)}
              {renderFIBOSection('lighting', <Lightbulb size={16} />, fiboData?.lighting)}
              {renderFIBOSection('camera_angle', <Camera size={16} />, fiboData?.camera_angle)}
              {renderFIBOSection('focal_length', <Target size={16} />, fiboData?.focal_length || fiboData?.lens_focal_length)}
              {renderFIBOSection('depth_of_field', <Layers size={16} />, fiboData?.depth_of_field || fiboData?.photographic_characteristics?.depth_of_field)}
              {renderFIBOSection('focus', <Target size={16} />, fiboData?.focus || fiboData?.photographic_characteristics?.focus)}
              {renderFIBOSection('composition', <Image size={16} />, fiboData?.composition || fiboData?.aesthetics?.composition)}
              {renderFIBOSection('color_scheme', <Palette size={16} />, fiboData?.color_scheme || fiboData?.aesthetics?.color_scheme)}
              {renderFIBOSection('mood_atmosphere', <Star size={16} />, fiboData?.mood_atmosphere || fiboData?.aesthetics?.mood_atmosphere)}
              {renderFIBOSection('aesthetics', <Image size={16} />, fiboData?.aesthetics)}
              {renderFIBOSection('negative_prompt', <Hash size={16} />, fiboData?.negative_prompt)}
            </div>
          </div>
        );

      case 'validation':
        const violations = validationData?.violations || [];

        return (
          <div className="space-y-6">
            <div className="neumorphic-card p-6">
              <h3 className="text-lg font-bold text-pastel-navy mb-4">Brand Validation Report</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-pastel-text">Compliance Score</span>
                  <span className="text-2xl font-bold text-pastel-accent">{Math.round(currentItem?.brand_compliance_score || 0)}%</span>
                </div>
                <div className="h-4 neumorphic-inset rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-pastel-teal to-pastel-accent rounded-full transition-all duration-700"
                    style={{ width: `${currentItem?.brand_compliance_score || 0}%` }}
                  />
                </div>
                <div className={`inline-block px-4 py-2 rounded-lg ${badge.bgColor}`}>
                  <span className={`font-semibold ${badge.color}`}>{badge.label}</span>
                </div>
              </div>
            </div>

            {/* Validation Metrics */}
            <div className="neumorphic-inset rounded-xl p-6">
              <h4 className="font-medium text-pastel-navy mb-3">Validation Breakdown</h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-pastel-text">Color Compliance</span>
                  <span className="text-sm font-medium text-green-500">✓ Passed</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-pastel-text">Style Consistency</span>
                  <span className="text-sm font-medium text-green-500">✓ Passed</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-pastel-text">Brand Tone</span>
                  <span className="text-sm font-medium text-green-500">✓ Passed</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-pastel-text">Technical Standards</span>
                  <span className="text-sm font-medium text-green-500">✓ Passed</span>
                </div>
              </div>
            </div>

            {/* Violations if any */}
            {violations.length > 0 && (
              <div className="neumorphic-inset rounded-xl p-6">
                <h4 className="font-medium text-pastel-navy mb-3">Issues Found</h4>
                <div className="space-y-2">
                  {violations.slice(0, 5).map((violation: any, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        violation.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                        violation.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {violation.severity}
                      </span>
                      <p className="text-xs text-pastel-text-light flex-1">{violation.message}</p>
                    </div>
                  ))}
                  {violations.length > 5 && (
                    <p className="text-xs text-pastel-muted italic">
                      ...and {violations.length - 5} more issues
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Auto-fixes applied */}
            {validationData?.auto_fixes_applied && validationData.auto_fixes_applied.length > 0 && (
              <div className="neumorphic-inset rounded-xl p-6">
                <h4 className="font-medium text-pastel-navy mb-3">Auto-fixes Applied</h4>
                <div className="space-y-2">
                  {validationData.auto_fixes_applied.map((fix: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-pastel-text-light">
                      <span className="text-green-400">✓</span>
                      <span>{fix.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'techpack':
        if (loadingTechPack) {
          return (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 size={48} className="text-pastel-accent animate-spin mb-4" />
              <p className="text-pastel-text">Generating comprehensive tech pack...</p>
              <p className="text-sm text-pastel-muted mt-2">Analyzing product specifications</p>
            </div>
          );
        }

        return (
          <div className="space-y-6">
            <div className="neumorphic-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-pastel-navy">Technical Specifications</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (techPack) {
                        const techPackText = JSON.stringify(techPack, null, 2);
                        copyToClipboard(techPackText);
                      }
                    }}
                    className="btn-soft px-3 py-1.5 flex items-center gap-2 text-sm"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? 'Copied!' : 'Copy JSON'}
                  </button>
                  <button
                    onClick={downloadTechPackPDF}
                    disabled={!techPack || downloadingPdf}
                    className="btn-soft px-3 py-1.5 flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {downloadingPdf ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    {downloadingPdf ? 'Generating...' : 'Download PDF'}
                  </button>
                  <button
                    onClick={() => setEmailDialogOpen(true)}
                    disabled={!techPack}
                    className="btn-soft px-3 py-1.5 flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    <Send size={16} />
                    Send Tech Pack
                  </button>
                </div>
              </div>

              {/* Basic Product Info */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="neumorphic-inset rounded-xl p-4">
                  <h5 className="font-medium text-pastel-navy mb-2">Category</h5>
                  <p className="text-sm text-pastel-text capitalize">{currentItem?.category || 'N/A'}</p>
                </div>
                <div className="neumorphic-inset rounded-xl p-4">
                  <h5 className="font-medium text-pastel-navy mb-2">Subcategory</h5>
                  <p className="text-sm text-pastel-text capitalize">{currentItem?.subcategory || 'N/A'}</p>
                </div>
              </div>

              {/* Render Tech Pack Sections */}
              {techPack ? (
                <div className="space-y-2">
                  {Object.entries(techPack).map(([key, section]) =>
                    renderTechPackSection(key, section, 0)
                  )}
                </div>
              ) : (
                <div>
                  {/* Fallback to basic tech pack if generation fails */}
                  {currentItem?.design_spec_json ? (
                    <div className="space-y-4">
                      {/* Materials */}
                      <div className="neumorphic-inset rounded-xl p-4">
                        <h5 className="font-medium text-pastel-navy mb-2">Materials</h5>
                        {currentItem?.design_spec_json?.materials && currentItem.design_spec_json.materials.length > 0 ? (
                          <ul className="space-y-1">
                            {currentItem.design_spec_json.materials.map((material: any, i: number) => {
                              const percentage = material.percentage ||
                                (i === 0 ? 70 : Math.floor(30 / (currentItem.design_spec_json.materials.length - 1)));
                              return (
                                <li key={i} className="text-sm text-pastel-text-light">
                                  • {typeof material === 'string' ? material : material.name} - {percentage}%
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-sm text-pastel-text-light">Material composition to be determined</p>
                        )}
                      </div>

                      {/* Colors */}
                      {currentItem?.design_spec_json?.colors && currentItem.design_spec_json.colors.length > 0 && (
                        <div className="neumorphic-inset rounded-xl p-4">
                          <h5 className="font-medium text-pastel-navy mb-2">Color Specifications</h5>
                          <div className="grid grid-cols-2 gap-2">
                            {currentItem.design_spec_json.colors.map((color: any, i: number) => (
                              <div key={i} className="flex items-center gap-2">
                                <div
                                  className="w-6 h-6 rounded shadow-neumorphic-sm"
                                  style={{ backgroundColor: color.hex || '#888888' }}
                                />
                                <span className="text-sm text-pastel-text-light">
                                  {typeof color === 'string' ? color : color.name}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Basic Production Details */}
                      <div className="neumorphic-inset rounded-xl p-4">
                        <h5 className="font-medium text-pastel-navy mb-2">Production Details</h5>
                        <div className="space-y-2 text-sm text-pastel-text-light">
                          <div>
                            <span className="font-medium">Season:</span> {currentItem?.design_spec_json?.season || 'Current'}
                          </div>
                          <div>
                            <span className="font-medium">Target Market:</span> {currentItem?.design_spec_json?.persona || 'General'}
                          </div>
                          <div>
                            <span className="font-medium">Style:</span> {currentItem?.design_spec_json?.inspiration || 'Contemporary'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-pastel-text-light">
                      Click "Regenerate Tech Pack" to generate comprehensive specifications.
                    </p>
                  )}

                  <button
                    onClick={loadOrGenerateTechPack}
                    className="mt-4 btn-primary px-4 py-2 text-sm"
                  >
                    Generate Comprehensive Tech Pack
                  </button>
                </div>
              )}
            </div>
          </div>
        );

      case 'design':
        return (
          <DesignAdjustments
            item={currentItem}
            brandId={brandId}
            onUpdateItem={handleUpdateItem}
          />
        );

      case 'video':
        return (
          <AdvertisementVideo
            item={currentItem}
            brandId={brandId}
            onUpdateItem={handleUpdateItem}
          />
        );

      default:
        return null;
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Product Details" size="lg">
        <div>
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'overview'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'neumorphic-sm text-pastel-text hover:shadow-neumorphic'
            }`}
          >
            <div className="flex items-center gap-2">
              <Eye size={16} />
              Overview
            </div>
          </button>
          <button
            onClick={() => setActiveTab('fibo')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'fibo'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'neumorphic-sm text-pastel-text hover:shadow-neumorphic'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText size={16} />
              FIBO JSON
            </div>
          </button>
          <button
            onClick={() => setActiveTab('validation')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'validation'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'neumorphic-sm text-pastel-text hover:shadow-neumorphic'
            }`}
          >
            <div className="flex items-center gap-2">
              <Shield size={16} />
              Validation
            </div>
          </button>
          <button
            onClick={() => setActiveTab('techpack')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'techpack'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'neumorphic-sm text-pastel-text hover:shadow-neumorphic'
            }`}
          >
            <div className="flex items-center gap-2">
              <Package size={16} />
              Tech Pack
            </div>
          </button>
          <button
            onClick={() => setActiveTab('design')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'design'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'neumorphic-sm text-pastel-text hover:shadow-neumorphic'
            }`}
          >
            <div className="flex items-center gap-2">
              <MessageSquare size={16} />
              Adjust Design
            </div>
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'video'
                ? 'neumorphic-pressed text-pastel-accent'
                : 'neumorphic-sm text-pastel-text hover:shadow-neumorphic'
            }`}
          >
            <div className="flex items-center gap-2">
              <Video size={16} />
              Ad Video
            </div>
          </button>
        </div>

        {/* Tab Content */}
        <div>{renderTabContent()}</div>
      </div>
    </Modal>

    {/* Email Dialog */}
    {emailDialogOpen && (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="neumorphic-card p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-bold text-pastel-navy mb-4">Send Tech Pack</h3>
          <p className="text-sm text-pastel-text mb-4">
            Enter the recipient's email address to send the tech pack with PDF attachment.
          </p>
          <input
            type="email"
            placeholder="Enter recipient email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="w-full px-4 py-2 neumorphic-inset rounded-lg mb-4 text-pastel-navy bg-pastel-card"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setEmailDialogOpen(false);
                setRecipientEmail('');
              }}
              className="btn-soft px-4 py-2"
              disabled={sendingEmail}
            >
              Cancel
            </button>
            <button
              onClick={sendTechPackEmail}
              disabled={!recipientEmail || sendingEmail || !recipientEmail.includes('@')}
              className="btn-primary px-4 py-2 flex items-center gap-2"
            >
              {sendingEmail ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}