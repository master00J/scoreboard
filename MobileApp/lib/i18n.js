import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { coreMessages, locales } from './messages';
import { screenMessages } from './screenMessages';
import { matchMessages } from './matchMessages';
const Context = createContext(null);
export function translate(locale,key,values={}) {
  const lookup=data=>data?.[key] ?? key.split('.').reduce((value,part)=>value?.[part],data);
  const template=lookup(coreMessages[locale]) ?? lookup(screenMessages[locale]) ?? lookup(matchMessages[locale]) ?? lookup(coreMessages.nl) ?? lookup(screenMessages.nl) ?? lookup(matchMessages.nl) ?? key;
  return String(template).replace(/\{(\w+)\}/g,(_,name)=>String(values[name]??`{${name}}`));
}
export function I18nProvider({children}) {
  const [locale,setLocaleState]=useState('nl');
  useEffect(()=>{let alive=true;AsyncStorage.getItem('arenacue_mobile_locale').then(value=>{if(alive&&locales.includes(value))setLocaleState(value);}).catch(()=>{});return()=>{alive=false;};},[]);
  const value=useMemo(()=>({locale,t:(key,values)=>translate(locale,key,values),setLocale:next=>{if(locales.includes(next)){setLocaleState(next);void AsyncStorage.setItem('arenacue_mobile_locale',next).catch(()=>{});}}}),[locale]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export { locales };
export const useI18n=()=>useContext(Context) ?? {locale:'nl',t:(key,values)=>translate('nl',key,values||{}),setLocale:()=>{}};
