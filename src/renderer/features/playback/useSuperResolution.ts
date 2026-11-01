import { useCallback, useEffect, useRef, useState } from 'react';
import type { SrState } from '../../../shared/plugin';
import type { MpvShaderRenderStatus, SrMode } from '../../../shared/player';
import type { SuperResolutionFeedback, SuperResolutionPort } from './application/superResolutionPort';
import { changeSuperResolutionMode } from './application/superResolutionUseCases';
import { formatSuperResolutionFeedback } from './presentation/superResolutionFeedback';
export type { SuperResolutionFeedback } from './application/superResolutionPort';

export function useSuperResolution(enabled: boolean, sessionKey: string, port: SuperResolutionPort, mpvActive = false) {
  const [capability, setCapability] = useState<{
    enabled: boolean;
    loading: boolean;
    info: SrState | null;
    error: string | null;
  }>({ enabled, loading: enabled, info: null, error: null });
  const [mode, setMode] = useState<SrMode>('off');
  const [feedback, setFeedback] = useState<SuperResolutionFeedback | null>(null);
  const [renderProbe, setRenderProbe] = useState<{
    sessionKey: string;
    mode: SrMode;
    loading: boolean;
    status: MpvShaderRenderStatus | null;
    error: string | null;
  }>({ sessionKey, mode: 'off', loading: false, status: null, error: null });
  const [panel, setPanel] = useState({ sessionKey, open: false });
  const applyChain = useRef<Promise<void>>(Promise.resolve());
  // Reset this transient panel in the same render that changes playback resource,
  // while preserving it during a kernel handoff for the same resource.
  if (panel.sessionKey !== sessionKey) setPanel({ sessionKey, open: false });
  const open = panel.sessionKey === sessionKey && panel.open;
  const currentCapability = capability.enabled === enabled
    ? capability
    : { enabled, loading: enabled, info: null, error: null };
  const setOpen = useCallback((open: boolean) => {
    if (open) setFeedback(null);
    setPanel({ sessionKey, open });
  }, [sessionKey]);
  useEffect(() => {
    if (!enabled) {
      setCapability({ enabled: false, loading: false, info: null, error: null });
      setMode('off');
      return;
    }
    let alive = true;
    setCapability({ enabled: true, loading: true, info: null, error: null });
    void port.readCapability().then(value => {
      if (alive) {
        setCapability({ enabled: true, loading: false, info: value, error: null });
        setMode((value.mode as SrMode) || 'off');
      }
    }).catch(error => {
      if (alive) setCapability({
        enabled: true,
        loading: false,
        info: null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => { alive = false; };
  }, [enabled, port]);
  useEffect(() => {
    if (!enabled || !mpvActive || !open || mode === 'off' || !port.readRenderStatus) {
      setRenderProbe({ sessionKey, mode, loading: false, status: null, error: null });
      return;
    }
    let alive = true;
    setRenderProbe({ sessionKey, mode, loading: true, status: null, error: null });
    // Let the renderer present a frame after the shader switch before taking a snapshot.
    const timer = setTimeout(() => {
      void port.readRenderStatus!(mode).then(status => {
        if (alive) setRenderProbe({ sessionKey, mode, loading: false, status, error: null });
      }).catch(error => {
        if (alive) setRenderProbe({
          sessionKey,
          mode,
          loading: false,
          status: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [enabled, mpvActive, open, mode, sessionKey, port]);
  const apply = useCallback(async (value: SrMode) => {
    const operation = applyChain.current.then(async () => {
      setFeedback(null);
      const change = await changeSuperResolutionMode(port, value);
      if (change.type !== 'persistence-failed') setMode(change.mode);
      setFeedback(formatSuperResolutionFeedback(change));
    });
    applyChain.current = operation.then(() => undefined, () => undefined);
    await operation;
  }, [port]);
  const probeMatches = renderProbe.sessionKey === sessionKey && renderProbe.mode === mode;
  return {
    info: currentCapability.info,
    loading: currentCapability.loading,
    error: currentCapability.error,
    mode,
    open,
    setOpen,
    apply,
    feedback,
    renderStatus: probeMatches ? renderProbe.status : null,
    renderStatusLoading: probeMatches
      ? renderProbe.loading
      : enabled && mpvActive && open && mode !== 'off' && !!port.readRenderStatus,
    renderStatusError: probeMatches ? renderProbe.error : null,
  };
}
