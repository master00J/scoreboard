import { Component, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { I18nProvider, locales, useI18n } from '../lib/i18n';
import { useController } from '../lib/useController';
import { colors } from '../lib/theme';
import { sportProfile } from '../lib/match-state';
import { ConnectionScreen } from '../screens/ConnectionScreen';
import { MatchScreen } from '../screens/MatchScreen';
import { SetupScreen } from '../screens/SetupScreen';
import { MediaScreen } from '../screens/MediaScreen';
import { DisplayScreen } from '../screens/DisplayScreen';

const TABS=[['match','⚽'],['setup','⚙'],['media','▶'],['display','▣'],['connection','☍']];
const SPORT_ICONS={FOOTBALL:'⚽',FUTSAL:'⚽',BASKETBALL:'🏀',VOLLEYBALL:'🏐',HOCKEY:'🏑'};
function Shell() {
  const c=useController();const {t,locale,setLocale}=useI18n();
  const cycleLocale=()=>setLocale(locales[(Math.max(0,locales.indexOf(locale))+1)%locales.length]);
  const [tab,setTab]=useState('connection');const scroll=useRef(null);
  const select=value=>{setTab(value);scroll.current?.scrollTo({y:0,animated:false});};
  const connectWithCode=useRef(c.connectWithCode);
  connectWithCode.current=c.connectWithCode;
  useEffect(()=>{if(c.sessionToken)setTab('match');},[c.sessionToken]);
  useEffect(()=>{
    const consume=url=>{if(!url)return;try{const parsed=new URL(url);if(parsed.protocol==='arenacue:'){const code=parsed.searchParams.get('code');if(code){void connectWithCode.current(code);setTab('connection');}}}catch{}};
    void Linking.getInitialURL().then(consume).catch(()=>{});
    const subscription=Linking.addEventListener('url',event=>consume(event.url));return()=>subscription.remove();
  },[]);
  useEffect(()=>{
    if(!c.notice)return;
    // Verbindingsfouten blijven staan; een geweigerde actie of waarschuwing verdwijnt vanzelf zodat de bediening vrij blijft.
    const rejected=c.notice.kind==='error'&&c.notice.key?.startsWith('cmd.');
    const ms=c.notice.kind==='error'?(rejected?10000:0):c.notice.kind==='warning'?10000:6000;
    if(!ms)return;
    const timer=setTimeout(c.dismissNotice,ms);return()=>clearTimeout(timer);
  },[c.notice]);
  const connectedColor=c.connected?colors.success:c.canCall?colors.warning:colors.muted;
  const tabIcon=(id,icon)=>id==='match'&&c.activeMatchDetails?SPORT_ICONS[sportProfile(c.activeMatchDetails.sport).id]:icon;
  // Foutcodes van de desktop geven sport/kleur als code mee; hier in de UI-taal zetten.
  const noticeValues=c.notice?.values&&Object.fromEntries(Object.entries(c.notice.values).map(([key,value])=>[key,
    key==='sport'?t(`sport.${sportProfile(value).id}`):key==='color'?t(`color.${value}`):value]));
  const props={canCall:c.canCall,canMutate:c.canMutate,isCloud:c.isCloud,baseUrl:c.config.baseUrl,sessionToken:c.sessionToken,
    callBridge:c.callBridge,sendCommand:c.sendCommand,snapshot:c.snapshot,activeMatchDetails:c.activeMatchDetails,onStatus:c.onStatus};
  if(!c.hydrated)return <SafeAreaView style={s.loading}><ActivityIndicator size="large" color={colors.accent}/><Text style={s.muted}>{t('common.loading')}</Text></SafeAreaView>;
  return <SafeAreaView style={s.safe} edges={['top','left','right','bottom']}>
    <StatusBar style="light"/>
    <View style={s.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="ArenaCue Control" onPress={()=>select('match')} style={s.brand}>
        <Image source={require('../assets/arenacue-mark.png')} resizeMode="contain" style={s.logo}/><View><Text style={s.brandName}>ArenaCue<Text style={{color:colors.accent}}> Control</Text></Text><Text style={s.brandCaption}>{t(`nav.${tab}`)}</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.language')} onPress={cycleLocale} style={s.language}><Text style={s.languageText}>{locale.toUpperCase()}</Text></Pressable>
    </View>
    <Pressable accessibilityRole="button" onPress={()=>select('connection')} style={s.connection} accessibilityLabel={t(`connection.${c.state}`)}>
      <View style={[s.dot,{backgroundColor:connectedColor}]}/><Text style={[s.connectionText,{color:connectedColor}]}>{t(`connection.${c.state}`)}</Text>
      <Text style={s.connectionMode}>{c.isCloud?'Cloud':'LAN'}{c.canCall?` · ${t(`common.${c.role}`)}`:''}</Text><Text style={{color:colors.muted,fontSize:18}}>›</Text>
    </Pressable>
    <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
      <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={c.refreshing&&!c.authenticating} onRefresh={()=>c.refresh(true)} tintColor={colors.accent} colors={[colors.accent]} enabled={c.canCall}/> }>
        {tab!=='connection'&&c.canCall&&!c.connected&&<View style={s.banner}><Text style={{color:colors.warning,fontSize:20}}>!</Text><View style={{flex:1,gap:4}}><Text style={s.bannerText}>{t('connection.staleHint')}</Text>{Number.isFinite(c.age)&&<Text style={s.muted}>{t('connection.lastUpdate',{seconds:Math.floor(c.age/1000)})}</Text>}</View></View>}
        {tab!=='connection'&&c.canCall&&c.role==='viewer'&&<Text style={s.readOnly}>{t('connection.viewerHint')}</Text>}
        {tab==='match'&&<MatchScreen controller={c} onConnect={()=>select('connection')}/>}
        {tab==='connection'&&<ConnectionScreen controller={c} onConnected={()=>select('match')}/>}
        {tab==='setup'&&<SetupScreen {...props}/>}
        {tab==='media'&&<MediaScreen {...props}/>}
        {tab==='display'&&<DisplayScreen {...props}/>}
      </ScrollView>
      {/* Zwevende melding: live-knoppen verspringen niet wanneer er een melding verschijnt of verdwijnt. */}
      {c.notice&&<View style={[s.notice,{borderLeftColor:c.notice.kind==='error'?colors.danger:c.notice.kind==='warning'?colors.warning:colors.accent}]} accessibilityLiveRegion="polite">
        <View style={{flex:1,gap:4}}><Text style={s.noticeText}>{c.notice.text||t(c.notice.key,noticeValues)}</Text>
          {typeof c.notice.details==='string'&&<Text style={s.muted}>{c.notice.details}</Text>}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={c.dismissNotice} style={s.dismiss}><Text style={{color:colors.muted,fontSize:22}}>×</Text></Pressable>
      </View>}
    </KeyboardAvoidingView>
    <View style={s.tabs}>{TABS.map(([id,icon])=><Pressable key={id} accessibilityRole="tab" accessibilityState={{selected:id===tab}} accessibilityLabel={t(`nav.${id}`)}
      onPress={()=>select(id)} style={[s.tab,id===tab&&s.activeTab]}><Text style={{fontSize:18,color:id===tab?colors.accent:colors.muted}}>{tabIcon(id,icon)}</Text><Text style={[s.tabText,id===tab&&{color:colors.accent}]}>{t(`nav.${id}`)}</Text></Pressable>)}</View>
  </SafeAreaView>;
}
class ErrorBoundary extends Component {
  state={error:null};
  static getDerivedStateFromError(error){return {error};}
  render(){
    if(!this.state.error) return this.props.children;
    return <SafeAreaView style={s.loading}><Text style={s.noticeText}>ArenaCue Control kon niet starten.</Text><Text style={s.muted}>{String(this.state.error?.message||this.state.error)}</Text></SafeAreaView>;
  }
}
export default function AppShell(){return <ErrorBoundary><I18nProvider><Shell/></I18nProvider></ErrorBoundary>;}
const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.bg},loading:{flex:1,backgroundColor:colors.bg,justifyContent:'center',alignItems:'center',gap:15},
  header:{paddingHorizontal:20,paddingTop:12,paddingBottom:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},brand:{flexDirection:'row',gap:10,alignItems:'center',flex:1},logo:{width:37,height:37},brandName:{color:colors.text,fontSize:18,fontWeight:'700',letterSpacing:-.4},brandCaption:{color:colors.muted,fontSize:12,marginTop:3},language:{minHeight:42,minWidth:42,alignItems:'center',justifyContent:'center',borderRadius:13,borderWidth:1,borderColor:colors.line},languageText:{color:colors.muted,fontSize:13,fontWeight:'700'},
  connection:{flexDirection:'row',gap:8,paddingVertical:11,paddingHorizontal:20,borderTopWidth:1,borderBottomWidth:1,borderColor:colors.line,alignItems:'center',backgroundColor:'#0b1420'},dot:{width:7,height:7,borderRadius:4},connectionText:{fontSize:13,fontWeight:'600',flex:1},connectionMode:{color:colors.muted,fontSize:12},
  content:{padding:18,gap:18,paddingBottom:30,width:'100%',maxWidth:780,alignSelf:'center'},tabs:{flexDirection:'row',backgroundColor:'#0b1420',borderTopWidth:1,borderTopColor:colors.line,paddingHorizontal:4,paddingTop:7,paddingBottom:5},tab:{flex:1,alignItems:'center',justifyContent:'center',paddingVertical:8,minHeight:60,gap:5,borderRadius:13},activeTab:{backgroundColor:'#112b37'},tabText:{color:colors.muted,fontSize:11,fontWeight:'600',textAlign:'center'},
  notice:{position:'absolute',left:14,right:14,bottom:12,paddingLeft:12,paddingVertical:10,borderLeftWidth:3,borderWidth:1,borderColor:colors.line,backgroundColor:colors.panelRaised,borderRadius:12,flexDirection:'row',gap:8,elevation:8,shadowColor:'#000',shadowOpacity:.45,shadowRadius:12,shadowOffset:{width:0,height:4}},noticeText:{color:colors.text,fontSize:14,lineHeight:21},muted:{color:colors.muted,fontSize:13,lineHeight:20},dismiss:{width:42,alignItems:'center',justifyContent:'center'},banner:{flexDirection:'row',gap:12,padding:14,backgroundColor:'#2d241c',borderRadius:14},bannerText:{color:colors.warning,fontSize:14,lineHeight:21},readOnly:{color:colors.muted,fontSize:14,lineHeight:22,padding:14,borderWidth:1,borderColor:colors.line,borderRadius:14},
});
