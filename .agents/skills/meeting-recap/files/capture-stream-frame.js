// Capture frames from a SharePoint Stream recording as screenshots you can see.
//
// WHY THIS EXISTS. A screenshot of the <video> element comes back BLACK, every
// time: the browser composites video on a layer the screenshot does not
// capture. Seeking, playing, pausing and waiting do not change that. (The
// old advice in SKILL.md, "re-seek a few seconds either side", was wrong.)
// The frames themselves are real and untainted, so drawImage onto a canvas
// works. A canvas is ALSO black in the screenshot. What shows is an <img>
// holding the canvas's data URL.
//
// Two traps found on 2026-10-12:
//   - The screenshot shows the PREVIOUS image unless you wait for the new one
//     to decode. That is why `await im.decode()` is here, and why the caller
//     still adds a 1-second `computer { action: "wait" }` before each
//     screenshot. Without both, every frame is attributed to the wrong time.
//   - So each frame gets its own timestamp, stamped bottom right. Cite that,
//     never the time you asked for.
//
// Run once through javascript_tool. Then, per frame:
//   await window.__snap(<seconds>)                  // the whole frame
//   await window.__crop(<seconds>, x, y, w, h)      // a region of the 1920x1080
//                                                   // frame, enlarged to fill
// then wait 1s, then screenshot. resize_window to 1600x900 first.

const v = document.querySelector('video');
v.muted = true;
v.pause();

const cv = document.createElement('canvas');
cv.width = v.videoWidth || 1920;
cv.height = v.videoHeight || 1080;

const im = document.createElement('img');
im.style.cssText =
  'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:100002;background:#000;object-fit:contain';
document.body.appendChild(im);

const seek = async (t) => {
  v.pause();
  v.currentTime = t;
  await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 6000); });
  await new Promise((r) => setTimeout(r, 1500));
};

const stamp = (g) => {
  const s = Math.floor(v.currentTime);
  const label = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  g.fillStyle = '#ff0';
  g.fillRect(cv.width - 220, cv.height - 40, 220, 40);
  g.fillStyle = '#000';
  g.font = 'bold 32px sans-serif';
  g.fillText(label, cv.width - 210, cv.height - 8);
  return label;
};

const show = async () => {
  im.src = cv.toDataURL('image/jpeg', 0.92);
  await im.decode();
  await new Promise((r) => setTimeout(r, 300));
};

window.__snap = async (t) => {
  await seek(t);
  const g = cv.getContext('2d');
  g.drawImage(v, 0, 0, cv.width, cv.height);
  const label = stamp(g);
  await show();
  return label;
};

window.__crop = async (t, x, y, w, h) => {
  await seek(t);
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, cv.width, cv.height);
  const k = Math.min(cv.width / w, cv.height / h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(v, x, y, w, h, 0, 0, w * k, h * k);
  const label = stamp(g);
  await show();
  return label;
};

'ready';
