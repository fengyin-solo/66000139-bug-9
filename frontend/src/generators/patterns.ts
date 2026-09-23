// Seeded PRNG (mulberry32)
export function createRng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = ReturnType<typeof createRng>

// 一次作品生成被拆成若干「单元」，调度器可逐单元、分帧推进并随时取消。
export interface PatternParams {
  w: number
  h: number
  iterations: number
  scale: number
  palette: string[]
  strokeWidth: number
  opacity: number
}

export interface PatternJob {
  totalUnits: number
  // 返回第 index 个单元生成的 SVG 片段；调用顺序固定，保证结果可复现。
  renderUnit: (index: number) => string
}

// 螺旋：每个单元为一条臂的一段（i 步进），首段补上 <path> 开头，末段补上结尾。
function spiralJob(p: PatternParams, rng: Rng): PatternJob {
  const { w, h, iterations, scale, palette, strokeWidth, opacity } = p
  const cx = w / 2, cy = h / 2
  const arms = 3 + Math.floor(rng() * 5)
  const totalUnits = arms * iterations

  return {
    totalUnits,
    renderUnit(index) {
      const arm = Math.floor(index / iterations)
      const i = index % iterations
      const color = palette[arm % palette.length]
      const offset = (arm / arms) * Math.PI * 2
      const angle = (i / iterations) * Math.PI * 8 + offset
      const r = (i / iterations) * Math.min(w, h) * 0.45 * scale
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      const head = i === 0 ? `<path d="M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
      const tail = i === iterations - 1
        ? `" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
        : ''
      return head + tail
    },
  }
}

// 分形树：递归规模小，预展开为线条数组，逐线作为一个单元。
function fractalJob(p: PatternParams, rng: Rng): PatternJob {
  const { w, h, iterations, scale, palette, strokeWidth, opacity } = p
  const depth = Math.min(8, Math.floor(iterations / 25) + 2)
  interface Line { x1: number; y1: number; x2: number; y2: number; depth: number }
  const lines: Line[] = []
  function tree(x: number, y: number, angle: number, len: number, d: number) {
    if (d <= 0 || len < 2) return
    const x2 = x + Math.cos(angle) * len
    const y2 = y + Math.sin(angle) * len
    lines.push({ x1: x, y1: y, x2, y2, depth: d })
    const spread = 0.4 + rng() * 0.3
    tree(x2, y2, angle - spread, len * 0.7, d - 1)
    tree(x2, y2, angle + spread, len * 0.7, d - 1)
  }
  tree(w / 2, h * 0.85, -Math.PI / 2, h * 0.25 * scale, depth)

  return {
    totalUnits: lines.length,
    renderUnit(index) {
      const l = lines[index]
      const color = palette[l.depth % palette.length]
      return `<line x1="${l.x1.toFixed(1)}" y1="${l.y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${l.y2.toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
    },
  }
}

// 波浪：每个单元为一条波浪路径（按层），与原实现逐像素输出完全一致。
function waveJob(p: PatternParams, rng: Rng): PatternJob {
  const { w, h, iterations, scale, palette, strokeWidth, opacity } = p
  const layers = Math.min(20, Math.floor(iterations / 10))
  interface WaveSpec { freq: number; amp: number; baseY: number; phase: number; layer: number }
  const specs: WaveSpec[] = []
  for (let layer = 0; layer < layers; layer++) {
    specs.push({
      freq: 0.005 + rng() * 0.01,
      amp: 30 + rng() * 60 * scale,
      baseY: (layer / layers) * h,
      phase: rng() * Math.PI * 2,
      layer,
    })
  }

  return {
    totalUnits: layers,
    renderUnit(index) {
      const s = specs[index]
      let d = `M0,${s.baseY.toFixed(1)}`
      for (let x = 0; x <= w; x += 4) {
        const y = s.baseY + Math.sin(x * s.freq + s.phase) * s.amp + Math.cos(x * s.freq * 2 + s.phase) * s.amp * 0.3
        d += ` L${x},${y.toFixed(1)}`
      }
      const color = palette[s.layer % palette.length]
      return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
    },
  }
}

// 圆环：每个单元为一个圆。
function circlesJob(p: PatternParams, rng: Rng): PatternJob {
  const { w, h, iterations, scale, palette, strokeWidth, opacity } = p
  const circles: { cx: number; cy: number; r: number }[] = []
  for (let i = 0; i < iterations; i++) {
    circles.push({ cx: rng() * w, cy: rng() * h, r: 5 + rng() * 80 * scale })
  }

  return {
    totalUnits: iterations,
    renderUnit(index) {
      const c = circles[index]
      const color = palette[index % palette.length]
      return `<circle cx="${c.cx.toFixed(1)}" cy="${c.cy.toFixed(1)}" r="${c.r.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
    },
  }
}

// 噪声场：每个单元为一行；行内各点是否跳过仍由顺序消费的 rng 决定。
function noiseJob(p: PatternParams, rng: Rng): PatternJob {
  const { w, h, scale, palette, strokeWidth, opacity } = p
  const step = Math.max(4, Math.floor(20 / scale))
  const cols = Math.floor(w / step)
  const rows = Math.floor(h / step)

  return {
    totalUnits: rows,
    renderUnit(row) {
      let out = ''
      for (let col = 0; col < cols; col++) {
        if (rng() > 0.4) continue
        const x = col * step
        const y = row * step
        const len = 5 + rng() * 15 * scale
        const angle = rng() * Math.PI * 2
        const x2 = x + Math.cos(angle) * len
        const y2 = y + Math.sin(angle) * len
        const color = palette[(row + col) % palette.length]
        out += `<line x1="${x}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`
      }
      return out
    },
  }
}

export function createPatternJob(
  pattern: string,
  params: PatternParams,
  rng: Rng
): PatternJob {
  switch (pattern) {
    case 'spiral':  return spiralJob(params, rng)
    case 'fractal': return fractalJob(params, rng)
    case 'wave':    return waveJob(params, rng)
    case 'circles': return circlesJob(params, rng)
    case 'noise':   return noiseJob(params, rng)
    default:        return { totalUnits: 0, renderUnit: () => '' }
  }
}
