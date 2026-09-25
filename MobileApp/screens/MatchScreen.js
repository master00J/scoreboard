import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ConfirmButton, EmptyState, Field, Sheet, sharedStyles as s } from '../components/ui';
import { colors } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import {
  BASKETBALL_LATE_TIMEOUT_MAX, basketballLateTimeoutBlocked, basketballLateTimeoutCounts, clockAdjustDelta, clockSetSeconds,
  computeBreakSeconds, computePenaltySeconds, computeShotClockSeconds, computeTimeoutSeconds, describePeriod, formatClock,
  formatCountdown, formatShotClock, formatSportClock, liveElapsedSeconds, nextOvertimePeriod, parseClockInput,
  periodDurationSecFor, periodStartElapsedSec, regularPeriodCount, splitFieldAndBench, sportClockSeconds, sportProfile,
  timeoutDurationSecForMatch, timeoutLimitForMatch,
} from '../lib/match-state';

const PHASES=['SETUP','PREMATCH','FIRST_HALF','HALF_TIME','SECOND_HALF','EXTRA_TIME','FULL_TIME','POST_MATCH'];
const SIDES=['home','away'];
const CARD_LABELS={GREEN:'match.green',YELLOW:'match.yellow',RED:'match.red'};
const CLOCK_STEPS=[-60,-10,-1,1,10,60];
const stepLabel=step=>`${step>0?'+':'−'}${Math.abs(step)>=60?`${Math.abs(step)/60} min`:`${Math.abs(step)} s`}`;

/** Tijd voor een lopende klok, met eigen cadans (tienden) en nooit verder dan de laatste geldige desktopmeting. */
function useLiveNow(active,intervalMs,limitMs) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{
    if(!active)return undefined;
    setNow(Date.now());
    const timer=setInterval(()=>setNow(Date.now()),intervalMs);
    return()=>clearInterval(timer);
  },[active,intervalMs]);
  return limitMs?Math.min(now,limitMs):now;
}
function GameClock({profile,match,snapshot,limitMs,style}) {
  const now=useLiveNow(!!snapshot?.timerRunning,profile.tenthsUnderMinute?100:250,limitMs);
  const seconds=sportClockSeconds(profile,liveElapsedSeconds(snapshot,now),match?.periodDurationSec,match?.currentPeriod);
  return <Text style={style} accessibilityRole="timer">{formatSportClock(profile,seconds)}</Text>;
}
function LiveCountdown({snapshot,running,read,format=formatCountdown,fast,limitMs,style}) {
  const now=useLiveNow(running,fast?100:250,limitMs);
  return <Text style={style} accessibilityRole="timer">{format(read(snapshot,now))}</Text>;
}
function StepButton({label,onPress,disabled,accessibilityLabel}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel||label} accessibilityState={{disabled:!!disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[local.step,disabled&&local.disabled,pressed&&!disabled&&{opacity:.7}]}><Text style={local.stepText}>{label}</Text></Pressable>;
}
function Counter({label,name,value,max,onAdjust,disabled,highlight,tag}) {
  return <View style={local.line}>
    <Text style={local.lineName} numberOfLines={1}>{label}</Text>
    <StepButton label="−" accessibilityLabel={`${name||label} −1`} disabled={disabled||value<=0} onPress={()=>onAdjust(-1)}/>
    <View style={local.counter}><Text style={[local.count,highlight&&{color:colors.danger}]}>{value}</Text>{!!tag&&<Text style={local.tag}>{tag}</Text>}</View>
    <StepButton label="+" accessibilityLabel={`${name||label} +1`} disabled={disabled||(max!=null&&value>=max)} onPress={()=>onAdjust(1)}/>
  </View>;
}
function PeriodButton({label,active,disabled,onPress}) {
  return <Pressable accessibilityRole="button" accessibilityState={{selected:!!active,disabled:!!disabled}} disabled={disabled} onPress={onPress}
    style={({pressed})=>[local.period,active&&local.periodActive,disabled&&local.disabled,pressed&&!disabled&&{opacity:.7}]}>
    <Text style={[local.periodText,active&&{color:colors.bg}]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text></Pressable>;
}
function PlayerPicker({players,selected,onSelect,excluded,label}) {
  const {t}=useI18n();const [query,setQuery]=useState('');
  const filtered=players.filter(player=>player.id!==excluded&&`${player.number} ${player.firstName} ${player.lastName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <View style={{gap:10}}>{label&&<Text style={s.title}>{label}</Text>}<Field label={t('common.search')} value={query} onChangeText={setQuery} autoCorrect={false}/>
    {!players.length&&<Text style={s.muted}>{t('match.noPlayers')}</Text>}
    <View style={{gap:8}}>{filtered.map(player=><Pressable key={player.id} accessibilityRole="button" accessibilityState={{selected:selected===player.id}}
      onPress={()=>onSelect(player.id)} style={[local.player,selected===player.id&&local.selected]}>
      <Text style={local.shirt}>#{player.number}</Text><Text style={[s.text,{flex:1}]}>{[player.firstName,player.lastName].filter(Boolean).join(' ')}</Text>
      {selected===player.id&&<Text style={{color:colors.accent,fontSize:18}}>✓</Text>}</Pressable>)}</View>
  </View>;
}
export function MatchScreen({controller:c,onConnect}) {
  const {t}=useI18n();const match=c.activeMatchDetails;const snapshot=c.snapshot;
  const profile=sportProfile(match?.sport);
  const [sheet,setSheet]=useState(null),[side,setSide]=useState('home'),[player,setPlayer]=useState(null),[playerIn,setPlayerIn]=useState(null);
  const [cardColor,setCardColor]=useState('YELLOW'),[added,setAdded]=useState('0'),[phase,setPhase]=useState('SETUP'),[confirm,setConfirm]=useState(null);
  const [clockDraft,setClockDraft]=useState(''),[clockError,setClockError]=useState('');
  const goalOpened=useRef(false);
  useEffect(()=>{setSheet(null);setConfirm(null);setPlayer(null);setPlayerIn(null);setSide('home');goalOpened.current=false;},[match?.id]);
  useEffect(()=>{
    if(sheet!=='goal' || !c.canCall) return;
    goalOpened.current=true;
    void c.sendCommand({type:'goal:prepare',side},{quiet:true,allowStale:true});
  },[sheet,side,c.canCall]);
  const closeGoal=confirmed=>{
    setSheet(null);
    if(!confirmed && goalOpened.current) void c.sendCommand({type:'goal:cancel'},{quiet:true,allowStale:true});
    goalOpened.current=false;
  };
  const team=match?.[side==='home'?'homeTeam':'awayTeam'];
  const players=useMemo(()=>(team?.players||[]).filter(value=>!value.isCoach),[team?.players]);
  const {onField,bench}=useMemo(()=>splitFieldAndBench(team,match?.[side==='home'?'homeFieldPlayerIds':'awayFieldPlayerIds'],profile.fieldPlayers),[team,match,side,profile.fieldPlayers]);
  const period=Number(match?.currentPeriod||1);
  const inPrematch=match?.status==='PREMATCH'||match?.status==='SETUP';
  const elapsed=liveElapsedSeconds(snapshot,c.clockNow);
  const duration=periodDurationSecFor(profile,period,match?.periodDurationSec);
  const gameClock=sportClockSeconds(profile,elapsed,match?.periodDurationSec,period);
  const running=!!snapshot?.timerRunning;
  const periodEnded=!!match&&profile.timer==='down'&&duration>0&&elapsed>=duration-1e-6;
  const breakLeft=computeBreakSeconds(snapshot,c.clockNow);
  const timeoutLeft=computeTimeoutSeconds(snapshot,c.clockNow);
  const timeoutRunning=!!snapshot?.timeoutRunning&&timeoutLeft>0;
  const timeoutLimit=match?timeoutLimitForMatch(profile,match):0;
  const timeoutSeconds=timeoutDurationSecForMatch(profile,match);
  const technicalSeconds=Number(match?.technicalTimeoutDurationSec)>0?Math.max(5,Math.min(180,Math.floor(Number(match.technicalTimeoutDurationSec)))):60;
  const overtimeAvailable=profile.overtimeDurationSec>0&&profile.maxOvertimePeriods>0;
  const inOvertime=period>profile.periods&&!profile.hasSets;
  const nextOvertime=nextOvertimePeriod(profile,period);
  const command=async (value, options)=>{
    const ok=await c.sendCommand(value, options);
    // Ook bij een fout sluiten: meldingen verschijnen onder het blad en zouden anders onzichtbaar blijven.
    if(sheet==='goal'&&!ok){closeGoal(false);return ok;}
    if(sheet==='goal')goalOpened.current=false;
    setSheet(null);
    return ok;
  };
  const chooseSide=value=>{setSide(value);setPlayer(null);setPlayerIn(null);};
  const open=(value,teamSide)=>{
    if(teamSide)chooseSide(teamSide);else{setPlayer(null);setPlayerIn(null);}
    setSheet(value);
    if(value==='clock'){setAdded(String(snapshot?.addedTimeMinutes||0));setClockError('');setClockDraft(profile.timer==='down'?formatCountdown(gameClock):formatClock(gameClock));}
    if(value==='phase')setPhase(match?.status||'SETUP');
    if(value==='card')setCardColor(profile.cards.includes('YELLOW')?'YELLOW':profile.cards[0]||'YELLOW');
  };
  const teamName=teamSide=>match?.[`${teamSide}Team`]?.name||t(`common.${teamSide}`);
  const canOperate=c.canCall&&c.role==='operator'&&!!match;
  const disabled=!canOperate||!c.canMutate;
  const sideSelector=<View style={s.row}>{SIDES.map(value=><Chip key={value} label={teamName(value)} selected={side===value} onPress={()=>chooseSide(value)}/>)}</View>;
  const periodName=value=>{
    const d=describePeriod(profile,value);
    if(d.kind==='overtime')return d.numbered?t('period.overtimeN',{n:d.index}):t('period.overtime');
    if(d.kind==='half')return t(d.index===1?'period.half1':'period.half2');
    return t(d.kind==='set'?'period.setN':'period.quarterN',{n:d.index});
  };
  const periodShort=value=>{
    const d=describePeriod(profile,value);
    if(d.kind==='quarter')return t('period.quarterShort',{n:d.index});
    if(d.kind==='overtime'&&d.numbered)return t('period.overtimeShort',{n:d.index});
    return periodName(value);
  };
  const askPeriod=next=>setConfirm({title:t('live.periodTitle',{period:periodName(next)}),message:t('match.periodBody'),command:{type:'sport:setPeriod',period:next}});
  const askPhase=status=>setConfirm({title:t('live.phaseTitle'),message:t('live.phaseBody',{phase:t(`status.${status}`)}),command:{type:'match:setStatus',status}});
  const runConfirmed=async()=>{const value=confirm?.command;setConfirm(null);if(value)await c.sendCommand(value);};
  const applyClock=async()=>{
    const value=parseClockInput(clockDraft);
    if(value==null){setClockError(t('clock.invalid'));return;}
    if(profile.timer==='down'&&value>duration){setClockError(t('clock.tooLong',{max:formatCountdown(duration)}));return;}
    setClockError('');
    await command({type:'timer:set',seconds:clockSetSeconds(profile,match,value)});
  };
  const clockColor=running?colors.success:periodEnded?colors.danger:colors.warning;
  const statLabel=profile.stat?t(`stat.${profile.id}`):null;
  const periodButtons=match?[
    {id:'pre',label:t('live.prematch'),active:inPrematch,onPress:()=>askPhase('PREMATCH')},
    ...Array.from({length:regularPeriodCount(profile,match)},(_,index)=>index+1).map(value=>({id:`p${value}`,label:periodShort(value),active:!inPrematch&&period===value,onPress:()=>askPeriod(value)})),
    // In de verlenging: de huidige verlenging actief en een aparte knop voor de volgende.
    ...(!overtimeAvailable?[]:inOvertime?[
      {id:`ot${period}`,label:periodShort(period),active:!inPrematch,onPress:()=>askPeriod(period)},
      ...(nextOvertime>period?[{id:'ot-next',label:periodShort(nextOvertime),onPress:()=>askPeriod(nextOvertime)}]:[]),
    ]:[{id:'ot',label:t('live.overtime'),onPress:()=>askPeriod(nextOvertime)}]),
    {id:'pause',label:t('live.pause'),active:match.status==='HALF_TIME',onPress:()=>askPhase('HALF_TIME')},
    {id:'end',label:t('live.end'),active:match.status==='FULL_TIME',onPress:()=>askPhase('FULL_TIME')},
  ]:[];

  return <>
    {!c.canCall?<EmptyState title={t('connection.title')} message={t('connection.intro')} actionLabel={t('connection.connect')} onAction={onConnect}/>
      :!match?<EmptyState title={t('match.noMatch')} message={t('match.chooseHint')} actionLabel={t('match.choose')} onAction={()=>open('matches')}/>
      :<>
        <View style={local.matchHeading}><View style={{flex:1,gap:5}}><Text style={local.eyebrow}>{t(`sport.${profile.id}`)} · {inPrematch?t('status.PREMATCH'):periodName(period)}</Text><Text style={s.muted}>{t(`status.${match.status||'SETUP'}`)}</Text></View>
          <Pressable onPress={()=>open('matches')} accessibilityRole="button" accessibilityLabel={t('match.change')} style={local.headerAction}><Text style={{color:colors.accent,fontSize:20}}>⇄</Text></Pressable></View>
        <View style={local.scoreboard}>
          <View style={local.clockBlock}>
            {profile.timer==='none'?<Text style={local.clock}>—</Text>
              :<GameClock profile={profile} match={match} snapshot={snapshot} limitMs={c.clockLimitMs} style={[local.clock,{color:clockColor}]}/>}
            <Text style={local.clockState}>{t(profile.timer==='none'?'match.noTimer':running?'match.running':'match.paused')}{snapshot?.addedTimeMinutes>0?` · +${snapshot.addedTimeMinutes}′`:''}</Text>
            {periodEnded&&!running&&<Text style={local.ended}>{t('live.periodEnded')}</Text>}
          </View>
          <View style={local.scoreRow}>{SIDES.map((teamSide,index)=><View key={teamSide} style={[local.scoreSide,index===1&&local.awaySide]}>
            <Text style={local.teamHint}>{t(`common.${teamSide}`)}</Text><Text style={local.teamName}>{teamName(teamSide)}</Text><Text style={local.score}>{Number(match[`${teamSide}Score`]||0)}</Text>
            <View style={local.pointButtons}>{profile.increments.map(points=><Pressable key={points} accessibilityRole="button" accessibilityLabel={`${teamName(teamSide)} +${points}`} accessibilityState={{disabled:!canOperate}}
              disabled={!canOperate} style={({pressed})=>[local.point,!canOperate&&local.disabled,pressed&&{opacity:.7}]}
              onPress={()=>profile.score==='Goal'?open('goal',teamSide):c.sendCommand({type:'score:adjust',side:teamSide,delta:points})}>
              <Text style={local.pointValue}>+{points}</Text>{profile.increments.length===1&&<Text style={local.pointLabel}>{t(profile.score==='Goal'?'match.goal':'match.points')}</Text>}</Pressable>)}</View>
          </View>)}</View>
          {profile.timer!=='none'&&<Button label={t(running?'match.pause':'match.start')} disabled={disabled||(!running&&periodEnded)} onPress={()=>c.sendCommand({type:running?'timer:pause':'timer:start'})} style={{margin:16}}/>}
        </View>

        {breakLeft>0&&<View style={[local.banner,local.breakBanner]}>
          <Text style={[local.bannerLabel,{color:colors.accent}]}>{t('live.breakRunning')}</Text>
          <LiveCountdown snapshot={snapshot} running={!!snapshot?.breakRunning} read={computeBreakSeconds} limitMs={c.clockLimitMs} style={[local.bannerClock,{color:colors.accent}]}/>
        </View>}
        {timeoutRunning&&<View style={[local.banner,local.timeoutBanner]}>
          <View style={{flex:1,gap:2}}>
            <Text style={[local.bannerLabel,{color:colors.warning}]}>{t(snapshot?.timeoutSide==='technical'?'live.technicalTimeout':'live.timeoutRunning')}{SIDES.includes(snapshot?.timeoutSide)?` · ${teamName(snapshot.timeoutSide)}`:''}</Text>
            <LiveCountdown snapshot={snapshot} running read={computeTimeoutSeconds} limitMs={c.clockLimitMs} style={[local.bannerClock,{color:colors.warning}]}/>
          </View>
          <Button label={t('live.endTimeout')} disabled={disabled} onPress={()=>c.sendCommand(profile.hasSets?{type:'sport:resumePlay'}:{type:'timeout:clear'})}/>
        </View>}

        {profile.shot.length>0&&<Card title={t('match.shotClock')}>
          <View style={local.shotRow}>
            {snapshot?.shotClockOff?<Text style={[local.shot,{color:colors.muted}]}>{t('live.shotOff')}</Text>
              :<LiveCountdown snapshot={snapshot} running={!!snapshot?.shotClockRunning} read={computeShotClockSeconds} format={formatShotClock} fast limitMs={c.clockLimitMs}
                style={[local.shot,{color:snapshot?.shotClockRunning?colors.danger:colors.warning}]}/>}
            <Button label={t(snapshot?.shotClockRunning?'live.shotPause':'live.shotStart')} disabled={disabled} style={{flex:1}}
              onPress={()=>c.sendCommand({type:snapshot?.shotClockRunning?'shotclock:pause':'shotclock:start'})}/>
          </View>
          <View style={s.row}>{profile.shot.map(seconds=><Button key={seconds} label={t('match.resetShot',{seconds})} variant="secondary" disabled={disabled} style={{flex:1}} onPress={()=>c.sendCommand({type:'shotclock:reset',seconds})}/>)}</View>
          <Text style={s.muted}>{t('live.shotHint')}</Text>
        </Card>}

        {(timeoutLimit>0||statLabel||profile.hasSets)&&<Card>
          {timeoutLimit>0&&<View style={{gap:10}}>
            <Text style={local.section}>{t('live.timeouts',{n:timeoutLimit})}</Text>
            {SIDES.map(teamSide=>{
              const used=Number(match[`${teamSide}Timeouts`]||0);
              const lateUsed=Number(match[`${teamSide}LateTimeouts`]||0);
              const inLate=basketballLateTimeoutCounts(profile,period,gameClock);
              const blocked=used>=timeoutLimit||timeoutRunning||basketballLateTimeoutBlocked(profile,period,gameClock,lateUsed);
              return <View key={teamSide} style={{gap:8}}>
                <View style={local.line}>
                  <Text style={local.lineName} numberOfLines={1}>{teamName(teamSide)}</Text>
                  {inLate&&<Text style={local.late}>{t('live.timeoutLate',{used:lateUsed,max:BASKETBALL_LATE_TIMEOUT_MAX})}</Text>}
                  <Text style={local.count}>{used}<Text style={local.countMax}>/{timeoutLimit}</Text></Text>
                </View>
                <View style={local.line}>
                  <StepButton label="−" accessibilityLabel={`${teamName(teamSide)} ${t('live.timeoutStart')} −1`} disabled={disabled||used<=0} onPress={()=>c.sendCommand({type:'sport:statAdjust',stat:'timeout',side:teamSide,delta:-1})}/>
                  <Button label={`${t('live.timeoutStart')}${timeoutSeconds>0?` ${timeoutSeconds}s`:''}`} variant={blocked?'secondary':'primary'} disabled={disabled||blocked} style={{flex:1}}
                    onPress={()=>c.sendCommand({type:'timeout:start',side:teamSide})}/>
                </View>
              </View>;
            })}
            {profile.hasSets&&<Button label={`${t('live.technicalTimeout')} ${technicalSeconds}s`} variant="secondary" disabled={disabled||timeoutRunning}
              onPress={()=>c.sendCommand({type:'timeout:start',side:'technical',seconds:technicalSeconds})}/>}
          </View>}
          {!!statLabel&&<View style={{gap:10}}>
            <Text style={local.section}>{profile.statLimit?t('live.statLimit',{label:statLabel,n:profile.statLimit+1}):statLabel}</Text>
            {SIDES.map(teamSide=>{
              const fouls=Number(match[`${teamSide}Fouls`]||0);
              const bonus=profile.foulBonusFrom!=null&&fouls>=profile.foulBonusFrom;
              return <Counter key={teamSide} label={teamName(teamSide)} name={`${statLabel} ${teamName(teamSide)}`} value={fouls} highlight={bonus} tag={bonus?t('live.bonus'):null} disabled={disabled}
                onAdjust={delta=>c.sendCommand({type:'sport:statAdjust',stat:'foul',side:teamSide,delta})}/>;
            })}
          </View>}
          {profile.hasSets&&<View style={{gap:10}}>
            <Text style={local.section}>{t('match.set')}</Text>
            {SIDES.map(teamSide=><Counter key={teamSide} label={teamName(teamSide)} name={`${t('match.set')} ${teamName(teamSide)}`} value={Number(match[`${teamSide}Sets`]||0)} disabled={disabled}
              onAdjust={delta=>c.sendCommand({type:'sport:statAdjust',stat:'set',side:teamSide,delta})}/>)}
            <Text style={local.section}>{t('live.serving')}</Text>
            <View style={s.row}>{SIDES.map(teamSide=><Chip key={teamSide} label={teamName(teamSide)} selected={match.servingSide===teamSide} disabled={disabled} onPress={()=>c.sendCommand({type:'sport:setServing',side:teamSide})}/>)}</View>
          </View>}
        </Card>}

        {profile.possessionArrow&&<Card title={t('live.possession')}>
          <View style={s.row}>{SIDES.map(teamSide=><Chip key={teamSide} label={teamSide==='home'?`◀ ${teamName('home')}`:`${teamName('away')} ▶`} selected={match.possessionArrow===teamSide} disabled={disabled}
            onPress={()=>c.sendCommand({type:'sport:setPossession',side:teamSide})}/>)}</View>
        </Card>}

        {profile.penalty.length>0&&<Card title={t('live.penaltyClock')} subtitle={profile.penaltyFollowsClock?t('live.penaltyFollows'):undefined}>
          {SIDES.map(teamSide=>{
            const remaining=computePenaltySeconds(snapshot,teamSide,c.clockNow);
            const penaltyRunning=!!snapshot?.[`${teamSide}PenaltyRunning`];
            return <View key={teamSide} style={{gap:8}}>
              <View style={local.line}><Text style={local.lineName} numberOfLines={1}>{teamName(teamSide)}</Text>
                <LiveCountdown snapshot={snapshot} running={penaltyRunning} read={(value,now)=>computePenaltySeconds(value,teamSide,now)} limitMs={c.clockLimitMs}
                  style={[local.count,{color:remaining>0?(penaltyRunning?colors.warning:colors.muted):colors.text}]}/></View>
              <View style={s.row}>{profile.penalty.map(seconds=><Button key={seconds} label={`${Math.round(seconds/60)}′`} variant="secondary" disabled={disabled} style={{flex:1}}
                onPress={()=>c.sendCommand({type:'penalty:start',side:teamSide,seconds})}/>)}
                <Button label={t('live.clearPenalty')} variant="secondary" disabled={disabled||remaining<=0} style={{flex:1}} onPress={()=>c.sendCommand({type:'penalty:clear',side:teamSide})}/></View>
            </View>;
          })}
        </Card>}

        <Card title={t('match.period')}>
          <View style={local.periodGrid}>{periodButtons.map(item=><PeriodButton key={item.id} label={item.label} active={item.active} disabled={disabled||item.disabled} onPress={item.onPress}/>)}</View>
          {match.status==='HALF_TIME'&&(profile.hasSets||profile.id==='BASKETBALL')&&<Button label={t('live.resume')} disabled={disabled} onPress={()=>c.sendCommand({type:'sport:resumePlay'})}/>}
        </Card>

        <View style={local.actionGrid}>{[
          ['sub','match.sub'],['card','match.card'],['clock','match.advanced'],['phase','match.phase'],['score','match.scoreCorrection'],
        ].filter(([id])=>(id!=='clock'||profile.timer!=='none')&&(id!=='card'||profile.cards.length>0)).map(([id,key])=><Pressable key={id} accessibilityRole="button" accessibilityLabel={t(key)} onPress={()=>open(id)} style={({pressed})=>[local.action,pressed&&{backgroundColor:colors.panelRaised}]}>
          <Text style={local.actionLabel}>{t(key)}</Text></Pressable>)}</View>
      </>}

    <Sheet visible={!!confirm} title={confirm?.title} closeLabel={t('common.cancel')} onClose={()=>setConfirm(null)}>
      <Text style={s.muted}>{confirm?.message}</Text>
      <Button label={t('common.confirm')} disabled={disabled} onPress={runConfirmed}/>
      <Button label={t('common.cancel')} variant="secondary" onPress={()=>setConfirm(null)}/>
    </Sheet>
    <Sheet visible={sheet==='matches'} title={t('match.choose')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      <Button label={t('common.refresh')} variant="secondary" loading={c.refreshing} onPress={()=>c.refresh(true)}/>
      {!c.matches.length&&<Text style={s.muted}>{t('match.noMatches')}</Text>}
      {c.matches.map(value=><Card key={value.id} title={`${value.homeTeam?.name||t('common.home')} · ${value.awayTeam?.name||t('common.away')}`} subtitle={`${t(`sport.${sportProfile(value.sport).id}`)} · ${value.homeScore||0} — ${value.awayScore||0}`}>
        <ConfirmButton label={t('match.activate')} title={t('match.activate')} message={t('match.activateBody')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} variant="primary"
          disabled={!c.canMutate||value.id===match?.id} onConfirm={()=>command({type:'match:setActive',matchId:value.id})}/></Card>)}
    </Sheet>
    <Sheet visible={sheet==='goal'} title={t('match.scorer')} subtitle={`${teamName(side)} · ${t('match.goalHint')}`} closeLabel={t('common.cancel')} onClose={()=>!c.busy&&closeGoal(false)}>
      <PlayerPicker players={onField.length?onField:players} selected={player} onSelect={setPlayer}/>
      <Button label={t('match.confirmGoal')} disabled={!canOperate||!player} loading={c.busy} onPress={()=>command({type:'goal:trigger',side,scorerId:player},{allowStale:true})}/>
      <Button label={t('match.withoutScorer')} variant="secondary" disabled={!canOperate} onPress={()=>command({type:'goal:trigger',side},{allowStale:true})}/>
    </Sheet>
    <Sheet visible={sheet==='card'} title={t('match.card')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      {sideSelector}<PlayerPicker players={players} selected={player} onSelect={setPlayer}/>
      <View style={s.row}>{profile.cards.map(value=><Chip key={value} selected={cardColor===value} onPress={()=>setCardColor(value)} label={t(CARD_LABELS[value])}/>)}</View>
      <Button label={t('match.confirmCard')} disabled={disabled||!player||!profile.cards.includes(cardColor)} loading={c.busy} onPress={()=>command({type:'card:trigger',teamId:team.id,playerId:player,color:cardColor})}/>
    </Sheet>
    <Sheet visible={sheet==='sub'} title={t('match.sub')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      {sideSelector}
      <Text style={s.muted}>{t('match.subHint')}</Text>
      <PlayerPicker players={onField} selected={player} excluded={playerIn} onSelect={setPlayer} label={t('match.playerOut')}/>
      {!onField.length&&<Text style={s.muted}>{t('match.noOnField')}</Text>}
      <PlayerPicker players={bench} selected={playerIn} excluded={player} onSelect={setPlayerIn} label={t('match.playerIn')}/>
      {!bench.length&&<Text style={s.muted}>{t('match.noBench')}</Text>}
      <Button label={t('match.confirmSub')} disabled={disabled||!player||!playerIn||player===playerIn} loading={c.busy} onPress={()=>command({type:'sub:trigger',teamId:team.id,playerOutId:player,playerInId:playerIn})}/>
    </Sheet>
    <Sheet visible={sheet==='clock'} title={t('match.advanced')} subtitle={match?`${periodName(period)} · ${formatSportClock(profile,gameClock)}`:undefined} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      <Field label={t('clock.set')} placeholder={t('clock.setHint')} value={clockDraft} onChangeText={value=>{setClockDraft(value);setClockError('');}} error={clockError||undefined}
        keyboardType="numbers-and-punctuation" autoCorrect={false} maxLength={6}/>
      <Button label={t('clock.apply')} disabled={disabled||!clockDraft.trim()} onPress={applyClock}/>
      <Text style={s.title}>{t('clock.adjust')}</Text>
      <Text style={s.muted}>{t('clock.adjustHint')}</Text>
      <View style={local.stepGrid}>{CLOCK_STEPS.map(step=><Button key={step} label={stepLabel(step)} variant="secondary" disabled={disabled} style={local.clockStep}
        onPress={()=>c.sendCommand({type:'timer:adjust',deltaSec:clockAdjustDelta(profile,step)})}/>)}</View>
      {profile.injuryTime&&<><Field label={t('match.added')} value={added} onChangeText={setAdded} keyboardType="number-pad" maxLength={2}/>
        <Button label={t('common.save')} disabled={disabled||!/^\d{1,2}$/.test(added)||Number(added)>30} onPress={()=>command({type:'timer:setAddedTime',minutes:Number(added)})}/></>}
      <ConfirmButton label={t('match.resetClock')} title={t('match.resetClock')} message={t('match.resetBody')} cancelLabel={t('common.cancel')} confirmLabel={t('common.confirm')} disabled={disabled}
        onConfirm={()=>command({type:'timer:set',seconds:periodStartElapsedSec(profile,match,period)})}/>
    </Sheet>
    <Sheet visible={sheet==='phase'} title={t('match.phase')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      <View style={s.row}>{PHASES.map(value=><Chip key={value} label={t(`status.${value}`)} selected={phase===value} onPress={()=>setPhase(value)}/>)}</View>
      <Button label={t('common.confirm')} disabled={disabled||phase===match?.status} onPress={()=>command({type:'match:setStatus',status:phase})}/>
    </Sheet>
    <Sheet visible={sheet==='score'} title={t('match.scoreCorrection')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      {SIDES.map(teamSide=><Card key={teamSide} title={`${teamName(teamSide)} · ${match?.[`${teamSide}Score`]||0}`}><View style={s.row}>{[-1,1].map(delta=><Button key={delta} label={delta>0?'+1':'−1'} variant="secondary" style={{flex:1}} disabled={disabled||(delta<0&&!match?.[`${teamSide}Score`])} onPress={()=>c.sendCommand({type:'score:adjust',side:teamSide,delta})}/>)}</View></Card>)}
    </Sheet>
  </>;
}
const local=StyleSheet.create({
  matchHeading:{flexDirection:'row',alignItems:'center',gap:14},eyebrow:{color:colors.accent,fontSize:13,fontWeight:'700'},headerAction:{width:46,height:46,borderRadius:14,backgroundColor:colors.panel,alignItems:'center',justifyContent:'center'},
  scoreboard:{backgroundColor:colors.panel,borderRadius:24,borderWidth:1,borderColor:colors.line,overflow:'hidden'},clockBlock:{alignItems:'center',paddingTop:18,paddingBottom:20,gap:3,paddingHorizontal:12},
  clock:{color:colors.text,fontSize:60,fontWeight:'700',fontVariant:['tabular-nums'],letterSpacing:-2},clockState:{color:colors.muted,fontSize:13},ended:{color:colors.danger,fontSize:13,fontWeight:'600',textAlign:'center',marginTop:4},
  scoreRow:{flexDirection:'row',borderTopWidth:1,borderTopColor:colors.line},
  scoreSide:{flex:1,alignItems:'center',padding:14,gap:5,backgroundColor:'#102331'},awaySide:{borderLeftWidth:1,borderLeftColor:colors.line,backgroundColor:'#191f35'},teamHint:{color:colors.muted,fontSize:12},
  teamName:{color:colors.text,fontSize:16,fontWeight:'600',textAlign:'center',minHeight:42},score:{color:colors.text,fontSize:65,fontWeight:'700',fontVariant:['tabular-nums'],lineHeight:78},pointButtons:{flexDirection:'row',gap:6,alignSelf:'stretch'},
  point:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',backgroundColor:'#23475b',borderRadius:12,paddingHorizontal:4},pointValue:{color:colors.accent,fontSize:24,fontWeight:'700'},pointLabel:{color:colors.text,fontSize:12},
  disabled:{opacity:.35},
  banner:{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderRadius:18,borderWidth:1},breakBanner:{backgroundColor:'#0d2b36',borderColor:'#1f5f73'},timeoutBanner:{backgroundColor:'#2d241c',borderColor:'#6b5230'},
  bannerLabel:{fontSize:12,fontWeight:'700',letterSpacing:1,textTransform:'uppercase',flex:1},bannerClock:{fontSize:30,fontWeight:'800',fontVariant:['tabular-nums']},
  shotRow:{flexDirection:'row',alignItems:'center',gap:14},shot:{fontSize:54,fontWeight:'800',fontVariant:['tabular-nums'],minWidth:96,textAlign:'center'},
  section:{color:colors.muted,fontSize:12,fontWeight:'700',letterSpacing:1,textTransform:'uppercase'},
  line:{flexDirection:'row',alignItems:'center',gap:10},lineName:{flex:1,color:colors.text,fontSize:15,fontWeight:'600'},
  step:{width:46,height:46,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.bg,alignItems:'center',justifyContent:'center'},stepText:{color:colors.text,fontSize:22,fontWeight:'700'},
  counter:{minWidth:54,alignItems:'center'},count:{color:colors.text,fontSize:26,fontWeight:'800',fontVariant:['tabular-nums'],minWidth:44,textAlign:'center'},countMax:{color:colors.muted,fontSize:14,fontWeight:'600'},
  tag:{color:colors.danger,fontSize:10,fontWeight:'800',letterSpacing:1},late:{color:colors.warning,fontSize:12},
  periodGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},period:{flexGrow:1,flexBasis:'22%',minHeight:48,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.bg,alignItems:'center',justifyContent:'center',paddingHorizontal:6},
  periodActive:{backgroundColor:colors.accent,borderColor:colors.accent},periodText:{color:colors.text,fontSize:14,fontWeight:'700'},
  stepGrid:{flexDirection:'row',flexWrap:'wrap',gap:8},clockStep:{flexGrow:1,flexBasis:'30%',paddingHorizontal:8},
  actionGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},action:{width:'48%',flexGrow:1,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.line,borderRadius:17,padding:16,gap:12,minHeight:94},actionLabel:{color:colors.text,fontSize:15,fontWeight:'600'},
  player:{flexDirection:'row',gap:12,padding:12,minHeight:58,alignItems:'center',borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.bg},selected:{borderColor:colors.accent,backgroundColor:'#10313c'},shirt:{color:colors.accent,fontSize:20,fontWeight:'700',minWidth:48},
});
