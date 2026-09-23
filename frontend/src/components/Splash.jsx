import { useEffect, useRef } from 'react'

/* ════════════════════════════════════════════════════════════════
   PARAMETRIZAÇÃO (ajuste tudo aqui — ver splash.html na raiz p/ docs)
   ════════════════════════════════════════════════════════════════ */
const TEXTS = [
  'Projeto Mara',
  'Mara',
  'Motor de Alocação, Risco e Análise',
  'Multiestratégia Research Asset Allocation',
  'MARA', // ← logo final (permanece)
]

// ms por etapa (uma por frase, exceto a última, que é o estado final)
const STAGE_DURATIONS = [2800, 2400, 4200, 4600]

const COLORS = { bg: '#0B0F14', ink: '#E6EDF3', cyan: '#22D3EE', blue: '#3B82F6' }

const SCRAMBLE = {
  frameMs: 40, // velocidade do embaralhamento
  perChar: 12, // iterações que cada caractere "testa" antes de travar
  stagger: 55, // defasagem (ms) entre letras vizinhas (esq→dir)
  chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@<>/\\+=*',
}

const MONTE_CARLO = {
  lines: 26, // nº de trajetórias secundárias
  opacity: 0.16, // opacidade base
  speed: 0.45, // velocidade da oscilação
  noise: 0.9, // intensidade do ruído
  amplitude: 0.1, // amplitude (fração da altura)
  drift: 0.42, // tendência (>0 = ALTA)
}

const CSS = `
.mara-splash {
  --bg: ${COLORS.bg}; --ink: ${COLORS.ink}; --cyan: ${COLORS.cyan};
  --blue: ${COLORS.blue}; --muted: #5B6B7A;
  position: fixed; inset: 0; z-index: 9999;
  background: var(--bg); color: var(--ink);
  font-family: "Space Mono", monospace; overflow: hidden;
}
.mara-splash * { box-sizing: border-box; }
.mara-splash #mc { position: absolute; inset: 0; width: 100%; height: 100%; display: block; z-index: 0; }
.mara-splash .vignette {
  position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(ellipse at 50% 45%, rgba(11,15,20,0) 35%, rgba(11,15,20,.85) 100%);
}
.mara-splash .stage {
  position: absolute; inset: 0; z-index: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  text-align: center; padding: 24px;
}
.mara-splash #logo {
  margin: 0; font-family: "Space Mono", monospace; font-weight: 700;
  font-size: clamp(22px, 5.2vw, 56px); letter-spacing: .04em; line-height: 1.15;
  min-height: 1.2em; white-space: pre-wrap; word-break: break-word; max-width: 90vw;
  transition: letter-spacing .6s ease;
}
.mara-splash #logo .scram { color: var(--cyan); }
.mara-splash #logo .lock  { color: var(--ink); }
.mara-splash #logo.final {
  font-family: "Space Grotesk", sans-serif; font-weight: 700; letter-spacing: .14em;
  font-size: clamp(46px, 12vw, 130px); color: var(--ink);
  text-shadow: 0 0 14px rgba(34,211,238,.55), 0 0 38px rgba(34,211,238,.30), 0 0 80px rgba(34,211,238,.12);
}
.mara-splash .outro {
  margin-top: 28px; display: flex; flex-direction: column; align-items: center; gap: 22px;
  opacity: 0; transform: translateY(8px);
  transition: opacity .8s ease, transform .8s ease; pointer-events: none;
}
.mara-splash .outro.show { opacity: 1; transform: none; pointer-events: auto; }
.mara-splash .subtitle {
  font-family: "Space Grotesk", sans-serif; font-weight: 500; font-size: clamp(12px, 2vw, 16px);
  letter-spacing: .26em; text-transform: uppercase; color: var(--cyan);
}
.mara-splash .sim { font-family: "Space Mono", monospace; font-size: 13px; letter-spacing: .12em; color: var(--muted); }
.mara-splash .sim .dots::after { content: ""; animation: mara-dots 1.4s steps(4, end) infinite; }
@keyframes mara-dots { 0%{content:""} 25%{content:"."} 50%{content:".."} 75%{content:"..."} 100%{content:""} }
.mara-splash .enter-btn {
  font-family: "Space Grotesk", sans-serif; font-weight: 700; font-size: 15px;
  letter-spacing: .14em; text-transform: uppercase; color: var(--ink);
  background: transparent; border: 1px solid var(--cyan); border-radius: 10px;
  padding: 13px 34px; cursor: pointer;
  transition: background .25s ease, box-shadow .25s ease, transform .12s ease;
}
.mara-splash .enter-btn:hover { background: rgba(34,211,238,.12); box-shadow: 0 0 22px rgba(34,211,238,.35); }
.mara-splash .enter-btn:active { transform: translateY(1px); }
.mara-splash .enter-btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.mara-splash .skip-btn {
  position: absolute; top: 22px; right: 24px; z-index: 3;
  font-family: "Space Mono", monospace; font-size: 12px; letter-spacing: .18em;
  text-transform: uppercase; color: var(--muted); background: transparent;
  border: 1px solid rgba(91,107,122,.4); border-radius: 8px; padding: 8px 16px; cursor: pointer;
  transition: color .2s ease, border-color .2s ease, opacity .4s ease;
}
.mara-splash .skip-btn:hover { color: var(--cyan); border-color: rgba(34,211,238,.5); }
.mara-splash .skip-btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.mara-splash .skip-btn.hidden { opacity: 0; pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .mara-splash #logo { transition: opacity .5s ease; } }
`

export default function Splash({ onEnter }) {
  const canvasRef = useRef(null)
  const logoRef = useRef(null)
  const outroRef = useRef(null)
  const skipRef = useRef(null)

  useEffect(() => {
    const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const canvas = canvasRef.current
    const logoEl = logoRef.current
    const outroEl = outroRef.current
    const skipBtn = skipRef.current
    const ctx = canvas.getContext('2d')

    let W = 0, H = 0
    let finished = false          // sequência encerrada (natural ou via skip)
    let mainProgress = 0
    let rafId = 0
    let lanes = []

    // ── helpers ──
    const hexA = (hex, a) => {
      const n = parseInt(hex.slice(1), 16)
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
    }
    const randChar = () => SCRAMBLE.chars[(Math.random() * SCRAMBLE.chars.length) | 0]
    const lockTime = (i) => i * SCRAMBLE.stagger + SCRAMBLE.perChar * SCRAMBLE.frameMs
    const totalLock = (text) => lockTime(text.length - 1)
    const escapeHTML = (s) => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]))

    function renderScramble(text, elapsed) {
      let html = ''
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === ' ') { html += ' '; continue }
        if (elapsed >= lockTime(i)) html += `<span class="lock">${escapeHTML(ch)}</span>`
        else html += `<span class="scram">${escapeHTML(randChar())}</span>`
      }
      logoEl.innerHTML = html
    }

    // ── canvas (Monte Carlo, viés de alta) ──
    function buildLanes() {
      lanes = []
      for (let i = 0; i < MONTE_CARLO.lines; i++) {
        lanes.push({
          slope: MONTE_CARLO.drift * (0.45 + Math.random() * 1.15),
          amp: MONTE_CARLO.amplitude * (0.4 + Math.random()),
          freq: 2 + Math.random() * 5,
          phase: Math.random() * Math.PI * 2,
          speed: 0.6 + Math.random() * 0.9,
        })
      }
    }
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = window.innerWidth; H = window.innerHeight
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const geo = () => ({ leftX: W * 0.08, rightX: W * 0.98, startY: H * 0.64 })
    function laneY(l, xf, t) {
      const g = geo()
      const rise = l.slope * xf * H
      const wave = l.amp * H * Math.sin(xf * l.freq + l.phase + t * l.speed) * xf
      const wobble = MONTE_CARLO.noise * 6 * Math.sin(xf * 14 + t * 0.7 + l.phase) * xf
      return g.startY - rise + wave + wobble
    }
    function mainY(xf, t) {
      const g = geo()
      const rise = MONTE_CARLO.drift * 1.55 * xf * H
      const wave = MONTE_CARLO.amplitude * 0.45 * H * Math.sin(xf * 2.4 + t * 0.5) * xf
      return g.startY - rise + wave
    }
    function drawBackground(t) {
      ctx.clearRect(0, 0, W, H)
      const g = geo()
      const span = g.rightX - g.leftX
      const STEP = 0.012
      ctx.lineWidth = 1
      for (const l of lanes) {
        ctx.beginPath()
        for (let xf = 0; xf <= 1.0001; xf += STEP) {
          const x = g.leftX + xf * span
          const y = laneY(l, xf, t)
          xf === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.strokeStyle = hexA(COLORS.blue, MONTE_CARLO.opacity)
        ctx.stroke()
      }
      mainProgress = REDUCE ? 1 : Math.min(1, mainProgress + 0.004)
      ctx.save()
      ctx.shadowColor = COLORS.cyan
      ctx.shadowBlur = 16
      ctx.lineWidth = 2.2
      ctx.strokeStyle = hexA(COLORS.cyan, 0.95)
      ctx.beginPath()
      let tipX = g.leftX, tipY = g.startY
      for (let xf = 0; xf <= mainProgress + 1e-9; xf += STEP) {
        const x = g.leftX + xf * span
        const y = mainY(xf, t)
        xf === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        tipX = x; tipY = y
      }
      ctx.stroke()
      ctx.beginPath()
      ctx.fillStyle = COLORS.cyan
      ctx.shadowBlur = 24
      ctx.arc(tipX, tipY, 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    function goFinal() {
      if (finished) return
      finished = true
      mainProgress = 1
      const last = TEXTS[TEXTS.length - 1]
      logoEl.classList.remove('final')
      logoEl.textContent = last
      logoEl.style.opacity = '1'
      logoEl.classList.add('final')
      outroEl.classList.add('show')
      skipBtn.classList.add('hidden')
    }
    const doSkip = () => goFinal()
    const onKey = (e) => { if (e.key === 'Escape') doSkip() }

    // ── start ──
    resize()
    buildLanes()
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', onKey)
    skipBtn.addEventListener('click', doSkip)

    if (REDUCE) {
      drawBackground(0)
      let stage = 0
      const show = () => {
        if (finished) return
        const isLast = stage === TEXTS.length - 1
        logoEl.style.opacity = '0'
        setTimeout(() => {
          if (finished) return
          if (isLast) { goFinal(); return }
          logoEl.textContent = TEXTS[stage]
          logoEl.style.opacity = '1'
          setTimeout(() => { stage++; show() }, STAGE_DURATIONS[stage])
        }, 350)
      }
      show()
    } else {
      let stage = 0
      let stageStart = performance.now()
      let lastRender = 0
      const frame = (now) => {
        const t = (now / 1000) * MONTE_CARLO.speed
        drawBackground(t)
        if (!finished) {
          const elapsed = now - stageStart
          const text = TEXTS[stage]
          if (now - lastRender >= SCRAMBLE.frameMs) { renderScramble(text, elapsed); lastRender = now }
          const isLast = stage === TEXTS.length - 1
          if (!isLast && elapsed >= STAGE_DURATIONS[stage]) { stage++; stageStart = now }
          else if (isLast && elapsed >= totalLock(text)) goFinal()
        }
        rafId = requestAnimationFrame(frame)
      }
      rafId = requestAnimationFrame(frame)
    }

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', onKey)
      skipBtn.removeEventListener('click', doSkip)
    }
  }, [])

  return (
    <div className="mara-splash">
      <style>{CSS}</style>
      <canvas id="mc" ref={canvasRef} />
      <div className="vignette" />
      <button className="skip-btn" ref={skipRef} type="button" title="Pular intro (Esc)">Pular ›</button>
      <main className="stage">
        <h1 id="logo" ref={logoRef} aria-live="polite" />
        <div className="outro" ref={outroRef}>
          <div className="subtitle">Motor de Alocação, Risco e Análise</div>
          <div className="sim">simulando<span className="dots" /></div>
          <button className="enter-btn" type="button" onClick={() => onEnter?.()}>Entrar</button>
        </div>
      </main>
    </div>
  )
}
