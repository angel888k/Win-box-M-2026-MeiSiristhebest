import { SR_MODE_LABEL } from '../../../../shared/player';
import type { SuperResolutionFeedback } from '../application/superResolutionPort';
import type { SuperResolutionModeChange } from '../application/superResolutionUseCases';
import type { MpvShaderRenderStatus } from '../../../../shared/player';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatSuperResolutionFeedback(change: SuperResolutionModeChange): SuperResolutionFeedback {
  switch (change.type) {
    case 'persistence-failed':
      return { kind: 'error', message: `保存超分档位失败：${describeError(change.error)}` };
    case 'saved-and-acknowledged':
      return {
        kind: 'ok',
        message: change.mode === 'off'
          ? 'MPV 已确认清空着色器列表；GPU 实际渲染状态尚未核验。'
          : `MPV 已确认切换到「${SR_MODE_LABEL[change.mode] ?? change.mode}」；GPU 实际渲染状态尚未核验。`,
      };
    case 'saved-but-unconfirmed':
      return {
        kind: 'error',
        message: '档位已保存，但 MPV 未确认切换命令成功。请确认使用 MPV 内核后重试；下次启动时仍会按保存的档位尝试加载。',
      };
    case 'saved-but-command-failed':
      return {
        kind: 'error',
        message: `档位已保存，但向 MPV 发送指令失败：${describeError(change.error)}`,
      };
  }
}

export function formatSuperResolutionRenderStatus(status: MpvShaderRenderStatus): string {
  switch (status.state) {
    case 'disabled': return '超分已关闭。';
    case 'no-session': return '当前没有运行中的 MPV 会话，无法检查渲染 pass。';
    case 'unavailable': return status.detail || '读取 MPV 渲染状态失败。';
    case 'unsupported': return `当前 MPV 输出后端不支持渲染 pass 查询。${status.detail ? `（${status.detail}）` : ''}`;
    case 'waiting-for-frame': return 'MPV 尚未报告画面渲染 pass；有画面后重新打开此面板检查。';
    case 'unidentifiable': return `MPV 报告了 ${status.activePasses?.length ?? 0} 个渲染 pass，但当前着色器没有可匹配的描述标记，无法确认超分是否参与渲染。`;
    case 'not-observed': return `MPV 当前渲染 pass 中没有发现所选档位的着色器（观察到 ${status.activePasses?.length ?? 0} 个 pass）。`;
    case 'observed': {
      const passes = status.matchingPasses ?? [];
      return `MPV 渲染管线已观察到所选着色器：${passes.slice(0, 3).join('、')}${passes.length > 3 ? ` 等 ${passes.length} 个 pass` : ''}。这证明着色器 pass 正在运行，不代表已确认使用独立显卡硬件加速。`;
    }
  }
}
