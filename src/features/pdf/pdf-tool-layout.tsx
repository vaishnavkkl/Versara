import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

// The route owns orientation so changing preview/settings cannot reset it.
export const PdfToolLayoutContext = createContext<{
  landscape: boolean;
  setLandscape: Dispatch<SetStateAction<boolean>>;
} | null>(null);

export const usePdfToolLayout = () => useContext(PdfToolLayoutContext);
