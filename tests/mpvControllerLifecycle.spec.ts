import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/util/paths', () => ({ cacheDir: () => '.', resourcesDir: () => '.' }));
vi.mock('../src/main/player/playerSettings', () => ({ playerSettings: { settings: {} } }));
vi.mock('../src/main/player/PlayerWindow', () => ({ playerIsMini: () => false, playerIsFullscreen: () => false }));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';
import { MpvController } from '../src/main/player/MpvController';

class Proc extends EventEmitter {
  exitCode: number | null = null;
  signalCode = null;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill() { this.killed = true; this.finish(); }
  finish() { this.exitCode = 0; this.emit('exit', 0); }
}
class Sock extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
}
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const windowStub = () => Object.assign(new EventEmitter(), {
  isDestroyed: () => false,
  isFullScreen: () => false,
  getContentBounds: () => ({ height: 600 }),
  getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0]),
  webContents: { send: vi.fn(), invalidate: vi.fn() },
});
const make = () => {
  const controller = new MpvController({ i: vi.fn(), w: vi.fn(), e: vi.fn() });
  vi.spyOn(controller, 'status').mockReturnValue({ available: true, path: 'mpv.exe', source: 'bundled', note: '' });
  const sockets: Sock[] = [];
  vi.spyOn(controller as any, 'connectPipe').mockImplementation(async () => {
    const socket = new Sock(); sockets.push(socket); return socket;
  });
  return { controller, sockets };
};

beforeEach(() => vi.clearAllMocks());
describe('mpv lifecycle', () => {
  it('a stop cancels a start still waiting in the queue', async () => {
    const { controller } = make();
    const pending = controller.start(windowStub() as any, { url: 'a.mp4' });
    controller.stop();
    await pending;
    expect(spawn).not.toHaveBeenCalled();
  });
  it('only the latest concurrent start spawns', async () => {
    const { controller, sockets } = make();
    const proc = new Proc(); vi.mocked(spawn).mockReturnValue(proc as any);
    const win = windowStub();
    await Promise.all([controller.start(win as any, { url: 'old.mp4' }), controller.start(win as any, { url: 'new.mp4', volume: .6 })]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(sockets[0].write.mock.calls.flat().join('')).toContain('new.mp4');
    expect(sockets[0].write.mock.calls.flat().join('')).not.toContain('old.mp4');
    proc.finish(); controller.stop();
  });
  it('waits for the old process to release its HWND and ignores its late messages', async () => {
    const { controller, sockets } = make();
    const oldProc = new Proc(), newProc = new Proc();
    vi.mocked(spawn).mockReturnValueOnce(oldProc as any).mockReturnValueOnce(newProc as any);
    const win = windowStub();
    await controller.start(win as any, { url: 'old.mp4' });
    const next = controller.start(win as any, { url: 'new.mp4', paused: true });
    await tick();
    expect(spawn).toHaveBeenCalledTimes(1);
    oldProc.finish();
    await next;
    expect(spawn).toHaveBeenCalledTimes(2);
    sockets[0].emit('data', Buffer.from('{"event":"property-change","name":"time-pos","data":99}\n'));
    expect((controller as any).state.time).toBeNull();
    const lines = sockets[1].write.mock.calls.flat().join('');
    expect(lines).toContain('"mute","no"');
    expect(lines).toContain('"pause","yes"');
    newProc.finish(); controller.stop();
    expect(win.listenerCount('resize')).toBe(0);
  });

  it('loads the next item into the same process with an acknowledged per-file resume point', async () => {
    const { controller, sockets } = make();
    const proc = new Proc(); vi.mocked(spawn).mockReturnValue(proc as any);
    const win = windowStub();
    const first = await controller.start(win as any, { url: 'episode-1.mp4' });
    const socket = sockets[0];
    socket.write.mockImplementation((chunk: any) => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        let message: { request_id?: number };
        try { message = JSON.parse(line); } catch { continue; }
        if (Number.isSafeInteger(message.request_id)) {
          queueMicrotask(() => socket.emit('data', Buffer.from(JSON.stringify({ request_id: message.request_id, error: 'success' }) + '\n')));
        }
      }
      return true;
    });

    const next = await controller.start(win as any, {
      url: 'episode-2.mp4', reuseSession: true, startTime: 75, paused: false, rate: 1.25, volume: 0.6, fit: 'contain',
    });
    expect(spawn).toHaveBeenCalledOnce();
    expect(next.session).not.toBe(first.session);
    const lines = socket.write.mock.calls.flat().map(String).join('');
    expect(lines).toContain('episode-2.mp4');
    expect(lines).toContain('"start":"75"');
    expect(lines).toContain('"pause","yes"');
    expect(lines).toContain('"pause","no"');
    socket.emit('data', Buffer.from('{"event":"property-change","name":"time-pos","data":3}\n'));
    expect((controller as any).state.time).toBeNull();
    socket.emit('data', Buffer.from('{"event":"start-file"}\n{"event":"property-change","name":"time-pos","data":75}\n'));
    expect((controller as any).state.time).toBe(75);

    proc.finish(); controller.stop();
  });

  it('does not restart a superseded URL after a newer start cancels MPV reuse', async () => {
    const { controller, sockets } = make();
    const oldProc = new Proc(), latestProc = new Proc();
    vi.mocked(spawn).mockReturnValueOnce(oldProc as any).mockReturnValueOnce(latestProc as any);
    const win = windowStub();
    await controller.start(win as any, { url: 'episode-1.mp4' });

    const stale = controller.start(win as any, { url: 'episode-stale.mp4', reuseSession: true });
    await tick();
    const latest = controller.start(win as any, { url: 'episode-latest.mp4' });
    oldProc.finish();
    await Promise.all([stale, latest]);

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    expect(sockets[1].write.mock.calls.flat().map(String).join('')).toContain('episode-latest.mp4');
    expect(sockets[1].write.mock.calls.flat().map(String).join('')).not.toContain('episode-stale.mp4');
    latestProc.finish(); controller.stop();
  });

  it('keeps ordinary property updates throttled after file-loaded', async () => {
    const { controller, sockets } = make();
    const proc = new Proc(); vi.mocked(spawn).mockReturnValue(proc as any);
    const win = windowStub();
    await controller.start(win as any, { url: 'video.mp4' });
    const send = win.webContents.send;
    sockets[0].emit('data', Buffer.from('{"event":"file-loaded"}\n'));
    expect(send).toHaveBeenCalledTimes(1);
    send.mockClear();
    vi.useFakeTimers();
    sockets[0].emit('data', Buffer.from('{"event":"property-change","name":"time-pos","data":1}\n'));
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    proc.finish(); controller.stop();
  });

  it('only reports a shader list as applied after a successful MPV JSON IPC acknowledgement', async () => {
    const { controller, sockets } = make();
    const proc = new Proc(); vi.mocked(spawn).mockReturnValue(proc as any);
    await controller.start(windowStub() as any, { url: 'video.mp4' });

    const accepted = controller.replaceShaders([]);
    await tick();
    const acceptedCommand = JSON.parse(sockets[0].write.mock.calls[sockets[0].write.mock.calls.length - 1]?.[0] || '{}');
    expect(acceptedCommand.command).toEqual(['change-list', 'glsl-shaders', 'clr', '']);
    sockets[0].emit('data', Buffer.from(JSON.stringify({ request_id: acceptedCommand.request_id, error: 'success' }) + '\n'));
    await expect(accepted).resolves.toBe(true);

    const declined = controller.replaceShaders([]);
    await tick();
    const declinedCommand = JSON.parse(sockets[0].write.mock.calls[sockets[0].write.mock.calls.length - 1]?.[0] || '{}');
    sockets[0].emit('data', Buffer.from(JSON.stringify({ request_id: declinedCommand.request_id, error: 'property unavailable' }) + '\n'));
    await expect(declined).resolves.toBe(false);

    proc.finish(); controller.stop();
  });

  it('queries vo-passes through request-id IPC and reports only an observed shader description', async () => {
    const { controller, sockets } = make();
    const proc = new Proc(); vi.mocked(spawn).mockReturnValue(proc as any);
    await controller.start(windowStub() as any, { url: 'video.mp4' });

    const status = controller.readShaderRenderStatus(['missing-test-shader.glsl']);
    await vi.waitFor(() => expect(sockets[0].write.mock.calls.flat().join('')).toContain('"get_property","vo-passes"'));
    const request = sockets[0].write.mock.calls.flat().join('').trim().split(/\r?\n/)
      .map((line: string) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((entry: { command?: unknown[] } | null) => entry?.command?.[0] === 'get_property').at(-1);
    expect(request?.command).toEqual(['get_property', 'vo-passes']);
    sockets[0].emit('data', Buffer.from(JSON.stringify({
      request_id: request.request_id,
      error: 'success',
      data: { fresh: [{ desc: 'Bicubic scaler' }], redraw: [] },
    }) + '\n'));
    await expect(status).resolves.toMatchObject({ state: 'unidentifiable', activePasses: ['Bicubic scaler'] });

    proc.finish(); controller.stop();
  });
});
