export const DEVICE_SECTIONS = [
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
