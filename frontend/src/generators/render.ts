import type { PatternType } from '../types'
import {
  createRng,
  generateSpiral, generateFractal, generateWave, generateCircles, generateNoise,
  type GenParams, type ChunkGenerator,
} from './patterns'

// 每帧用于生成的时间预算（ms），留出余量给浏览器绘制与交互响应
const FRAME_BUDGET_MS = 8

export interface ProgressInfo {
  /** 已完成的工作单元数（线段/路径/扫描格） */
  done: number
  /** 总工作单元数；未知时为 0，界面显示不确定进度 */
  total: number
  /** 从本轮开始累计的耗时（ms） */
  elapsedMs: number
}

export interface Artwork {
  /** 图案层 SVG 片段 */
  content: string
  /** 本轮生成使用的参数快照 */
  params: GenerateParams
  /** 总工作单元数（可能为 0，表示未知） */
  total: number
  /** 实际生成耗时（ms） */
  durationMs: number
}

export interface GenerateParams extends GenParams {
  pattern: PatternType
  seed: number
}

function createGenerator(p: GenerateParams, rng: ReturnType<typeof createRng>): ChunkGenerator {
  switch (p.pattern) {
    case 'spiral':  return generateSpiral(p, rng)
    case 'fractal': return generateFractal(p, rng)
    case 'wave':    return generateWave(p, rng)
    case 'circles': return generateCircles(p, rng)
    case 'noise':   return generateNoise(p, rng)
    default:
      throw new Error(`暂不支持的图案类型：${p.pattern}`)
  }
}

function countTotal(p: GenerateParams): number {
  const { pattern, w, h, iterations, scale } = p
  switch (pattern) {
    case 'spiral': {
      const rng = createRng(p.seed)
      const arms = 3 + Math.floor(rng() * 5)
      return arms * iterations
    }
    case 'fractal':
      // 树节点总数与随机数无关，先跑一次结构计数
      return countFractalNodes(h, iterations, scale)
    case 'wave': {
      const layers = Math.min(20, Math.floor(iterations / 10))
      return layers * (Math.floor(w / 4) + 1)
    }
    case 'circles':
      return iterations
    case 'noise': {
      const step = Math.max(4, Math.floor(20 / scale))
      return Math.floor(w / step) * Math.floor(h / step)
    }
    default:
      return 0
  }
}

function countFractalNodes(h: number, iterations: number, scale: number): number {
  const depth = Math.min(8, Math.floor(iterations / 25) + 2)
  // 与 patterns.ts 中 tree() 的递归结构一一对应：
  // 第 level 层（根为 0）枝长 = 初始长度 * 0.7^level；d<=0 或 len<2 的节点不绘制。
  // spread 只改变角度（随机），不影响是否终止，因此计数与随机数无关。
  const rootLen = h * 0.25 * scale
  let count = 0
  let alive = 1 // 当前层可绘制的节点数
  for (let level = 0; level < depth; level++) {
    const len = rootLen * Math.pow(0.7, level)
    if (len < 2) break
    count += alive
    alive *= 2
  }
  return count
}

/**
 * 分帧推进生成：每帧只跑 FRAME_BUDGET_MS 的工作量，随后让出主线程，
 * 使滑杆拖动与页面交互不会被阻塞。
 * - signal 被取消（新参数进入 / 用户点停止 / 组件卸载）时会在下一帧边界中止
 * - onProgress 每帧最多回调一次
 */
export function generateArtwork(
  params: GenerateParams,
  signal: AbortSignal,
  onProgress: (info: ProgressInfo) => void,
): Promise<Artwork> {
  return new Promise((resolve, reject) => {
    const total = countTotal(params)
    const rng = createRng(params.seed)
    const gen = createGenerator(params, rng)
    const startedAt = performance.now()
    let rafId = 0
    let done = 0

    const onAbort = () => {
      cancelAnimationFrame(rafId)
      reject(new DOMException('生成已取消', 'AbortError'))
    }
    if (signal.aborted) {
      reject(new DOMException('生成已取消', 'AbortError'))
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      const frameStart = performance.now()
      try {
        // 同一帧内连续推进，直到耗尽预算 / 生成结束 / 被取消
        while (performance.now() - frameStart < FRAME_BUDGET_MS) {
          const res = gen.next()
          if (res.done) {
            const durationMs = performance.now() - startedAt
            signal.removeEventListener('abort', onAbort)
            resolve({ content: res.value as string, params, total, durationMs })
            return
          }
          done = res.value
        }
        onProgress({ done, total, elapsedMs: performance.now() - startedAt })
        rafId = requestAnimationFrame(tick)
      } catch (err) {
        signal.removeEventListener('abort', onAbort)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    rafId = requestAnimationFrame(tick)
  })
}

/** 把图案层片段包装成完整 SVG 文档（旋转 / 背景属于纯展示参数，即时生效） */
export function buildSvg(
  content: string,
  opts: { w: number; h: number; rotation: number; bgColor: string },
): string {
  const { w, h, rotation, bgColor } = opts
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bgColor}"/>
  <g transform="rotate(${rotation},${w / 2},${h / 2})">${content}</g>
</svg>`
}
