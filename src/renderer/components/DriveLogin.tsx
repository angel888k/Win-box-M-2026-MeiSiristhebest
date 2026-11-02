// 网盘绑定只保留网页登录，由主进程抓取完整凭据并落盘。
import { driveProviderLabel, WEB_LOGIN_PROVIDERS } from '../../shared/driveProvider';
import type { DriveWebLoginPort } from '../features/driveBinding/application/driveBindingPorts';
import { useDriveWebLogin } from '../features/driveBinding/useDriveWebLogin';

interface Props {
  provider: string;
  onBound: (savedProvider: string) => void;
  port: DriveWebLoginPort;
}

export default function DriveLogin({ provider, onBound, port }: Props) {
  const { model, actions } = useDriveWebLogin(port);
  const label = driveProviderLabel(provider);
  const viaWeb = WEB_LOGIN_PROVIDERS.includes(provider);
  const loginForProvider = model.activeProvider === provider;
  const loginForAnotherProvider = !!model.activeProvider && !loginForProvider;

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      {viaWeb ? (
        <button className="primary" disabled={model.busy} onClick={() => void actions.login(provider, onBound)}
          title={`${label}：打开网页登录页，扫码后自动保存完整凭据`}>
          {loginForProvider ? '登录中…' : loginForAnotherProvider ? '等待其他网盘登录…' : '🌐 网页扫码登录'}
        </button>
      ) : (
        <span className="muted" style={{ fontSize: 12 }}>该网盘暂不支持网页扫码，请手动粘贴凭据</span>
      )}
      {loginForAnotherProvider && (
        <span className="muted" role="status" aria-live="polite" style={{ fontSize: 12 }}>
          「{driveProviderLabel(model.activeProvider || '')}」正在登录；可查看其他网盘，当前登录结束后才能再启动登录。
        </span>
      )}
      {model.messages[provider] && <output className="muted" role="status" aria-live="polite" style={{ fontSize: 12 }}>{model.messages[provider]}</output>}
    </div>
  );
}
