import { useCallback, useEffect, useRef, useState } from 'react';
import { checkDriveCookie } from '../../../shared/driveCookie';
import { driveProviderLabel } from '../../../shared/driveProvider';
import type { DriveCredentialsPort } from './application/driveBindingPorts';
import { driveCredentialStatus } from './application/driveCredentialStatus';
import type { DriveCredentialProbeResult } from '../../../shared/driveCredential';

interface DriveCredentialManagementOptions {
  port: DriveCredentialsPort;
  initialProvider?: string;
  onSaved: () => void;
}

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useDriveCredentialManagement({ port, initialProvider, onSaved }: DriveCredentialManagementOptions) {
  const normalizedInitial = (initialProvider || '').trim().toLowerCase();
  const [provider, setProvider] = useState(normalizedInitial || 'quark');
  const [cookie, setCookie] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [probeResult, setProbeResult] = useState<DriveCredentialProbeResult | null>(null);
  const alive = useRef(false);
  const requestSequence = useRef(0);
  const operationInProgress = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    try {
      const value = await port.load();
      if (alive.current && request === requestSequence.current) setCredentials({ ...value });
      return true;
    } catch {
      return false;
    }
  }, [port]);

  useEffect(() => {
    alive.current = true;
    // oxlint-disable-next-line react/set-state-in-effect -- Loads external credentials asynchronously; the port result owns the state update.
    void refresh();
    return () => {
      alive.current = false;
      requestSequence.current += 1;
    };
  }, [refresh]);

  const selectProvider = useCallback((value: string) => {
    setProvider(value);
    setMessage('');
    setProbeResult(null);
  }, []);
  const changeCookie = useCallback((value: string) => {
    setCookie(value);
    setProbeResult(null);
  }, []);
  const clearMessage = useCallback(() => setMessage(''), []);

  const probe = useCallback(async () => {
    if (operationInProgress.current) return false;
    operationInProgress.current = true;
    setBusy(true);
    setMessage('');
    setProbeResult(null);
    try {
      const result = await port.probe(provider);
      if (alive.current) setProbeResult(result);
      return true;
    } catch (cause) {
      if (alive.current) {
        setProbeResult({ state: 'unknown', checkedAt: Date.now() });
        setMessage(`无法检查登录状态：${describeFailure(cause)}`);
      }
      return false;
    } finally {
      operationInProgress.current = false;
      if (alive.current) setBusy(false);
    }
  }, [port, provider]);

  const save = useCallback(async () => {
    if (operationInProgress.current) return false;
    const normalizedCookie = cookie.trim();
    if (!normalizedCookie) {
      setMessage('请先粘贴 Cookie');
      return false;
    }
    operationInProgress.current = true;
    setBusy(true);
    setMessage('');
    try {
      await port.save(provider, normalizedCookie);
      if (!alive.current) return true;
      setCookie('');
      setProbeResult(null);
      await refresh();
      setMessage(`已保存「${driveProviderLabel(provider)}」的全局凭据，所有支持该网盘的子仓和源均可复用。凭据有效性会在实际播放请求时确认；如果是在播放中打开绑定窗口，当前集会自动重新解析。`);
      onSaved();
      return true;
    } catch (cause) {
      if (alive.current) setMessage(`保存失败：${describeFailure(cause)}`);
      return false;
    } finally {
      operationInProgress.current = false;
      if (alive.current) setBusy(false);
    }
  }, [cookie, onSaved, port, provider, refresh]);

  const unbind = useCallback(async () => {
    if (operationInProgress.current) return false;
    operationInProgress.current = true;
    setBusy(true);
    setMessage('');
    try {
      await port.remove(provider);
      if (!alive.current) return true;
      await refresh();
      setProbeResult(null);
      setMessage(`已解绑「${driveProviderLabel(provider)}」`);
      onSaved();
      return true;
    } catch (cause) {
      if (alive.current) setMessage(`解绑失败：${describeFailure(cause)}`);
      return false;
    } finally {
      operationInProgress.current = false;
      if (alive.current) setBusy(false);
    }
  }, [onSaved, port, provider, refresh]);

  const handleExternalLoginSaved = useCallback(async () => {
    setProbeResult(null);
    await refresh();
    onSaved();
  }, [onSaved, refresh]);

  return {
    model: {
      provider,
      cookie,
      credentials,
      busy,
      message,
      validation: checkDriveCookie(provider, cookie),
      isBound: !!credentials[provider],
      credentialStatus: driveCredentialStatus(!!credentials[provider], probeResult),
      probeResult,
    },
    actions: { selectProvider, changeCookie, clearMessage, save, unbind, probe, refresh, handleExternalLoginSaved },
  };
}
