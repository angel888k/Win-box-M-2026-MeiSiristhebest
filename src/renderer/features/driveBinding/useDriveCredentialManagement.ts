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
  const [cookieDrafts, setCookieDrafts] = useState<Record<string, string>>({});
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [activeOperation, setActiveOperation] = useState<{ provider: string; kind: 'probe' | 'save' | 'unbind' } | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [probeResults, setProbeResults] = useState<Record<string, DriveCredentialProbeResult | null>>({});
  const alive = useRef(false);
  const requestSequence = useRef(0);
  const operationInProgress = useRef(false);
  const cookie = cookieDrafts[provider] || '';
  const probeResult = probeResults[provider] || null;
  const busy = activeOperation !== null;
  const message = messages[provider] || '';

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
  }, []);
  const changeCookie = useCallback((value: string) => {
    setCookieDrafts(current => ({ ...current, [provider]: value }));
    setProbeResults(current => ({ ...current, [provider]: null }));
  }, [provider]);
  const clearMessage = useCallback(() => {
    setMessages(current => ({ ...current, [provider]: '' }));
  }, [provider]);

  const probe = useCallback(async () => {
    if (operationInProgress.current) return false;
    operationInProgress.current = true;
    const checkedProvider = provider;
    setActiveOperation({ provider: checkedProvider, kind: 'probe' });
    setMessages(current => ({ ...current, [checkedProvider]: '' }));
    setProbeResults(current => ({ ...current, [checkedProvider]: null }));
    try {
      const result = await port.probe(checkedProvider);
      if (alive.current) setProbeResults(current => ({ ...current, [checkedProvider]: result }));
      return true;
    } catch (cause) {
      if (alive.current) {
        setProbeResults(current => ({ ...current, [checkedProvider]: { state: 'unknown', checkedAt: Date.now() } }));
        setMessages(current => ({ ...current, [checkedProvider]: `无法检查登录状态：${describeFailure(cause)}` }));
      }
      return false;
    } finally {
      operationInProgress.current = false;
      if (alive.current) setActiveOperation(null);
    }
  }, [port, provider]);

  const save = useCallback(async () => {
    if (operationInProgress.current) return false;
    const normalizedCookie = cookie.trim();
    if (!normalizedCookie) {
      setMessages(current => ({ ...current, [provider]: '请先粘贴 Cookie' }));
      return false;
    }
    operationInProgress.current = true;
    const savedProvider = provider;
    setActiveOperation({ provider: savedProvider, kind: 'save' });
    setMessages(current => ({ ...current, [savedProvider]: '' }));
    try {
      await port.save(savedProvider, normalizedCookie);
      if (!alive.current) return true;
      setCookieDrafts(current => ({ ...current, [savedProvider]: '' }));
      setProbeResults(current => ({ ...current, [savedProvider]: null }));
      await refresh();
      setMessages(current => ({ ...current, [savedProvider]: `已保存「${driveProviderLabel(savedProvider)}」的全局凭据，所有支持该网盘的子仓和源均可复用。凭据有效性会在实际播放请求时确认；如果是在播放中打开绑定窗口，当前集会自动重新解析。` }));
      onSaved();
      return true;
    } catch (cause) {
      if (alive.current) setMessages(current => ({ ...current, [savedProvider]: `保存失败：${describeFailure(cause)}` }));
      return false;
    } finally {
      operationInProgress.current = false;
      if (alive.current) setActiveOperation(null);
    }
  }, [cookie, onSaved, port, provider, refresh]);

  const unbind = useCallback(async () => {
    if (operationInProgress.current) return false;
    operationInProgress.current = true;
    const removedProvider = provider;
    setActiveOperation({ provider: removedProvider, kind: 'unbind' });
    setMessages(current => ({ ...current, [removedProvider]: '' }));
    try {
      await port.remove(removedProvider);
      if (!alive.current) return true;
      await refresh();
      setCookieDrafts(current => ({ ...current, [removedProvider]: '' }));
      setProbeResults(current => ({ ...current, [removedProvider]: null }));
      setMessages(current => ({ ...current, [removedProvider]: `已解绑「${driveProviderLabel(removedProvider)}」` }));
      onSaved();
      return true;
    } catch (cause) {
      if (alive.current) setMessages(current => ({ ...current, [removedProvider]: `解绑失败：${describeFailure(cause)}` }));
      return false;
    } finally {
      operationInProgress.current = false;
      if (alive.current) setActiveOperation(null);
    }
  }, [onSaved, port, provider, refresh]);

  const handleExternalLoginSaved = useCallback(async () => {
    setProbeResults(current => ({ ...current, [provider]: null }));
    await refresh();
    onSaved();
  }, [onSaved, provider, refresh]);

  return {
    model: {
      provider,
      cookie,
      credentials,
      busy,
      activeOperation,
      message,
      validation: checkDriveCookie(provider, cookie),
      isBound: !!credentials[provider],
      credentialStatus: driveCredentialStatus(!!credentials[provider], probeResult),
      probeResult,
    },
    actions: { selectProvider, changeCookie, clearMessage, save, unbind, probe, refresh, handleExternalLoginSaved },
  };
}
