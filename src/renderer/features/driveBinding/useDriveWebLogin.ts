import { useCallback, useRef, useState } from 'react';
import { driveProviderLabel } from '../../../shared/driveProvider';
import type { DriveWebLoginPort } from './application/driveBindingPorts';

function describeFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useDriveWebLogin(port: DriveWebLoginPort) {
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Record<string, string>>({});
  const activeProviderRef = useRef<string | null>(null);

  const login = useCallback(async (provider: string, onBound: (provider: string) => void) => {
    if (activeProviderRef.current) return false;
    activeProviderRef.current = provider;
    setActiveProvider(provider);
    setMessages(current => ({ ...current, [provider]: '' }));
    try {
      await port.login(provider);
      onBound(provider);
      const result = `✓ 已通过网页扫码保存「${driveProviderLabel(provider)}」绑定`;
      setMessage(result);
      setMessages(current => ({ ...current, [provider]: result }));
      return true;
    } catch (cause) {
      const result = `登录失败：${describeFailure(cause)}`;
      setMessage(result);
      setMessages(current => ({ ...current, [provider]: result }));
      return false;
    } finally {
      activeProviderRef.current = null;
      setActiveProvider(null);
    }
  }, [port]);

  return { model: { busy: activeProvider !== null, activeProvider, message, messages }, actions: { login } };
}
