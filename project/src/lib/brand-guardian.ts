import type { BrandStyleJSON, FIBOPromptJSON, Violation, AutoFix } from '../types/database';

export interface ValidationResult {
  isValid: boolean;
  complianceScore: number;
  violations: Violation[];
  autoFixesAvailable: number;
}

export interface ValidationWithFixes extends ValidationResult {
  originalPrompt: FIBOPromptJSON;
  fixedPrompt: FIBOPromptJSON;
  appliedFixes: AutoFix[];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return Infinity;
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
}

function findClosestColor(hex: string, palette: { hex: string; name: string }[]): { hex: string; name: string; distance: number } | null {
  if (palette.length === 0) return null;
  let closest = palette[0];
  let minDistance = colorDistance(hex, closest.hex);

  for (const color of palette) {
    const dist = colorDistance(hex, color.hex);
    if (dist < minDistance) {
      minDistance = dist;
      closest = color;
    }
  }

  return { ...closest, distance: minDistance };
}

function extractHexColors(colorScheme: string | undefined): string[] {
  if (!colorScheme || typeof colorScheme !== 'string') {
    return [];
  }
  const hexPattern = /#[0-9A-Fa-f]{6}/g;
  return colorScheme.match(hexPattern) || [];
}

function extractFocalLength(focalLength: string | undefined): number | null {
  if (!focalLength || typeof focalLength !== 'string') {
    return null;
  }
  const match = focalLength.match(/(\d+)\s*mm/i);
  return match ? parseInt(match[1], 10) : null;
}

function extractCameraAngle(cameraAngle: string | undefined): number | null {
  if (!cameraAngle || typeof cameraAngle !== 'string') {
    return null;
  }
  const match = cameraAngle.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function validateFIBOPrompt(
  prompt: FIBOPromptJSON,
  brandStyle: BrandStyleJSON
): ValidationResult {
  const violations: Violation[] = [];

  // Safely extract color_scheme (might be undefined or different type)
  const hexColors = extractHexColors(prompt.color_scheme as any);
  for (const hex of hexColors) {
    const isApproved = brandStyle.colorPalette.some(
      c => colorDistance(c.hex, hex) < 30
    );

    if (!isApproved) {
      const closest = findClosestColor(hex, brandStyle.colorPalette);
      // For trend-based collections, color differences are suggestions, not critical
      violations.push({
        id: crypto.randomUUID(),
        rule: 'Color differs from brand palette (OK for trends)',
        category: 'color',
        severity: 'suggestion', // Changed from 'critical' since trends may use different colors
        detected: hex,
        allowed: brandStyle.colorPalette.map(c => `${c.name} (${c.hex})`).join(', ') || 'No colors defined',
        message: `Trend color ${hex} differs from brand palette - this is acceptable for trend-based collections`,
        autoFixAvailable: closest !== null,
        fixedValue: closest?.hex,
      });
    }
  }

  const { cameraSettings } = brandStyle;
  const focalLength = extractFocalLength(prompt.focal_length as any);

  if (focalLength !== null) {
    const fovFromFocal = Math.round(2 * Math.atan(36 / (2 * focalLength)) * (180 / Math.PI));
    if (fovFromFocal < cameraSettings.fovMin || fovFromFocal > cameraSettings.fovMax) {
      const suggestedFocal = Math.round(36 / (2 * Math.tan((cameraSettings.fovDefault * Math.PI / 180) / 2)));
      violations.push({
        id: crypto.randomUUID(),
        rule: 'Focal length must produce FOV within allowed range',
        category: 'camera',
        severity: 'warning',
        detected: `${focalLength}mm (FOV ~${fovFromFocal}°)`,
        allowed: { min: cameraSettings.fovMin, max: cameraSettings.fovMax },
        message: `Focal length ${focalLength}mm produces FOV ~${fovFromFocal}° outside allowed range (${cameraSettings.fovMin}°-${cameraSettings.fovMax}°)`,
        autoFixAvailable: true,
        fixedValue: `${suggestedFocal}mm`,
      });
    }
  }

  const numericAngle = extractCameraAngle(prompt.camera_angle as any);
  if (numericAngle !== null) {
    if (numericAngle < cameraSettings.angleMin || numericAngle > cameraSettings.angleMax) {
      violations.push({
        id: crypto.randomUUID(),
        rule: 'Camera angle must be within allowed range',
        category: 'camera',
        severity: 'warning',
        detected: prompt.camera_angle,
        allowed: { min: cameraSettings.angleMin, max: cameraSettings.angleMax },
        message: `Camera angle "${prompt.camera_angle}" is outside allowed range (${cameraSettings.angleMin}°-${cameraSettings.angleMax}°)`,
        autoFixAvailable: true,
        fixedValue: `${cameraSettings.angleDefault}° eye level`,
      });
    }
  }

  const { lightingConfig } = brandStyle;
  // Handle lighting as either string or object
  let lightingLower = '';
  if (typeof prompt.lighting === 'string') {
    lightingLower = (prompt.lighting || '').toLowerCase();
  } else if (prompt.lighting && typeof prompt.lighting === 'object') {
    // If lighting is an object, combine its properties into a string
    lightingLower = JSON.stringify(prompt.lighting).toLowerCase();
  }

  if (lightingLower && lightingConfig.colorTemperature < 4500 && lightingLower.includes('cool')) {
    violations.push({
      id: crypto.randomUUID(),
      rule: 'Lighting color temperature should match brand style',
      category: 'lighting',
      severity: 'suggestion',
      detected: 'cool lighting',
      allowed: `warm lighting (${lightingConfig.colorTemperature}K)`,
      message: `Cool lighting detected but brand style specifies warm (${lightingConfig.colorTemperature}K)`,
      autoFixAvailable: true,
      fixedValue: 'warm, soft lighting with natural tones',
    });
  } else if (lightingLower && lightingConfig.colorTemperature > 5500 && lightingLower.includes('warm')) {
    violations.push({
      id: crypto.randomUUID(),
      rule: 'Lighting color temperature should match brand style',
      category: 'lighting',
      severity: 'suggestion',
      detected: 'warm lighting',
      allowed: `cool lighting (${lightingConfig.colorTemperature}K)`,
      message: `Warm lighting detected but brand style specifies cool (${lightingConfig.colorTemperature}K)`,
      autoFixAvailable: true,
      fixedValue: 'cool, neutral studio lighting',
    });
  }

  // Handle description as either string or object
  let descriptionLower = '';
  if (typeof prompt.description === 'string') {
    descriptionLower = (prompt.description || '').toLowerCase();
  } else if (prompt.description && typeof prompt.description === 'object') {
    descriptionLower = JSON.stringify(prompt.description).toLowerCase();
  }
  for (const negative of brandStyle.negativePrompts) {
    if (descriptionLower && descriptionLower.includes(negative.toLowerCase())) {
      violations.push({
        id: crypto.randomUUID(),
        rule: 'Description must not contain forbidden terms',
        category: 'prompt',
        severity: 'critical',
        detected: negative,
        allowed: 'Not allowed: ' + brandStyle.negativePrompts.join(', '),
        message: `Description contains forbidden term: "${negative}"`,
        autoFixAvailable: true,
        fixedValue: (prompt.description || '').replace(new RegExp(negative, 'gi'), '').trim(),
      });
    }
  }

  const currentNegatives = prompt.negative_prompt?.toLowerCase() || '';
  for (const negative of brandStyle.negativePrompts) {
    if (!currentNegatives.includes(negative.toLowerCase())) {
      violations.push({
        id: crypto.randomUUID(),
        rule: 'Negative prompt must include brand exclusions',
        category: 'prompt',
        severity: 'warning',
        detected: 'Missing: ' + negative,
        allowed: brandStyle.negativePrompts.join(', '),
        message: `Missing required negative prompt: "${negative}"`,
        autoFixAvailable: true,
        fixedValue: negative,
      });
    }
  }

  for (const obj of (prompt.objects || [])) {
    // Handle object description as either string or object
    let objDescLower = '';
    if (typeof obj.description === 'string') {
      objDescLower = (obj.description || '').toLowerCase();
    } else if (obj.description && typeof obj.description === 'object') {
      objDescLower = JSON.stringify(obj.description).toLowerCase();
    }
    for (const negative of brandStyle.negativePrompts) {
      if (objDescLower.includes(negative.toLowerCase())) {
        violations.push({
          id: crypto.randomUUID(),
          rule: 'Object description must not contain forbidden terms',
          category: 'prompt',
          severity: 'critical',
          detected: `"${negative}" in object "${obj.name}"`,
          allowed: 'Not allowed: ' + brandStyle.negativePrompts.join(', '),
          message: `Object "${obj.name}" description contains forbidden term: "${negative}"`,
          autoFixAvailable: true,
          fixedValue: (obj.description || '').replace(new RegExp(negative, 'gi'), '').trim(),
        });
      }
    }
  }

  const criticalCount = violations.filter(v => v.severity === 'critical').length;
  const warningCount = violations.filter(v => v.severity === 'warning').length;
  const suggestionCount = violations.filter(v => v.severity === 'suggestion').length;

  const maxScore = 100;
  const criticalPenalty = 25;
  const warningPenalty = 10;
  const suggestionPenalty = 3;

  const complianceScore = Math.max(0, Math.min(100,
    maxScore -
    (criticalCount * criticalPenalty) -
    (warningCount * warningPenalty) -
    (suggestionCount * suggestionPenalty)
  ));

  return {
    isValid: criticalCount === 0,
    complianceScore,
    violations,
    autoFixesAvailable: violations.filter(v => v.autoFixAvailable).length,
  };
}

export function applyAutoFixes(
  prompt: FIBOPromptJSON,
  brandStyle: BrandStyleJSON,
  validationResult: ValidationResult
): ValidationWithFixes {
  const fixedPrompt: FIBOPromptJSON = JSON.parse(JSON.stringify(prompt));
  const appliedFixes: AutoFix[] = [];

  for (const violation of validationResult.violations) {
    if (!violation.autoFixAvailable || violation.fixedValue === undefined) continue;

    const fix: AutoFix = {
      violationId: violation.id,
      field: '',
      originalValue: violation.detected,
      fixedValue: violation.fixedValue,
      appliedAt: new Date().toISOString(),
    };

    switch (violation.category) {
      case 'color':
        if (typeof violation.fixedValue === 'string' && typeof violation.detected === 'string' && fixedPrompt.color_scheme) {
          fix.field = 'color_scheme';
          fixedPrompt.color_scheme = fixedPrompt.color_scheme.replace(
            violation.detected,
            violation.fixedValue
          );
          appliedFixes.push(fix);
        }
        break;

      case 'camera':
        if (violation.rule.includes('Focal length') && typeof violation.fixedValue === 'string') {
          fix.field = 'focal_length';
          fixedPrompt.focal_length = violation.fixedValue;
          appliedFixes.push(fix);
        } else if (violation.rule.includes('angle') && typeof violation.fixedValue === 'string') {
          fix.field = 'camera_angle';
          fixedPrompt.camera_angle = violation.fixedValue;
          appliedFixes.push(fix);
        }
        break;

      case 'lighting':
        if (typeof violation.fixedValue === 'string') {
          fix.field = 'lighting';
          fixedPrompt.lighting = violation.fixedValue;
          appliedFixes.push(fix);
        }
        break;

      case 'prompt':
        if (violation.rule.includes('Description') && typeof violation.fixedValue === 'string') {
          fix.field = 'description';
          fixedPrompt.description = violation.fixedValue;
          appliedFixes.push(fix);
        } else if (violation.rule.includes('Negative prompt') && typeof violation.fixedValue === 'string') {
          fix.field = 'negative_prompt';
          const existing = fixedPrompt.negative_prompt || '';
          if (!existing.toLowerCase().includes(violation.fixedValue.toLowerCase())) {
            fixedPrompt.negative_prompt = existing
              ? `${existing}, ${violation.fixedValue}`
              : violation.fixedValue;
          }
          appliedFixes.push(fix);
        } else if (violation.rule.includes('Object description')) {
          for (let i = 0; i < fixedPrompt.objects.length; i++) {
            if (violation.message.includes(fixedPrompt.objects[i].name)) {
              fix.field = `objects[${i}].description`;
              fixedPrompt.objects[i].description = String(violation.fixedValue);
              appliedFixes.push(fix);
              break;
            }
          }
        }
        break;
    }
  }

  const newValidation = validateFIBOPrompt(fixedPrompt, brandStyle);

  return {
    ...newValidation,
    originalPrompt: prompt,
    fixedPrompt,
    appliedFixes,
  };
}

export function getComplianceBadge(score: number): { label: string; color: string; bgColor: string } {
  if (score >= 90) return { label: 'Excellent', color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' };
  if (score >= 75) return { label: 'Good', color: 'text-green-400', bgColor: 'bg-green-500/20' };
  if (score >= 60) return { label: 'Fair', color: 'text-amber-400', bgColor: 'bg-amber-500/20' };
  if (score >= 40) return { label: 'Poor', color: 'text-orange-400', bgColor: 'bg-orange-500/20' };
  return { label: 'Critical', color: 'text-red-400', bgColor: 'bg-red-500/20' };
}

export function getSeverityIcon(severity: Violation['severity']): { icon: string; color: string } {
  switch (severity) {
    case 'critical': return { icon: 'XCircle', color: 'text-red-400' };
    case 'warning': return { icon: 'AlertTriangle', color: 'text-amber-400' };
    case 'suggestion': return { icon: 'Info', color: 'text-blue-400' };
  }
}
