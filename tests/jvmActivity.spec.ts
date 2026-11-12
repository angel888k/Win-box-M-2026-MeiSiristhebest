import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const bin = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : '';
const exe = process.platform === 'win32' ? '.exe' : '';
const javac = join(bin, 'javac' + exe);
const java = resolve('resources/jvm/jre/bin/java' + exe);

describe.skipIf(!bin || !existsSync(javac) || !existsSync(java))('桌面 JVM Activity 桩兼容性', () => {
  it('验证 CatVod 蜘蛛常用的 Activity 桩方法（isFinishing/isDestroyed/getWindowManager 等）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'winbox-activity-'));
    try {
      const source = join(dir, 'ActivityProbe.java');
      writeFileSync(source, [
        'import android.app.Activity;',
        'public class ActivityProbe {',
        '  public static void main(String[] args) throws Exception {',
        '    Activity act = new Activity();',
        '    if (act.isFinishing()) throw new RuntimeException("isFinishing should be false");',
        '    if (act.isDestroyed()) throw new RuntimeException("isDestroyed should be false");',
        '    if (act.shouldShowRequestPermissionRationale("perm")) throw new RuntimeException("permission rationale should be false");',
        '    act.setRequestedOrientation(1);',
        '    act.recreate();',
        '    act.startActivityForResult(null, 100);',
        '    if (act.findViewById(1) != null) throw new RuntimeException("findViewById should be null");',
        '    if (act.getReferrer() != null) throw new RuntimeException("getReferrer should be null");',
        '    try { act.requireViewById(1); throw new RuntimeException("requireViewById should throw"); } catch (IllegalArgumentException expected) {}',
        '    System.out.print("activity-stubs-ok");',
        '  }',
        '}',
      ].join('\n'), { encoding: 'utf8' });
      const cp = resolve('resources/jvm/stubs/stubs.jar');
      const compile = spawnSync(javac, ['--release', '17', '-encoding', 'UTF-8', '-cp', cp, '-d', dir, source], { encoding: 'utf8', timeout: 30000 });
      expect(compile.status, compile.stderr).toBe(0);
      const run = spawnSync(java, ['-cp', [dir, cp].join(delimiter), 'ActivityProbe'], { encoding: 'utf8', timeout: 10000 });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe('activity-stubs-ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
