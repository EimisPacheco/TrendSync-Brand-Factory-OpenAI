/**
 * PDF Generator for Tech Packs
 *
 * Uses jsPDF to create professional tech pack PDFs in the browser
 */

import { jsPDF } from 'jspdf';
import type { TechPack } from './techpack-generator';
import type { CollectionItem } from '../types/database';

export class PDFGenerator {
  private doc: jsPDF;
  private yPos: number;
  private pageHeight: number;
  private margins = { top: 20, bottom: 20, left: 20, right: 20 };

  constructor() {
    this.doc = new jsPDF();
    this.yPos = this.margins.top;
    this.pageHeight = this.doc.internal.pageSize.getHeight();
  }

  private checkPageBreak(requiredSpace: number = 20) {
    if (this.yPos + requiredSpace > this.pageHeight - this.margins.bottom) {
      this.doc.addPage();
      this.yPos = this.margins.top;
    }
  }

  private addTitle(text: string) {
    this.checkPageBreak(20);
    this.doc.setFontSize(18);
    this.doc.setFont(undefined, 'bold');
    this.doc.text(text, this.margins.left, this.yPos);
    this.yPos += 10;
  }

  private addSubtitle(text: string) {
    this.checkPageBreak(15);
    this.doc.setFontSize(14);
    this.doc.setFont(undefined, 'bold');
    this.doc.text(text, this.margins.left, this.yPos);
    this.yPos += 8;
  }

  private addText(text: string, indent: number = 0) {
    this.checkPageBreak(10);
    this.doc.setFontSize(11);
    this.doc.setFont(undefined, 'normal');

    // Handle long text with word wrap
    const maxWidth = this.doc.internal.pageSize.getWidth() - this.margins.left - this.margins.right - indent;
    const lines = this.doc.splitTextToSize(text, maxWidth);

    lines.forEach((line: string) => {
      this.checkPageBreak(7);
      this.doc.text(line, this.margins.left + indent, this.yPos);
      this.yPos += 5;
    });
  }

  private addSection(title: string, section: any) {
    this.addSubtitle(title);
    this.yPos += 2;

    // Handle TechPackSection structure
    if (section && typeof section === 'object') {
      // If it has a content property (TechPackSection structure)
      if ('content' in section) {
        // Add main content if it's a string or has meaningful data
        if (typeof section.content === 'string' && section.content !== 'Not specified') {
          this.addText(section.content, 5);
        } else if (typeof section.content === 'object' && section.content !== null) {
          this.formatContent(section.content, 5);
        }

        // Add subsections if they exist
        if (section.subsections && Array.isArray(section.subsections)) {
          section.subsections.forEach((subsection: any) => {
            if (subsection.title) {
              this.addText('', 0); // Add spacing
              this.doc.setFont(undefined, 'bold');
              this.addText(subsection.title + ':', 10);
              this.doc.setFont(undefined, 'normal');
            }
            if (typeof subsection.content === 'string') {
              this.addText(subsection.content, 15);
            } else if (typeof subsection.content === 'object' && subsection.content !== null) {
              this.formatContent(subsection.content, 15);
            }
          });
        }
      } else {
        // Fallback for direct object content
        this.formatContent(section, 5);
      }
    }

    this.yPos += 5;
  }

  private formatContent(content: any, indent: number) {
    if (typeof content === 'string') {
      this.addText(content, indent);
    } else if (Array.isArray(content)) {
      content.forEach(item => {
        if (typeof item === 'string') {
          this.addText(`• ${item}`, indent);
        } else if (typeof item === 'object' && item !== null) {
          // Format object items
          const text = this.objectToString(item);
          this.addText(`• ${text}`, indent);
        }
      });
    } else if (typeof content === 'object' && content !== null) {
      Object.entries(content).forEach(([key, value]) => {
        if (value && value !== 'Not specified') {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          if (typeof value === 'object' && !Array.isArray(value)) {
            this.addText(`${label}: ${this.objectToString(value)}`, indent);
          } else if (Array.isArray(value)) {
            this.addText(`${label}:`, indent);
            value.forEach(v => {
              const itemText = typeof v === 'object' ? this.objectToString(v) : v;
              this.addText(`  • ${itemText}`, indent + 5);
            });
          } else {
            this.addText(`${label}: ${value}`, indent);
          }
        }
      });
    }
  }

  private objectToString(obj: any): string {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object') return String(obj);

    // Try to create a meaningful string representation
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined && value !== '') {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const formattedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        parts.push(`${formattedKey}: ${formattedValue}`);
      }
    }
    return parts.join(', ') || JSON.stringify(obj);
  }

  public generateTechPackPDF(item: CollectionItem, techPack: TechPack): Blob {
    // Header
    this.addTitle(`Tech Pack: ${item.name}`);
    this.yPos += 5;

    // Product Info
    this.doc.setFontSize(11);
    this.doc.setFont(undefined, 'normal');
    this.addText(`SKU: ${item.sku}`);
    this.addText(`Category: ${item.category} / ${item.subcategory}`);
    this.addText(`Price Tier: ${item.price_tier}`);
    this.addText(`Target Persona: ${item.target_persona}`);
    this.yPos += 10;

    // Tech Pack Sections
    this.addSection('Fabric & Materials', techPack.fabricType);
    this.addSection('Measurements & Sizing', techPack.measurements);
    this.addSection('Graphics & Branding', techPack.graphics);
    this.addSection('Adornments & Hardware', techPack.adornments);
    this.addSection('Construction Details', techPack.construction);
    this.addSection('Quality Control', techPack.qualityControl);
    this.addSection('Packaging & Presentation', techPack.packaging);

    // Footer
    this.yPos = this.pageHeight - 15;
    this.doc.setFontSize(9);
    this.doc.setTextColor(128);
    this.doc.text(`Generated on ${new Date().toLocaleDateString()}`, this.margins.left, this.yPos);
    this.doc.text(`TrendSync Brand Factory`, this.doc.internal.pageSize.getWidth() - this.margins.right - 50, this.yPos);

    // Return as blob
    return this.doc.output('blob');
  }

  public downloadPDF(item: CollectionItem, techPack: TechPack) {
    const blob = this.generateTechPackPDF(item, techPack);
    const fileName = `tech-pack-${item.sku}-${new Date().toISOString().split('T')[0]}.pdf`;

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return fileName;
  }
}

export const pdfGenerator = new PDFGenerator();