/**
 * Utility functions for generating heat map colors based on performance metrics
 */

import { HeatMapConfig } from '../models/ProfileData';

export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number; // alpha
}

/**
 * Convert percentage (0-100) to heat map color based on configuration
 * Higher percentage = "hotter" color (more critical)
 */
export function percentToColor(
  percent: number,
  config: HeatMapConfig
): string {
  if (!config.enabled || percent < config.threshold) {
    return 'transparent';
  }

  // Normalize to 0-1 range
  const normalized = Math.min(percent / 100, 1.0);

  let rgb: RGB;
  switch (config.colorScheme) {
    case 'red-yellow-green':
      rgb = redYellowGreen(normalized);
      break;
    case 'thermal':
      rgb = thermal(normalized);
      break;
    case 'grayscale':
      rgb = grayscale(normalized);
      break;
    default:
      rgb = redYellowGreen(normalized);
  }

  // Apply intensity
  rgb.a = config.intensity;

  return rgbaToString(rgb);
}

/**
 * Red (hot) -> Yellow -> Green (cool) color scheme
 * Inverted: 0% = green (good), 100% = red (bad/hot)
 */
function redYellowGreen(value: number): RGB {
  // Invert so high values are red
  const inverted = 1 - value;

  if (inverted < 0.5) {
    // Red to Yellow
    const t = inverted * 2;
    return { r: 255, g: Math.round(t * 255), b: 0, a: 1 };
  } else {
    // Yellow to Green
    const t = (inverted - 0.5) * 2;
    return { r: Math.round((1 - t) * 255), g: 255, b: 0, a: 1 };
  }
}

/**
 * Thermal imaging color scheme: black -> red -> yellow -> white
 * 0% = dark, 100% = bright/hot
 */
function thermal(value: number): RGB {
  if (value < 0.25) {
    // Black to Red
    const t = value * 4;
    return { r: Math.round(t * 255), g: 0, b: 0, a: 1 };
  } else if (value < 0.5) {
    // Red to Yellow
    const t = (value - 0.25) * 4;
    return { r: 255, g: Math.round(t * 255), b: 0, a: 1 };
  } else if (value < 0.75) {
    // Yellow to White
    const t = (value - 0.5) * 4;
    return { r: 255, g: 255, b: Math.round(t * 255), a: 1 };
  } else {
    // Bright white for extreme values
    return { r: 255, g: 255, b: 255, a: 1 };
  }
}

/**
 * Simple grayscale: 0% = light gray, 100% = dark gray
 */
function grayscale(value: number): RGB {
  const intensity = Math.round(255 * (1 - value * 0.7)); // Keep it readable
  return { r: intensity, g: intensity, b: intensity, a: 1 };
}

/**
 * Convert RGB object to CSS rgba string
 */
function rgbaToString(rgb: RGB): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})`;
}

/**
 * Get a discrete color for categorical data (e.g., function names in sidebar)
 */
export function getDiscreteColor(index: number): string {
  const colors = [
    '#FF6B6B', // Red
    '#FFA500', // Orange
    '#FFD93D', // Yellow
    '#6BCF7F', // Green
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#9B59B6', // Purple
    '#E91E63', // Pink
  ];
  return colors[index % colors.length];
}

/**
 * Determine if we should use light or dark text based on background color
 */
export function shouldUseLightText(backgroundColor: string): boolean {
  // Simple heuristic: if it's not transparent, use white text for hot colors
  return backgroundColor !== 'transparent';
}
