import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { setReaderBackHandler, setReaderHelpHandler } from '@/features/pdf/reader-back';

/**
 * State for the tools-around-content ring. While it shows, close and back leave name mode, then the ring;
 * the next press closes the screen. The header help button toggles name mode, where tapping a ring tool
 * shows its name instead of opening it.
 */
export function useToolRing(available: boolean) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => { setNaming(false); setClosing(open); }, [open]);
  const finishClose = useCallback(() => { setOpen(false); setClosing(false); }, []);
  const active = available && open;
  const namingActive = active && naming;
  const namingRef = useRef(false);
  useEffect(() => { namingRef.current = namingActive; }, [namingActive]);
  useEffect(() => {
    if (!active) return;
    const leave = () => { if (namingRef.current) setNaming(false); else close(); return true; };
    const release = setReaderBackHandler(leave);
    const releaseHelp = setReaderHelpHandler(() => {
      const next = !namingRef.current;
      setNaming(next);
      return true;
    });
    const back = BackHandler.addEventListener('hardwareBackPress', leave);
    return () => { release(); releaseHelp(); back.remove(); };
  }, [active, close]);
  const toggle = useCallback(() => {
    setNaming(false);
    if (closing) { setClosing(false); setOpen(true); }
    else if (open) close();
    else setOpen(true);
  }, [closing, open, close]);
  return { active, naming: namingActive, closing, toggle, close, finishClose };
}
