import AsyncStorage from '@react-native-async-storage/async-storage';
const SETTINGS='arenacue_mobile_settings_v2';
const SECRET='arenacue_mobile_secret_v2';
const LEGACY='scoreboard_mobile_session_v1';
let writes=Promise.resolve();
const text=value=>typeof value==='string'?value:value==null?'':String(value);
const publicFields=value=>({baseUrl:text(value.baseUrl),connectionMode:value.connectionMode==='cloud'?'cloud':'local',venueId:text(value.venueId)});
const privateFields=value=>({pairingCode:text(value.pairingCode),cloudPairToken:text(value.cloudPairToken),operatorPin:text(value.operatorPin),role:value.role==='viewer'?'viewer':'operator',sessionToken:text(value.sessionToken),sessionExpiresAt:value.sessionExpiresAt||null});
async function store(value) {
  await AsyncStorage.setItem(SECRET,JSON.stringify(privateFields(value)));
  await AsyncStorage.setItem(SETTINGS,JSON.stringify(publicFields(value)));
}
export function saveSession(value) {
  const task=writes.catch(()=>{}).then(()=>store(value));
  writes=task;
  return task;
}
function readJson(raw) {
  if(!raw) return {};
  try { const value=JSON.parse(raw); return value && typeof value==='object' && !Array.isArray(value)?value:{}; }
  catch { return {}; }
}
export async function loadSession() {
  const [settings,secret,legacy]=await Promise.all([AsyncStorage.getItem(SETTINGS),AsyncStorage.getItem(SECRET),AsyncStorage.getItem(LEGACY)]);
  const stored=settings?{...readJson(settings),...readJson(secret)}:legacy?readJson(legacy):null;
  if(!stored || (!stored.baseUrl && !stored.sessionToken && !stored.pairingCode)) return null;
  if(legacy && !settings) {
    await saveSession(stored);
    await AsyncStorage.removeItem(LEGACY);
  }
  return {...publicFields(stored),...privateFields(stored)};
}
