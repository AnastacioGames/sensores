'use strict';
/* Painel de Sensores — somente Web APIs reais, 100% client-side. */

const $ = (s, r = document) => r.querySelector(s);
const winInput = $('#win');
const getN = () => Math.max(3, parseInt(winInput.value, 10) || 20);

/* ---------- Log ---------- */
const logEl = $('#log');
function addLog(sensor, msg) {
  const empty = logEl.querySelector('.empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  const t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString('pt-BR');
  li.append(t, `[${sensor}] ${msg}`);
  logEl.prepend(li);
  while (logEl.children.length > 300) logEl.lastChild.remove();
}
$('#clear-log').onclick = () => {
  logEl.innerHTML = '<li class="empty">Nenhuma alteração detectada ainda.</li>';
};

/* ---------- Contexto ---------- */
$('#ctx').textContent = window.isSecureContext
  ? 'Contexto seguro (HTTPS/localhost): sensores disponíveis conforme o navegador.'
  : 'ATENÇÃO: página fora de contexto seguro — a maioria dos sensores não funcionará. Use HTTPS ou localhost.';

/* ---------- Cartão base com detector de alteração ---------- */
class Card {
  constructor({ id, icon, name, unit, threshold, step = 'any', note = '', supported = true, reason = '' }) {
    this.id = id; this.name = name; this.unit = unit;
    this.win = []; this.lastFlag = -Infinity; this.active = false;
    const el = this.el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <header><span class="ico">${icon}</span><span class="name">${name}</span>
        <span class="badge">ocioso</span></header>
      <div class="extra"></div>
      <div class="reading">—</div>
      <div class="row">
        <button class="toggle" type="button">Ativar</button>
        <label>Limiar (${unit}) <input class="thr" type="number" min="0" step="${step}" value="${threshold}"></label>
      </div>
      <div class="note">${note}</div>`;
    $('#cards').append(el);
    this.badge = $('.badge', el); this.reading = $('.reading', el);
    this.extra = $('.extra', el); this.btn = $('.toggle', el); this.thr = $('.thr', el);
    this.btn.onclick = () => (this.active ? this.stop() : this.start());
    if (!supported) this.setStatus('indisponivel', 'indisponível neste navegador', reason);
  }
  get threshold() { return parseFloat(this.thr.value) || 0; }
  setStatus(cls, text, msg) {
    this.badge.className = 'badge ' + cls;
    this.badge.textContent = text;
    if (msg !== undefined) this.reading.textContent = msg;
    if (cls === 'indisponivel') { this.btn.disabled = true; this.thr.disabled = true; }
  }
  setActive(on) {
    this.active = on;
    this.btn.textContent = on ? 'Desativar' : 'Ativar';
    this.btn.classList.toggle('stop', on);
    this.setStatus(on ? 'ativo' : '', on ? 'ativo' : 'ocioso');
    if (!on) { this.win = []; this.el.classList.remove('changed'); }
  }
  fail(err) {
    this.setActive(false);
    const m = err && err.name === 'NotAllowedError' ? 'permissão negada' : (err && (err.message || err.name)) || 'erro';
    this.setStatus('indisponivel', 'indisponível', 'Não foi possível usar: ' + m);
    this.btn.disabled = false; this.thr.disabled = false; // permite tentar de novo
  }
  /** Detector genérico: valor atual vs. média móvel das últimas N leituras. */
  detect(v) {
    const n = getN();
    let changed = false;
    if (this.win.length >= Math.min(5, n)) {
      const avg = this.win.reduce((a, b) => a + b, 0) / this.win.length;
      const diff = v - avg;
      if (Math.abs(diff) > this.threshold) {
        changed = true;
        this.flag(`variação de ${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ${this.unit} (atual ${v.toFixed(2)}, média ${avg.toFixed(2)}, limiar ${this.threshold})`);
      }
    }
    this.win.push(v);
    while (this.win.length > n) this.win.shift();
    if (!changed) this.unflagSoon();
  }
  flag(msg) {
    this.el.classList.add('changed');
    this.flagAt = performance.now();
    if (performance.now() - this.lastFlag > 2000) { // evita inundar o log
      this.lastFlag = performance.now();
      addLog(this.name, msg);
    }
  }
  unflagSoon() {
    if (this.flagAt && performance.now() - this.flagAt > 800) {
      this.el.classList.remove('changed'); this.flagAt = 0;
    }
  }
}

const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const noMedia = 'getUserMedia indisponível (use HTTPS/localhost e um navegador compatível).';

/* ---------- Microfone ---------- */
class Mic extends Card {
  constructor() {
    super({ id: 'mic', icon: '🎤', name: 'Microfone', unit: 'dB', threshold: 10,
      note: 'dB relativo ao fundo de escala digital (≤ 0), aproximado — não é SPL calibrado.',
      supported: hasMedia && !!(window.AudioContext || window.webkitAudioContext), reason: noMedia });
    this.btn.textContent = 'Ativar microfone';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 300; this.canvas.height = 80;
    this.extra.append(this.canvas);
  }
  async start() {
    this.setStatus('pedindo', 'pedindo permissão');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      await this.ctx.resume();
      this.an = this.ctx.createAnalyser();
      this.an.fftSize = 2048; this.an.smoothingTimeConstant = 0.6;
      this.ctx.createMediaStreamSource(this.stream).connect(this.an);
      this.td = new Float32Array(this.an.fftSize);
      this.fd = new Uint8Array(this.an.frequencyBinCount);
      this.setActive(true);
      this.loop();
    } catch (e) { this.cleanup(); this.fail(e); }
  }
  loop() {
    if (!this.active) return;
    this.an.getFloatTimeDomainData(this.td);
    let s = 0;
    for (const x of this.td) s += x * x;
    const rms = Math.sqrt(s / this.td.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-7));
    this.reading.textContent = `${db.toFixed(1)} dB\nRMS ${rms.toFixed(4)}`;
    this.detect(db);
    this.an.getByteFrequencyData(this.fd);
    const c = this.canvas.getContext('2d'), w = this.canvas.width, h = this.canvas.height;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#58a6ff';
    const bins = 128, bw = w / bins, step = Math.floor(this.fd.length / 2 / bins) || 1; // ~0–11 kHz
    for (let i = 0; i < bins; i++) {
      const v = this.fd[i * step] / 255;
      c.fillRect(i * bw, h - v * h, bw - 1, v * h);
    }
    this.raf = requestAnimationFrame(() => this.loop());
  }
  cleanup() {
    cancelAnimationFrame(this.raf);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.stream = this.ctx = null;
  }
  stop() { this.setActive(false); this.cleanup(); this.reading.textContent = '—'; }
}

/* ---------- Câmera (luminosidade média) ---------- */
class Cam extends Card {
  constructor() {
    super({ id: 'cam', icon: '📷', name: 'Câmera / Luz', unit: '0–255', threshold: 15,
      note: 'Brilho médio do frame (luma) como proxy de luz ambiente. O vídeo não sai do navegador. Auto-exposição da câmera também altera o valor.',
      supported: hasMedia, reason: noMedia });
    this.btn.textContent = 'Ativar câmera';
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true;
    this.extra.append(this.video);
    this.cv = document.createElement('canvas'); this.cv.width = 32; this.cv.height = 24;
  }
  async start() {
    this.setStatus('pedindo', 'pedindo permissão');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.setActive(true);
      this.timer = setInterval(() => this.sample(), 250);
    } catch (e) { this.cleanup(); this.fail(e); }
  }
  sample() {
    if (!this.video.videoWidth) return;
    const c = this.cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(this.video, 0, 0, 32, 24);
    const d = c.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const lum = sum / (d.length / 4);
    this.reading.textContent = `${lum.toFixed(1)} / 255\n${(lum / 2.55).toFixed(0)} %`;
    this.detect(lum);
  }
  cleanup() {
    clearInterval(this.timer);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.video.srcObject = null; this.stream = null;
  }
  stop() { this.setActive(false); this.cleanup(); this.reading.textContent = '—'; }
}

/* ---------- GPS ---------- */
const R = 6371000, rad = x => x * Math.PI / 180;
function dist(a, b) { // haversine, metros
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
class Gps extends Card {
  constructor() {
    super({ id: 'gps', icon: '📍', name: 'GPS', unit: 'm', threshold: 20,
      note: 'Alteração = distância da posição atual até o centro das últimas N posições. A imprecisão do GPS (accuracy) causa deriva mesmo parado.',
      supported: 'geolocation' in navigator, reason: 'Geolocation API indisponível.' });
  }
  start() {
    this.setStatus('pedindo', 'pedindo permissão');
    this.wid = navigator.geolocation.watchPosition(p => {
      if (!this.active) this.setActive(true);
      const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      let line = `${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}\nprecisão ±${p.coords.accuracy.toFixed(0)} m`;
      const n = getN();
      if (this.win.length >= Math.min(3, n)) {
        const ctr = { lat: this.win.reduce((a, q) => a + q.lat, 0) / this.win.length,
                      lon: this.win.reduce((a, q) => a + q.lon, 0) / this.win.length };
        const d = dist(ctr, pos);
        line += ` · Δ ${d.toFixed(1)} m`;
        if (d > this.threshold) this.flag(`posição variou ${d.toFixed(1)} m do centro recente (limiar ${this.threshold} m, precisão ±${p.coords.accuracy.toFixed(0)} m)`);
        else this.unflagSoon();
      }
      this.win.push(pos);
      while (this.win.length > n) this.win.shift();
      this.reading.textContent = line;
    }, e => {
      if (this.wid != null) navigator.geolocation.clearWatch(this.wid);
      this.wid = null;
      this.fail(e.code === 1 ? { name: 'NotAllowedError' } : { message: e.code === 2 ? 'posição indisponível' : e.code === 3 ? 'tempo esgotado' : (e.message || 'erro de geolocalização') });
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  stop() {
    if (this.wid != null) navigator.geolocation.clearWatch(this.wid);
    this.wid = null; this.setActive(false); this.reading.textContent = '—';
  }
}

/* ---------- Movimento / Orientação ---------- */
async function askMotionPermission(Cls) {
  // iOS 13+ exige requestPermission() dentro de um clique; detecta automaticamente.
  if (Cls && typeof Cls.requestPermission === 'function') {
    const r = await Cls.requestPermission();
    if (r !== 'granted') throw Object.assign(new Error('negada'), { name: 'NotAllowedError' });
  }
}
class Motion extends Card {
  constructor() {
    super({ id: 'motion', icon: '📳', name: 'Aceleração', unit: 'm/s²', threshold: 1.5, step: '0.1',
      note: 'Magnitude da aceleração (com gravidade se o aparelho não separar). Chega em ~60 Hz; em PC sem sensor, nenhum evento chega.',
      supported: 'DeviceMotionEvent' in window, reason: 'DeviceMotionEvent indisponível.' });
    this.handler = e => {
      const a = e.acceleration && e.acceleration.x != null ? e.acceleration : e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      this.got = true;
      const m = Math.hypot(a.x, a.y, a.z);
      this.reading.textContent = `x ${a.x.toFixed(2)}  y ${a.y.toFixed(2)}  z ${a.z.toFixed(2)}\n|a| ${m.toFixed(2)} m/s²`;
      this.detect(m);
    };
  }
  async start() {
    this.setStatus('pedindo', 'pedindo permissão');
    try {
      await askMotionPermission(window.DeviceMotionEvent);
      window.addEventListener('devicemotion', this.handler);
      this.got = false;
      this.setActive(true);
      this.reading.textContent = 'aguardando dados…';
      this.to = setTimeout(() => {
        if (this.active && !this.got) this.reading.textContent = 'Nenhum dado recebido: este dispositivo provavelmente não tem acelerômetro acessível.';
      }, 2500);
    } catch (e) { this.fail(e); }
  }
  stop() {
    clearTimeout(this.to);
    window.removeEventListener('devicemotion', this.handler);
    this.setActive(false); this.reading.textContent = '—';
  }
}
class Orient extends Card {
  constructor() {
    super({ id: 'orient', icon: '🧭', name: 'Orientação', unit: '°', threshold: 10, step: '1',
      note: 'alpha (0–360), beta (−180–180), gamma (−90–90). Alteração = maior desvio entre os três eixos.',
      supported: 'DeviceOrientationEvent' in window, reason: 'DeviceOrientationEvent indisponível.' });
    this.hist = [];
    this.handler = e => {
      if (e.alpha == null && e.beta == null && e.gamma == null) return;
      this.got = true;
      const v = [e.alpha || 0, e.beta || 0, e.gamma || 0];
      this.reading.textContent = `α ${v[0].toFixed(1)}  β ${v[1].toFixed(1)}  γ ${v[2].toFixed(1)}`;
      const n = getN();
      if (this.hist.length >= Math.min(5, n)) {
        let worst = 0;
        v.forEach((x, i) => {
          const avg = this.hist.reduce((a, h) => a + h[i], 0) / this.hist.length;
          let d = x - avg;
          if (i === 0) d = ((d + 540) % 360) - 180; // alpha é circular
          if (Math.abs(d) > Math.abs(worst)) worst = d;
        });
        if (Math.abs(worst) > this.threshold) this.flag(`orientação variou ${worst.toFixed(1)}° (limiar ${this.threshold}°)`);
        else this.unflagSoon();
      }
      this.hist.push(v);
      while (this.hist.length > n) this.hist.shift();
    };
  }
  async start() {
    this.setStatus('pedindo', 'pedindo permissão');
    try {
      await askMotionPermission(window.DeviceOrientationEvent);
      window.addEventListener('deviceorientation', this.handler);
      this.got = false; this.hist = [];
      this.setActive(true);
      this.reading.textContent = 'aguardando dados…';
      this.to = setTimeout(() => {
        if (this.active && !this.got) this.reading.textContent = 'Nenhum dado recebido: sem sensor de orientação acessível.';
      }, 2500);
    } catch (e) { this.fail(e); }
  }
  stop() {
    clearTimeout(this.to);
    window.removeEventListener('deviceorientation', this.handler);
    this.hist = []; this.setActive(false); this.reading.textContent = '—';
  }
}

/* ---------- Magnetômetro (melhor esforço) ---------- */
class Mag extends Card {
  constructor() {
    super({ id: 'mag', icon: '🧲', name: 'Magnetômetro', unit: 'µT', threshold: 5, step: '0.5',
      note: 'API experimental (Chrome Android, contexto seguro; pode exigir flag). Magnitude do campo; metais/eletrônicos próximos o alteram.',
      supported: 'Magnetometer' in window,
      reason: 'Não suportado neste navegador (Magnetometer API ausente).' });
  }
  async start() {
    this.setStatus('pedindo', 'pedindo permissão');
    try {
      if (navigator.permissions) {
        try {
          const p = await navigator.permissions.query({ name: 'magnetometer' });
          if (p.state === 'denied') throw Object.assign(new Error('negada'), { name: 'NotAllowedError' });
        } catch (e) { if (e.name === 'NotAllowedError') throw e; }
      }
      this.sensor = new window.Magnetometer({ frequency: 20 });
      this.sensor.addEventListener('reading', () => {
        const { x, y, z } = this.sensor;
        const m = Math.hypot(x, y, z);
        this.reading.textContent = `x ${x.toFixed(1)}  y ${y.toFixed(1)}  z ${z.toFixed(1)}\n|B| ${m.toFixed(1)} µT`;
        this.detect(m);
      });
      this.sensor.addEventListener('error', e => { this.cleanup(); this.fail(e.error); });
      this.sensor.start();
      this.setActive(true);
      this.reading.textContent = 'aguardando dados…';
    } catch (e) { this.cleanup(); this.fail(e); }
  }
  cleanup() { try { this.sensor && this.sensor.stop(); } catch (_) {} this.sensor = null; }
  stop() { this.cleanup(); this.setActive(false); this.reading.textContent = '—'; }
}

new Mic(); new Cam(); new Gps(); new Motion(); new Orient(); new Mag();
