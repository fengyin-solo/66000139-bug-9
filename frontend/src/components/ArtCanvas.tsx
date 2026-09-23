import { useEffect, useRef } from 'react'
import { shallow } from 'zustand/shallow'
import { useDesignStore } from '../store/design'
import { runGeneration, formatElapsed, type RunSnapshot } from '../render/runner'

export default function ArtCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lastTokenRef = useRef(0)

  const svgContent = useDesignStore(s => s.svgContent)
  const render = useDesignStore(s => s.render)
  const genNonce = useDesignStore(s => s.genNonce)
  const cancelToken = useDesignStore(s => s.cancelToken)
  const params = useDesignStore(s => ({
    pattern: s.pattern, seed: s.seed, iterations: s.iterations, scale: s.scale,
    rotation: s.rotation, strokeWidth: s.strokeWidth, opacity: s.opacity,
    bgColor: s.bgColor, palette: s.palette, width: s.width, height: s.height,
  }), shallow)
  const setRender = useDesignStore(s => s.setRender)
  const commitSvg = useDesignStore(s => s.commitSvg)
  const retry = useDesignStore(s => s.retry)
  const cancelGeneration = useDesignStore(s => s.cancelGeneration)

  // 取消信号：仅在 token 变化时中断当前这一轮。
  useEffect(() => {
    if (cancelToken === lastTokenRef.current) return
    lastTokenRef.current = cancelToken
    abortRef.current?.abort()
  }, [cancelToken])

  // 参数变化或重试都会重新分帧生成；上一轮的 controller 会在 cleanup 中被取消。
  useEffect(() => {
    const state = useDesignStore.getState()
    const controller = new AbortController()
    abortRef.current = controller
    let disposed = false

    setRender({ status: 'generating', error: null, unitsDone: 0, totalUnits: 0, elapsedMs: 0 })

    runGeneration(state, {
      signal: controller.signal,
      onProgress: (p: RunSnapshot) => {
        if (disposed) return
        setRender({ status: 'generating', unitsDone: p.unitsDone, totalUnits: p.totalUnits, elapsedMs: p.elapsedMs })
      },
    }).then((result) => {
      if (disposed) return
      if (result.status === 'done' && result.svg) {
        commitSvg(result.svg, result.elapsedMs)
      } else if (result.status === 'error') {
        setRender({
          status: 'error',
          error: result.error || '生成失败',
          unitsDone: result.unitsDone,
          totalUnits: result.totalUnits,
          elapsedMs: result.elapsedMs,
        })
      } else if (result.status === 'cancelled') {
        // 仅当这仍是当前轮次时落为「已中断」；被新参数顶掉时新一轮已在进行中。
        if (abortRef.current === controller) {
          setRender({
            status: 'cancelled',
            unitsDone: result.unitsDone,
            totalUnits: result.totalUnits,
            elapsedMs: result.elapsedMs,
          })
        }
      }
    })

    return () => {
      disposed = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, genNonce])

  // 成功后才把完整结果换到画布上，保证不会停在半幅画面。
  useEffect(() => {
    if (containerRef.current && svgContent) {
      containerRef.current.innerHTML = svgContent
    }
  }, [svgContent])

  const hasResult = svgContent.length > 0
  const progress = render.totalUnits > 0 ? Math.round((render.unitsDone / render.totalUnits) * 100) : 0
  const generating = render.status === 'generating'

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="relative shadow-2xl rounded border border-gray-700 bg-gray-900 art-frame"
        style={{ minWidth: 320, minHeight: 240 }}>
        <div ref={containerRef} className="[&>svg]:max-w-full [&>svg]:max-h-[calc(100vh-140px)] [&>svg]:h-auto [&>svg]:block" />

        {/* 初始生成且还没有任何可用结果 */}
        {generating && !hasResult && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/80 rounded">
            <Spinner />
            <p className="text-sm text-gray-300">正在生成作品…</p>
            <ProgressBar value={progress} />
            <p className="text-xs text-gray-400 tabular-nums">{progress}% · {formatElapsed(render.elapsedMs)}</p>
          </div>
        )}

        {/* 更新中：保留上一版结果，只覆盖一层提示 */}
        {generating && hasResult && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2 bg-gray-950/70 backdrop-blur-sm rounded-t text-xs text-gray-200">
            <Spinner small />
            <span>正在更新参数</span>
            <div className="flex-1"><ProgressBar value={progress} thin /></div>
            <span className="tabular-nums">{progress}%</span>
            <span className="text-gray-400 tabular-nums">{formatElapsed(render.elapsedMs)}</span>
            <button onClick={cancelGeneration}
              className="ml-1 px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-100">
              停止
            </button>
          </div>
        )}

        {/* 错误或被中断：说明原因并允许重试，画面不空白 */}
        {(render.status === 'error' || render.status === 'cancelled') && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/70 rounded p-6">
            <div className="max-w-sm text-center flex flex-col items-center gap-3">
              <div className={`text-2xl`}>{render.status === 'error' ? '⚠️' : '⏹️'}</div>
              <p className="text-sm font-medium text-gray-100">
                {render.status === 'error' ? '生成过程中出错' : '本次生成已中断'}
              </p>
              {render.status === 'error' && render.error && (
                <p className="text-xs text-rose-300 break-words">{render.error}</p>
              )}
              <p className="text-xs text-gray-400">
                已完成 {render.unitsDone}/{render.totalUnits} 单元 · 耗时 {formatElapsed(render.elapsedMs)}
                {hasResult ? '，下方仍保留上一版可用结果' : '，尚无可用结果'}
              </p>
              <button onClick={retry}
                className="px-4 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-medium">
                重试
              </button>
            </div>
          </div>
        )}
      </div>

      <StatusBar hasResult={hasResult} progress={progress} />
    </div>
  )
}

function StatusBar({ hasResult, progress }: { hasResult: boolean; progress: number }) {
  const render = useDesignStore(s => s.render)
  let text: string
  let dot = 'bg-gray-400'
  if (render.status === 'generating') {
    dot = 'bg-indigo-400 animate-pulse'
    text = `正在生成… ${progress}%（${render.unitsDone}/${render.totalUnits} 单元）· 已用 ${formatElapsed(render.elapsedMs)}`
  } else if (render.status === 'done') {
    dot = 'bg-emerald-400'
    text = `生成完成 · 耗时 ${formatElapsed(render.elapsedMs)}`
  } else if (render.status === 'error') {
    dot = 'bg-rose-400'
    text = `生成失败：${render.error ?? '未知错误'} · 已用 ${formatElapsed(render.elapsedMs)} · 可重试`
  } else if (render.status === 'cancelled') {
    dot = 'bg-amber-400'
    text = `已中断（${render.unitsDone}/${render.totalUnits} 单元）· 已用 ${formatElapsed(render.elapsedMs)} · 可重试`
  } else {
    text = hasResult ? '就绪' : '等待生成'
  }

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      <span>{text}</span>
    </div>
  )
}

function ProgressBar({ value, thin }: { value: number; thin?: boolean }) {
  return (
    <div className={`w-full rounded-full bg-gray-700 overflow-hidden ${thin ? 'h-1' : 'h-2'}`}>
      <div className="h-full bg-indigo-500 transition-[width] duration-100" style={{ width: `${value}%` }} />
    </div>
  )
}

function Spinner({ small }: { small?: boolean }) {
  const size = small ? 'h-3.5 w-3.5 border-2' : 'h-6 w-6 border-[3px]'
  return <div className={`${size} rounded-full border-gray-500 border-t-indigo-300 animate-spin`} />
}
