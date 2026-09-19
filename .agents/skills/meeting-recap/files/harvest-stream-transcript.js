// Harvest a SharePoint Stream transcript out of the player's own panel.
//
// WHY THIS EXISTS. Two easier routes do not work:
//   1. Graph: `meeting-transcript:///events/<token>` off a calendar event's
//      `meetingTranscriptUrl` returns GraphAccessToTranscriptsDisabled. The
//      scopes are granted; a TENANT POLICY blocks it. Nothing you can fix.
//   2. The player's own transcript file (`.../cdnmedia/transcripts?...kid=...`)
//      is ENCRYPTED. Fetching it succeeds and gives you ciphertext, which is
//      worse than failing, because the length looks right.
//
// So: read the rendered panel. It is a Fluent `ms-List`, heavily virtualised —
// about 110 of 1,800 rows exist in the DOM at any moment — so it has to be
// scrolled and harvested by `data-list-index`, not read in one go.
//
// Run through the browser's javascript_tool with the transcript panel OPEN.
// Leaves the joined text on `window.__c`; slice it out in ~25k-char chunks.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The scroll container is an ancestor of .ms-List, not the list itself.
let sc = null;
for (let n = document.querySelector('.ms-List'); n && n !== document.body; n = n.parentElement) {
  const s = getComputedStyle(n);
  if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 50) {
    sc = n;
    break;
  }
}
if (!sc) throw new Error('No scroll container — is the Transcript panel open?');

// Keyed by data-list-index so re-visiting a row is idempotent and the final
// order is the transcript's own, whatever order the scrolling visited it in.
const rows = {};
const grab = () =>
  document.querySelectorAll('.ms-List-cell').forEach((c) => {
    const i = +c.getAttribute('data-list-index');
    const t = c.innerText.trim();
    if (t) rows[i] = t;
  });

sc.scrollTop = 0;
await sleep(400);
grab();
// 700px is under one viewport, so no row is skipped between samples. 110ms is
// enough for Fluent to re-render; much less and rows come back empty.
for (let y = 0; y <= sc.scrollHeight; y += 700) {
  sc.scrollTop = y;
  await sleep(110);
  grab();
}
sc.scrollTop = sc.scrollHeight;
await sleep(400);
grab();

// A cell is [speaker, "X minutes Y seconds", "0:03", "speaker 0:03", ...text],
// or for a continuation [ "speaker X minutes Y seconds", ...text ] with no
// clock timestamp at all. Both collapse to "[m:ss] Speaker: text".
const clock = (s) => {
  const h = +(s.match(/(\d+) hours?/) || [0, 0])[1];
  const m = +(s.match(/(\d+) minutes?/) || [0, 0])[1];
  const sec = +(s.match(/(\d+) seconds?/) || [0, 0])[1];
  return (h ? h + ':' + String(m).padStart(2, '0') : '' + m) + ':' + String(sec).padStart(2, '0');
};

const out = [];
for (const k of Object.keys(rows).map(Number).sort((a, b) => a - b)) {
  const parts = rows[k].split('\n').map((s) => s.trim()).filter(Boolean);
  const joined = parts.join(' ');
  if (/transcription$/.test(joined)) { out.push('--- ' + joined); continue; }
  const i = parts.findIndex((p) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(p));
  if (i >= 0) {
    out.push('[' + parts[i] + '] ' + parts[0] + ': ' + parts.slice(i + 2).join(' '));
  } else {
    const m = (parts[0] || '').match(/^(.*?)\s+((?:\d+ hours? )?(?:\d+ minutes? )?\d+ seconds?)$/);
    out.push(m ? '[' + clock(m[2]) + '] ' + m[1] + ': ' + parts.slice(1).join(' ') : '[?] ' + joined);
  }
}

window.__c = out.join('\n');
({ entries: out.length, chars: window.__c.length, unparsed: out.filter((l) => l.startsWith('[?]')).length });
