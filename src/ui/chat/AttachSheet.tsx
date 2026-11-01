import { useEffect, useMemo, useRef } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Image as ImageIcon, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, type, type Palette } from '../theme/tokens';

type Props = {
  visible: boolean;
  /** The agent's name, for the skills tile. */
  name: string;
  /** Offer the camera and photos; a composer without image upload has only skills. */
  photos: boolean;
  palette: Palette;
  onCamera: () => void;
  onPhotos: () => void;
  onSkills: () => void;
  onClose: () => void;
};

/** How far the sheet starts below its resting place, and where a drag ends it. */
const HIDDEN_OFFSET = 320;
const DISMISS_DRAG = 80;
const DISMISS_VELOCITY = 0.6;

/** What + adds to a message, as large tiles in a sheet from the bottom. */
export function AttachSheet({ visible, name, photos, palette, onCamera, onPhotos, onSkills, onClose }: Props) {
  const s = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const offset = useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!visible) return;
    offset.setValue(HIDDEN_OFFSET);
    Animated.timing(offset, { toValue: 0, duration: 220, useNativeDriver: true }).start();
  }, [visible, offset]);

  const drag = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => offset.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > DISMISS_DRAG || gesture.vy > DISMISS_VELOCITY) {
        Animated.timing(offset, { toValue: HIDDEN_OFFSET, duration: 160, useNativeDriver: true })
          .start(() => closeRef.current());
      } else {
        Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
      }
    },
  }), [offset]);

  // Each choice closes the sheet first, so a picker or the skills list opens over the chat.
  const choose = (next: () => void) => () => {
    onClose();
    next();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close attachments" />
      <Animated.View
        {...drag.panHandlers}
        style={[s.sheet, { paddingBottom: insets.bottom + space.xl, transform: [{ translateY: offset }] }]}
      >
        <View style={s.handle} />
        <View style={s.tiles}>
          {photos && (
            <>
              <Tile icon={Camera} label="Camera" a11y="Take a photo" s={s} palette={palette} onPress={choose(onCamera)} />
              <Tile icon={ImageIcon} label="Photos" a11y="Attach a photo" s={s} palette={palette} onPress={choose(onPhotos)} />
            </>
          )}
          <Tile icon={Sparkles} label="Skills" a11y={`${name} skills`} s={s} palette={palette} onPress={choose(onSkills)} />
        </View>
      </Animated.View>
    </Modal>
  );
}

function Tile({ icon: Icon, label, a11y, onPress, s, palette }: {
  icon: LucideIcon;
  label: string;
  a11y: string;
  onPress: () => void;
  s: Styles;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [s.tile, pressed && s.tilePressed]}
    >
      <Icon size={28} color={palette.text} strokeWidth={1.75} />
      <Text style={s.tileLabel}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(p: Palette) {
  return StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: p.bg,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingTop: space.sm,
      paddingHorizontal: space.lg,
      gap: space.lg,
    },
    handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: p.seam, marginBottom: space.xs },
    tiles: { flexDirection: 'row', gap: space.md },
    tile: {
      flex: 1,
      height: 104,
      borderRadius: radius.md,
      backgroundColor: p.surface,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
    },
    tilePressed: { backgroundColor: p.seam },
    tileLabel: { ...type.bodyMedium, color: p.text },
  });
}
