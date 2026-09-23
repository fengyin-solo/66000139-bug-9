import type { PatternJob, PatternParams } from '../generators/patterns'
import { createRng, createPatternJob } from '../generators/patterns'
import type { DesignParams } from '../types'

export type RunStatus = 'idle' | 'generating' | 'done' | 'error' | 'cancelled'

export interface RunResult {
  status: 'done' | 'error' | 'cancelled'
  svg?: string
  content?: string
  error?: string
  unitsDone: number
  totalUnits: number
  elapsedMs: number
}

export interface RunSnapshot {
  unitsDone: number
  totalUnits: number
  elapsedMs: number
}

interface RunOptions {
  onProgress?: (s: RunSnapshot) => void
  signal?: AbortSignal
  // 每帧最多占用的主线程时间，留出余量给浏览器渲染与交互。
  frameBudgetMs?: number
}

// 把当前参数快照拼成完整 SVG。
export function buildSvg(params: DesignParams, content: string): string {
  const { width, height, rotation, bgColor } = params
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bgColor}"/>
  <g transform="rotate(${rotation},${width / 2},${height / 2})">${content}</g>
</svg>`
}

// 分帧推进一次生成：每帧在时间预算内渲染若干单元，期间可被 signal 取消。
export function runGeneration(params: DesignParams, options: RunOptions = {}): Promise<RunResult> {
  const { onProgress, signal, frameBudgetMs = 10 } = options

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ status: 'cancelled', unitsDone: 0, totalUnits: 0, elapsedMs: 0 })
      return
    }

    const startedAt = performance.now()
    let job: PatternJob
    try {
      const p: PatternParams = {
        w: params.width,
        h: params.height,
        iterations: params.iterations,
        scale: params.scale,
        palette: params.palette,
        strokeWidth: params.strokeWidth,
        opacity: params.opacity,
      }
      job = createPatternJob(params.pattern, p, createRng(params.seed))
    } catch (err) {
      resolve({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        unitsDone: 0,
        totalUnits: 0,
        elapsedMs: Math.round(performance.now() - startedAt),
      })
      return
    }

    const totalUnits = job.totalUnits
    let unitsDone = 0
    let content = ''

    const finishCancelled = () => resolve({
      status: 'cancelled',
      unitsDone,
      totalUnits,
      elapsedMs: Math.round(performance.now() - startedAt),
    })

    const finishError = (err: unknown) => resolve({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      unitsDone,
      totalUnits,
      elapsedMs: Math.round(performance.now() - startedAt),
    })

    const tick = () => {
      if (signal?.aborted) {
        finishCancelled()
        return
      }

      const frameStart = performance.now()
      try {
        // 每帧推进多个单元，直到耗尽预算；同时设单帧上限，避免超大单元独占。
        while (unitsDone < totalUnits && performance.now() - frameStart < frameBudgetMs) {
          const chunkEnd = Math.min(totalUnits, unitsDone + Math.max(1, Math.ceil(totalUnits / 200)))
          for (let i = unitsDone; i < chunkEnd; i++) {
            content += job.renderUnit(i)
          }
          unitsDone = chunkEnd
          if (signal?.aborted) {
            finishCancelled()
            return
          }
          onProgress?.({
            unitsDone,
            totalUnits,
            elapsedMs: Math.round(performance.now() - startedAt),
          })
        }
      } catch (err) {
        finishError(err)
        return
      }

      if (unitsDone >= totalUnits) {
        try {
          const svg = buildSvg(params, content)
          resolve({
            status: 'done',
            svg,
            content,
            unitsDone,
            totalUnits,
            elapsedMs: Math.round(performance.now() - startedAt),
          })
        } catch (err) {
          finishError(err)
        }
        return
      }

      // 本帧时间预算用尽，让出主线程，下一帧继续。
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  })
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
