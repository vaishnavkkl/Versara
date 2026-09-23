import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedText } from '@/components/themed-text';
import { UniversalIcon } from '@/components/universal-icon';
import { colors } from '@/theme/colors';

const DEVICE_SECTIONS = [
  {
    title: 'Network',
    tools: [
      { id: 'wifi_info',   title: 'Wi-Fi Info',        subtitle: 'SSID, IP, gateway, DNS',      ios: 'wifi' as const,                    android: 'wifi' as const },
      { id: 'net_diag',    title: 'Internet Diagnostic', subtitle: 'Latency, jitter, packet loss', ios: 'network' as const,                android: 'network-check' as const },
      { id: 'speed_test',  title: 'Speed Test',        subtitle: 'Download & upload speed',     ios: 'speedometer' as const,             android: 'speed' as const },
      { id: 'dns_lookup',  title: 'DNS Lookup',        subtitle: 'Query DNS records',           ios: 'magnifyingglass' as const,         android: 'dns' as const },
    ],
  },
  {
    title: 'Battery',
    tools: [
      { id: 'charge_test', title: 'Charging Test',    subtitle: 'Measure charge rate (% / hr)',  ios: 'bolt.fill' as const,               android: 'bolt' as const },
      { id: 'drain_test',  title: 'Drain Test',       subtitle: 'Observe battery consumption',  ios: 'battery.75percent' as const,       android: 'battery-std' as const },
      { id: 'battery_info', title: 'Battery Info',   subtitle: 'Voltage, temperature, state',   ios: 'info.circle' as const,             android: 'info' as const },
    ],
  },
  {
    title: 'Device Info',
    tools: [
      { id: 'device_info', title: 'Device Details',   subtitle: 'Model, OS, RAM, storage',     ios: 'iphone' as const,                  android: 'smartphone' as const },
    ],
  },
] as const;

export default function DeviceScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Device',
          headerLargeTitleEnabled: true,
          headerSearchBarOptions: { placeholder: 'Search device tools…' },
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        style={{ backgroundColor: colors.systemBackground }}
      >
        {DEVICE_SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <ThemedText style={styles.sectionLabel}>{section.title}</ThemedText>
            <View style={styles.list}>
              {section.tools.map((tool, i) => (
                <View
                  key={tool.id}
                  style={[
                    styles.row,
                    { backgroundColor: colors.secondarySystemBackground },
                    i === 0 && styles.rowFirst,
                    i === section.tools.length - 1 && styles.rowLast,
                  ]}
                >
                  <View style={[styles.iconBubble, { backgroundColor: colors.systemBackground }]}>
                    <UniversalIcon ios={tool.ios} android={tool.android} size={20} color={colors.systemBlue as string} />
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.rowTitle}>{tool.title}</ThemedText>
                    <ThemedText style={[styles.rowSub, { color: colors.secondaryLabel as string }]}>{tool.subtitle}</ThemedText>
                  </View>
                  <UniversalIcon ios="chevron.right" android="chevron-right" size={16} color={colors.secondaryLabel as string} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 24 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  list: { borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', gap: 1 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowFirst: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  iconBubble: { width: 38, height: 38, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 1 },
});
