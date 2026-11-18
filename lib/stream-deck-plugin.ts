/**
 * De bestanden van de Stream Deck-plug-in: manifest, het script dat in Stream Deck draait en de
 * instelschermen. De desktop-app schrijft ze weg (`electron/stream-deck-plugin.ts`).
 *
 * De plug-in weet niets van sport of wedstrijd. Hij vraagt de app welke knoppen er te zien zijn,
 * zet het beeld neer dat hij terugkrijgt en roept bij een druk het pad van de knop aan.
 */
import { BOARD_DECK_PATHS } from "./stream-deck-board";
import { DECK_TEXTS, deckPathName, type DeckLocale } from "./stream-deck-faces";
import { STREAM_DECK_HTTP_PORT, STREAM_DECK_PLUGIN_UUID } from "./stream-deck";

export const STREAM_DECK_PLUGIN_VERSION = "1.1.0.0";

const KEY_IMAGE = "images/key";
const ACTION_ICON = "images/action";

/** Knop zolang ArenaCue niet draait: donker, met het scorebordje gedimd. */
const KEY_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
  `<rect width="144" height="144" rx="18" fill="#141518"/>` +
  `<g fill="#343a46"><rect x="30" y="52" width="32" height="40" rx="5"/><rect x="82" y="52" width="32" height="40" rx="5"/>` +
  `<circle cx="72" cy="64" r="3.5"/><circle cx="72" cy="80" r="3.5"/></g></svg>`;

/** Pictogram in de actielijst van Stream Deck. */
const ACTION_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">` +
  `<g fill="#ffffff"><rect x="1.5" y="5" width="6" height="10" rx="1.2"/><rect x="12.5" y="5" width="6" height="10" rx="1.2"/>` +
  `<circle cx="10" cy="8" r="1"/><circle cx="10" cy="12" r="1"/></g></svg>`;

function action(id: string, name: string, tooltip: string, extra: Record<string, unknown> = {}) {
  return {
    UUID: `${STREAM_DECK_PLUGIN_UUID}.${id}`,
    Name: name,
    Tooltip: tooltip,
    Icon: ACTION_ICON,
    // Geen vaste titel: de app tekent de knop, met de tekst erin.
    States: [{ Image: KEY_IMAGE }],
    SupportedInMultiActions: true,
    ...extra,
  };
}

export function streamDeckManifest(locale: DeckLocale) {
  const texts = DECK_TEXTS[locale];
  return {
    SDKVersion: 2,
    UUID: STREAM_DECK_PLUGIN_UUID,
    Author: "ArenaCue",
    CodePath: "plugin.html",
    PropertyInspectorPath: "pi.html",
    Description: "Bedien ArenaCue: het scorebord en je eigen knoppen uit de studio.",
    Name: "ArenaCue",
    Icon: "images/plugin",
    Category: "ArenaCue",
    CategoryIcon: ACTION_ICON,
    Version: STREAM_DECK_PLUGIN_VERSION,
    OS: [{ Platform: "windows", MinimumVersion: "10" }],
    Software: { MinimumVersion: "6.0" },
    Actions: [
      action("board", texts.piAction, texts.piActionTooltip, { PropertyInspectorPath: "board.html" }),
      action("key", "Studio-knop", "Een knop uit je eigen Stream Deck-set in ArenaCue"),
      action("input", "Bron in beeld", "Zet deze bron direct in beeld"),
      action("preview", "Bron klaarzetten", "Zet deze bron klaar als Volgende"),
      action("cut", "CUT", "Volgende bron in beeld"),
      action("stream", "Live", "Live gaan of stoppen"),
      action("record", "Opnemen", "Program-output opnemen"),
      action("timer", "Klok", "Wedstrijdklok start/pauze"),
      action("score", "Score +1", "Score thuis of uit +1"),
      action("blackout", "Zwart", "Scherm zwart"),
    ],
  };
}

/**
 * Het script van de plug-in. Stream Deck laadt het in een verborgen pagina.
 *
 * Chromium laat timers van een verborgen pagina na korte tijd nog maar één keer per minuut lopen;
 * een knop die elke 400 ms de stand ophaalde, liep zo een minuut achter. Daarom houdt de pagina
 * één open verzoek naar de app aan (antwoord zodra er iets verandert) en komt de enige timer, die
 * opnieuw probeert als de app niet draait, uit een worker: die wordt niet afgeknepen.
 */
export const STREAM_DECK_PLUGIN_SCRIPT = `
var API = "http://127.0.0.1:${STREAM_DECK_HTTP_PORT}";
var RETRY_MS = 2000;
var ws = null;
var contexts = {};
var poll = null;
var etag = "";
var online = false;

function send(evt) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(evt)); }

function pathFor(action, settings) {
  settings = settings || {};
  if (action.endsWith(".board")) {
    return typeof settings.path === "string" && settings.path.charAt(0) === "/" ? settings.path : "/timer/toggle";
  }
  if (action.endsWith(".key")) return "/key/" + (Number(settings.slot) || 1);
  if (action.endsWith(".input")) return "/input/" + (Number(settings.index) || 1);
  if (action.endsWith(".preview")) return "/preview/" + (Number(settings.index) || 1);
  if (action.endsWith(".cut")) return "/cut";
  if (action.endsWith(".stream")) return "/stream/toggle";
  if (action.endsWith(".record")) return "/record/toggle";
  if (action.endsWith(".timer")) return "/timer/toggle";
  if (action.endsWith(".score")) return settings.side === "away" ? "/score/away/up" : "/score/home/up";
  if (action.endsWith(".blackout")) return "/blackout";
  return "";
}

function show(context, svg) {
  var item = contexts[context];
  if (!item || item.shown === svg) return;
  item.shown = svg;
  send({
    event: "setImage",
    context: context,
    payload: svg ? { image: "data:image/svg+xml," + encodeURIComponent(svg), target: 0 } : { target: 0 }
  });
}

function apply(faces) {
  Object.keys(contexts).forEach(function (context) {
    var face = faces[contexts[context].path];
    show(context, face && face.svg ? face.svg : "");
  });
}

function sync() {
  if (poll) poll.abort();
  poll = null;
  var seen = {};
  var query = [];
  Object.keys(contexts).forEach(function (context) {
    var path = contexts[context].path;
    if (path && !seen[path]) { seen[path] = true; query.push("p=" + encodeURIComponent(path)); }
  });
  if (!query.length) return;
  var mine = new AbortController();
  var sent = etag;
  var startedAt = Date.now();
  poll = mine;
  fetch(API + "/faces?" + query.join("&") + "&since=" + encodeURIComponent(sent), { signal: mine.signal, cache: "no-store" })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (poll !== mine) return;
      if (!data || typeof data.etag !== "string" || !data.faces) throw new Error("geen ArenaCue");
      online = true;
      etag = data.etag;
      apply(data.faces);
      // Hetzelfde antwoord, meteen terug: dat is niet de app die wacht op een wijziging. Niet blijven vragen.
      if (data.etag === sent && Date.now() - startedAt < 1000) { poll = null; return; }
      sync();
    })
    .catch(function () {
      if (poll !== mine) return;
      poll = null;
      etag = "";
      if (online) { online = false; apply({}); }
    });
}

function retry() { if (!poll) sync(); }

function startRetryTimer() {
  try {
    var code = "setInterval(function(){postMessage(0)}," + RETRY_MS + ")";
    var worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
    worker.onmessage = retry;
  } catch (e) {
    setInterval(retry, RETRY_MS);
  }
}

function connectElgatoStreamDeckSocket(port, pluginUUID, registerEvent) {
  ws = new WebSocket("ws://127.0.0.1:" + port);
  ws.onopen = function () { send({ event: registerEvent, uuid: pluginUUID }); };
  ws.onmessage = function (ev) {
    var data = JSON.parse(ev.data);
    var settings = data.payload && data.payload.settings;
    if (data.event === "willAppear") {
      contexts[data.context] = { path: pathFor(data.action, settings), shown: null };
      sync();
    }
    if (data.event === "willDisappear") {
      delete contexts[data.context];
      sync();
    }
    if (data.event === "didReceiveSettings" && contexts[data.context]) {
      contexts[data.context] = { path: pathFor(data.action, settings), shown: null };
      sync();
    }
    if (data.event === "keyDown") {
      var path = contexts[data.context] ? contexts[data.context].path : pathFor(data.action, settings);
      var warn = function () { send({ event: "showAlert", context: data.context }); };
      if (!path) { warn(); return; }
      fetch(API + path, { cache: "no-store" })
        .then(function (res) { if (!res.ok) warn(); })
        .catch(warn);
      if (!poll) sync();
    }
  };
  startRetryTimer();
}
`;

const PAGE_STYLE =
  "body{font-family:Segoe UI,sans-serif;font-size:13px;color:#d8d8d8;background:#2d2d2d;margin:12px}" +
  "label{display:block;margin:8px 0 4px}select,input{width:100%;box-sizing:border-box}";

function html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function streamDeckPluginHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ArenaCue</title></head>
<body>
<script>${STREAM_DECK_PLUGIN_SCRIPT}</script>
</body></html>
`;
}

/** Instelscherm van de scorebordknop: één keuzelijst met wat de knop doet. */
export function streamDeckBoardInspectorHtml(locale: DeckLocale): string {
  const texts = DECK_TEXTS[locale];
  const options = BOARD_DECK_PATHS.map(
    (path) => `<option value="${html(path)}">${html(deckPathName(path, texts))}</option>`,
  ).join("");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ArenaCue</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<label for="path">${html(texts.piFunction)}</label>
<select id="path">${options}</select>
<script>
var ws, actionInfo;
function send(evt){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(evt)); }
function connectElgatoStreamDeckSocket(port, inUuid, registerEvent, info, inActionInfo){
  actionInfo = JSON.parse(inActionInfo);
  var select = document.getElementById("path");
  var s = actionInfo.payload && actionInfo.payload.settings || {};
  if (s.path) select.value = s.path;
  ws = new WebSocket("ws://127.0.0.1:"+port);
  ws.onopen = function(){ send({ event: registerEvent, uuid: inUuid }); };
  select.onchange = function(){
    send({ event:"setSettings", context: actionInfo.context, payload:{ path: select.value } });
  };
}
</script>
</body></html>
`;
}

/** Instelscherm van de studio-knoppen (knopnummer, bronnummer, score-kant); ongewijzigd. */
export function streamDeckStudioInspectorHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ArenaCue</title>
<style>${PAGE_STYLE}</style>
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
}

/** Alle tekstbestanden van de plug-in, met hun pad binnen de plug-inmap. */
export function streamDeckPluginFiles(locale: DeckLocale): { name: string; text: string }[] {
  return [
    { name: "manifest.json", text: JSON.stringify(streamDeckManifest(locale), null, 2) },
    { name: "plugin.html", text: streamDeckPluginHtml() },
    { name: "pi.html", text: streamDeckStudioInspectorHtml() },
    { name: "board.html", text: streamDeckBoardInspectorHtml(locale) },
    { name: `${KEY_IMAGE}.svg`, text: KEY_SVG },
    { name: `${ACTION_ICON}.svg`, text: ACTION_SVG },
  ];
}
