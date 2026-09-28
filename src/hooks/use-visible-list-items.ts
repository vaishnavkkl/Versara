import { useCallback, useState } from 'react';
import type { ViewToken } from 'react-native';

const viewabilityConfig = { itemVisiblePercentThreshold: 1, minimumViewTime: 80 };

/** Keep bitmap decoding/native thumbnail jobs limited to the visible list rows. */
export function useVisibleListItems() {
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(() => new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const next = new Set(viewableItems.filter(item => item.isViewable).map(item => item.key));
    setVisibleKeys(current => current.size === next.size && [...next].every(key => current.has(key)) ? current : next);
  }, []);
  return { visibleKeys, onViewableItemsChanged, viewabilityConfig };
}
