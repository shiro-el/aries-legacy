import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import type { CodeSegment } from './syntax';
import type { Crumb } from './workbench';
import type { WorkbenchStyles } from './styles';
import type { Palette } from '../theme/tokens';

/** A full-pane state: loading, empty, or an error with a way forward. */
export function Notice({ s, palette, title, text, busy, action }: {
  s: WorkbenchStyles;
  palette: Palette;
  title?: string;
  text?: string;
  busy?: boolean;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={s.center}>
      {busy && <ActivityIndicator color={palette.muted} />}
      {title && <Text style={s.centerTitle}>{title}</Text>}
      {text && <Text style={s.centerText} selectable>{text}</Text>}
      {action && (
        <View style={s.centerActions}>
          <Pressable onPress={action.onPress} accessibilityRole="button" style={s.solid}>
            <Text style={s.solidLabel}>{action.label}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Tappable path segments, scrolled to the deepest one. */
export function Crumbs({ s, items, onSelect }: { s: WorkbenchStyles; items: Crumb[]; onSelect?: (path: string) => void }) {
  return (
    <ScrollView
      horizontal
      style={s.crumbs}
      contentContainerStyle={s.crumbsContent}
      showsHorizontalScrollIndicator={false}
      ref={view => view?.scrollToEnd({ animated: false })}
    >
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <View key={item.path} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {index > 0 && items[index - 1].label !== '/' &&<Text style={s.crumbSep}>/</Text>}
            <Pressable
              onPress={() => onSelect?.(item.path)}
              disabled={last || !onSelect}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.path}`}
              hitSlop={4}
            >
              <Text style={[s.crumb, last && s.crumbLast]}>{item.label}</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

export function Chip({ s, label, on, onPress, disabled }: {
  s: WorkbenchStyles;
  label: string;
  on?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={on === undefined ? undefined : { selected: on }}
      hitSlop={6}
      style={({ pressed }) => [s.chip, on && s.chipOn, pressed && s.pressed, disabled && s.dim]}
    >
      <Text style={s.chipLabel}>{label}</Text>
    </Pressable>
  );
}

export function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** JetBrains Mono's advance is 0.6em; code views set 12px text. */
const CODE_CELL = 12 * 0.6;

/**
 * Holds a vertical code list. Wrapped, lines break at the phone's width.
 * Unwrapped, the list is as wide as its longest line and scrolls sideways,
 * so every line keeps its shape instead of breaking at whatever width the
 * first rendered rows happened to need.
 */
export function CodeFrame({ wrap, columns, gutter, children }: {
  wrap: boolean;
  /** Columns in the longest line. */
  columns: number;
  /** Width taken by line numbers, markers and padding. */
  gutter: number;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  if (wrap) return <View style={{ flex: 1 }}>{children}</View>;
  return (
    <ScrollView horizontal style={{ flex: 1 }}>
      <View style={{ width: Math.max(width, Math.ceil(gutter + columns * CODE_CELL) + 8) }}>{children}</View>
    </ScrollView>
  );
}

/**
 * A line's styled runs, as children of the line's own `Text`. Changed words
 * take the tint of the side they are on.
 */
export function Segments({ s, segments, side }: {
  s: WorkbenchStyles;
  segments: readonly CodeSegment[];
  side?: 'added' | 'removed';
}) {
  if (segments.length === 1 && !segments[0].color && !segments[0].changed) return <>{segments[0].text || ' '}</>;
  return (
    <>
      {segments.map((segment, index) => (
        <Text
          key={index}
          style={[
            segment.color !== undefined && { color: segment.color },
            segment.bold && s.bold,
            segment.italic && s.italic,
            segment.changed && (side === 'removed' ? s.changedRemoved : s.changedAdded),
          ]}
        >
          {segment.text}
        </Text>
      ))}
    </>
  );
}
