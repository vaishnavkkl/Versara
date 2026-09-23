import React, { useCallback, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Stack } from 'expo-router';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { colors } from '@/theme/colors';



const QUICK_ACTIONS = [
  { id: 'compress_pdf',  title: 'Compress PDF',      iosIcon: 'doc.zipper',               androidIcon: 'picture-as-pdf'          },
  { id: 'merge_pdf',     title: 'Merge PDF',          iosIcon: 'doc.on.doc',               androidIcon: 'file-copy'               },
  { id: 'compress_img',  title: 'Compress Image',     iosIcon: 'photo.badge.arrow.down',   androidIcon: 'photo-size-select-large' },
  { id: 'compress_vid',  title: 'Compress Video',     iosIcon: 'video.badge.checkmark',    androidIcon: 'video-settings'          },
  { id: 'redact',        title: 'Redact Screenshot',  iosIcon: 'eye.slash',                androidIcon: 'visibility-off'          },
  { id: 'wifi',          title: 'Wi-Fi Test',         iosIcon: 'wifi.exclamationmark',     androidIcon: 'wifi-tethering'          },
  { id: 'battery',       title: 'Battery Test',       iosIcon: 'battery.75percent',        androidIcon: 'battery-full'            },
  { id: 'metadata',      title: 'Remove Metadata',    iosIcon: 'xmark.seal',               androidIcon: 'remove-circle'           },
] as const;

const CATEGORIES = [
  { id: 'documents', label: 'Documents', iosIcon: 'doc.text',  androidIcon: 'description'  },
  { id: 'media',     label: 'Media',     iosIcon: 'photo',     androidIcon: 'perm-media'   },
  { id: 'privacy',   label: 'Privacy',   iosIcon: 'lock.shield', androidIcon: 'security'   },
  { id: 'device',    label: 'Device',    iosIcon: 'iphone',    androidIcon: 'smartphone'   },
] as const;

export default function HomeScreen() {
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const handleActionPress = useCallback((title: string) => {
    setSelectedAction(title);
    bottomSheetRef.current?.expand();
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Toolbox',
          headerLargeTitleEnabled: true,
          headerTransparent: Platform.OS === 'ios',
          headerBlurEffect: 'regular',
          headerSearchBarOptions: {
            placeholder: 'Search tools…',
            hideWhenScrolling: false,
          },
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        style={{ backgroundColor: colors.systemBackground }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Quick Actions */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel}>Quick Actions</ThemedText>
          <View style={styles.grid}>
            {QUICK_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.id}
                activeOpacity={0.75}
                style={[styles.card, { backgroundColor: colors.secondarySystemBackground }]}
                onPress={() => handleActionPress(action.title)}
                accessibilityLabel={action.title}
                accessibilityRole="button"
              >
                <View style={[styles.iconBubble, { backgroundColor: colors.systemBackground }]}>
                  <UniversalIcon
                    ios={action.iosIcon}
                    android={action.androidIcon as any}
                    size={22}
                    color={colors.systemBlue as string}
                  />
                </View>
                <ThemedText style={styles.cardLabel} numberOfLines={2}>
                  {action.title}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Categories */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel}>Categories</ThemedText>
          <View style={styles.chipRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                activeOpacity={0.75}
                style={[styles.chip, { backgroundColor: colors.secondarySystemBackground }]}
                accessibilityLabel={cat.label}
                accessibilityRole="button"
              >
                <UniversalIcon
                  ios={cat.iosIcon}
                  android={cat.androidIcon as any}
                  size={16}
                  color={colors.label as string}
                />
                <ThemedText style={styles.chipLabel}>{cat.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Tool action sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={-1}
        snapPoints={['30%', '55%']}
        enablePanDownToClose
        backgroundStyle={[styles.sheetBg, { backgroundColor: colors.secondarySystemBackground as string }]}
        handleIndicatorStyle={{ backgroundColor: colors.separator as string }}
      >
        <BottomSheetView style={styles.sheetContent}>
          <ThemedText style={[styles.sheetTitle, { color: colors.label as string }]}>
            {selectedAction}
          </ThemedText>
          <ThemedText style={{ color: colors.secondaryLabel as string, marginTop: 8 }}>
            Module integration coming in Phase 2.
          </ThemedText>
        </BottomSheetView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 28,
  },

  section: {
    gap: 12,
  },

  sectionLabel: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },

  // 2-column action grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },

  card: {
    // ~2 columns with 12 gap
    flexBasis: '47%',
    flexGrow: 1,
    padding: 16,
    borderRadius: 18,
    gap: 12,
    alignItems: 'flex-start',
    // CSS box-shadow (New Arch, SDK 56+)
    boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)',
    borderCurve: 'continuous',
  },

  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },

  cardLabel: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },

  // Category chips
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderCurve: 'continuous',
  },

  chipLabel: {
    fontSize: 14,
    fontWeight: '500',
  },

  // Bottom sheet
  sheetBg: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },

  sheetContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    alignItems: 'center',
  },

  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
});
