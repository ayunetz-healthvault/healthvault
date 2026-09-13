/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Lives in `src/` rather than in the test so the rule is available to anything
 * that needs to choose a foreground at runtime — an avatar colour picked from a
 * name, for instance — and so there is one implementation to be right.
 */

const channel = (hex: string, offset: number): number => {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a `#RRGGBB` colour. */
export const luminance = (color: string): number => {
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Expected a #RRGGBB colour, received "${color}".`);
  }
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4);
};

/** Contrast ratio between two `#RRGGBB` colours, 1–21. */
export const contrastRatio = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
};
