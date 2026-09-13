import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../lib/theme';

export function Button({ label, onPress, variant = 'primary', disabled, loading, style, accessibilityLabel }) {
  const muted = disabled || loading;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}
    accessibilityState={{ disabled: !!muted, busy: !!loading }} disabled={muted} onPress={onPress}
    style={({ pressed }) => [s.button, s[variant], pressed && !muted && s.pressed, muted && s.disabled, style]}>
    {loading && <ActivityIndicator color={variant === 'primary' ? colors.bg : colors.accent} size="small"/>}
    <Text style={[s.buttonText, variant === 'primary' && { color: colors.bg }, variant === 'danger' && { color: colors.danger }]}>{label}</Text>
  </Pressable>;
}
export function Card({ title, subtitle, children, style }) {
  return <View style={[s.card, style]}>{title && <Text accessibilityRole="header" style={s.title}>{title}</Text>}{subtitle && <Text style={s.muted}>{subtitle}</Text>}{children}</View>;
}
export function Field({ label, error, style, ...props }) {
  return <View style={[{ gap: 7 }, style]}>{label && <Text style={s.label}>{label}</Text>}<TextInput
    accessibilityLabel={label} placeholderTextColor="#71869f" selectionColor={colors.accent}
    style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, error && { borderColor: colors.danger }]} {...props}/>
    {error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}</View>;
}
export function Chip({ label, selected, onPress, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [s.chip, selected && s.chipSelected, disabled && s.disabled, pressed && s.pressed]}>
    <Text style={[s.chipText, selected && { color: colors.accent }]}>{label}</Text></Pressable>;
}
export function EmptyState({ title, message, onAction, actionLabel }) {
  return <Card style={{ paddingVertical: 28 }}>{title && <Text accessibilityRole="header" style={s.title}>{title}</Text>}<Text style={s.muted}>{message}</Text>{onAction && <Button label={actionLabel} onPress={onAction}/>}</Card>;
}
export function Sheet({ visible, title, subtitle, onClose, closeLabel, children }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <View style={s.backdrop}><View style={s.sheet} accessibilityViewIsModal>
      <View style={s.sheetHead}><View style={{ flex: 1, gap: 5 }}><Text accessibilityRole="header" style={s.sheetTitle}>{title}</Text>{subtitle && <Text style={s.muted}>{subtitle}</Text>}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={8} style={s.close}><Text style={{ color: colors.text, fontSize: 26 }}>×</Text></Pressable></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>{children}</ScrollView>
    </View></View>
  </Modal>;
}
export function ConfirmButton({ label, title, message, confirmLabel, cancelLabel, onConfirm, disabled, variant = 'danger', style }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function confirm() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { if (await onConfirm() !== false) setOpen(false); }
    finally { lock.current = false; setBusy(false); }
  }
  return <><Button label={label} variant={variant} disabled={disabled} onPress={() => setOpen(true)} style={style}/>
    <Sheet visible={open} title={title} onClose={() => !busy && setOpen(false)} closeLabel={cancelLabel}>
      <Text style={s.muted}>{message}</Text><Button label={confirmLabel || label} variant={variant} onPress={confirm} loading={busy}/>
      <Button label={cancelLabel} variant="secondary" onPress={() => setOpen(false)} disabled={busy}/>
    </Sheet></>;
}
export const sharedStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  column: { flex: 1, minWidth: 110, gap: 10 },
  text: { color: colors.text, fontSize: 16, lineHeight: 24 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  item: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 10 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
const s = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: 20, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 15 },
  title: { color: colors.text, fontSize: 19, fontWeight: '700', lineHeight: 25 },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  label: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  input: { backgroundColor: colors.bg, color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 12 },
  button: { minHeight: 50, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  primary: { backgroundColor: colors.accent }, secondary: { backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.line },
  danger: { backgroundColor: '#321d29', borderWidth: 1, borderColor: '#64303f' }, ghost: { backgroundColor: 'transparent' },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 15, textAlign: 'center' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] }, disabled: { opacity: 0.38 },
  chip: { minHeight: 46, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: colors.bg },
  chipSelected: { borderColor: colors.accent, backgroundColor: '#11323d' }, chipText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000000aa' },
  sheet: { backgroundColor: colors.panel, padding: 22, paddingBottom: 22, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '90%', width: '100%', maxWidth: 700, alignSelf: 'center' },
  sheetHead: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingBottom: 22 }, sheetTitle: { color: colors.text, fontSize: 23, fontWeight: '700' },
  close: { minWidth: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: colors.panelRaised },
});
