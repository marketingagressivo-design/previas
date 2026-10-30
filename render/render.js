/* Renderiza uma animação em HTML (a mesma da prévia) para MP4.
   Uso: node render/render.js render/fila/<id>.json
   O JSON: { "html": "render/fila/<id>.html", "w": 1080, "h": 1080, "fps": 30, "dur": 58.98, "saida": "saida/<id>.mp4", "crf": 20 }
   O HTML precisa ter: window.renderAt(t) (desenha o quadro do instante t em segundos) e <audio id="au" src="data:..."> (opcional). */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
(async () => {
  const cfgPath = process.argv[2]; if (!cfgPath) throw new Error('faltou o .json do pedido');
  const J = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const W = +J.w || 1080, H = +J.h || 1080, FPS = +J.fps || 30, CRF = String(J.crf || 20);
  const htmlAbs = path.resolve(J.html), saida = path.resolve(J.saida || ('saida/' + path.basename(cfgPath, '.json') + '.mp4'));
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  // áudio embutido no HTML (data:audio/...;base64,...) → arquivo
  let audio = '';
  const txt = fs.readFileSync(htmlAbs, 'utf8'), m = txt.match(/<audio[^>]*src="data:audio\/([a-z0-9+.-]+);base64,/i);
  if (m) { const i = m.index + m[0].length, j = txt.indexOf('"', i); audio = path.join(path.dirname(saida), '_audio.' + (/mpeg|mp3/.test(m[1]) ? 'mp3' : /wav/.test(m[1]) ? 'wav' : 'm4a')); fs.writeFileSync(audio, Buffer.from(txt.slice(i, j), 'base64')); }
  else { const s = txt.match(/<audio[^>]*src="([^"]+)"/i); if (s && !/^data:/.test(s[1])) { const p = path.resolve(path.dirname(htmlAbs), s[1]); if (fs.existsSync(p)) audio = p; } }
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: Math.min(W + 40, 2600), height: Math.min(H + 140, 1600) } });
  page.on('pageerror', e => console.log('erro na página:', e.message));
  await page.goto('file://' + htmlAbs);
  await page.waitForFunction(() => typeof window.renderAt === 'function', null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  let dur = +J.dur; if (!dur) dur = await page.evaluate(() => (document.getElementById('au') && document.getElementById('au').duration) || 0);
  if (!dur) throw new Error('informe "dur" (duração em segundos) no .json');
  const N = Math.round(dur * FPS);
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
  if (audio) args.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', CRF, '-pix_fmt', 'yuv420p', '-r', String(FPS), '-t', String(dur), '-movflags', '+faststart', saida);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const d = await page.evaluate(t => { window.renderAt(t); return document.getElementById('cv').toDataURL('image/jpeg', 0.95).slice(23); }, i / FPS);
    if (!ff.stdin.write(Buffer.from(d, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log('quadro', i, '/', N, Math.round((Date.now() - t0) / 1000) + 's');
  }
  ff.stdin.end(); const cod = await new Promise(r => ff.on('close', r));
  await browser.close(); if (audio && audio.includes('_audio')) fs.unlinkSync(audio);
  if (cod !== 0) throw new Error('o ffmpeg falhou (código ' + cod + ')');
  console.log('pronto:', saida, Math.round(fs.statSync(saida).size / 1e6) + ' MB em ' + Math.round((Date.now() - t0) / 1000) + 's');
})().catch(e => { console.error(e); process.exit(1); });
