import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useAppearance, usePalette } from '@/theme/colors';
import { brandFont } from '@/theme/dashboard';

// Artwork coordinates follow the 1024px logo; the visible art spans this box.
const ART = { x: 178, y: 178, width: 674, height: 622 };
const WIDTH = 200;
const SCALE = WIDTH / ART.width;
const HEIGHT = ART.height * SCALE;
const FRONT = { x: 180, y: 295, width: 350, height: 400, radius: 78 };
// Starts fully below the front card so no part shows under the hills before it rises.
const SUN = { cx: 460, cy: 447, r: 42, below: 300 };
const AUDIO_TOP = 430;
const BARS = [
  { x: 621, height: 60 }, { x: 660, height: 110 }, { x: 699, height: 180 }, { x: 738, height: 110 }, { x: 777, height: 60 },
];
const BAR_WIDTH = 26;
const BAR_CENTER = 645;
// Play and pause stay inside the video card, clear of the audio card below.
const PLAY = { cx: 672, cy: 340 };
const NAME = 'Versara';
// Letters step along the primary gradient, so the word reads as one gradient stroke.
// Dark mode stays monochrome: white fading to light grey.
const LETTER_COLORS = {
  light: ['#1A1953', '#25236A', '#302E80', '#3C3996', '#4944AB', '#5750BF', '#665DD2'],
  dark: ['#FFFFFF', '#F2F2F2', '#E6E6E6', '#D9D9D9', '#CCCCCC', '#C0C0C0', '#B3B3B3'],
};
const UNDERLINE = {
  light: 'linear-gradient(90deg, #1A1953 0%, #3F3AA6 60%, #6A5CF0 100%)',
  dark: 'linear-gradient(90deg, #FFFFFF 0%, #BDBDBD 60%, #6E6E6E 100%)',
};

const INTRO_MS = 1600;
const SUN_DELAY = 900;
const SUN_MS = 2200;
const PAUSE_DELAY = 2600;
const NAME_DELAY = 1100;
const NAME_MS = 1400;
const TOTAL_MS = 5000;
const FADE_MS = 700;
const SMOOTH = Easing.bezier(0.22, 1, 0.36, 1);

const px = (value: number) => {
  'worklet';
  return value * SCALE;
};
/** Progress of one staggered part of a shared 0..1 timeline. */
const part = (value: number, start: number, end: number) => {
  'worklet';
  return interpolate(value, [start, end], [0, 1], 'clamp');
};
const viewBox = `${ART.x} ${ART.y} ${ART.width} ${ART.height}`;
const frontBox = `${FRONT.x} ${FRONT.y} ${FRONT.width} ${FRONT.height}`;
const PLAY_ORIGIN = `${px(PLAY.cx - ART.x)}px ${px(PLAY.cy - ART.y)}px`;

function Layer({ children, box = viewBox }: { children: ReactNode; box?: string }) {
  return <Svg width="100%" height="100%" viewBox={box} style={StyleSheet.absoluteFill}>{children}</Svg>;
}

/** A logo card that drifts in from an offset while fading and settling to full size. */
function Card({ intro, start, end, dx, dy, children }: { intro: SharedValue<number>; start: number; end: number; dx: number; dy: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const p = part(intro.value, start, end);
    return { opacity: p, transform: [{ translateX: dx * (1 - p) }, { translateY: dy * (1 - p) }, { scale: 0.9 + p * 0.1 }] };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, style]}>{children}</Animated.View>;
}

function Bar({ x, height, index, progress, intro, reduced }: { x: number; height: number; index: number; progress: SharedValue<number>; intro: SharedValue<number>; reduced: boolean }) {
  const style = useAnimatedStyle(() => {
    const shown = part(intro.value, 0.55 + index * 0.06, 0.8 + index * 0.04);
    return { opacity: shown, transform: [{ scaleY: reduced ? 1 : shown * (0.45 + progress.value * 0.55) }] };
  });
  return <Animated.View style={[styles.bar, style, {
    left: px(x - BAR_WIDTH / 2 - ART.x), top: px(BAR_CENTER - height / 2 - ART.y), width: px(BAR_WIDTH), height: px(height), borderRadius: px(BAR_WIDTH / 2),
  }]} />;
}

function Letter({ char, index, word, color }: { char: string; index: number; word: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const step = 1 / (NAME.length + 3);
    const p = part(word.value, index * step, index * step + step * 4);
    // Overshoots slightly and settles, like the letters are dropped into place.
    const lift = interpolate(p, [0, 0.7, 1], [26, -3, 0]);
    return { opacity: part(p, 0, 0.5), transform: [{ translateY: lift }, { scale: 0.72 + p * 0.28 }, { rotate: `${(1 - p) * -10}deg` }] };
  });
  return <Animated.Text style={[styles.letter, { color }, style]}>{char}</Animated.Text>;
}

/** Launch splash: the cards settle in, the sun rises behind the hills, play turns to pause and the audio meter moves. */
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const colors = usePalette();
  const mode = useAppearance(state => state.mode);
  const reduced = useReducedMotion();
  const fade = useSharedValue(1);
  const intro = useSharedValue(reduced ? 1 : 0);
  const sun = useSharedValue(reduced ? 1 : 0);
  const pause = useSharedValue(reduced ? 1 : 0);
  const word = useSharedValue(reduced ? 1 : 0);
  const tagline = useSharedValue(reduced ? 1 : 0);
  const bars = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];

  function finish(delay: number) {
    fade.value = withDelay(delay, withTiming(0, { duration: FADE_MS, easing: Easing.inOut(Easing.cubic) }, finished => { if (finished) scheduleOnRN(onDone); }));
  }

  useEffect(() => {
    if (reduced) { finish(1400); return; }
    intro.value = withTiming(1, { duration: INTRO_MS, easing: SMOOTH });
    sun.value = withDelay(SUN_DELAY, withTiming(1, { duration: SUN_MS, easing: SMOOTH }));
    pause.value = withDelay(PAUSE_DELAY, withTiming(1, { duration: 600, easing: Easing.inOut(Easing.cubic) }));
    word.value = withDelay(NAME_DELAY, withTiming(1, { duration: NAME_MS, easing: Easing.out(Easing.cubic) }));
    tagline.value = withDelay(NAME_DELAY + NAME_MS - 300, withTiming(1, { duration: 900, easing: SMOOTH }));
    [1500, 1250, 1100, 1350, 1600].forEach((duration, index) => {
      bars[index].value = withDelay(INTRO_MS * 0.6 + index * 160, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true));
    });
    finish(TOTAL_MS - FADE_MS);
    // Shared values are stable; this runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlay = useAnimatedStyle(() => ({ opacity: fade.value }));
  const artStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.96 + part(intro.value, 0, 1) * 0.04 }] }));
  const frontStyle = useAnimatedStyle(() => {
    const p = part(intro.value, 0.3, 0.85);
    return { opacity: p, transform: [{ translateX: -px(60) * (1 - p) }, { translateY: px(30) * (1 - p) }, { scale: 0.88 + p * 0.12 }] };
  });
  const sunStyle = useAnimatedStyle(() => ({
    opacity: part(sun.value, 0, 0.25),
    backgroundColor: interpolateColor(sun.value, [0, 0.5, 1], ['#FFE7A3', '#FFC04D', '#FF8A1F']),
    transform: [{ translateY: px(SUN.below * (1 - sun.value)) }],
  }));
  const playStyle = useAnimatedStyle(() => ({
    opacity: part(intro.value, 0.45, 0.75) * (1 - pause.value),
    transform: [{ scale: 1 - pause.value * 0.35 }, { rotate: `${pause.value * 90}deg` }],
  }));
  const pauseStyle = useAnimatedStyle(() => ({ opacity: pause.value, transform: [{ scale: 0.65 + pause.value * 0.35 }, { rotate: `${(pause.value - 1) * 90}deg` }] }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: tagline.value, transform: [{ translateY: (1 - tagline.value) * 8 }] }));
  const underlineStyle = useAnimatedStyle(() => ({ opacity: part(word.value, 0.55, 0.75), transform: [{ scaleX: part(word.value, 0.6, 1) }] }));

  return <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: colors.systemBackground }, overlay]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Versara is starting. Tap to skip." onPress={() => finish(0)} style={styles.center}>
      <Animated.View style={[styles.art, artStyle]}>
        <Card intro={intro} start={0} end={0.55} dx={px(40)} dy={px(-30)}>
          <Layer>
            <Defs><LinearGradient id="back" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#2F7CFF" /><Stop offset="1" stopColor="#1BB4EE" /></LinearGradient></Defs>
            <Rect x={300} y={180} width={550} height={620} rx={80} fill="url(#back)" />
          </Layer>
        </Card>
        <Card intro={intro} start={0.12} end={0.65} dx={px(50)} dy={px(-40)}>
          <Layer>
            <Defs><LinearGradient id="video" x1="0" y1="1" x2="1" y2="0"><Stop offset="0" stopColor="#4F35D8" /><Stop offset="0.6" stopColor="#6F5BF2" /><Stop offset="1" stopColor="#C08AFF" /></LinearGradient></Defs>
            <Rect x={515} y={198} width={335} height={300} rx={70} fill="url(#video)" />
          </Layer>
        </Card>
        <Animated.View style={[StyleSheet.absoluteFill, playStyle, { transformOrigin: PLAY_ORIGIN }]}>
          <Layer><Path d={`M${PLAY.cx - 44} ${PLAY.cy - 56} L${PLAY.cx + 56} ${PLAY.cy} L${PLAY.cx - 44} ${PLAY.cy + 56} Z`} fill="#EEF0FF" stroke="#EEF0FF" strokeWidth={28} strokeLinejoin="round" /></Layer>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, pauseStyle, { transformOrigin: PLAY_ORIGIN }]}>
          <Layer>
            <Rect x={PLAY.cx - 44} y={PLAY.cy - 60} width={34} height={120} rx={17} fill="#EEF0FF" />
            <Rect x={PLAY.cx + 10} y={PLAY.cy - 60} width={34} height={120} rx={17} fill="#EEF0FF" />
          </Layer>
        </Animated.View>
        <Card intro={intro} start={0.22} end={0.75} dx={px(50)} dy={px(40)}>
          <Layer>
            <Defs><LinearGradient id="audio" x1="0" y1="1" x2="1" y2="0"><Stop offset="0" stopColor="#10AFA8" /><Stop offset="0.55" stopColor="#26D07A" /><Stop offset="1" stopColor="#BDF47C" /></LinearGradient></Defs>
            <Rect x={555} y={AUDIO_TOP} width={295} height={370} rx={90} fill="url(#audio)" />
          </Layer>
        </Card>
        {BARS.map((bar, index) => <Bar key={bar.x} {...bar} index={index} progress={bars[index]} intro={intro} reduced={reduced} />)}
        <Animated.View style={[styles.front, frontStyle, { left: px(FRONT.x - ART.x), top: px(FRONT.y - ART.y), width: px(FRONT.width), height: px(FRONT.height), borderRadius: px(FRONT.radius) }]}>
          <Layer box={frontBox}>
            <Defs><LinearGradient id="front" x1="0" y1="1" x2="1" y2="0"><Stop offset="0" stopColor="#0A2FC4" /><Stop offset="0.55" stopColor="#1473F0" /><Stop offset="1" stopColor="#52E4FF" /></LinearGradient></Defs>
            <Rect x={FRONT.x} y={FRONT.y} width={FRONT.width} height={FRONT.height} fill="url(#front)" />
          </Layer>
          <Animated.View style={[styles.sun, sunStyle, {
            left: px(SUN.cx - SUN.r - FRONT.x), top: px(SUN.cy - SUN.r - FRONT.y), width: px(SUN.r * 2), height: px(SUN.r * 2), borderRadius: px(SUN.r),
          }]} />
          <Layer box={frontBox}>
            <Path d="M222 628 L335 468 L478 628 Z" fill="#E9F0FF" stroke="#E9F0FF" strokeWidth={28} strokeLinejoin="round" />
            <Path d="M330 628 L462 530 L522 628 Z" fill="#BCD2FF" stroke="#BCD2FF" strokeWidth={24} strokeLinejoin="round" />
          </Layer>
        </Animated.View>
      </Animated.View>
      <View style={styles.wordmark} accessible accessibilityLabel={NAME}>
        {NAME.split('').map((char, index) => <Letter key={index} char={char} index={index} word={word} color={LETTER_COLORS[mode][index % LETTER_COLORS[mode].length]} />)}
      </View>
      <Animated.View style={[styles.underline, { experimental_backgroundImage: UNDERLINE[mode] }, underlineStyle]} />
      <Animated.Text style={[styles.tagline, { color: colors.secondaryLabel }, taglineStyle]}>PDF · Image · Video · Audio</Animated.Text>
    </Pressable>
  </Animated.View>;
}

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, elevation: 1000 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  art: { width: WIDTH, height: HEIGHT, marginBottom: 28 },
  bar: { position: 'absolute', backgroundColor: '#E8FFF7' },
  front: { position: 'absolute', overflow: 'hidden' },
  sun: { position: 'absolute' },
  wordmark: { flexDirection: 'row' },
  letter: { ...brandFont.display, fontSize: 44, lineHeight: 54, letterSpacing: 0.4 },
  underline: {
    width: 132, height: 4, borderRadius: 2, marginTop: 2, transformOrigin: 'left',
  },
  tagline: { marginTop: 10, fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.4 },
});
