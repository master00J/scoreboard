import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { callBridge as request, normalizeBaseUrl, parsePairCode } from './transport';
import { applyCommandToMatch, cloudMatchesFromState, extractMatchId, hasStoredCredentials, mergeLiveMatch, normalizeSnapshot, readCloudState } from './match-state';
import { loadSession, saveSession } from './session-store';

const EMPTY = { baseUrl: '', connectionMode: 'local', venueId: '', pairingCode: '', cloudPairToken: '', operatorPin: '', role: 'operator' };
const FRESH_MS = 9000;
export function useController() {
  const [config,setConfig] = useState(EMPTY);
  const [session,setSession] = useState(null);
  const [hydrated,setHydrated] = useState(false);
  const [snapshot,setSnapshot] = useState(null);
  const [activeMatchDetails,setDetails] = useState(null);
  const [matches,setMatches] = useState([]);
  const [network,setNetwork] = useState('disconnected');
  const [busy,setBusy] = useState(false);
  const [refreshing,setRefreshing] = useState(false);
  const [authenticating,setAuthenticating] = useState(false);
  const [notice,setNotice] = useState(null);
  const [nowMs,setNow] = useState(Date.now());
  const [foreground,setForeground] = useState(AppState.currentState !== 'background');
  const [cloudPendingUntil,setCloudPendingUntil] = useState(0);
  const current = useRef({});
  const generation = useRef(0);
  const controllers = useRef(new Set());
  const mutationLock = useRef(false);
  const authLock = useRef(false);
  const poll = useRef(null);
  const failures = useRef(0);
  const verifiedCloud = useRef(false);
  const lastContact = useRef(0);
  const lastListLoad = useRef(0);
  const snapshotRef = useRef(null);
  const detailsRef = useRef(null);
  const cloudGate = useRef(0);
  const alive = useRef(true);
  const reconnectAttempted = useRef(false);
  current.current = { config,session,network,foreground };

  const notify = useCallback((key,kind='info',values,details) => setNotice({ key,kind,values,details }),[]);
  const onStatus = useCallback((text,kind='info') => setNotice({ text,kind }),[]);
  const invalidate = useCallback(() => {
    generation.current++;
    controllers.current.forEach(controller=>controller.abort());
    controllers.current.clear();
    poll.current=null; snapshotRef.current=null; lastContact.current=0; lastListLoad.current=0;
    verifiedCloud.current=false; cloudGate.current=0; mutationLock.current=false; authLock.current=false;
    setBusy(false); setAuthenticating(false); setRefreshing(false); setCloudPendingUntil(0);
    setSnapshot(null); setDetails(null); detailsRef.current=null; setMatches([]);
  },[]);
  const disconnect = useCallback(() => {
    reconnectAttempted.current=false;
    invalidate(); setSession(null); setNetwork('disconnected'); setNotice(null);
    current.current.session=null;
    setConfig(value=>({...value,pairingCode:'',cloudPairToken:'',operatorPin:''}));
    return true;
  },[invalidate]);
  const expire = useCallback(() => {
    invalidate(); setSession(null); current.current.session=null; setNetwork('expired'); notify('connection.expired','warning');
  },[invalidate,notify]);
  const updateConfig = useCallback(patch => {
    reconnectAttempted.current=false;
    invalidate(); setSession(null); current.current.session=null; setNetwork('disconnected'); setNotice(null);
    const next={...current.current.config,...patch};
    current.current={...current.current,config:next,session:null};
    setConfig(next);
  },[invalidate]);
  const applyCode = useCallback(code => {
    try {
      const parsed=parsePairCode(code);
      updateConfig({...EMPTY,...parsed}); notify('connection.ready'); return true;
    } catch(error) { notify(`errors.${error.code || 'invalidPairCode'}`,'error'); return false; }
  },[updateConfig,notify]);
  const scopedRequest = useCallback(async (cfg,token,path,method='GET',body,options={}) => {
    const controller=new AbortController();
    const abortFromCaller=()=>controller.abort();
    if(options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort',abortFromCaller,{once:true});
    controllers.current.add(controller);
    try { return await request(cfg.baseUrl,token,path,method,body,{signal:controller.signal,timeoutMs:options.timeoutMs ?? 10000}); }
    finally {
      options.signal?.removeEventListener('abort',abortFromCaller);
      controllers.current.delete(controller);
    }
  },[]);
  function mayMutate() {
    const state=current.current;
    return !!state.session && state.session.role==='operator' && state.foreground && state.network==='connected'
      && Date.now()-lastContact.current<FRESH_MS && !!snapshotRef.current && Date.now()>=cloudGate.current;
  }

  const refresh = useCallback(async (force=false) => {
    if(poll.current) { await poll.current; if(!force) return; }
    const {config:cfg,session:auth}=current.current;
    if(!auth?.token || !current.current.foreground) return;
    const epoch=generation.current;
    const cloud=cfg.connectionMode==='cloud';
    const task=(async()=>{
      if(force) setRefreshing(true);
      try {
        const response=await scopedRequest(cfg,auth.token,cloud?'/api/control/state':'/mobile/snapshot');
        if(epoch!==generation.current || !alive.current) return;
        if(response.status===401) { expire(); return; }
        if(!response.ok) throw Object.assign(new Error('state'),{code:'network'});
        const raw=cloud?readCloudState(response.data):response.data;
        const previous=snapshotRef.current;
        const next=normalizeSnapshot(raw,previous);
        lastContact.current=Date.now(); failures.current=0;
        if(cloud && next && previous && Number.isFinite(next.timerElapsedAtMs)
          && next.timerElapsedAtMs!==previous.timerElapsedAtMs) verifiedCloud.current=true;
        if(cloud && Number.isFinite(response.data?.stateAgeMs) && response.data.stateAgeMs<FRESH_MS) verifiedCloud.current=true;
        snapshotRef.current=next; setSnapshot(next);
        const fresh=next && Date.now()-next._sampleReceivedAtMs<FRESH_MS;
        setNetwork(fresh && (!cloud || verifiedCloud.current)?'connected':'waiting');
        const matchId=extractMatchId(next);
        const snapshotMatch=raw?.activeMatch ?? raw?.match ?? null;
        if(cloud) {
          setMatches(cloudMatchesFromState(raw));
          const match=snapshotMatch?.id===matchId?snapshotMatch:null;
          detailsRef.current=match; setDetails(match);
        } else {
          if(snapshotMatch?.id===matchId) {
            const merged=mergeLiveMatch(detailsRef.current,snapshotMatch);
            detailsRef.current=merged; setDetails(merged);
          } else if(!matchId) {
            detailsRef.current=null; setDetails(null);
          }
          const needDetail=!!matchId && snapshotMatch?.id!==matchId;
          const needList=force || Date.now()-lastListLoad.current>15000;
          if(needDetail || needList) {
            const [detail,list]=await Promise.all([
              needDetail?scopedRequest(cfg,auth.token,`/mobile/api/matches/${encodeURIComponent(matchId)}`):null,
              needList?scopedRequest(cfg,auth.token,'/mobile/api/matches'):null,
            ]);
            if(epoch!==generation.current || !alive.current) return;
            if(detail?.status===401 || list?.status===401) { expire(); return; }
            if(detail?.ok && detail.data?.id===matchId) {
              const merged=mergeLiveMatch(detailsRef.current,detail.data);
              detailsRef.current=merged; setDetails(merged);
            }
            if(list?.ok && Array.isArray(list.data)) { setMatches(list.data); lastListLoad.current=Date.now(); }
          }
        }
      } catch(error) {
        if(epoch!==generation.current || !alive.current) return;
        failures.current++;
        let nextNetwork='reconnecting';
        if(!cloud) {
          try {
            const health=await scopedRequest(cfg,'','/mobile/health','GET',undefined,{timeoutMs:2500});
            if(epoch!==generation.current || !alive.current) return;
            if(!health.ok) nextNetwork='offline';
          } catch { nextNetwork='offline'; }
        }
        setNetwork(nextNetwork);
        if(force) notify(`errors.${error.code || 'network'}`,'error');
      } finally {
        if(epoch===generation.current && alive.current) setRefreshing(false);
      }
    })();
    poll.current=task;
    await task;
    if(poll.current===task) poll.current=null;
  },[expire,notify,scopedRequest]);

  const authenticate = useCallback(async () => {
    if(authLock.current) return false;
    invalidate(); authLock.current=true;
    const epoch=generation.current;
    const cfg={...current.current.config};
    setSession(null); current.current.session=null; setAuthenticating(true); setNetwork('connecting'); setNotice(null);
    try {
      cfg.baseUrl=normalizeBaseUrl(String(cfg.baseUrl||''),cfg.connectionMode);
      cfg.pairingCode=String(cfg.pairingCode||'');
      cfg.venueId=String(cfg.venueId||'');
      cfg.operatorPin=String(cfg.operatorPin||'');
      const cloud=cfg.connectionMode==='cloud';
      if((!cloud && !cfg.pairingCode.trim()) || (cloud && !cfg.venueId.trim())) throw Object.assign(new Error('credentials'),{code:'auth'});
      if(!cloud) {
        const health=await scopedRequest(cfg,'','/mobile/health','GET',undefined,{timeoutMs:4000});
        if(epoch!==generation.current || !alive.current) return false;
        if(!health.ok) throw Object.assign(new Error('health'),{code:'invalidResponse'});
      }
      const body=cloud?{venueId:cfg.venueId.trim(),role:cfg.role,pin:cfg.role==='operator'?cfg.operatorPin:undefined,pairToken:cfg.cloudPairToken||undefined}
        :{pairingCode:cfg.pairingCode.trim(),role:cfg.role,operatorPin:cfg.role==='operator'?cfg.operatorPin:undefined};
      const response=await scopedRequest(cfg,'',cloud?'/api/control/auth/session':'/mobile/auth/session','POST',body);
      if(epoch!==generation.current || !alive.current) return false;
      const token=cloud?response.data?.token:response.data?.sessionToken;
      if(!response.ok || !token) { notify('errors.auth','error',null,response.data?.error||response.data?.message); setNetwork('disconnected'); return false; }
      const auth={token,role:response.data.role==='operator'?'operator':'viewer',expiresAt:response.data.expiresAt || new Date(Date.now()+8*60*60*1000).toISOString()};
      cfg.role=auth.role;
      current.current={...current.current,config:cfg,session:auth};
      setConfig(cfg); setSession(auth); setNetwork('waiting');
      await refresh(true); return true;
    } catch(error) {
      if(epoch===generation.current && alive.current) { notify(`errors.${error.code || 'network'}`,'error'); setNetwork('disconnected'); }
      return false;
    } finally { if(epoch===generation.current && alive.current) { authLock.current=false; setAuthenticating(false); } }
  },[invalidate,notify,refresh,scopedRequest]);

  const connectWithCode = useCallback(async code => {
    if(!applyCode(code)) return false;
    return authenticate();
  },[applyCode,authenticate]);

  const sendCommand = useCallback(async (command, options={}) => {
    const quiet=!!options.quiet;
    if(mutationLock.current && !quiet) { notify('errors.busy','warning'); return false; }
    if(!mayMutate() && !options.allowStale) { notify('errors.notLive','warning'); return false; }
    if(!quiet) { mutationLock.current=true; setBusy(true); notify('command.sending'); }
    const epoch=generation.current;
    const {config:cfg,session:auth}=current.current;
    if(!auth?.token) return false;
    const cloud=cfg.connectionMode==='cloud';
    try {
      const response=await scopedRequest(cfg,auth.token,cloud?'/api/control/commands':'/mobile/command','POST',{command});
      if(epoch!==generation.current || !alive.current) return false;
      if(response.status===401) { expire(); return false; }
      if(!response.ok) { notify(cloud&&response.status===422?'errors.cloudUnsupported':'errors.command','error',null,response.data?.error||response.data?.message); return false; }
      if(!cloud && detailsRef.current) {
        const optimistic=applyCommandToMatch(detailsRef.current,command);
        detailsRef.current=optimistic; setDetails(optimistic);
      }
      if(!quiet) {
        if(cloud) { cloudGate.current=Date.now()+3500; setCloudPendingUntil(cloudGate.current); notify('command.queued'); }
        else notify('command.sent','success',null,response.data?.warning);
        await refresh(true);
      }
      return true;
    } catch(error) {
      if(epoch===generation.current && alive.current && !quiet) { notify('errors.uncertain','warning'); setNetwork('reconnecting'); }
      return false;
    } finally { if(!quiet && epoch===generation.current && alive.current) { mutationLock.current=false; setBusy(false); } }
  },[expire,notify,refresh,scopedRequest]);

  const callBridge = useCallback(async (baseUrl,token,path,method='GET',body,options) => {
    const epoch=generation.current;
    const {config:cfg,session:auth}=current.current;
    const write=method!=='GET';
    if(baseUrl!==cfg.baseUrl || token!==auth?.token) return {ok:false,status:401,data:null};
    if(write && mutationLock.current) return {ok:false,status:409,data:{error:'busy'}};
    if(write && !mayMutate()) return {ok:false,status:409,data:{error:'notLive'}};
    if(write) { mutationLock.current=true; setBusy(true); }
    try {
      const response=await scopedRequest(cfg,token,path,method,body,options);
      if(epoch!==generation.current || !alive.current) return {ok:false,status:499,data:null};
      if(response.status===401) expire();
      return response;
    } finally { if(write && epoch===generation.current && alive.current) { mutationLock.current=false; setBusy(false); } }
  },[expire,scopedRequest]);

  useEffect(()=>{
    alive.current=true;
    loadSession().then(value=>{
      if(!alive.current || !value) return;
      const cfg={...EMPTY,...value}; delete cfg.sessionToken; delete cfg.sessionExpiresAt;
      setConfig(cfg); current.current.config=cfg;
      const expiry=Date.parse(value.sessionExpiresAt||'');
      if(value.sessionToken && Number.isFinite(expiry) && expiry>Date.now()) {
        const auth={token:value.sessionToken,role:value.role==='operator'?'operator':'viewer',expiresAt:value.sessionExpiresAt};
        setSession(auth); current.current.session=auth; setNetwork('waiting');
      } else if(value.sessionToken) setNetwork('expired');
    }).catch(()=>notify('errors.storage','warning')).finally(()=>{if(alive.current)setHydrated(true);});
    return()=>{alive.current=false;generation.current++;controllers.current.forEach(controller=>controller.abort());};
  },[notify]);
  useEffect(()=>{
    if(!hydrated) return;
    void saveSession({...config,sessionToken:session?.token||'',sessionExpiresAt:session?.expiresAt||null,role:session?.role||config.role}).catch(()=>{if(alive.current)notify('errors.storage','warning');});
  },[config,session,hydrated,notify]);
  useEffect(()=>{
    const subscription=AppState.addEventListener('change',state=>{
      setForeground(state==='active'); current.current.foreground=state==='active';
      if(state!=='active') controllers.current.forEach(controller=>controller.abort());
    });
    return()=>subscription.remove();
  },[]);
  useEffect(()=>{
    if(!hydrated || !session || !foreground) return;
    let stopped=false,timer;
    const tick=async()=>{await refresh();if(!stopped)timer=setTimeout(tick,Math.min(15000,3000*2**Math.min(failures.current,3)));};
    void tick(); return()=>{stopped=true;clearTimeout(timer);};
  },[session,config.baseUrl,config.connectionMode,foreground,hydrated,refresh]);
  useEffect(()=>{
    if(!hydrated || session || authenticating || !foreground) return;
    if(network!=='expired' || reconnectAttempted.current || !hasStoredCredentials(config)) return;
    reconnectAttempted.current=true;
    void authenticate();
  },[hydrated,session,authenticating,foreground,network,config,authenticate]);
  useEffect(()=>{
    if(session && network==='connected') reconnectAttempted.current=false;
  },[session,network]);
  useEffect(()=>{
    if(!foreground) return;
    const timer=setInterval(()=>setNow(Date.now()),500); return()=>clearInterval(timer);
  },[foreground]);
  useEffect(()=>{
    if(session && Date.parse(session.expiresAt)<=nowMs) expire();
  },[nowMs,session,expire]);
  const age=lastContact.current?Math.max(0,nowMs-lastContact.current):Infinity;
  const state=network==='connected' && age>=FRESH_MS?'reconnecting':network;
  const connected=state==='connected' && foreground;
  const pending=busy || nowMs<cloudPendingUntil;
  return {config,sessionToken:session?.token||'',role:session?.role||config.role,hydrated,snapshot,activeMatchDetails,matches,
    state,connected,canCall:!!session,canMutate:connected&&session?.role==='operator'&&!pending,
    busy:pending,authenticating,refreshing,notice,nowMs,age,isCloud:config.connectionMode==='cloud',
    hasCredentials:hasStoredCredentials(config),
    updateConfig,applyCode,connectWithCode,authenticate,disconnect,refresh,sendCommand,callBridge,onStatus,notify,
    dismissNotice:()=>setNotice(null),clockNow:snapshot?Math.min(nowMs,snapshot._sampleReceivedAtMs+FRESH_MS):nowMs};
}
