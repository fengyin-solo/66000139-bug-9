import { useDesignStore } from '../store/design'
import { formatElapsed } from '../render/runner'

// 侧栏预览：始终保留上一版完整结果，并标注当前生成状态与耗时。
export default function PreviewPanel() {
  const svgContent = useDesignStore(s => s.svgContent)
  const render = useDesignStore(s => s.render)
  const retry = useDesignStore(s => s.retry)
  const cancelGeneration = useDesignStore(s => s.cancelGeneration)

  const src = svgContent ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}` : null
  const progress = render.totalUnits > 0 ? Math.round((render.unitsDone / render.totalUnits) * 100) : 0

  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">预览</label>
      <div className="relative rounded border border-gray-700 bg-gray-950 h-36 overflow-hidden flex items-center justify-center">
        {src ? (
          <img src={src} alt="作品预览" className="max-w-full max-h-full object-contain" />
        ) : (
          <span className="text-xs text-gray-600">尚无作品</span>
        )}

        {render.status === 'generating' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-gray-950/60 px-3">
            <div className="h-5 w-5 rounded-full border-2 border-gray-500 border-t-indigo-300 animate-spin" />
            <span className="text-[11px] text-gray-200">
              {src ? '正在更新…' : '正在生成…'} {progress}%
            </span>
            <span className="text-[10px] text-gray-400 tabular-nums">{formatElapsed(render.elapsedMs)}</span>
            <button onClick={cancelGeneration}
              className="mt-0.5 px-2 py-0.5 rounded text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-100">
              中断
            </button>
          </div>
        )}

        {(render.status === 'error' || render.status === 'cancelled') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gray-950/70 px-2 text-center">
            <span className="text-[11px] text-gray-100">
              {render.status === 'error' ? '生成失败' : '已中断'}
            </span>
            <span className="text-[10px] text-gray-400">
              {render.status === 'error'
                ? (render.error ?? '未知错误')
                : `完成 ${render.unitsDone}/${render.totalUnits} · ${formatElapsed(render.elapsedMs)}`}
            </span>
            <button onClick={retry}
              className="px-2 py-0.5 rounded text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white">
              重试
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-[10px] text-gray-500 leading-relaxed">
        {render.status === 'done' && `上次生成耗时 ${formatElapsed(render.elapsedMs)}`}
        {render.status === 'generating' && (src ? '正在用新参数更新，预览仍为上一版结果' : '正在生成首版作品')}
        {render.status === 'error' && (src ? '出错，预览保留上一版结果，可重试' : '出错，尚无结果，可重试')}
        {render.status === 'cancelled' && (src ? '已中断，预览保留上一版结果，可重试' : '已中断，尚无结果，可重试')}
        {render.status === 'idle' && (src ? '就绪' : '等待生成')}
      </p>
    </div>
  )
}
