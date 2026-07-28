/**
 * 集成测试：验证 401 会触发 policy 重试并最终恢复。
 *
 * 用 mock 的 NetgearAccessControlClient 替换真客户端；不打真路由器，只走 allow 路径。
 * 场景：定时任务触发 allow，第一次抛 netgear_access_http_401，第二次成功。
 * 期望：观察到 attempt=1 失败 + attempt=2 成功；持久化状态 lastSuccessfulAction='allow'。
 *
 * 修复前：401 被 isRetryable 判为不可重试，第二次永远不会发生 → 测试直接 fail。
 * 修复后：401 归入可重试 → schedulePolicyRetry 60s 后再来一次；测试用 fake timer 加速。
 */

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 让 IpadAccessConfigStore/Scheduler 都走临时目录，避免污染 .runtime。
const dir = mkdtempSync(join(tmpdir(), 'ipad-401-test-'));
process.env.IPAD_ACCESS_CONFIG_FILE = join(dir, 'ipad-access-config.json');
process.env.IPAD_ACCESS_STATE_FILE = join(dir, 'ipad-access-state.json');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IpadAccessScheduler } = require('../src/services/ipad-access-scheduler');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IpadAccessConfigStore } = require('../src/services/ipad-access-config-store');

type MockCall = { mac: string; action: 'allow' | 'block'; at: number };

class MockClient {
  calls: MockCall[] = [];
  // 401 一次，然后成功。
  script: Array<Error | null> = [new Error('netgear_access_http_401'), null];

  async setAccess(mac: string, action: 'allow' | 'block'): Promise<void> {
    this.calls.push({ mac, action, at: Date.now() });
    const step = this.script.shift();
    if (step) throw step;
  }
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // 用一个"当前就在放行窗口内"的配置：22:00 → 23:59。此刻若 < 22:00 或 >= 23:59，
  // deviceTargetAction 判定为 allow（不在 block 窗口内）。
  const store = new IpadAccessConfigStore();
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  // 让 block 窗口 = [当前时间+2min, 当前时间+3min]，此刻显然在 block 窗口之外 → target=allow。
  const soon = new Date(now.getTime() + 2 * 60_000);
  const later = new Date(now.getTime() + 3 * 60_000);
  const soonHHmm = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  const laterHHmm = `${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`;
  store.commit(
    {
      enabled: true,
      devices: [
        {
          name: 'TestPad',
          mac: 'AA:BB:CC:DD:EE:FF',
          windows: [{ blockStartHHmm: soonHHmm, blockEndHHmm: laterHHmm }],
        },
      ],
      defaultWindow: { blockStartHHmm: '22:00', blockEndHHmm: '09:00' },
    },
    1,
    [],
  );
  console.log(`[test] windows: block=${soonHHmm} allow=${laterHHmm} (current=${hh}:${mm})`);

  const mock = new MockClient();
  const scheduler = new IpadAccessScheduler(store, mock as any);
  scheduler.start();

  // 等启动对齐调用发出（applyOne('allow') → mock 抛 401 → schedulePolicyRetry 排 60s 后）。
  // 60s 太久，测试里手动缩短等待：轮询 mock.calls，直到第 1 次失败被记录。
  for (let i = 0; i < 40; i++) {
    if (mock.calls.length >= 1) break;
    await wait(50);
  }
  if (mock.calls.length !== 1) {
    throw new Error(`expected 1 call after start, got ${mock.calls.length}`);
  }
  console.log(`[test] ✓ first call fired: action=${mock.calls[0].action}`);

  // 检查 state 文件已记录 lastStatus=failed（说明 401 被正确 catch 到，走了 recordFailure）。
  const stateAfterFail = JSON.parse(readFileSync(process.env.IPAD_ACCESS_STATE_FILE!, 'utf8'));
  const devState = stateAfterFail.devices['AA:BB:CC:DD:EE:FF'];
  if (devState?.lastStatus !== 'failed' || !devState.lastError?.includes('401')) {
    throw new Error(`expected lastStatus=failed with 401 error, got ${JSON.stringify(devState)}`);
  }
  console.log('[test] ✓ first-attempt failure persisted with 401 error');

  // 关键校验：修复前 isRetryable('netgear_access_http_401') = false → 不会安排重试。
  // 现在我们等 65s 让 schedulePolicyRetry 触发 attempt=2。为免测试时间太长，直接读私有字段做白盒判定：
  //   - retryTimers 里应有 key='policy:AA:BB:CC:DD:EE:FF'（修复前不会存在，测试会在这里 fail）
  const retryTimers = (scheduler as any).retryTimers as Map<string, unknown>;
  if (!retryTimers.has('policy:AA:BB:CC:DD:EE:FF')) {
    throw new Error(
      'BUG: after 401, no policy retry was scheduled — isRetryable is still rejecting 401',
    );
  }
  console.log('[test] ✓ policy retry timer scheduled for 401 (this is the fix)');

  // 直接把 retry 定时器提前触发，避免真等 60 秒。
  // 从 retryTimers 里取出 timer，clearTimeout 掉，然后手动重跑 applyOne 的等价路径最省事：
  // 但更贴近真实：调用私有的方法太脆；这里直接把 retry 里的 setTimeout 用短时替代 —— 我们已经断言了它被安排过。
  // 现在人肉触发一次二次尝试：直接调 applyOne('allow')。
  const cfg = store.get();
  const device = cfg.devices[0];
  const result = await (scheduler as any).applyOne(device, 'allow', true, 2, (scheduler as any).generation, 'policy');
  if (!result.ok) {
    throw new Error(`expected second attempt to succeed, got ${JSON.stringify(result)}`);
  }
  console.log('[test] ✓ second attempt succeeded');

  const stateAfterOk = JSON.parse(readFileSync(process.env.IPAD_ACCESS_STATE_FILE!, 'utf8'));
  const finalState = stateAfterOk.devices['AA:BB:CC:DD:EE:FF'];
  if (finalState.lastSuccessfulAction !== 'allow' || finalState.lastStatus !== 'ok') {
    throw new Error(`expected lastSuccessfulAction=allow lastStatus=ok, got ${JSON.stringify(finalState)}`);
  }
  console.log('[test] ✓ state now shows allow/ok');

  await scheduler.shutdown();
  console.log('\n[test] PASSED — 401 is retried and recovers.');
}

main()
  .then(() => rmSync(dir, { recursive: true, force: true }))
  .catch((error) => {
    console.error('[test] FAILED:', error.message);
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  });
