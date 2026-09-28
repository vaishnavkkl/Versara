import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { useAppearance, usePalette } from '@/theme/colors';
import { brandFont } from '@/theme/dashboard';

const ENTER = Easing.bezier(0.23, 1, 0.32, 1);
const HOLD_MS = 2000;
const EXIT_MS = 200;

function ImageCard() {
  return <Svg width="100%" height="100%" viewBox="0 0 174 146">
    <Defs><LinearGradient id="splash-photo" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#236DE8" /><Stop offset="1" stopColor="#49C6DF" /></LinearGradient></Defs>
    <Rect width={174} height={146} rx={22} fill="#F8FBFF" />
    <Rect x={12} y={12} width={150} height={112} rx={14} fill="url(#splash-photo)" />
    <Circle cx={126} cy={41} r={13} fill="#FFD88A" />
    <Path d="M19 108 L57 57 Q60 53 64 58 L104 112 H23 Q19 112 19 108Z" fill="#F1F8FF" />
    <Path d="M71 112 L108 76 Q111 73 115 77 L151 112Z" fill="#B5E9F2" />
    <Rect x={63} y={133} width={48} height={3} rx={1.5} fill="#D4DFEE" />
  </Svg>;
}

function PdfCard() {
  return <Svg width="100%" height="100%" viewBox="0 0 142 184">
    <Path d="M22 0H103L142 39V162Q142 184 120 184H22Q0 184 0 162V22Q0 0 22 0Z" fill="#FFFFFF" />
    <Path d="M103 0V25Q103 39 117 39H142Z" fill="#E4EAF5" />
    <Rect x={18} y={32} width={51} height={28} rx={8} fill="#E95D61" />
    <SvgText x={43.5} y={51} fontSize={14} fontWeight="700" textAnchor="middle" fill="#FFFFFF">PDF</SvgText>
    <Rect x={19} y={82} width={96} height={6} rx={3} fill="#243E69" />
    <Rect x={19} y={98} width={77} height={5} rx={2.5} fill="#A8B9CF" />
    <Rect x={19} y={113} width={93} height={5} rx={2.5} fill="#A8B9CF" />
    <Rect x={19} y={128} width={60} height={5} rx={2.5} fill="#A8B9CF" />
    <Rect x={19} y={153} width={29} height={5} rx={2.5} fill="#F5AFB0" />
  </Svg>;
}

/** A two-second introduction with a restrained entrance and a short fade into the app. */
export function AnimatedSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const colors = usePalette();
  const dark = useAppearance(state => state.mode) === 'dark';
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  const pdfProgress = useSharedValue(reduced ? 1 : 0);
  const brandProgress = useSharedValue(reduced ? 1 : 0);
  const fade = useSharedValue(1);
  const flourish = useSharedValue(0);
  const mounted = useRef(false);
  const completed = useRef(false);
  const done = useRef(onDone);

  useEffect(() => { done.current = onDone; }, [onDone]);
  const complete = useCallback(() => {
    if (!mounted.current || completed.current) return;
    completed.current = true;
    done.current();
  }, []);

  useEffect(() => {
    if (!ready) return;
    mounted.current = true;
    completed.current = false;
    progress.set(reduced ? 1 : 0);
    pdfProgress.set(reduced ? 1 : 0);
    brandProgress.set(reduced ? 1 : 0);
    flourish.set(0);
    if (!reduced) {
      flourish.set(withDelay(550, withTiming(1, { duration: 1100, easing: Easing.linear })));
      progress.set(withDelay(120, withTiming(1, { duration: 500, easing: ENTER })));
      pdfProgress.set(withDelay(220, withTiming(1, { duration: 400, easing: ENTER })));
      brandProgress.set(withDelay(340, withTiming(1, { duration: 300, easing: ENTER })));
    }
    fade.set(1);
    // Keep the hold independent of Reanimated: reduced motion may skip withDelay.
    const hold = setTimeout(() => {
      if (reduced) { complete(); return; }
      fade.set(withTiming(0, { duration: EXIT_MS, easing: ENTER }, finished => {
        if (finished) scheduleOnRN(complete);
      }));
    }, HOLD_MS);
    // Keep startup bounded even when an animation completion callback is interrupted.
    const fallback = setTimeout(complete, HOLD_MS + EXIT_MS + 300);
    return () => {
      mounted.current = false;
      clearTimeout(hold);
      clearTimeout(fallback);
      cancelAnimation(progress);
      cancelAnimation(pdfProgress);
      cancelAnimation(brandProgress);
      cancelAnimation(fade);
      cancelAnimation(flourish);
    };
  }, [brandProgress, complete, fade, flourish, pdfProgress, progress, ready, reduced]);

  const overlay = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const photo = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: (1 - progress.get()) * 18 - Math.sin(flourish.get() * Math.PI) * 4 }, { rotate: `${-18 + progress.get() * 6}deg` }, { scale: 0.94 + progress.get() * 0.06 }],
  }));
  const pdf = useAnimatedStyle(() => ({
    opacity: pdfProgress.get(),
    transform: [{ translateY: (1 - pdfProgress.get()) * 14 - Math.sin(flourish.get() * Math.PI) * 6 }, { rotate: `${15 - pdfProgress.get() * 6}deg` }, { scale: 0.94 + pdfProgress.get() * 0.06 }],
  }));
  const halo = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : Math.sin(flourish.get() * Math.PI) * 0.45,
    transform: [{ scale: 0.92 + flourish.get() * 0.24 }],
  }));
  const glint = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : Math.sin(flourish.get() * Math.PI),
    transform: [{ rotate: `${flourish.get() * 80}deg` }, { scale: 0.9 + Math.sin(flourish.get() * Math.PI) * 0.1 }],
  }));
  const scan = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : Math.sin(flourish.get() * Math.PI) * 0.55,
    transform: [{ translateY: flourish.get() * 105 }],
  }));
  const wordmark = useAnimatedStyle(() => ({ opacity: brandProgress.get(), transform: [{ translateY: (1 - brandProgress.get()) * 4 }] }));

  return <Animated.View accessibilityViewIsModal style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.systemBackground }, overlay]}>
    <View accessible accessibilityLabel="Versara. PDF and image tools." style={styles.center}>
      <View style={styles.art} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[styles.backdrop, { backgroundColor: dark ? '#152542' : '#E9F0FE' }]} />
        <Animated.View pointerEvents="none" style={[styles.halo, { borderColor: dark ? '#73B8F5' : '#A1BDF2' }, halo]} />
        <Animated.View pointerEvents="none" style={[styles.sparkle, glint]}><Svg width={20} height={20} viewBox="0 0 20 20"><Path d="M10 0L12 8L20 10L12 12L10 20L8 12L0 10L8 8Z" fill="#49B8D4" /></Svg></Animated.View>
        <Animated.View style={[styles.photo, photo]}><ImageCard /></Animated.View>
        <Animated.View style={[styles.pdf, pdf]}><PdfCard /><Animated.View pointerEvents="none" style={[styles.scan, scan]} /></Animated.View>
      </View>
      <Animated.View style={[styles.brand, wordmark]}>
        <Animated.Text maxFontSizeMultiplier={1.25} style={[styles.wordmark, { color: colors.label }]}>Versara</Animated.Text>
        <Animated.Text maxFontSizeMultiplier={1.4} style={[styles.tagline, { color: colors.secondaryLabel }]}>PDF &amp; image tools</Animated.Text>
      </Animated.View>
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  art: { width: 260, height: 238, marginBottom: 20 },
  backdrop: { position: 'absolute', width: 216, height: 216, borderRadius: 108, left: 22, top: 12 },
  photo: { position: 'absolute', left: 5, top: 73, width: 174, height: 146, borderRadius: 22, boxShadow: '0 10px 24px rgba(13, 32, 69, 0.14)' },
  pdf: { position: 'absolute', left: 108, top: 18, width: 142, height: 184, borderRadius: 22, boxShadow: '0 12px 26px rgba(13, 32, 69, 0.16)' },
  halo: { position: 'absolute', width: 230, height: 230, borderRadius: 115, borderWidth: 1.5, left: 15, top: 5 },
  sparkle: { position: 'absolute', left: 12, top: 40 },
  scan: { position: 'absolute', left: 18, right: 18, top: 45, height: 2, borderRadius: 1, backgroundColor: '#63C8E7' },
  brand: { alignItems: 'center', gap: 6 },
  wordmark: { ...brandFont.label, fontSize: 44, lineHeight: 56, letterSpacing: -1.8 },
  tagline: { fontSize: 14, lineHeight: 22, fontWeight: '400', letterSpacing: 0.6 },
});
