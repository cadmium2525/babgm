const $ = (id) => document.getElementById(id);
const audio = $('audio');
const baseSource = new URL('./audio/water.wav', location.href).href;
let mode = 'loop';
let completed = false;
let worker = null;
let generation = 0;
let blobUrl = null;
let fadeDuration = 0;
let fadeOffset = 0;
let preparedFade = null;
let deferredInstall = null;
let returnFocus = null;

function readSetting(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* Private browsing may deny storage. */ }
}
function showError(text = '') {
  $('error').textContent = text;
  $('error').hidden = !text;
}
function formatTime(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
function update() {
  const playing = !audio.paused && !audio.ended;
  $('play').setAttribute('aria-label', playing ? '一時停止' : '再生');
  $('play').setAttribute('aria-pressed', String(playing));
  $('play-icon').hidden = playing;
  $('pause-icon').hidden = !playing;
  $('cancel-fade').hidden = !worker && !preparedFade && mode !== 'fade';
  $('status').textContent = preparedFade ? '画面を戻すと開始' : worker ? '準備中' : completed ? '停止しました' : mode === 'fade' ? (playing ? 'フェード中' : '一時停止') : '水の音';
  $('remaining').textContent = mode === 'fade' && !completed
    ? `あと ${formatTime(fadeDuration - audio.currentTime)}` : 'ループ';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = completed ? 'none' : playing ? 'playing' : 'paused';
    if (mode === 'fade' && Number.isFinite(audio.duration) && audio.duration > 0) {
      try { navigator.mediaSession.setPositionState({duration: audio.duration, playbackRate: 1, position: Math.min(audio.currentTime, audio.duration)}); } catch { /* Optional API. */ }
    } else {
      try { navigator.mediaSession.setPositionState(); } catch { /* Optional API. */ }
    }
  }
}
function cancelPreparation() {
  generation++;
  worker?.terminate();
  worker = null;
  preparedFade = null;
  $('progress').hidden = true;
  $('fade').disabled = false;
  $('minutes').disabled = false;
  update();
}
function changeSource(source, loop, offset = 0) {
  const oldBlob = blobUrl;
  audio.src = source;
  audio.loop = loop;
  audio.load();
  if (offset > 0) audio.currentTime = offset;
  blobUrl = source.startsWith('blob:') ? source : null;
  if (oldBlob && oldBlob !== blobUrl) URL.revokeObjectURL(oldBlob);
}
function restoreLoop(offset = 0) {
  cancelPreparation();
  mode = 'loop';
  completed = false;
  fadeDuration = 0;
  fadeOffset = 0;
  changeSource(baseSource, true, offset % 60);
  update();
}
function commitFade(prepared) {
  preparedFade = null;
  fadeDuration = prepared.duration;
  fadeOffset = prepared.offset;
  mode = 'fade';
  completed = false;
  changeSource(URL.createObjectURL(prepared.blob), false);
  update();
  if (prepared.wasPlaying) void play();
}
async function play() {
  showError();
  if (completed || audio.ended) restoreLoop();
  try {
    if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
  } catch { /* Optional on older Safari versions. */ }
  try { await audio.play(); }
  catch (error) {
    if (error.name !== 'AbortError') showError(error.name === 'NotAllowedError' ? '再生ボタンをタップしてください。' : '再生できません。もう一度お試しください。');
  }
  update();
}
function pause() {
  cancelPreparation();
  audio.pause();
  update();
}
$('play').addEventListener('click', () => {
  if (!audio.paused) pause();
  else { cancelPreparation(); void play(); }
});

$('fade-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!$('fade-form').reportValidity()) return;
  const minutes = Number($('minutes').value);
  if (!Number.isFinite(minutes) || minutes < 0.1 || minutes > 60) return;
  saveSetting('yoru-minutes', minutes);
  cancelPreparation();
  showError();
  // Start native audio while still in the user gesture. It continues during encoding.
  if (completed || audio.ended || mode === 'fade') restoreLoop();
  const offsetSeconds = mode === 'loop' ? audio.currentTime : 0;
  void play();
  let currentWorker;
  try { currentWorker = new Worker(new URL('./fade-worker.js', import.meta.url)); }
  catch { showError('このブラウザではフェードを準備できません。'); return; }
  worker = currentWorker;
  const id = ++generation;
  $('progress').value = 0;
  $('progress').hidden = false;
  $('fade').disabled = true;
  $('minutes').disabled = true;
  update();
  const fail = () => {
    if (id !== generation) return;
    cancelPreparation();
    showError('準備できませんでした。短い時間でお試しください。');
  };
  currentWorker.onerror = fail;
  currentWorker.onmessage = ({data}) => {
    if (data.id !== id || id !== generation) return;
    if (data.type === 'progress') { $('progress').value = data.value; return; }
    if (data.type === 'error') { fail(); return; }
    if (data.type !== 'done') return;
    const wasPlaying = !audio.paused;
    currentWorker.terminate();
    worker = null;
    $('progress').hidden = true;
    $('fade').disabled = false;
    $('minutes').disabled = false;
    const prepared = {blob: data.blob, duration: data.duration, offset: offsetSeconds, wasPlaying};
    // Safari may reject a new media source while hidden. Keep the old loop until visible.
    if (document.hidden) { preparedFade = prepared; update(); }
    else commitFade(prepared);
  };
  currentWorker.postMessage({id, minutes, offsetSeconds, format: 'wav'});
});
$('cancel-fade').addEventListener('click', () => {
  if (worker || preparedFade) { cancelPreparation(); return; }
  const wasPlaying = !audio.paused && !audio.ended;
  const offset = fadeOffset + audio.currentTime;
  restoreLoop(offset);
  if (wasPlaying) void play();
});

const savedVolume = Number(readSetting('yoru-volume', '0.5'));
audio.volume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 0.5;
$('volume').value = String(audio.volume);
$('volume').addEventListener('input', () => {
  audio.volume = Number($('volume').value);
  saveSetting('yoru-volume', audio.volume);
});
const savedMinutes = Number(readSetting('yoru-minutes', '10'));
$('minutes').value = String(Number.isFinite(savedMinutes) && savedMinutes >= 0.1 && savedMinutes <= 60 ? savedMinutes : 10);
// iOS delegates volume to hardware; a slider would falsely imply control.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS) document.querySelector('.volume-row').hidden = true;

audio.addEventListener('ended', () => { completed = true; update(); });
for (const name of ['play', 'pause', 'loadedmetadata', 'durationchange', 'timeupdate']) audio.addEventListener(name, update);
audio.addEventListener('error', () => showError('音声を読み込めません。ページを開き直してください。'));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (preparedFade) commitFade(preparedFade);
    update();
  }
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = new MediaMetadata({title: '夜の音', artist: '水の音', artwork: [{src: new URL('./icons/icon-512.png', location.href).href, sizes: '512x512', type: 'image/png'}]});
  const handlers = {play: () => void play(), pause, stop: () => { pause(); restoreLoop(); }};
  for (const [name, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* Optional action. */ }
  }
}
$('help-open').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
$('help').addEventListener('click', (event) => { if (event.target === $('help')) { const r = $('help').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('help').close(); } });
function uncurtain() {
  $('curtain').hidden = true;
  document.querySelector('main').inert = false;
  returnFocus?.focus();
}
$('blackout').addEventListener('click', () => {
  returnFocus = document.activeElement;
  $('curtain').hidden = false;
  document.querySelector('main').inert = true;
  $('curtain').focus();
});
$('curtain').addEventListener('click', uncurtain);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('curtain').hidden) uncurtain(); });

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstall = event;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  await deferredInstall.prompt();
  const result = await deferredInstall.userChoice;
  deferredInstall = null;
  $('install').hidden = true;
  if (result.outcome === 'dismissed') $('help').showModal();
});
window.addEventListener('appinstalled', () => { $('install').hidden = true; deferredInstall = null; });

async function registerOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    const registration = await navigator.serviceWorker.ready;
    // The install event resolves only after all shell + complete audio assets are cached.
    if (registration.active) $('offline').textContent = 'オフライン可';
    if ('storage' in navigator && navigator.storage.persisted) {
      // Do not prompt for extra permissions; cache eviction is still browser controlled.
      await navigator.storage.persisted();
    }
  } catch { $('offline').textContent = 'オンラインで利用'; }
}
void registerOffline();
update();
