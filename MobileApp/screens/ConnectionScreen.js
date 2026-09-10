import { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, ConfirmButton, Field, Sheet, sharedStyles as s } from '../components/ui';
import { colors } from '../lib/theme';
import { useI18n } from '../lib/i18n';

function ScannerPane({ onCode, onCancel }) {
  const { QrScanner } = require('./QrScanner');
  return <QrScanner onCode={onCode} onCancel={onCancel} />;
}

export function ConnectionScreen({ controller:c, onConnected }) {
  const {t,locale,setLocale}=useI18n();
  const [manual,setManual]=useState(false);
  const [code,setCode]=useState('');
  const [scanner,setScanner]=useState(false);
  const scanned=useRef(false);
  const cfg=c.config;
  async function apply(value) {
    setCode('');
    const ok=await c.connectWithCode(value);
    if(ok) onConnected();
    else setManual(true);
    return ok;
  }
  function mode(connectionMode) {
    c.updateConfig({connectionMode,baseUrl:connectionMode==='cloud'?'https://arenacue.be':'',pairingCode:'',cloudPairToken:'',operatorPin:'',venueId:''});
  }
  return <>
    <View style={local.intro}>
      <View style={local.icon}><Text style={{color:colors.accent,fontSize:28}}>▣</Text></View>
      <Text accessibilityRole="header" style={local.title}>{t('connection.title')}</Text>
      <Text style={s.muted}>{t('connection.intro')}</Text>
    </View>
    {c.canCall && <Card title={t(`connection.${c.state}`)} subtitle={`${cfg.baseUrl} · ${t(`common.${c.role}`)}`}>
      <Button label={t('connection.retry')} variant="secondary" onPress={()=>c.refresh(true)} loading={c.refreshing}/>
      <ConfirmButton label={t('connection.disconnect')} title={t('connection.disconnect')} message={t('connection.disconnectBody')}
        confirmLabel={t('common.confirm')} cancelLabel={t('common.cancel')} onConfirm={c.disconnect}/>
    </Card>}
    {!c.canCall && c.hasCredentials && <Card title={t(`connection.${c.state}`)} subtitle={cfg.baseUrl || t('connection.savedHint')}>
      <Text style={s.muted}>{t('connection.savedHint')}</Text>
      <Button label={t('connection.reconnect')} loading={c.authenticating} onPress={async()=>{if(await c.authenticate())onConnected();}}/>
    </Card>}
    <Card>
      <Button label={t('connection.scan')} onPress={()=>{scanned.current=false;setScanner(true);}} disabled={c.authenticating}/>
      <Button label={t('connection.settings')} variant="secondary" onPress={()=>Linking.openSettings().catch(()=>c.notify('connection.cameraDenied','warning'))}/>
      <Field label={t('connection.paste')} placeholder="ACPAIR:…" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} multiline/>
      <Button label={t('connection.useCode')} variant="secondary" loading={c.authenticating} disabled={!code.trim()||c.authenticating} onPress={()=>apply(code)}/>
    </Card>
    <Button label={t('connection.manual')} variant="ghost" onPress={()=>setManual(value=>!value)}/>
    {manual && <Card>
      <View style={s.row}><Chip label={t('connection.local')} selected={!c.isCloud} onPress={()=>mode('local')} disabled={c.authenticating}/><Chip label={t('connection.cloud')} selected={c.isCloud} onPress={()=>mode('cloud')} disabled={c.authenticating}/></View>
      <Text style={s.muted}>{t(c.isCloud?'connection.cloudHint':'connection.localHint')}</Text>
      <Field label={t(c.isCloud?'connection.cloudAddress':'connection.address')} value={cfg.baseUrl} onChangeText={baseUrl=>c.updateConfig({baseUrl})}
        placeholder={c.isCloud?'https://arenacue.be':'http://192.168.1.10:17890'} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!c.authenticating}/>
      {c.isCloud?<Field label={t('connection.venue')} value={cfg.venueId} onChangeText={venueId=>c.updateConfig({venueId})} autoCapitalize="none" autoCorrect={false} editable={!c.authenticating}/>
        :<Field label={t('connection.pairingCode')} value={cfg.pairingCode} onChangeText={pairingCode=>c.updateConfig({pairingCode})} keyboardType="number-pad" maxLength={12} editable={!c.authenticating}/>}
      <Text style={s.muted}>{t('connection.role')}</Text>
      <View style={s.row}>{['operator','viewer'].map(role=><Chip key={role} label={t(`common.${role}`)} selected={cfg.role===role} onPress={()=>c.updateConfig({role})} disabled={c.authenticating}/>)}</View>
      {cfg.role==='operator' && (!c.isCloud||!cfg.cloudPairToken) && <Field label={t('connection.pin')} value={cfg.operatorPin} onChangeText={operatorPin=>c.updateConfig({operatorPin})} secureTextEntry keyboardType="number-pad" maxLength={12} editable={!c.authenticating}/>}
      <Button label={t('connection.connect')} loading={c.authenticating} disabled={!cfg.baseUrl.trim()} onPress={async()=>{if(await c.authenticate())onConnected();}}/>
    </Card>}
    <Card title={t('common.language')}><View style={s.row}>{Object.entries({nl:'Nederlands',en:'English',fr:'Français',it:'Italiano'}).map(([value,label])=><Chip key={value} label={label} selected={locale===value} onPress={()=>setLocale(value)}/>)}</View></Card>
    <Sheet visible={scanner} title={t('connection.scan')} subtitle={t('connection.scanHint')} closeLabel={t('common.close')} onClose={()=>setScanner(false)}>
      {scanner && <ScannerPane onCancel={()=>setScanner(false)} onCode={(data)=>{
        if(scanned.current)return;scanned.current=true;setScanner(false);void apply(data);
      }}/>}
    </Sheet>
  </>;
}
const local=StyleSheet.create({intro:{gap:12,paddingVertical:8},icon:{width:64,height:64,borderRadius:19,backgroundColor:'#103440',alignItems:'center',justifyContent:'center'},title:{color:colors.text,fontSize:31,fontWeight:'700',letterSpacing:-.8,lineHeight:37}});
