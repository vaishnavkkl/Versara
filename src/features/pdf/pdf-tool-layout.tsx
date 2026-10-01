import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

// The route owns orientation so changing preview/settings cannot reset it.
export const PdfToolLayoutContext = createContext<{
  landscape: boolean;
  setLandscape: Dispatch<SetStateAction<boolean>>;
  /** A mounted page row offers orientation itself; the header shows it only when no page row does. */
  registerPageRow: () => () => void;
} | null>(null);

export const usePdfToolLayout = () => useContext(PdfToolLayoutContext);
