import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, EmptyState, Field, Sheet, sharedStyles as s } from '../components/ui';
import { createBridgeApi } from '../lib/bridgeApi';
import { useI18n } from '../lib/i18n';
import { colors } from '../lib/theme';

const BUDGETS = ['prematchSeconds', 'matchFirstHalfSeconds', 'halftimeSeconds', 'matchSecondHalfSeconds', 'postmatchSeconds'];
const seconds = (value) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export function MediaScreen({ canCall, canMutate, isCloud, baseUrl, sessionToken, callBridge, sendCommand, onStatus }) {
  const { t } = useI18n();
  const copy = useRef(t); copy.current = t;
  const status = useRef(onStatus); status.current = onStatus;
  const operation = useRef({ id: 0, controller: null, locked: false });
  const [data, setData] = useState({ sponsors: [], media: [], playlists: [] });
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [editingSponsor, setEditingSponsor] = useState(null);
  const [budgetDraft, setBudgetDraft] = useState({});
  const [budgetError, setBudgetError] = useState('');
  const disabled = !canMutate || busy;
  const apiFor = useCallback((signal) => createBridgeApi({
    baseUrl, sessionToken, isCloud, callBridge: (...args) => callBridge(...args, { signal }),
  }), [baseUrl, sessionToken, isCloud, callBridge]);
  const fetchData = useCallback(async (signal) => {
    const api = apiFor(signal);
    const r = await Promise.all([api.get('/sponsors'), api.get('/media'), api.get('/playlists')]);
    if (r.some((response) => !response.ok || !Array.isArray(response.data))) throw new Error('load');
    return { sponsors: r[0].data, media: r[1].data.filter((item) => item.active), playlists: r[2].data };
  }, [apiFor]);
  const reload = useCallback(async () => {
    if (!canCall || isCloud || operation.current.locked) return;
    operation.current.controller?.abort();
    const controller = new AbortController();
    const id = ++operation.current.id;
    operation.current.controller = controller; setBusy(true);
    try {
      const next = await fetchData(controller.signal);
      if (id === operation.current.id && !controller.signal.aborted) { setData(next); setLoadError(false); }
    } catch {
      if (id === operation.current.id && !controller.signal.aborted) {
        setLoadError(true); status.current?.(copy.current('media.loadError'), 'error');
      }
    } finally { if (id === operation.current.id) setBusy(false); }
  }, [canCall, isCloud, fetchData]);
  useEffect(() => {
    setData({ sponsors: [], media: [], playlists: [] }); setEditingSponsor(null); setQuery(''); setLoadError(false); setBusy(false);
    operation.current.locked = false;
    void reload();
    return () => { operation.current.id += 1; operation.current.controller?.abort(); };
  }, [reload]);

  async function patchSponsor(id, patch) {
    if (disabled || operation.current.locked) return false;
    operation.current.locked = true; operation.current.controller?.abort();
    const controller = new AbortController();
    const generation = ++operation.current.id;
    operation.current.controller = controller;
    setBusy(true); setBudgetError('');
    const current = () => generation === operation.current.id && !controller.signal.aborted;
    try {
      const response = await apiFor(controller.signal).patch('/sponsors/' + encodeURIComponent(id), patch);
      if (!current()) return false;
      if (!response.ok) {
        const message = response.status === 409
          ? t(response.data?.error === 'busy' ? 'errors.busy' : 'errors.notLive')
          : (response.data?.error || response.data?.message || t('media.saveError'));
        setBudgetError(message); onStatus?.(message, 'error'); return false;
      }
      try {
        const next = await fetchData(controller.signal);
        if (!current()) return false;
        setData(next); setLoadError(false); onStatus?.(t('media.saved'), 'success');
      } catch {
        if (!current()) return false;
        setLoadError(true); onStatus?.(t('media.savedRefreshError'), 'warning');
      }
      return true;
    } catch {
      if (current()) { setBudgetError(t('media.saveError')); onStatus?.(t('media.saveError'), 'error'); }
      return false;
    } finally {
      if (generation === operation.current.id) { operation.current.locked = false; setBusy(false); }
    }
  }
  function editBudgets(sponsor) {
    setEditingSponsor(sponsor); setBudgetError('');
    setBudgetDraft(Object.fromEntries(BUDGETS.map((key) => [key, String(seconds(sponsor[key] ?? (key === 'matchFirstHalfSeconds' ? sponsor.matchSeconds : 0)))])));
  }
  async function saveBudgets() {
    if (!editingSponsor || disabled) return false;
    if (BUDGETS.some((key) => !/^\d+$/.test(budgetDraft[key] ?? '') || Number(budgetDraft[key]) > 86400)) {
      setBudgetError(t('media.budgetError')); return false;
    }
    const patch = Object.fromEntries(BUDGETS.map((key) => [key, Number(budgetDraft[key])]));
    patch.matchSeconds = patch.matchFirstHalfSeconds + patch.matchSecondHalfSeconds;
    if (await patchSponsor(editingSponsor.id, patch)) { setEditingSponsor(null); return true; }
    return false;
  }
  async function play(mediaId, mode) {
    if (disabled || !mediaId || operation.current.locked) return false;
    operation.current.locked = true;
    const generation = operation.current.id; setBusy(true);
    try { return await sendCommand({ type: 'display:setMode', mode, meta: { activeMediaId: mediaId } }) === true; }
    catch { if (generation === operation.current.id) onStatus?.(t('media.playError'), 'error'); return false; }
    finally { if (generation === operation.current.id) { operation.current.locked = false; setBusy(false); } }
  }
  if (isCloud) return <EmptyState title={t('media.cloudTitle')} message={t('media.cloudMessage')}/>;
  if (!canCall) return <EmptyState title={t('media.connectTitle')} message={t('media.connectMessage')}/>;
  const visibleMedia = data.media.filter((item) => String(item.title ?? item.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const matchTotal = BUDGETS.filter((key) => key === 'matchFirstHalfSeconds' || key === 'matchSecondHalfSeconds').reduce((sum, key) => sum + (/^\d+$/.test(budgetDraft[key] ?? '') ? Number(budgetDraft[key]) : 0), 0);
  return <>
    <Card title={t('media.title')} subtitle={t('media.subtitle')}>
      <Button label={t('media.refresh')} variant="secondary" onPress={reload} loading={busy}/>
      {!canMutate && <Text style={s.muted}>{t('media.viewer')}</Text>}
      {loadError && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{t('media.loadError')}</Text>}
    </Card>
    <Card title={t('media.sponsors', { count: data.sponsors.length })}>
      {!data.sponsors.length && !busy && <Text style={s.muted}>{t('media.noSponsors')}</Text>}
      {data.sponsors.map((sponsor) => <View key={sponsor.id} style={s.item}>
        <View style={s.row}><Text style={[s.title, { flex: 1 }]}>{sponsor.name}</Text><Text style={{ color: sponsor.active ? colors.success : colors.muted }}>{t('media.' + (sponsor.active ? 'active' : 'inactive'))}</Text></View>
        <Text style={s.muted}>{t('media.matchTotal', { count: seconds(sponsor.matchFirstHalfSeconds ?? sponsor.matchSeconds) + seconds(sponsor.matchSecondHalfSeconds) })}</Text>
        <View style={s.row}>
          <Button label={t('media.budgets')} variant="secondary" disabled={busy} onPress={() => editBudgets(sponsor)}/>
          <Button label={t('media.' + (sponsor.active ? 'deactivate' : 'activate'))} variant="secondary" disabled={disabled} onPress={() => patchSponsor(sponsor.id, { active: !sponsor.active })}/>
        </View>
      </View>)}
    </Card>
    <Card title={t('media.library')} subtitle={t('media.uploadHint')}>
      <Field label={t('media.search')} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}/>
      {!visibleMedia.length && !busy && <Text style={s.muted}>{t('media.noMedia')}</Text>}
      {visibleMedia.map((item) => <View key={item.id} style={s.item}>
        <Text style={s.text}>{item.title || item.id}</Text>
        <View style={s.row}>
          {['VIDEO', 'IMAGE', 'AUDIO'].includes(item.type) && <Text style={[s.muted, { flex: 1 }]}>{t('media.' + item.type)}</Text>}
          <Button label={t('media.play')} accessibilityLabel={t('media.play') + ' · ' + (item.title || item.id)} variant="secondary" disabled={disabled} onPress={() => play(item.id, 'SPONSOR')}/>
        </View>
      </View>)}
    </Card>
    <Card title={t('media.playlists')}>
      {!data.playlists.length && !busy && <Text style={s.muted}>{t('media.noPlaylists')}</Text>}
      {data.playlists.map((playlist) => <View key={playlist.id} style={s.item}>
        <Text style={s.title}>{playlist.name || playlist.slot}</Text>
        {!playlist.items?.length && <Text style={s.muted}>{t('media.noItems')}</Text>}
        {(playlist.items ?? []).map((item) => <Button key={item.id} label={item.media?.title || t('media.inactiveItem')} variant="secondary" disabled={disabled || !item.mediaId || !item.media || !item.media.active} onPress={() => play(item.mediaId, 'CUSTOM')}/>)}
      </View>)}
    </Card>
    <Sheet visible={!!editingSponsor} title={t('media.budgetTitle', { name: editingSponsor?.name ?? '' })} subtitle={t('media.budgetHint')} closeLabel={t('media.cancel')} onClose={() => !busy && setEditingSponsor(null)}>
      {BUDGETS.map((key) => <Field key={key} label={t('media.' + key)} value={budgetDraft[key] ?? ''} onChangeText={(value) => setBudgetDraft((current) => ({ ...current, [key]: value }))} keyboardType="number-pad" maxLength={5} editable={!disabled}/>)}
      <Text style={s.text}>{t('media.matchTotal', { count: matchTotal })}</Text>
      {!!budgetError && <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{budgetError}</Text>}
      <Button label={t('media.save')} onPress={saveBudgets} loading={busy} disabled={!canMutate}/>
      <Button label={t('media.cancel')} variant="secondary" disabled={busy} onPress={() => setEditingSponsor(null)}/>
    </Sheet>
  </>;
}
