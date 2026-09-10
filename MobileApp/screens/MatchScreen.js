import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ConfirmButton, EmptyState, Field, Sheet, sharedStyles as s } from '../components/ui';
import { colors } from '../lib/theme';
import { useI18n } from '../lib/i18n';
import { computeElapsedSeconds, computeShotClockSeconds, formatClock, splitFieldAndBench, sportProfile } from '../lib/match-state';

const PHASES=['SETUP','PREMATCH','FIRST_HALF','HALF_TIME','SECOND_HALF','EXTRA_TIME','FULL_TIME','POST_MATCH'];
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
  const [cardColor,setCardColor]=useState('YELLOW'),[added,setAdded]=useState('0'),[phase,setPhase]=useState('SETUP');
  const goalOpened=useRef(false);
  useEffect(()=>{setSheet(null);setPlayer(null);setPlayerIn(null);setSide('home');goalOpened.current=false;},[match?.id]);
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
  const elapsed=computeElapsedSeconds(snapshot,c.clockNow);
  const duration=Number(match?.periodDurationSec)>0?Number(match.periodDurationSec):profile.defaultPeriodDurationSec;
  const clock=profile.timer==='down'?Math.max(0,duration-elapsed):elapsed;
  const command=async (value, options)=>{
    const ok=await c.sendCommand(value, options);
    if(ok){if(sheet==='goal')goalOpened.current=false;setSheet(null);}
    return ok;
  };
  const chooseSide=value=>{setSide(value);setPlayer(null);setPlayerIn(null);};
  const open=(value,teamSide)=>{if(teamSide)chooseSide(teamSide);else{setPlayer(null);setPlayerIn(null);}setSheet(value);if(value==='clock')setAdded(String(snapshot?.addedTimeMinutes||0));if(value==='phase')setPhase(match?.status||'SETUP');};
  const teamName=teamSide=>match?.[`${teamSide}Team`]?.name||t(`common.${teamSide}`);
  const canOperate=c.canCall&&c.role==='operator'&&!!match;
  const disabled=!canOperate||!c.canMutate;
  const period=Number(match?.currentPeriod||1);
  const sideSelector=<View style={s.row}>{['home','away'].map(value=><Chip key={value} label={teamName(value)} selected={side===value} onPress={()=>chooseSide(value)}/>)}</View>;

  return <>
    {!c.canCall?<EmptyState title={t('connection.title')} message={t('connection.intro')} actionLabel={t('connection.connect')} onAction={onConnect}/>
      :!match?<EmptyState title={t('match.noMatch')} message={t('match.chooseHint')} actionLabel={t('match.choose')} onAction={()=>open('matches')}/>
      :<>
        <View style={local.matchHeading}><View style={{flex:1,gap:5}}><Text style={local.eyebrow}>{t(`sport.${profile.id}`)} · {t('match.period')} {period}</Text><Text style={s.muted}>{t(`status.${match.status||'SETUP'}`)}</Text></View>
          <Pressable onPress={()=>open('matches')} accessibilityRole="button" accessibilityLabel={t('match.change')} style={local.headerAction}><Text style={{color:colors.accent,fontSize:20}}>⇄</Text></Pressable></View>
        <View style={local.scoreboard}>
          <View style={local.clockBlock}><Text style={local.clock}>{profile.timer==='none'?'—':formatClock(clock)}</Text><Text style={local.clockState}>{t(profile.timer==='none'?'match.noTimer':snapshot?.timerRunning?'match.running':'match.paused')}{snapshot?.addedTimeMinutes>0?` · +${snapshot.addedTimeMinutes}′`:''}</Text></View>
          <View style={local.scoreRow}>{['home','away'].map((teamSide,index)=><View key={teamSide} style={[local.scoreSide,index===1&&local.awaySide]}>
            <Text style={local.teamHint}>{t(`common.${teamSide}`)}</Text><Text style={local.teamName}>{teamName(teamSide)}</Text><Text style={local.score}>{Number(match[`${teamSide}Score`]||0)}</Text>
            <View style={local.pointButtons}>{profile.increments.map(points=><Pressable key={points} accessibilityRole="button" accessibilityLabel={`${teamName(teamSide)} +${points}`} accessibilityState={{disabled:!canOperate}}
              disabled={!canOperate} style={({pressed})=>[local.point,!canOperate&&local.disabled,pressed&&{opacity:.7}]}
              onPress={()=>profile.score==='Goal'?open('goal',teamSide):c.sendCommand({type:'score:adjust',side:teamSide,delta:points})}>
              <Text style={local.pointValue}>+{points}</Text>{profile.increments.length===1&&<Text style={local.pointLabel}>{t(profile.score==='Goal'?'match.goal':'match.points')}</Text>}</Pressable>)}</View>
          </View>)}</View>
          {profile.timer!=='none'&&<Button label={t(snapshot?.timerRunning?'match.pause':'match.start')} disabled={disabled} onPress={()=>c.sendCommand({type:snapshot?.timerRunning?'timer:pause':'timer:start'})} style={{margin:16}}/>}
        </View>
        <View style={local.actionGrid}>{[
          ['card','match.card'],['sub','match.sub'],['clock','match.advanced'],['phase','match.phase'],['stats','match.stats'],['score','match.scoreCorrection'],
        ].filter(([id])=>profile.timer!=='none'||id!=='clock').map(([id,key])=><Pressable key={id} accessibilityRole="button" accessibilityLabel={t(key)} onPress={()=>open(id)} style={({pressed})=>[local.action,pressed&&{backgroundColor:colors.panelRaised}]}>
          <Text style={local.actionLabel}>{t(key)}</Text></Pressable>)}</View>
        {profile.shot.length>0&&<Card title={`${t('match.shotClock')} · ${Math.ceil(computeShotClockSeconds(snapshot,c.clockNow))}s`}>
          <View style={s.row}><Button label={t(snapshot?.shotClockRunning?'match.pause':'match.start')} disabled={disabled} onPress={()=>c.sendCommand({type:snapshot?.shotClockRunning?'shotclock:pause':'shotclock:start'})}/>
            {profile.shot.map(seconds=><Button key={seconds} label={t('match.resetShot',{seconds})} variant="secondary" disabled={disabled} onPress={()=>c.sendCommand({type:'shotclock:reset',seconds})}/>)}</View></Card>}
      </>}

    <Sheet visible={sheet==='matches'} title={t('match.choose')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      <Button label={t('common.refresh')} variant="secondary" loading={c.refreshing} onPress={()=>c.refresh(true)}/>
      {!c.matches.length&&<Text style={s.muted}>{t('match.noMatches')}</Text>}
      {c.matches.map(value=><Card key={value.id} title={`${value.homeTeam?.name||t('common.home')} · ${value.awayTeam?.name||t('common.away')}`} subtitle={`${value.homeScore||0} — ${value.awayScore||0}`}>
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
      <View style={s.row}>{['YELLOW','RED'].map(value=><Chip key={value} selected={cardColor===value} onPress={()=>setCardColor(value)} label={t(value==='YELLOW'?'match.yellow':'match.red')}/>)}</View>
      <Button label={t('match.confirmCard')} disabled={disabled||!player} loading={c.busy} onPress={()=>command({type:'card:trigger',teamId:team.id,playerId:player,color:cardColor})}/>
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
    <Sheet visible={sheet==='clock'} title={t('match.advanced')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      <Text style={s.title}>{t('match.period')} {period}</Text><View style={s.row}>{Array.from({length:profile.periods},(_,i)=>i+1).map(next=><ConfirmButton key={next} label={`${next}`} title={t('match.periodChange')} message={t('match.periodBody')} confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} variant="secondary" disabled={disabled||next===period} onConfirm={()=>command({type:'sport:setPeriod',period:next})}/>)}</View>
      <View style={s.row}>{[-60,60].map(deltaSec=><Button key={deltaSec} label={`${deltaSec>0?'+':'−'}1 min`} variant="secondary" disabled={disabled} onPress={()=>c.sendCommand({type:'timer:adjust',deltaSec})}/>)}</View>
      {profile.id==='FOOTBALL'&&<><Field label={t('match.added')} value={added} onChangeText={setAdded} keyboardType="number-pad" maxLength={2}/>
        <Button label={t('common.save')} disabled={disabled||!/^\d{1,2}$/.test(added)||Number(added)>30} onPress={()=>command({type:'timer:setAddedTime',minutes:Number(added)})}/></>}
      <ConfirmButton label={t('match.resetClock')} title={t('match.resetClock')} message={t('match.resetBody')} cancelLabel={t('common.cancel')} confirmLabel={t('common.confirm')} disabled={disabled} onConfirm={()=>command({type:'timer:set',seconds:0})}/>
    </Sheet>
    <Sheet visible={sheet==='phase'} title={t('match.phase')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      <View style={s.row}>{PHASES.map(value=><Chip key={value} label={t(`status.${value}`)} selected={phase===value} onPress={()=>setPhase(value)}/>)}</View>
      <Button label={t('common.confirm')} disabled={disabled||phase===match?.status} onPress={()=>command({type:'match:setStatus',status:phase})}/>
    </Sheet>
    <Sheet visible={sheet==='score'} title={t('match.scoreCorrection')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      {['home','away'].map(teamSide=><Card key={teamSide} title={`${teamName(teamSide)} · ${match?.[`${teamSide}Score`]||0}`}><View style={s.row}>{[-1,1].map(delta=><Button key={delta} label={delta>0?'+1':'−1'} variant="secondary" disabled={disabled||(delta<0&&!match?.[`${teamSide}Score`])} onPress={()=>c.sendCommand({type:'score:adjust',side:teamSide,delta})}/>)}</View></Card>)}
    </Sheet>
    <Sheet visible={sheet==='stats'} title={t('match.stats')} closeLabel={t('common.close')} onClose={()=>setSheet(null)}>
      {['home','away'].map(teamSide=><Card key={teamSide} title={teamName(teamSide)}>
        {(profile.timeouts>0?['timeout']:[]).concat(profile.stat?['foul']:[],profile.hasSets?['set']:[]).map(stat=>{
          const field=stat==='timeout'?'Timeouts':stat==='foul'?'Fouls':'Sets';const value=Number(match?.[`${teamSide}${field}`]||0);
          return <View key={stat} style={{gap:10}}><Text style={s.text}>{t(`match.${stat==='foul'&&profile.id==='HOCKEY'?'penalty':stat}`)} · {value}{stat==='timeout'?` / ${profile.timeoutLimitForPeriod(period)}`:''}</Text>
            <View style={s.row}>{[-1,1].map(delta=><Button key={delta} label={delta>0?'+1':'−1'} variant="secondary" disabled={disabled||(delta<0&&value===0)} onPress={()=>c.sendCommand({type:'sport:statAdjust',side:teamSide,stat,delta})}/>)}</View></View>;
        })}
        {!profile.timeouts&&!profile.stat&&!profile.hasSets&&<Text style={s.muted}>{match?.[`${teamSide}Score`]||0} {t('match.points')}</Text>}
      </Card>)}
    </Sheet>
  </>;
}
const local=StyleSheet.create({
  matchHeading:{flexDirection:'row',alignItems:'center',gap:14},eyebrow:{color:colors.accent,fontSize:13,fontWeight:'700'},headerAction:{width:46,height:46,borderRadius:14,backgroundColor:colors.panel,alignItems:'center',justifyContent:'center'},
  scoreboard:{backgroundColor:colors.panel,borderRadius:24,borderWidth:1,borderColor:colors.line,overflow:'hidden'},clockBlock:{alignItems:'center',paddingTop:18,paddingBottom:20,gap:3},
  clock:{color:colors.text,fontSize:60,fontWeight:'700',fontVariant:['tabular-nums'],letterSpacing:-2},clockState:{color:colors.muted,fontSize:13},scoreRow:{flexDirection:'row',borderTopWidth:1,borderTopColor:colors.line},
  scoreSide:{flex:1,alignItems:'center',padding:14,gap:5,backgroundColor:'#102331'},awaySide:{borderLeftWidth:1,borderLeftColor:colors.line,backgroundColor:'#191f35'},teamHint:{color:colors.muted,fontSize:12},
  teamName:{color:colors.text,fontSize:16,fontWeight:'600',textAlign:'center',minHeight:42},score:{color:colors.text,fontSize:65,fontWeight:'700',fontVariant:['tabular-nums'],lineHeight:78},pointButtons:{flexDirection:'row',gap:6,alignSelf:'stretch'},
  point:{flex:1,minHeight:56,alignItems:'center',justifyContent:'center',backgroundColor:'#23475b',borderRadius:12,paddingHorizontal:4},pointValue:{color:colors.accent,fontSize:24,fontWeight:'700'},pointLabel:{color:colors.text,fontSize:12},
  disabled:{opacity:.35},actionGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},action:{width:'48%',flexGrow:1,backgroundColor:colors.panel,borderWidth:1,borderColor:colors.line,borderRadius:17,padding:16,gap:12,minHeight:94},actionLabel:{color:colors.text,fontSize:15,fontWeight:'600'},
  player:{flexDirection:'row',gap:12,padding:12,minHeight:58,alignItems:'center',borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.bg},selected:{borderColor:colors.accent,backgroundColor:'#10313c'},shirt:{color:colors.accent,fontSize:20,fontWeight:'700',minWidth:48},
});
