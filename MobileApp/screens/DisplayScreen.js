import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chip, ConfirmButton, sharedStyles as s } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { clockAdjustDelta, sportProfile } from '../lib/match-state';
import { colors } from '../lib/theme';

const MODES = ['MATCH', 'SPONSOR_ROTATION', 'IDLE', 'HALFTIME', 'FULLTIME', 'TEAM_INTRO', 'PLAYER_INTRO'];
const PRESETS = ['FIRST_HALF', 'SECOND_HALF', 'ET1', 'ET2'];
const KNOWN_MODES = [...MODES, 'BLACKOUT', 'SPONSOR', 'CUSTOM', 'GOAL', 'GOAL_INTRO_VIDEO', 'GOAL_PLAYER_VIDEO', 'SUBSTITUTION', 'CARD'];

export function DisplayScreen({ canMutate, sendCommand, snapshot, activeMatchDetails, onStatus }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = !canMutate || busy;
  const profile = sportProfile(activeMatchDetails?.sport);
  const activeMode = KNOWN_MODES.includes(snapshot?.mode) ? t('display.mode' + snapshot.mode) : t('display.unknown');
  async function act(command) {
    if (!canMutate || lock.current) return false;
    lock.current = true; setBusy(true);
    try { return await sendCommand(command) === true; }
    catch { if (mounted.current) onStatus?.(t('display.commandError'), 'error'); return false; }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const setMode = (mode, meta) => act({ type: 'display:setMode', mode, ...(meta ? { meta } : {}) });
  return <>
    <Card title={t('display.title')} subtitle={t('display.subtitle')}>
      <View style={{ padding: 14, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line }}>
        <Text accessibilityLiveRegion="polite" style={[s.text, { color: colors.accent }]}>{t('display.current', { mode: snapshot?.safeMode ? t('display.safeMode') : activeMode })}</Text>
      </View>
      {!canMutate && <Text style={s.muted}>{t('display.viewer')}</Text>}
      <View style={s.row}>{MODES.map((mode) => <Chip key={mode} label={t('display.mode' + mode)} selected={snapshot?.mode === mode && !snapshot?.safeMode} disabled={disabled || !!snapshot?.safeMode || ((!activeMatchDetails) && ['TEAM_INTRO', 'PLAYER_INTRO'].includes(mode))} onPress={() => setMode(mode)}/>)}</View>
    </Card>
    <Card title={t('display.safety')}>
      <Button label={t('display.' + (snapshot?.mode === 'BLACKOUT' ? 'restore' : 'blackout'))} variant={snapshot?.mode === 'BLACKOUT' ? 'primary' : 'danger'} disabled={disabled || !!snapshot?.safeMode} onPress={() => act({ type: 'display:blackout' })}/>
    </Card>
    <Card title={t('display.capture')} subtitle={t('display.captureHint')}>
      {!snapshot?.externalCaptureSourceId && <Text style={s.muted}>{t('display.noCapture')}</Text>}
      <View style={s.row}>{[true, false].map((enabled) => <Chip key={String(enabled)} label={t('display.' + (enabled ? 'on' : 'off'))} selected={snapshot != null && !!snapshot.externalCaptureToDisplay === enabled} disabled={disabled || !snapshot || !!snapshot.externalCaptureToDisplay === enabled || (enabled && (!snapshot.externalCaptureSourceId || snapshot.safeMode))} onPress={() => act({ type: 'display:setExternalCaptureToDisplay', enabled })}/>)}</View>
    </Card>
    {!!activeMatchDetails && profile.id === 'FOOTBALL' && <Card title={t('display.presets')}>
      {PRESETS.map((preset) => <ConfirmButton key={preset} label={t('display.preset' + preset)} variant="secondary" title={t('display.resetTitle')} message={t('display.resetMessage', { preset: t('display.preset' + preset) })} cancelLabel={t('display.cancel')} confirmLabel={t('display.save')} disabled={disabled} onConfirm={() => act({ type: 'timer:preset', preset })}/>)}
    </Card>}
    {!!activeMatchDetails && profile.timer !== 'none' && <Card title={t('display.adjust')}>
      <View style={s.row}>
        <Button label={t('display.minusMinute')} variant="secondary" disabled={disabled} onPress={() => act({ type: 'timer:adjust', deltaSec: clockAdjustDelta(profile, -60) })}/>
        <Button label={t('display.plusMinute')} variant="secondary" disabled={disabled} onPress={() => act({ type: 'timer:adjust', deltaSec: clockAdjustDelta(profile, 60) })}/>
      </View>
    </Card>}
    <Card title={t('display.intro')}>
      {!activeMatchDetails ? <Text style={s.muted}>{t('display.noMatch')}</Text> : <>
        <Button label={t('display.introBlank')} variant="secondary" disabled={disabled || !!snapshot?.safeMode} onPress={() => setMode('PLAYER_INTRO', { activePlayerId: null })}/>
        {[activeMatchDetails.homeTeam, activeMatchDetails.awayTeam].filter(Boolean).map((team) => <View key={team.id} style={{ gap: 10 }}>
          <Text style={s.title}>{team.name}</Text>
          {!team.players?.length && <Text style={s.muted}>{t('display.noPlayers')}</Text>}
          <View style={s.row}>{(team.players ?? []).map((player) => <Chip key={player.id} label={'#' + player.number + ' ' + [player.firstName, player.lastName].filter(Boolean).join(' ')} selected={snapshot?.mode === 'PLAYER_INTRO' && snapshot?.activePlayerId === player.id} disabled={disabled || !!snapshot?.safeMode} onPress={() => setMode('PLAYER_INTRO', { activePlayerId: player.id })}/>)}</View>
        </View>)}
        <Button label={t('display.returnMatch')} variant="secondary" disabled={disabled} onPress={() => setMode('MATCH')}/>
      </>}
    </Card>
  </>;
}
