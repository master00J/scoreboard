const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const iconPath = path.join(root, "assets", "icon.png");
const outPath = path.join(root, "assets", "feature-graphic-real-ui-1024x500.png");
const icon = fs.readFileSync(iconPath).toString("base64");

const svg = `
<svg width="1024" height="500" viewBox="0 0 1024 500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#020617"/>
      <stop offset="0.48" stop-color="#071426"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="cyan" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
    <linearGradient id="btn" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0ea5e9"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="20" stdDeviation="18" flood-color="#000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <rect width="1024" height="500" fill="url(#bg)"/>
  <path d="M0 410 C180 330 360 330 520 410 C700 500 860 460 1024 390 L1024 500 L0 500 Z" fill="#031b22" opacity="0.95"/>
  <path d="M0 430 C210 360 380 358 530 430 C720 510 870 468 1024 410" fill="none" stroke="#0ea5e9" stroke-width="2" opacity="0.35"/>
  <path d="M85 500 L370 310 M210 500 L430 310 M815 500 L640 310 M940 500 L705 310" stroke="#0ea5e9" stroke-width="1" opacity="0.13"/>
  <circle cx="110" cy="84" r="3" fill="#7dd3fc" opacity="0.65"/>
  <circle cx="126" cy="94" r="3" fill="#7dd3fc" opacity="0.45"/>
  <circle cx="898" cy="78" r="3" fill="#7dd3fc" opacity="0.65"/>
  <circle cx="914" cy="91" r="3" fill="#7dd3fc" opacity="0.45"/>

  <g transform="translate(52 62)">
    <rect x="0" y="0" width="338" height="138" rx="22" fill="#04111f" stroke="#22d3ee" stroke-width="4" filter="url(#glow)"/>
    <text x="44" y="83" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="900" fill="#38bdf8">1</text>
    <text x="244" y="83" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="900" fill="#38bdf8">0</text>
    <circle cx="169" cy="58" r="28" fill="none" stroke="#38bdf8" stroke-width="4"/>
    <path d="M150 58 L160 44 L178 44 L188 58 L178 73 L160 73 Z" fill="none" stroke="#38bdf8" stroke-width="3"/>
    <text x="108" y="116" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="800" fill="#38bdf8" letter-spacing="2">00:00</text>
  </g>

  <g transform="translate(52 250)">
    <text x="0" y="0" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="900">
      <tspan fill="#ffffff">ArenaCue</tspan><tspan dx="14" fill="url(#cyan)">Control</tspan>
    </text>
    <text x="0" y="52" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="600" fill="#dbeafe">Mobiele bediening voor je wedstrijd-PC</text>
    <rect x="0" y="82" width="520" height="3" rx="2" fill="url(#cyan)" opacity="0.7"/>
  </g>

  <g transform="translate(694 34)" filter="url(#shadow)">
    <rect x="0" y="0" width="268" height="432" rx="38" fill="#020617" stroke="#334155" stroke-width="5"/>
    <rect x="14" y="17" width="240" height="398" rx="26" fill="#09090b"/>
    <rect x="95" y="10" width="80" height="17" rx="8" fill="#020617"/>

    <g transform="translate(28 34)">
      <rect x="0" y="0" width="212" height="64" rx="18" fill="#101827" stroke="#1d4ed8"/>
      <image href="data:image/png;base64,${icon}" x="10" y="10" width="44" height="44" preserveAspectRatio="xMidYMid slice"/>
      <text x="66" y="27" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="900" fill="#ffffff">ArenaCue Control</text>
      <text x="66" y="47" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="600" fill="#bfdbfe">Score, timer en visuals</text>
    </g>

    <g transform="translate(28 108)">
      <rect x="0" y="0" width="212" height="34" rx="11" fill="#0f172a" stroke="#1e293b"/>
      <rect x="4" y="4" width="100" height="26" rx="8" fill="#2563eb"/>
      <text x="31" y="22" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="800" fill="#fff">Operator</text>
      <text x="128" y="22" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="800" fill="#94a3b8">Instellingen</text>
    </g>

    <g transform="translate(28 156)">
      <rect x="0" y="0" width="212" height="232" rx="16" fill="#121216" stroke="#27272a"/>
      <text x="14" y="28" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" fill="#e4e4e7">Live bediening</text>
      <rect x="14" y="43" width="184" height="78" rx="16" fill="#020617" stroke="#1d4ed8"/>
      <text x="69" y="64" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="800" fill="#93c5fd" letter-spacing="1">TIMER GEPAUZEERD</text>
      <text x="46" y="111" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="900" fill="#ffffff" letter-spacing="2">00:00</text>

      <rect x="14" y="136" width="86" height="36" rx="9" fill="url(#btn)"/>
      <rect x="112" y="136" width="86" height="36" rx="9" fill="#334155"/>
      <text x="32" y="159" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" fill="#fff">Start timer</text>
      <text x="131" y="159" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" fill="#fff">Reset</text>

      <rect x="14" y="184" width="86" height="36" rx="9" fill="url(#btn)"/>
      <rect x="112" y="184" width="86" height="36" rx="9" fill="url(#btn)"/>
      <text x="29" y="207" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" fill="#fff">Home +1</text>
      <text x="129" y="207" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" fill="#fff">Away +1</text>
    </g>
  </g>
</svg>`;

sharp(Buffer.from(svg)).png().toFile(outPath).then(() => {
  console.log(outPath);
});
