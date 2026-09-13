import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { STREAM_DECK_HTTP_PORT, STREAM_DECK_PLUGIN_UUID } from "../lib/stream-deck";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const manifest = {
  SDKVersion: 2,
  Author: "ArenaCue",
  CodePath: "plugin.html",
  PropertyInspectorPath: "pi.html",
  Description: "Bedien ArenaCue via je eigen knoppen uit de studio.",
  Name: "ArenaCue",
  Icon: "images/plugin",
  Category: "ArenaCue",
  CategoryIcon: "images/plugin",
  Version: "1.0.0",
  OS: [{ Platform: "windows", MinimumVersion: "10" }],
  Software: { MinimumVersion: "6.0" },
  Actions: [
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.key`,
      Name: "Studio-knop",
      Tooltip: "Een knop uit je eigen Stream Deck-set in ArenaCue",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", TitleAlignment: "middle", FontSize: "9" }],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.input`,
      Name: "Bron in beeld",
      Tooltip: "Zet deze bron direct in beeld",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", TitleAlignment: "middle", FontSize: "9" }],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.preview`,
      Name: "Bron klaarzetten",
      Tooltip: "Zet deze bron klaar als Volgende",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", TitleAlignment: "middle", FontSize: "9" }],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.cut`,
      Name: "CUT",
      Tooltip: "Volgende bron in beeld",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", Title: "CUT", TitleAlignment: "middle" }],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.stream`,
      Name: "Live",
      Tooltip: "Live gaan of stoppen",
      Icon: "images/plugin",
      States: [
        { Image: "images/plugin", Title: "LIVE", TitleAlignment: "middle" },
        { Image: "images/plugin", Title: "ON AIR", TitleAlignment: "middle" },
      ],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.record`,
      Name: "Opnemen",
      Tooltip: "Program-output opnemen",
      Icon: "images/plugin",
      States: [
        { Image: "images/plugin", Title: "REC", TitleAlignment: "middle" },
        { Image: "images/plugin", Title: "REC ON", TitleAlignment: "middle" },
      ],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.timer`,
      Name: "Klok",
      Tooltip: "Wedstrijdklok start/pauze",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", Title: "KLOK", TitleAlignment: "middle" }],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.score`,
      Name: "Score +1",
      Tooltip: "Score thuis of uit +1",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", TitleAlignment: "middle", FontSize: "9" }],
      SupportedInMultiActions: true,
    },
    {
      UUID: `${STREAM_DECK_PLUGIN_UUID}.blackout`,
      Name: "Zwart",
      Tooltip: "Scherm zwart",
      Icon: "images/plugin",
      States: [{ Image: "images/plugin", Title: "ZWART", TitleAlignment: "middle" }],
      SupportedInMultiActions: true,
    },
  ],
};

const pluginHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ArenaCue</title></head>
<body>
<script>
const API = "http://127.0.0.1:${STREAM_DECK_HTTP_PORT}";
let ws, uuid;
const contexts = {};

function send(evt) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(evt)); }
function setTitle(context, title) { send({ event: "setTitle", context, payload: { title, target: 0 } }); }
function setState(context, state) { send({ event: "setState", context, payload: { state } }); }

function pathFor(action, settings) {
  if (action.endsWith(".key")) return "/key/" + (Number(settings.slot) || 1);
  if (action.endsWith(".input")) return "/input/" + (Number(settings.index) || 1);
  if (action.endsWith(".preview")) return "/preview/" + (Number(settings.index) || 1);
  if (action.endsWith(".cut")) return "/cut";
  if (action.endsWith(".stream")) return "/stream/toggle";
  if (action.endsWith(".record")) return "/record/toggle";
  if (action.endsWith(".timer")) return "/timer/toggle";
  if (action.endsWith(".score")) return settings.side === "away" ? "/score/away/up" : "/score/home/up";
  if (action.endsWith(".blackout")) return "/blackout";
  return "/";
}

function connectElgatoStreamDeckSocket(port, pluginUUID, registerEvent) {
  uuid = pluginUUID;
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = function () { send({ event: registerEvent, uuid: pluginUUID }); };
  ws.onmessage = function (ev) {
    const data = JSON.parse(ev.data);
    if (data.event === "willAppear") {
      contexts[data.context] = { action: data.action, settings: data.payload.settings || {} };
    }
    if (data.event === "willDisappear") delete contexts[data.context];
    if (data.event === "didReceiveSettings" && contexts[data.context]) {
      contexts[data.context].settings = data.payload.settings || {};
    }
    if (data.event === "keyDown") {
      const item = contexts[data.context] || { action: data.action, settings: data.payload.settings || {} };
      fetch(API + pathFor(item.action, item.settings)).catch(function () {});
    }
  };
}

async function tick() {
  let status;
  try { status = await (await fetch(API + "/status")).json(); } catch (e) { return; }
  Object.keys(contexts).forEach(function (context) {
    const item = contexts[context];
    const settings = item.settings || {};
    if (item.action.endsWith(".key")) {
      const n = Number(settings.slot) || 1;
      const key = (status.keys || []).find(function (k) { return k.index === n; });
      setTitle(context, key && key.title ? key.title : ("KEY " + n));
      const act = key && key.action ? key.action.id : "";
      if (act === "stream") setState(context, status.running ? 1 : 0);
      if (act === "record") setState(context, status.recording ? 1 : 0);
    } else if (item.action.endsWith(".input") || item.action.endsWith(".preview")) {
      const n = Number(settings.index) || 1;
      const input = (status.inputs || []).find(function (i) { return i.index === n; });
      const name = input ? input.name : ("Bron " + n);
      const tag = item.action.endsWith(".preview")
        ? (input && input.preview ? "NEXT" : "CUE")
        : (input && input.program ? "PGM" : input && input.preview ? "NEXT" : "");
      setTitle(context, (tag ? tag + "\\n" : "") + name);
    } else if (item.action.endsWith(".stream")) {
      setState(context, status.running ? 1 : 0);
      setTitle(context, status.running ? "ON AIR" : "LIVE");
    } else if (item.action.endsWith(".record")) {
      setState(context, status.recording ? 1 : 0);
      setTitle(context, status.recording ? "REC ON" : "REC");
    } else if (item.action.endsWith(".score")) {
      setTitle(context, settings.side === "away" ? "UIT +1" : "THUIS +1");
    }
  });
}
setInterval(tick, 400);
</script>
</body></html>
`;

const piHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ArenaCue</title>
<style>body{font-family:Segoe UI,sans-serif;font-size:13px;color:#d8d8d8;background:#2d2d2d;margin:12px}label{display:block;margin:8px 0 4px}</style>
</head>
<body>
<label>Studio-knop (1–24)</label>
<input id="slot" type="number" min="1" max="24" value="1" />
<label>Bronnummer (1–8)</label>
<input id="index" type="number" min="1" max="8" value="1" />
<label>Score-kant</label>
<select id="side"><option value="home">Thuis</option><option value="away">Uit</option></select>
<script>
let ws, uuid, actionInfo;
function send(evt){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(evt)); }
function save(){
  send({ event:"setSettings", context: actionInfo.context, payload:{
    slot: Number(document.getElementById("slot").value)||1,
    index: Number(document.getElementById("index").value)||1,
    side: document.getElementById("side").value
  }});
}
function connectElgatoStreamDeckSocket(port, inUuid, registerEvent, info, inActionInfo){
  uuid = inUuid;
  actionInfo = JSON.parse(inActionInfo);
  const s = actionInfo.payload && actionInfo.payload.settings || {};
  document.getElementById("slot").value = s.slot || 1;
  document.getElementById("index").value = s.index || 1;
  document.getElementById("side").value = s.side || "home";
  ws = new WebSocket("ws://127.0.0.1:"+port);
  ws.onopen = function(){ send({ event: registerEvent, uuid: inUuid }); };
  document.getElementById("slot").onchange = save;
  document.getElementById("index").onchange = save;
  document.getElementById("side").onchange = save;
}
</script>
</body></html>
`;

export function installStreamDeckPlugin(log: (line: string) => void): boolean {
  try {
    const dest = path.join(
      app.getPath("appData"),
      "Elgato",
      "StreamDeck",
      "Plugins",
      `${STREAM_DECK_PLUGIN_UUID}.sdPlugin`,
    );
    fs.mkdirSync(path.join(dest, "images"), { recursive: true });
    fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(dest, "plugin.html"), pluginHtml);
    fs.writeFileSync(path.join(dest, "pi.html"), piHtml);
    const png = Buffer.from(PNG_1X1, "base64");
    fs.writeFileSync(path.join(dest, "images", "plugin.png"), png);
    fs.writeFileSync(path.join(dest, "images", "plugin@2x.png"), png);
    log(`[stream-deck] plugin gezet in ${dest} — herstart Stream Deck om hem te zien`);
    return true;
  } catch (error) {
    log(`[stream-deck] plugin niet gezet: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
