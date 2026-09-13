import { createContext, useContext, type ReactNode } from 'react';

import { density as densityScales, type Density } from '@/theme';

/**
 * The reading density the subtree renders at.
 *
 * Provided by each experience's layout, so a screen never asks "am I the parent
 * app?" — it asks how large to draw, which is the only thing the answer may
 * change. Defaulting to `standard` means every component still renders
 * correctly with no provider above it, which is how the existing screens and
 * their tests already work.
 */
const DensityContext = createContext<Density>('standard');

export interface DensityProviderProps {
  value: Density;
  children: ReactNode;
}

export function DensityProvider({ value, children }: DensityProviderProps): React.JSX.Element {
  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export const useDensity = (): Density => useContext(DensityContext);

/** The resolved scale values for the current subtree. */
export const useDensityScale = (): (typeof densityScales)[Density] => densityScales[useDensity()];
