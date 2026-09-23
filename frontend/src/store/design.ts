import { create } from 'zustand'
import type { DesignParams, PatternType } from '../types'
import { THEMES } from '../themes/palettes'
import type { RunStatus } from '../render/runner'

interface RenderState {
  status: RunStatus
  unitsDone: number
  totalUnits: number
  elapsedMs: number
  error: string | null
}

interface DesignStore extends DesignParams {
  svgContent: string
  render: RenderState
  genNonce: number
  cancelToken: number
  setParam: <K extends keyof DesignParams>(key: K, value: DesignParams[K]) => void
  setPattern: (p: PatternType) => void
  setTheme: (id: string) => void
  randomSeed: () => void
  setRender: (patch: Partial<RenderState>) => void
  commitSvg: (svg: string, elapsedMs: number) => void
  retry: () => void
  cancelGeneration: () => void
  exportSvg: () => void
  exportPng: () => void
}

const initialRender: RenderState = {
  status: 'idle',
  unitsDone: 0,
  totalUnits: 0,
  elapsedMs: 0,
  error: null,
}

// 参数变化都会触发新一轮生成：旧的一轮由调度器取消，画布仍保留上一版结果。
function nextRender(): Partial<RenderState> {
  return { status: 'generating', error: null, unitsDone: 0, totalUnits: 0, elapsedMs: 0 }
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  pattern: 'spiral',
  seed: 42,
  iterations: 200,
  scale: 1.0,
  rotation: 0,
  strokeWidth: 1.5,
  opacity: 0.8,
  bgColor: '#030712',
  palette: THEMES[0].colors,
  width: 800,
  height: 1000,
  svgContent: '',
  render: initialRender,
  genNonce: 0,
  cancelToken: 0,
  setParam: (key, value) => set((s) => ({ [key]: value, render: { ...s.render, ...nextRender() } } as any)),
  setPattern: (p) => set((s) => ({ pattern: p, render: { ...s.render, ...nextRender() } })),
  setTheme: (id) => {
    const theme = THEMES.find(t => t.id === id)
    if (theme) set((s) => ({ palette: theme.colors, render: { ...s.render, ...nextRender() } }))
  },
  randomSeed: () => set((s) => ({ seed: Math.floor(Math.random() * 99999), render: { ...s.render, ...nextRender() } })),
  setRender: (patch) => set((s) => ({ render: { ...s.render, ...patch } })),
  commitSvg: (svg, elapsedMs) => {
    set({ svgContent: svg, render: { ...get().render, status: 'done', unitsDone: 0, totalUnits: 0, elapsedMs, error: null } })
  },
  retry: () => set((s) => ({ genNonce: s.genNonce + 1, render: { ...s.render, ...nextRender() } })),
  cancelGeneration: () => set((s) => ({ cancelToken: s.cancelToken + 1 })),
  exportSvg: () => {
    const { svgContent, render } = get()
    if (render.status === 'generating' || !svgContent) return
    const blob = new Blob([svgContent], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `art-${get().seed}.svg`; a.click()
    URL.revokeObjectURL(url)
  },
  exportPng: () => {
    const { svgContent, width, height, render } = get()
    if (render.status === 'generating' || !svgContent) return
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    const svgBlob = new Blob([svgContent], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(svgBlob)
    img.onload = () => {
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob!)
        a.download = `art-${get().seed}.png`; a.click()
      })
    }
    img.src = url
  },
}))
