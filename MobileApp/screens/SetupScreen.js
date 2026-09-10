import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Chip, ConfirmButton, EmptyState, Field, Sheet, sharedStyles as s } from '../components/ui';
import { createBridgeApi } from '../lib/bridgeApi';
import { useI18n } from '../lib/i18n';
import { colors } from '../lib/theme';

const SPORTS = ['FOOTBALL', 'FUTSAL', 'BASKETBALL', 'VOLLEYBALL', 'HOCKEY'];
const playerName = (p) => '#' + p.number + ' ' + [p.firstName, p.lastName].filter(Boolean).join(' ');
const encoded = (id) => encodeURIComponent(id);
function localDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function parseLocalDate(value) {
  if (!value.trim()) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!parts) throw new Error('date');
  const [year, month, day, hours, minutes] = parts.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes) throw new Error('date');
  return date.toISOString();
}

export function SetupScreen({ canCall, canMutate, isCloud, baseUrl, sessionToken, callBridge, onStatus }) {
  const { t, locale } = useI18n();
  const copy = useRef(t); copy.current = t;
  const status = useRef(onStatus); status.current = onStatus;
  const operation = useRef({ id: 0, controller: null, locked: false });
  const [teams, setTeams] = useState([]);
  const [settings, setSettings] = useState(null);
  const [matches, setMatches] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [draft, setDraft] = useState({});
  const [formError, setFormError] = useState('');
  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  const disabled = !canMutate || busy;

  const apiFor = useCallback((signal) => createBridgeApi({
    baseUrl, sessionToken, isCloud, callBridge: (...args) => callBridge(...args, { signal }),
  }), [baseUrl, sessionToken, isCloud, callBridge]);
  const fetchData = useCallback(async (signal) => {
    const api = apiFor(signal);
    const r = await Promise.all([api.get('/teams'), api.get('/settings'), api.get('/matches')]);
    if (r.some((item) => !item.ok) || !Array.isArray(r[0].data) || !r[1].data || Array.isArray(r[1].data) || typeof r[1].data !== 'object' || !Array.isArray(r[2].data)) throw new Error('load');
    return { teams: r[0].data, settings: r[1].data, matches: r[2].data };
  }, [apiFor]);
  const applyData = useCallback((data) => {
    setTeams(data.teams); setSettings(data.settings); setMatches(data.matches); setLoadError(false);
    setSelectedTeamId((current) => data.teams.some((team) => team.id === current) ? current : data.teams[0]?.id ?? null);
  }, []);
  const reload = useCallback(async () => {
    if (!canCall || isCloud || operation.current.locked) return;
    operation.current.controller?.abort();
    const controller = new AbortController();
    const id = ++operation.current.id;
    operation.current.controller = controller;
    setBusy(true);
    try {
      const data = await fetchData(controller.signal);
      if (id === operation.current.id && !controller.signal.aborted) applyData(data);
    } catch {
      if (id === operation.current.id && !controller.signal.aborted) {
        setLoadError(true); status.current?.(copy.current('setup.loadError'), 'error');
      }
    } finally { if (id === operation.current.id) setBusy(false); }
  }, [canCall, isCloud, fetchData, applyData]);
  useEffect(() => {
    setTeams([]); setSettings(null); setMatches([]); setSelectedTeamId(null); setSheet(null); setLoadError(false); setBusy(false);
    operation.current.locked = false;
    void reload();
    return () => { operation.current.id += 1; operation.current.controller?.abort(); };
  }, [reload]);

  async function mutate(request) {
    if (!canMutate || busy || operation.current.locked) return false;
    operation.current.locked = true; operation.current.controller?.abort();
    const controller = new AbortController();
    const id = ++operation.current.id;
    operation.current.controller = controller;
    setBusy(true); setFormError('');
    const current = () => id === operation.current.id && !controller.signal.aborted;
    try {
      const response = await request(apiFor(controller.signal));
      if (!current()) return false;
      if (!response.ok) {
        const message = response.status === 409
          ? t(response.data?.error === 'busy' ? 'errors.busy' : 'errors.notLive')
          : (response.data?.error || response.data?.message || t('setup.saveError'));
        setFormError(message); onStatus?.(message, 'error'); return false;
      }
      try {
        const data = await fetchData(controller.signal);
        if (!current()) return false;
        applyData(data); onStatus?.(t('setup.saved'), 'success');
      } catch {
        if (!current()) return false;
        setLoadError(true); onStatus?.(t('setup.savedRefreshError'), 'warning');
      }
      return true;
    } catch {
      if (current()) { setFormError(t('setup.saveError')); onStatus?.(t('setup.saveError'), 'error'); }
      return false;
    } finally { if (id === operation.current.id) { operation.current.locked = false; setBusy(false); } }
  }
  function openEditor(kind, entity = null) {
    setFormError(''); setSheet({ kind, entity });
    if (kind === 'team') setDraft({ name: entity?.name ?? '', shortName: entity?.shortName ?? '' });
    if (kind === 'player') setDraft({ number: String(entity?.number ?? ''), firstName: entity?.firstName ?? '', lastName: entity?.lastName ?? '', teamId: selectedTeamId });
    if (kind === 'match') setDraft({ homeTeamId: entity?.homeTeamId ?? teams[0]?.id ?? '', awayTeamId: entity?.awayTeamId ?? teams[1]?.id ?? '', sport: entity?.sport ?? 'FOOTBALL', kickoff: localDateInput(entity?.kickoffAt) });
  }
  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function saveEditor() {
    if (!sheet || disabled) return false;
    const entity = sheet.entity;
    let request;
    if (sheet.kind === 'team') {
      if (!draft.name?.trim()) { setFormError(t('setup.nameError')); return false; }
      const body = { name: draft.name.trim(), shortName: draft.shortName?.trim() || draft.name.trim().slice(0, 3).toUpperCase() };
      request = (api) => entity ? api.patch('/teams/' + encoded(entity.id), body) : api.post('/teams', { ...body, primaryColor: '#1d4ed8', secondaryColor: '#ffffff' });
    }
    if (sheet.kind === 'player') {
      if ((!draft.firstName?.trim() && !draft.lastName?.trim()) || !/^\d{1,3}$/.test(draft.number ?? '') || !draft.teamId) { setFormError(t('setup.playerError')); return false; }
      const body = { firstName: draft.firstName.trim(), lastName: draft.lastName.trim(), number: Number(draft.number) };
      request = (api) => entity ? api.patch('/players/' + encoded(entity.id), body) : api.post('/players', { ...body, teamId: draft.teamId, position: null, isCoach: false });
    }
    if (sheet.kind === 'match') {
      if (!draft.homeTeamId || !draft.awayTeamId || draft.homeTeamId === draft.awayTeamId) { setFormError(t('setup.matchTeamsError')); return false; }
      let kickoffAt;
      try { kickoffAt = parseLocalDate(draft.kickoff ?? ''); }
      catch { setFormError(t('setup.kickoffError')); return false; }
      const body = { kickoffAt, ...(!entity || entity.sport !== draft.sport ? { sport: draft.sport } : {}) };
      request = (api) => entity ? api.patch('/matches/' + encoded(entity.id), body) : api.post('/matches', { ...body, homeTeamId: draft.homeTeamId, awayTeamId: draft.awayTeamId });
    }
    if (request && await mutate(request)) { setSheet(null); return true; }
    return false;
  }
  if (isCloud) return <EmptyState title={t('setup.cloudTitle')} message={t('setup.cloudMessage')}/>;
  if (!canCall) return <EmptyState title={t('setup.connectTitle')} message={t('setup.connectMessage')}/>;
  const sheetTitle = sheet ? t('setup.' + (sheet.kind === 'team' ? sheet.entity ? 'editTeam' : 'addTeam' : sheet.kind === 'player' ? sheet.entity ? 'editPlayer' : 'addPlayer' : sheet.entity ? 'editMatch' : 'addMatch')) : '';
  return <>
    <Card title={t('setup.title')} subtitle={t('setup.subtitle')}>
      <Button label={t('setup.refresh')} variant="secondary" onPress={reload} loading={busy}/>
      {!canMutate && <Text style={s.muted}>{t('setup.viewer')}</Text>}
      {loadError && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{t('setup.loadError')}</Text>}
    </Card>
    <Card title={t('setup.homeTitle')}>
      <View style={s.row}>
        <Chip label={t('setup.noHome')} selected={!settings?.homeTeamId} disabled={disabled || !settings} onPress={() => mutate((api) => api.patch('/settings', { homeTeamId: null }))}/>
        {teams.map((team) => <Chip key={team.id} label={team.name} selected={settings?.homeTeamId === team.id} disabled={disabled || !settings} onPress={() => mutate((api) => api.patch('/settings', { homeTeamId: team.id }))}/>)}
      </View>
      {['Home', 'Away'].map((side) => {
        const key = 'goalVisual' + side + 'Enabled';
        return <View key={side} style={{ gap: 9 }}><Text style={s.text}>{t('setup.visual' + side)}</Text><View style={s.row}>
          {[true, false].map((enabled) => <Chip key={String(enabled)} label={t('setup.' + (enabled ? 'on' : 'off'))} selected={settings != null && (settings[key] ?? (side === 'Home')) === enabled} disabled={disabled || !settings} onPress={() => mutate((api) => api.patch('/settings', { [key]: enabled }))}/>)}
        </View></View>;
      })}
    </Card>
    <Card title={t('setup.teams')}>
      <Button label={t('setup.addTeam')} onPress={() => openEditor('team')} disabled={disabled}/>
      {!teams.length && !busy && <Text style={s.muted}>{t('setup.noTeams')}</Text>}
      <View style={s.row}>{teams.map((team) => <Chip key={team.id} label={team.name + ' · ' + (team.players?.length ?? 0)} selected={selectedTeamId === team.id} onPress={() => setSelectedTeamId(team.id)} disabled={busy}/>)}</View>
      {selectedTeam && <View style={s.row}>
        <Button label={t('setup.editTeam')} variant="secondary" onPress={() => openEditor('team', selectedTeam)} disabled={disabled}/>
        <ConfirmButton label={t('setup.remove')} title={t('setup.deleteTeam')} message={t('setup.deleteTeamMessage', { name: selectedTeam.name })} cancelLabel={t('setup.cancel')} confirmLabel={t('setup.remove')} disabled={disabled} onConfirm={() => mutate((api) => api.delete('/teams/' + encoded(selectedTeam.id)))}/>
      </View>}
    </Card>
    {selectedTeam ? <Card title={t('setup.players', { name: selectedTeam.name })} subtitle={t('setup.playersCount', { count: selectedTeam.players?.length ?? 0 })}>
      <Button label={t('setup.addPlayer')} onPress={() => openEditor('player')} disabled={disabled}/>
      {!selectedTeam.players?.length && <Text style={s.muted}>{t('setup.noPlayers')}</Text>}
      {(selectedTeam.players ?? []).map((player) => <View key={player.id} style={s.item}>
        <Text style={s.text}>{playerName(player)}</Text>
        <View style={s.row}><Button label={t('setup.edit')} variant="secondary" disabled={disabled} onPress={() => openEditor('player', player)}/>
          <ConfirmButton label={t('setup.remove')} title={t('setup.deletePlayer')} message={t('setup.deletePlayerMessage', { name: playerName(player) })} cancelLabel={t('setup.cancel')} disabled={disabled} onConfirm={() => mutate((api) => api.delete('/players/' + encoded(player.id)))}/>
        </View>
      </View>)}
      <Text style={s.muted}>{t('setup.photoHint')}</Text>
    </Card> : teams.length > 0 && <Text style={s.muted}>{t('setup.selectTeam')}</Text>}
    <Card title={t('setup.matches')}>
      <Button label={t('setup.addMatch')} onPress={() => openEditor('match')} disabled={disabled || teams.length < 2}/>
      {!matches.length && !busy && <Text style={s.muted}>{t('setup.noMatches')}</Text>}
      {matches.map((match) => <View key={match.id} style={s.item}>
        <Text style={s.title}>{match.homeTeam?.name ?? '—'} – {match.awayTeam?.name ?? '—'}</Text>
        <Text style={s.muted}>{t('setup.sport' + (SPORTS.includes(match.sport) ? match.sport : 'FOOTBALL'))} · {match.closedAt ? t('setup.closed') : match.kickoffAt && Number.isFinite(Date.parse(match.kickoffAt)) ? new Date(match.kickoffAt).toLocaleString(locale) : t('setup.noKickoff')}</Text>
        <View style={s.row}>
          <Button label={t('setup.edit')} variant="secondary" disabled={disabled || !!match.closedAt} onPress={() => openEditor('match', match)}/>
          <ConfirmButton label={t('setup.remove')} title={t('setup.deleteMatch')} message={t('setup.deleteMatchMessage', { home: match.homeTeam?.name ?? '—', away: match.awayTeam?.name ?? '—' })} cancelLabel={t('setup.cancel')} disabled={disabled} onConfirm={() => mutate((api) => api.delete('/matches/' + encoded(match.id)))}/>
        </View>
      </View>)}
    </Card>
    <Sheet visible={!!sheet} title={sheetTitle} closeLabel={t('setup.cancel')} onClose={() => !busy && setSheet(null)}>
      {sheet?.kind === 'team' && <>
        <Field label={t('setup.teamName')} value={draft.name ?? ''} onChangeText={(value) => updateDraft('name', value)} editable={!disabled} maxLength={100}/>
        <Field label={t('setup.shortName')} value={draft.shortName ?? ''} onChangeText={(value) => updateDraft('shortName', value)} editable={!disabled} maxLength={12}/>
      </>}
      {sheet?.kind === 'player' && <>
        <Field label={t('setup.number')} value={draft.number ?? ''} onChangeText={(value) => updateDraft('number', value)} keyboardType="number-pad" editable={!disabled} maxLength={3}/>
        <Field label={t('setup.firstName')} value={draft.firstName ?? ''} onChangeText={(value) => updateDraft('firstName', value)} editable={!disabled} maxLength={80}/>
        <Field label={t('setup.lastName')} value={draft.lastName ?? ''} onChangeText={(value) => updateDraft('lastName', value)} editable={!disabled} maxLength={80}/>
      </>}
      {sheet?.kind === 'match' && <>
        {['home', 'away'].map((side) => <View key={side} style={{ gap: 9 }}><Text style={s.text}>{t('setup.' + side)}</Text><View style={s.row}>
          {teams.map((team) => <Chip key={team.id} label={team.name} selected={draft[side + 'TeamId'] === team.id} disabled={disabled || !!sheet.entity} onPress={() => updateDraft(side + 'TeamId', team.id)}/>)}
        </View></View>)}
        <Text style={s.text}>{t('setup.sport')}</Text><View style={s.row}>{SPORTS.map((sport) => <Chip key={sport} label={t('setup.sport' + sport)} selected={draft.sport === sport} disabled={disabled} onPress={() => updateDraft('sport', sport)}/>)}</View>
        <Field label={t('setup.kickoff')} placeholder={t('setup.kickoffHint')} value={draft.kickoff ?? ''} onChangeText={(value) => updateDraft('kickoff', value)} editable={!disabled} autoCapitalize="none" maxLength={16}/>
        {sheet.entity && <Text style={s.muted}>{t('setup.matchEditHint')}</Text>}
      </>}
      {!!formError && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{formError}</Text>}
      <Button label={t('setup.save')} onPress={saveEditor} loading={busy} disabled={!canMutate}/>
      <Button label={t('setup.cancel')} variant="secondary" disabled={busy} onPress={() => setSheet(null)}/>
    </Sheet>
  </>;
}
