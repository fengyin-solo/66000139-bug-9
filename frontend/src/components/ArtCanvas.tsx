import { useEffect, useRef, useState } from 'react'
import { useDesignStore } from '../store/design'
import { generateArtwork, buildSvg, type Artwork, type GenerateParams, type ProgressInfo } from '../generators/render'

type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

const PATTERN_LABEL: Record<string, string> = {
  spiral: '螺旋', fractal: '分形树', wave: '波浪', circles: '圆环', noise: '噪声场',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export default function ArtCanvas() {
  const pattern = useDesignStore(s => s.pattern)
  const seed = useDesignStore(s => s.seed)
  const iterations = useDesignStore(s => s.iterations)
  const scale = useDesignStore(s => s.scale)
  const rotation = useDesignStore(s => s.rotation)
  const strokeWidth = useDesignStore(s => s.strokeWidth)
  const opacity = useDesignStore(s => s.opacity)
  const bgColor = useDesignStore(s => s.bgColor)
  const palette = useDesignStore(s => s.palette)
  const width = useDesignStore(s => s.width)
  const height = useDesignStore(s => s.height)
  const setSvgContent = useDesignStore(s => s.setSvgContent)

  // 上一版“可用结果”：新参数进入时不清空，画布继续展示它，直到新一轮完成再原子替换
  const [art, setArt] = useState<Artwork | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<ProgressInfo>({ done: 0, total: 0, elapsedMs: 0 })
  const [errorMsg, setErrorMsg] = useState('')
  // 手动点“停止”时置位，用于区分“被新参数抢占”（静默继续下一轮）与“用户中断”（展示中断面板）
  const abortControllerRef = useRef<AbortController | null>(null)
  const manualStopRef = useRef(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // —— 重计算参数（图案内容相关）：变化时启动一轮可取消的分帧生成 ——
  useEffect(() => {
    const params: GenerateParams = {
      pattern, seed, iterations, scale, strokeWidth, opacity, palette, w: width, h: height,
    }
    manualStopRef.current = false
    const controller = new AbortController()
    abortControllerRef.current = controller
    setPhase('running')
    setProgress({ done: 0, total: 0, elapsedMs: 0 })

    generateArtwork(params, controller.signal, setProgress)
      .then(result => {
        if (controller.signal.aborted) return
        setArt(result)
        setPhase('done')
      })
      .catch(err => {
        if (controller.signal.aborted) {
          if (manualStopRef.current) {
            setPhase('cancelled')
            setErrorMsg('本轮生成已被手动中断，画布仍保留上一版结果。')
          }
          // 被新参数抢占时不提示，下一轮 effect 已在进行
          return
        }
        setPhase('error')
        setErrorMsg(errorMessage(err) || '生成过程中发生未知错误')
      })

    return () => {
      controller.abort()
    }
    // rotation / bgColor 只影响外层包装，不触发重算
  }, [pattern, seed, iterations, scale, strokeWidth, opacity, palette, width, height, retryNonce])

  // —— 纯展示参数（旋转 / 背景）与新一轮完成：仅重新包装 SVG，即时生效 ——
  useEffect(() => {
    if (!art) return
    const svg = buildSvg(art.content, {
      w: art.params.w, h: art.params.h,
      rotation, bgColor,
    })
    setSvgContent(svg)
    if (hostRef.current) hostRef.current.innerHTML = svg
  }, [art, rotation, bgColor, setSvgContent])

  const handleStop = () => {
    manualStopRef.current = true
    abortControllerRef.current?.abort()
  }

  const handleRetry = () => {
    // 递增 nonce 重新触发生成 effect
    setRetryNonce(n => n + 1)
  }

  const pct = progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : null
  const running = phase === 'running'
  const hasResult = art !== null
  const label = PATTERN_LABEL[pattern] ?? pattern

  return (
    <div className="relative inline-block leading-none" aria-busy={running}>
      <div
        ref={hostRef}
        className={`shadow-2xl rounded border border-gray-700 transition-opacity duration-150 ${running && hasResult ? 'opacity-60' : 'opacity-100'}`}
        style={{
          width: width,
          height: hasResult ? undefined : height,
          maxWidth: '100%',
          maxHeight: 'calc(100vh - 3rem)',
          overflow: 'hidden',
          background: bgColor,
        }}
      />

      {/* 顶部：进度条（仅生成中） */}
      {running && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gray-800/60 rounded-t overflow-hidden">
          {pct !== null ? (
            <div
              className="h-full bg-indigo-500 transition-[width] duration-100"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-indigo-500 animate-pulse" />
          )}
        </div>
      )}

      {/* 右上：状态 / 耗时读数 */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5 pointer-events-none">
        {running && (
          <div className="pointer-events-auto flex items-center gap-2 px-2.5 py-1 rounded bg-gray-900/85 border border-gray-600 text-xs text-gray-200">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>正在更新「{label}」</span>
            <span className="tabular-nums text-gray-400">
              {pct !== null ? `${pct}% · ` : ''}{formatDuration(progress.elapsedMs)}
            </span>
            <button
              onClick={handleStop}
              className="ml-1 px-1.5 py-0.5 rounded bg-rose-600/80 hover:bg-rose-500 text-white text-[11px]"
            >
              停止
            </button>
          </div>
        )}
        {!running && phase === 'done' && (
          <div className="px-2.5 py-1 rounded bg-gray-900/80 border border-gray-700 text-[11px] text-gray-400 tabular-nums">
            ✓ 已完成 · 耗时 {formatDuration(art!.durationMs)}
            {art!.total > 0 ? ` · ${art!.total.toLocaleString()} 个单元` : ''}
          </div>
        )}
      </div>

      {/* 中央：无结果时的等待提示 / 错误面板 / 中断面板 */}
      {running && !hasResult && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-4 py-3 rounded-lg bg-gray-900/90 border border-gray-700 text-sm text-gray-300 text-center">
            <div className="mb-1">正在生成「{label}」…</div>
            <div className="text-xs text-gray-500 tabular-nums">
              {pct !== null ? `${pct}%（${progress.done.toLocaleString()}/${progress.total.toLocaleString()}）· ` : ''}
              {formatDuration(progress.elapsedMs)}
            </div>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex justify-center">
          <div className="max-w-md w-full px-4 py-3 rounded-lg bg-rose-950/95 border border-rose-700 text-sm">
            <div className="font-medium text-rose-300 mb-1">⚠ 生成失败</div>
            <div className="text-xs text-rose-200/80 break-words mb-3">{errorMsg}</div>
            <div className="flex gap-2">
              <button
                onClick={handleRetry}
                className="px-3 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium"
              >
                重试
              </button>
              {hasResult && (
                <span className="self-center text-[11px] text-gray-400">画布仍为上一版可用结果</span>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'cancelled' && (
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 flex justify-center">
          <div className="max-w-md w-full px-4 py-3 rounded-lg bg-gray-900/95 border border-gray-600 text-sm">
            <div className="font-medium text-gray-200 mb-1">■ 已中断</div>
            <div className="text-xs text-gray-400 mb-3">
              {errorMsg}
            </div>
            <button
              onClick={handleRetry}
              className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
            >
              用当前参数重试
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
