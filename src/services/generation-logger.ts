/**
 * Generation Logger
 *
 * This service logs all generation flow details to both console and in-memory storage
 * for complete transparency of what's happening during collection generation.
 * Browser-compatible version - no filesystem access.
 */

export class GenerationLogger {
  private logContent: string[] = [];
  private startTime: number;
  private logFileName: string;

  constructor() {
    this.startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFileName = `generation-log-${timestamp}.md`;

    this.logContent.push(`# Collection Generation Log`);
    this.logContent.push(`**Started at:** ${new Date().toISOString()}\n`);
    this.logContent.push(`---\n`);
  }

  private formatJson(obj: any): string {
    try {
      return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
    } catch {
      return '```\n[Unable to stringify object]\n```';
    }
  }

  private formatTime(): string {
    const elapsed = Date.now() - this.startTime;
    const seconds = Math.floor(elapsed / 1000);
    const ms = elapsed % 1000;
    return `[${seconds}.${String(ms).padStart(3, '0')}s]`;
  }

  public async log(title: string, content: any, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const time = this.formatTime();
    const emoji = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️';

    // Console output
    console.log(`${time} ${emoji} ${title}`);
    if (content) {
      console.log(content);
    }
    console.log('---');

    // Markdown content
    this.logContent.push(`## ${time} ${emoji} ${title}\n`);

    if (content) {
      if (typeof content === 'object') {
        this.logContent.push(this.formatJson(content));
      } else {
        this.logContent.push(String(content));
      }
    }

    this.logContent.push('\n---\n');

    // Store in localStorage as backup
    this.saveToLocalStorage();
  }

  public async logSection(sectionTitle: string) {
    const separator = '═'.repeat(80);

    console.log(separator);
    console.log(`🔹 ${sectionTitle.toUpperCase()}`);
    console.log(separator);

    this.logContent.push(`\n# ${sectionTitle}\n`);
    this.logContent.push(`${'='.repeat(80)}\n`);

    this.saveToLocalStorage();
  }

  public async logGeminiTrendRequest(prompt: string) {
    await this.logSection('Step 1: Gemini + Google Search - Trend Analysis');
    await this.log('Gemini Trend Request', { prompt }, 'info');
  }

  public async logGeminiTrendResponse(response: any, parsed: any) {
    await this.log('Gemini Raw Response', response, 'info');
    await this.log('Gemini Parsed Data', parsed, 'success');
  }

  public async logProductCreation(products: any[]) {
    await this.logSection('Step 2: Product Definition');
    await this.log('Products Created', {
      count: products.length,
      products: products.map(p => ({
        name: p.name,
        category: p.category,
        colors: p.colors,
        materials: p.materials
      }))
    }, 'success');
  }

  public async logBriaPromptGeneration(itemName: string, textPrompt: string, structuredPrompt: any) {
    await this.logSection(`Step 3: Bria API - ${itemName}`);
    await this.log('Text Prompt Sent to Bria', textPrompt, 'info');
    if (structuredPrompt) {
      await this.log('Structured FIBO Prompt Received', structuredPrompt, 'success');
    }
  }

  public async logBrandValidation(itemName: string, validationResult: any, brandStyle: any) {
    await this.log(`Brand Guardian Validation - ${itemName}`, {
      score: validationResult.complianceScore,
      violations: validationResult.violations,
      formula: '100 - (critical×25) - (warning×10) - (suggestion×3)',
      calculation: {
        base: 100,
        critical: validationResult.violations.filter((v: any) => v.severity === 'critical').length,
        warnings: validationResult.violations.filter((v: any) => v.severity === 'warning').length,
        suggestions: validationResult.violations.filter((v: any) => v.severity === 'suggestion').length,
        deductions: {
          fromCritical: validationResult.violations.filter((v: any) => v.severity === 'critical').length * 25,
          fromWarnings: validationResult.violations.filter((v: any) => v.severity === 'warning').length * 10,
          fromSuggestions: validationResult.violations.filter((v: any) => v.severity === 'suggestion').length * 3
        },
        finalScore: validationResult.complianceScore
      },
      brandPalette: brandStyle.colorPalette,
      negativePrompts: brandStyle.negativePrompts
    }, validationResult.complianceScore >= 60 ? 'success' : 'warning');
  }

  public async logImageGeneration(itemName: string, imageUrl: string, requestId: string) {
    await this.log(`Image Generated - ${itemName}`, {
      url: imageUrl,
      requestId: requestId,
      source: 'Bria API v2'
    }, 'success');
  }

  public async logError(context: string, error: any) {
    await this.log(`Error in ${context}`, {
      message: error.message || 'Unknown error',
      stack: error.stack,
      details: error
    }, 'error');
  }

  public async logSummary(successful: number, failed: number, totalTime: number) {
    await this.logSection('Generation Summary');
    await this.log('Final Results', {
      successful: successful,
      failed: failed,
      totalTime: `${(totalTime / 1000).toFixed(2)} seconds`,
      averageComplianceScore: 'Calculated from actual validations above',
      timestamp: new Date().toISOString()
    }, successful > 0 ? 'success' : 'error');
  }

  private saveToLocalStorage() {
    try {
      const logData = {
        fileName: this.logFileName,
        content: this.logContent.join('\n'),
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('generation-log-current', JSON.stringify(logData));

      // Also save to a timestamped key for history
      localStorage.setItem(`generation-log-${this.startTime}`, JSON.stringify(logData));
    } catch (error) {
      console.warn('Could not save log to localStorage:', error);
    }
  }

  public getLogContent(): string {
    return this.logContent.join('\n');
  }

  public async saveLog(): Promise<string> {
    const content = this.getLogContent();

    // Save to localStorage for automatic persistence
    this.saveToLocalStorage();

    // Create a downloadable blob in memory
    const blob = new Blob([content], { type: 'text/markdown' });
    const blobUrl = URL.createObjectURL(blob);

    // Store the blob URL in sessionStorage for potential later download
    sessionStorage.setItem(`log-blob-${this.logFileName}`, blobUrl);

    // Log is automatically saved to browser storage - no user interaction needed
    console.log(`✅ Log automatically saved: ${this.logFileName}`);
    console.log(`📄 View in browser storage: localStorage['generation-log-${this.startTime}']`);

    return `auto-saved:${this.logFileName}`;
  }

  public downloadLog() {
    const content = this.getLogContent();
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.logFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`📄 Log downloaded as: ${this.logFileName}`);
  }

  public getLogPath(): string {
    return this.logFileName;
  }

  // Static method to retrieve logs from localStorage
  public static getStoredLogs(): Array<{ fileName: string; content: string; timestamp: string }> {
    const logs: Array<{ fileName: string; content: string; timestamp: string }> = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('generation-log-')) {
        try {
          const logData = JSON.parse(localStorage.getItem(key) || '{}');
          if (logData.fileName && logData.content) {
            logs.push(logData);
          }
        } catch (error) {
          console.warn(`Could not parse log ${key}:`, error);
        }
      }
    }

    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
}

export const generationLogger = new GenerationLogger();