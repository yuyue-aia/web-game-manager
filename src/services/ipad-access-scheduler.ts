import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from '../common/logger';
import {
  IpadAccessConfigStore,
  type AccessWindow,
  type IpadAccessConfig,
  type ManagedAccessDevice,
} from './ipad-access-config-store';
import {
  NetgearAccessControlClient,
  type NetgearAccessAction,
} from './netgear-access-control-client';

const QUICK_RETRY_TIMES = 5;
const QUICK_RETRY_INTERVAL_MS = 60_000;
const LONG_RETRY_INTERVAL_MS = 15 * 60_000;

type SchedulerAction = NetgearAccessAction;
type ExecutionStatus = 'ok' | 'failed';

interface DeviceExecutionState {
  name: string;
  lastSuccessfulAction?: SchedulerAction;
  lastStatus?: ExecutionStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
}

interface PersistedState {
  version: 2;
  devices: Record<string, DeviceExecutionState>;
  lastAction?: SchedulerAction;
  lastStatus?: ExecutionStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
}

export interface IpadAccessDeviceState extends ManagedAccessDevice {
  currentPolicy: SchedulerAction | null;
  lastStatus: ExecutionStatus | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** 该设备此刻应处于的策略；无 windows / 未启用时为 null。 */
  targetAction: SchedulerAction | null;
  /** 该设备的下一次自动触发；无 windows 时为 null。 */
  nextAction: SchedulerAction | null;
  nextActionAt: string | null;
}

export interface IpadAccessExecutionResult {
  ok: boolean;
  action: SchedulerAction;
  succeededMacs: string[];
  failed: Array<{ mac: string; error: string }>;
  error?: string;
}

export interface IpadAccessView {
  config: IpadAccessConfig;
  revision: number;
  pendingAllows: ManagedAccessDevice[];
  deviceStates: IpadAccessDeviceState[];
  routerConfigured: boolean;
  /** 聚合的目标策略：所有设备一致时返回该值，否则 null（"混合"由前端各行独立展示）。 */
  targetAction: SchedulerAction | null;
  currentPolicy: SchedulerAction | null;
  /** 聚合的下一动作：所有设备里最早那一个。 */
  nextAction: SchedulerAction | null;
  nextActionAt: string | null;
  nextActionDeviceName: string | null;
  lastAction: SchedulerAction | null;
  lastStatus: ExecutionStatus | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/** 单个窗口在此刻是否命中（跨零点视为次日）。 */
function isInWindow(window: AccessWindow, now: Date): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOfDay(window.blockStartHHmm);
  const end = minutesOfDay(window.blockEndHHmm);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** 任一窗口命中即视为该设备当前应处于禁网状态。 */
export function isDeviceInBlockedWindow(
  device: Pick<ManagedAccessDevice, 'windows'>,
  now = new Date(),
): boolean {
  return device.windows.some((window) => isInWindow(window, now));
}

function nextLocalTime(hhmm: string, now = new Date()): Date {
  const [hour, minute] = hhmm.split(':').map(Number);
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target;
}

/**
 * 遍历设备所有窗口，找出最近一次会触发的事件（block 或 allow）。
 * 无窗口 → null。
 */
function nextDeviceEvent(
  device: Pick<ManagedAccessDevice, 'windows'>,
  now = new Date(),
): { action: SchedulerAction; at: Date } | null {
  let best: { action: SchedulerAction; at: Date } | null = null;
  for (const window of device.windows) {
    const blockAt = nextLocalTime(window.blockStartHHmm, now);
    const allowAt = nextLocalTime(window.blockEndHHmm, now);
    const candidate = blockAt.getTime() <= allowAt.getTime()
      ? { action: 'block' as const, at: blockAt }
      : { action: 'allow' as const, at: allowAt };
    if (!best || candidate.at.getTime() < best.at.getTime()) best = candidate;
  }
  return best;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return '连接路由器超时';
    if (error.message === 'netgear_access_auth_failed') return '路由器认证失败';
    if (error.message === 'netgear_access_redirected') return '路由器返回了不安全的跳转';
    if (error.message === 'netgear_access_rejected') return '路由器拒绝了访问控制请求';
    if (error.message.startsWith('netgear_access_http_')) return `路由器请求失败（${error.message.slice(20)}）`;
    return error.message;
  }
  return '设备控制失败';
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.message === 'netgear_access_auth_failed'
    || error.message === 'netgear_access_redirected'
    || error.message === 'netgear_access_rejected'
    || error.message === 'invalid_mac') return false;
  const status = error.message.match(/^netgear_access_http_(\d{3})$/)?.[1];
  // 401 也算可重试：Orbi 固件在"当天首个请求"上会甩一次 401（未做 Basic Auth 预热），
  // 立刻重试基本就成功；只有连续多次 401 才会通过 auth_failed 分支被判为不可重试。
  return !status || Number(status) >= 500 || status === '401' || status === '408' || status === '429';
}

function normalizeMac(mac: string): string {
  return mac.trim().replace(/-/g, ':').toUpperCase();
}

function sameMacSet(left: string[], right: string[]): boolean {
  const a = Array.from(new Set(left.map(normalizeMac))).sort();
  const b = Array.from(new Set(right.map(normalizeMac))).sort();
  return a.length === b.length && a.every((mac, index) => mac === b[index]);
}

export class IpadAccessScheduler {
  private readonly store: IpadAccessConfigStore;
  private readonly client: NetgearAccessControlClient | null;
  private readonly stateFile: string;
  private state: PersistedState = { version: 2, devices: {} };
  /** key = `${mac}:${action}`（一台设备可能同时挂 block+allow 两条定时）。 */
  private timers = new Map<string, NodeJS.Timeout>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private operationChain: Promise<void> = Promise.resolve();
  private generation = 0;
  private started = false;
  private stopped = false;
  private updating = false;

  constructor(
    store = new IpadAccessConfigStore(),
    client = NetgearAccessControlClient.fromEnv(),
    stateFile = resolve(process.env.IPAD_ACCESS_STATE_FILE || '.runtime/ipad-access-state.json'),
  ) {
    this.store = store;
    this.client = client;
    this.stateFile = stateFile;
    this.loadState();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.generation += 1;
    const generation = this.generation;
    const config = this.store.get();

    if (!config.enabled) {
      logger.info('ipad-access.scheduler.disabled');
      // 停用时兜底：任何"上次被 block"的设备都进 pendingAllows，让下轮补一次 allow。
      const candidates = new Map(config.devices.map((device) => [device.mac, device]));
      for (const [mac, state] of Object.entries(this.state.devices)) {
        if (state.lastSuccessfulAction === 'block') {
          candidates.set(mac, { name: state.name || mac, mac, windows: [] });
        }
      }
      try {
        this.store.addPendingAllows(Array.from(candidates.values()));
      } catch (error) {
        logger.warn('ipad-access.pending_allow.save_failed', { error: (error as Error).message });
      }
    }

    this.reschedule();
    void this.restorePendingAllows(generation).then(() => {
      if (generation !== this.generation || this.stopped) return;
      const latest = this.store.get();
      if (!latest.enabled) return;
      // 每台设备各按自己的 windows 对齐到目标策略。
      for (const device of latest.devices) {
        const target = this.deviceTargetAction(device);
        if (target) void this.applyOne(device, target, true, 1, generation, 'policy');
      }
    });
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.started = false;
    this.generation += 1;
    this.clearTimers();
    await this.operationChain.catch(() => undefined);
  }

  getView(): IpadAccessView {
    const snapshot = this.store.getSnapshot();
    const { config, revision, pendingAllows } = snapshot;
    const now = new Date();
    const deviceStates = config.devices.map((device): IpadAccessDeviceState => {
      const state = this.state.devices[device.mac];
      const next = config.enabled ? nextDeviceEvent(device, now) : null;
      return {
        ...device,
        windows: device.windows.map((window) => ({ ...window })),
        currentPolicy: state?.lastSuccessfulAction ?? null,
        lastStatus: state?.lastStatus ?? null,
        lastAttemptAt: state?.lastAttemptAt ?? null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastError: state?.lastError ?? null,
        targetAction: config.enabled ? this.deviceTargetAction(device, now) : null,
        nextAction: next?.action ?? null,
        nextActionAt: next?.at.toISOString() ?? null,
      };
    });
    const currentPolicies = new Set(deviceStates.map((device) => device.currentPolicy));
    const currentPolicy = deviceStates.length > 0 && currentPolicies.size === 1
      ? deviceStates[0].currentPolicy
      : null;
    const targetPolicies = new Set(
      deviceStates.map((device) => device.targetAction).filter((value): value is SchedulerAction => value !== null),
    );
    const targetAction = targetPolicies.size === 1 ? Array.from(targetPolicies)[0] : null;
    const nextEntry = deviceStates
      .filter((device) => device.nextActionAt !== null)
      .sort((a, b) => (a.nextActionAt as string).localeCompare(b.nextActionAt as string))[0] ?? null;
    const failedDevice = deviceStates.find((device) => device.lastStatus === 'failed');
    const pendingFailure = pendingAllows.find((device) => this.state.devices[device.mac]?.lastStatus === 'failed');
    const latestAttemptAt = deviceStates.map((device) => device.lastAttemptAt).filter(Boolean).sort().at(-1) ?? null;
    const latestSuccessAt = deviceStates.map((device) => device.lastSuccessAt).filter(Boolean).sort().at(-1) ?? null;
    const failure = failedDevice ?? pendingFailure;
    return {
      config,
      revision,
      pendingAllows,
      deviceStates,
      routerConfigured: this.client !== null,
      targetAction,
      currentPolicy,
      nextAction: nextEntry?.nextAction ?? null,
      nextActionAt: nextEntry?.nextActionAt ?? null,
      nextActionDeviceName: nextEntry?.name ?? null,
      lastAction: this.state.lastAction ?? null,
      lastStatus: failure || pendingAllows.length > 0 ? 'failed'
        : deviceStates.some((device) => device.lastStatus === 'ok') ? 'ok' : null,
      lastAttemptAt: latestAttemptAt ?? this.state.lastAttemptAt ?? null,
      lastSuccessAt: latestSuccessAt ?? this.state.lastSuccessAt ?? null,
      lastError: failure
        ? `${failure.name}：${this.state.devices[failure.mac]?.lastError || '设备控制失败'}`
        : pendingAllows.length > 0 ? `${pendingAllows.length} 台旧设备等待恢复联网` : null,
    };
  }

  async updateConfig(
    config: IpadAccessConfig,
    expectedRevision: number,
  ): Promise<IpadAccessView> {
    if (this.updating) throw new Error('ipad_access_revision_conflict');
    const previous = this.store.getSnapshot();
    if (expectedRevision !== previous.revision) throw new Error('ipad_access_revision_conflict');
    this.updating = true;

    try {
      // 选中集合：启用时 = 新 devices 的 MAC；禁用时视为空（全部回归 pending 兜底恢复）。
      const selectedMacs = new Set(config.enabled ? config.devices.map((device) => device.mac) : []);
      const pending = new Map(previous.pendingAllows.map((device) => [device.mac, device]));
      for (const mac of selectedMacs) pending.delete(mac);
      if (previous.config.enabled) {
        for (const device of previous.config.devices) {
          if (!selectedMacs.has(device.mac)) pending.set(device.mac, device);
        }
      }

      this.store.commit(config, expectedRevision, Array.from(pending.values()));
      this.generation += 1;
      const generation = this.generation;
      this.clearTimers();
      this.reschedule();
      await this.restorePendingAllows(generation);
      if (config.enabled && generation === this.generation && !this.stopped) {
        for (const device of config.devices) {
          const target = this.deviceTargetAction(device);
          if (target) await this.applyOne(device, target, true, 1, generation, 'policy');
        }
      }
      return this.getView();
    } finally {
      this.updating = false;
    }
  }

  async runManual(
    action: SchedulerAction,
    expectedRevision: number,
    targetMacs: string[],
  ): Promise<IpadAccessExecutionResult> {
    if (this.updating) return this.failedResult(action, '配置正在更新，请稍后重试');
    const snapshot = this.store.getSnapshot();
    if (expectedRevision !== snapshot.revision
      || !sameMacSet(targetMacs, snapshot.config.devices.map((device) => device.mac))) {
      return this.failedResult(action, '配置已变化，请刷新后重试');
    }
    if (!snapshot.config.enabled) return this.failedResult(action, '请先启用设备时间管理');
    return this.applyBatch(snapshot.config.devices, action, false, 1, this.generation, 'manual');
  }

  private failedResult(action: SchedulerAction, error: string): IpadAccessExecutionResult {
    return { ok: false, action, succeededMacs: [], failed: [], error };
  }

  /** 该设备此刻应处于的策略；空 windows → null（该设备只受手动按钮支配）。 */
  private deviceTargetAction(
    device: Pick<ManagedAccessDevice, 'windows'>,
    now = new Date(),
  ): SchedulerAction | null {
    if (device.windows.length === 0) return null;
    return isDeviceInBlockedWindow(device, now) ? 'block' : 'allow';
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  private reschedule(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    const config = this.store.get();
    if (!this.started || this.stopped || !config.enabled) return;
    for (const device of config.devices) {
      this.scheduleDeviceNext(device, this.generation);
    }
  }

  /**
   * 为一台设备安排"下一次触发"的定时。到点后执行 applyOne 并递归重排。
   * 只挂一个定时（下一次事件），因为跨越 boundary 后 windows 决定的下一事件会变。
   */
  private scheduleDeviceNext(device: ManagedAccessDevice, generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    const key = `event:${device.mac}`;
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    if (device.windows.length === 0) return;
    const next = nextDeviceEvent(device);
    if (!next) return;
    const snapshot: ManagedAccessDevice = {
      name: device.name,
      mac: device.mac,
      windows: device.windows.map((window) => ({ ...window })),
    };
    const timer = setTimeout(() => {
      if (generation !== this.generation || this.stopped) return;
      this.timers.delete(key);
      // 先安排"再下一次"，避免执行链路里的等待影响准时性。
      this.scheduleDeviceNext(snapshot, generation);
      void this.applyOne(snapshot, next.action, true, 1, generation, 'policy');
    }, Math.max(0, next.at.getTime() - Date.now()));
    this.timers.set(key, timer);
  }

  private async restorePendingAllows(generation: number): Promise<void> {
    const pending = this.store.getSnapshot().pendingAllows;
    for (const device of pending) {
      if (generation !== this.generation || this.stopped) return;
      const result = await this.enqueue(device, 'allow', false, 1, generation);
      if (result.ok) {
        this.store.completePendingAllow(device.mac);
      } else {
        this.scheduleRestoreRetry(device, generation);
      }
    }
  }

  /** 批量执行（仅手动按钮使用，一次对多设备同一 action）。 */
  private async applyBatch(
    devices: ManagedAccessDevice[],
    action: SchedulerAction,
    retry: boolean,
    attempt: number,
    generation: number,
    retryKind: 'policy' | 'manual',
  ): Promise<IpadAccessExecutionResult> {
    const succeededMacs: string[] = [];
    const failed: Array<{ mac: string; error: string }> = [];
    for (const device of devices) {
      const result = await this.enqueue(device, action, retry, attempt, generation);
      if (result.ok) succeededMacs.push(device.mac);
      else failed.push({ mac: device.mac, error: result.error || '设备控制失败' });
      if (!result.ok && retry && retryKind === 'policy' && result.retryable) {
        this.schedulePolicyRetry(device, action, attempt, generation);
      }
    }
    return {
      ok: failed.length === 0,
      action,
      succeededMacs,
      failed,
      error: failed.length > 0 ? `${failed.length} 台设备操作失败` : undefined,
    };
  }

  /** 单设备执行（定时触发 / 启动对齐 / updateConfig 后使用）。 */
  private async applyOne(
    device: ManagedAccessDevice,
    action: SchedulerAction,
    retry: boolean,
    attempt: number,
    generation: number,
    retryKind: 'policy' | 'manual',
  ): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
    const result = await this.enqueue(device, action, retry, attempt, generation);
    if (!result.ok && retry && retryKind === 'policy' && result.retryable) {
      this.schedulePolicyRetry(device, action, attempt, generation);
    }
    return result;
  }

  private enqueue(
    device: ManagedAccessDevice,
    action: SchedulerAction,
    retry: boolean,
    attempt: number,
    generation: number,
  ): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
    let resolveResult!: (result: { ok: boolean; error?: string; retryable?: boolean }) => void;
    const result = new Promise<{ ok: boolean; error?: string; retryable?: boolean }>((resolve) => {
      resolveResult = resolve;
    });
    this.operationChain = this.operationChain.catch(() => undefined).then(async () => {
      resolveResult(await this.execute(device, action, retry, attempt, generation));
    });
    return result;
  }

  private async execute(
    device: ManagedAccessDevice,
    action: SchedulerAction,
    _retry: boolean,
    attempt: number,
    generation: number,
  ): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
    if (generation !== this.generation || this.stopped) {
      return { ok: false, error: '目标策略已变化，取消操作', retryable: false };
    }
    if (!this.client) return this.recordFailure(device, action, '路由器账号或密码未配置', false);

    try {
      await this.client.setAccess(device.mac, action);
      if (generation !== this.generation || this.stopped) {
        return { ok: false, error: '目标策略已变化，忽略过期结果', retryable: false };
      }
      const now = new Date().toISOString();
      this.state.devices[device.mac] = {
        name: device.name,
        lastSuccessfulAction: action,
        lastStatus: 'ok',
        lastAttemptAt: now,
        lastSuccessAt: now,
      };
      this.state.lastAction = action;
      this.state.lastStatus = 'ok';
      this.state.lastAttemptAt = now;
      this.state.lastSuccessAt = now;
      this.state.lastError = undefined;
      this.persistState();
      this.clearRetry(`policy:${device.mac}`);
      logger.info('ipad-access.apply', { action, mac: device.mac, name: device.name, ok: true, attempt });
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error);
      const retryable = isRetryable(error);
      logger.warn('ipad-access.apply_failed', {
        action, mac: device.mac, name: device.name, attempt, error: message,
      });
      return this.recordFailure(device, action, message, retryable);
    }
  }

  private recordFailure(
    device: ManagedAccessDevice,
    action: SchedulerAction,
    error: string,
    retryable: boolean,
  ): { ok: false; error: string; retryable: boolean } {
    const now = new Date().toISOString();
    const previous = this.state.devices[device.mac];
    this.state.devices[device.mac] = {
      ...previous,
      name: device.name,
      lastStatus: 'failed',
      lastAttemptAt: now,
      lastError: error,
    };
    this.state.lastAction = action;
    this.state.lastStatus = 'failed';
    this.state.lastAttemptAt = now;
    this.state.lastError = `${device.name}：${error}`;
    this.persistState();
    return { ok: false, error, retryable };
  }

  private clearRetry(key: string): void {
    const timer = this.retryTimers.get(key);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(key);
  }

  private scheduleRestoreRetry(device: ManagedAccessDevice, generation: number): void {
    const key = `restore:${device.mac}`;
    this.clearRetry(key);
    const timer = setTimeout(() => {
      this.retryTimers.delete(key);
      const snapshot = this.store.getSnapshot();
      const pending = snapshot.pendingAllows.find((item) => item.mac === device.mac);
      const selected = snapshot.config.enabled
        && snapshot.config.devices.some((item) => item.mac === device.mac);
      if (this.stopped || generation !== this.generation || !pending || selected) return;
      void this.enqueue(pending, 'allow', false, 1, generation).then((result) => {
        if (result.ok) this.store.completePendingAllow(pending.mac);
        else this.scheduleRestoreRetry(pending, generation);
      });
    }, LONG_RETRY_INTERVAL_MS);
    this.retryTimers.set(key, timer);
  }

  private schedulePolicyRetry(
    device: ManagedAccessDevice,
    action: SchedulerAction,
    attempt: number,
    generation: number,
  ): void {
    const key = `policy:${device.mac}`;
    this.clearRetry(key);
    const nextAttempt = attempt < QUICK_RETRY_TIMES ? attempt + 1 : 1;
    const delay = attempt < QUICK_RETRY_TIMES ? QUICK_RETRY_INTERVAL_MS : LONG_RETRY_INTERVAL_MS;
    const timer = setTimeout(() => {
      this.retryTimers.delete(key);
      const config = this.store.get();
      const selected = config.devices.find((item) => item.mac === device.mac);
      if (this.stopped || generation !== this.generation || !config.enabled || !selected) return;
      // 每台设备各自算目标：跨越了 boundary 就不再重试这个 action。
      if (this.deviceTargetAction(selected) !== action) return;
      void this.applyOne(selected, action, true, nextAttempt, generation, 'policy');
    }, delay);
    this.retryTimers.set(key, timer);
  }

  private loadState(): void {
    try {
      if (!existsSync(this.stateFile)) return;
      const value = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Record<string, unknown>;
      if (value.version === 1) {
        this.migrateV1State(value);
        return;
      }
      if (value.version !== 2 || !value.devices || typeof value.devices !== 'object') return;
      const devices: Record<string, DeviceExecutionState> = {};
      for (const [rawMac, rawState] of Object.entries(value.devices as Record<string, unknown>)) {
        const mac = normalizeMac(rawMac);
        if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)
          || !rawState || typeof rawState !== 'object') continue;
        const state = rawState as Partial<DeviceExecutionState>;
        devices[mac] = {
          name: typeof state.name === 'string' ? state.name : mac,
          lastSuccessfulAction: state.lastSuccessfulAction === 'block' || state.lastSuccessfulAction === 'allow'
            ? state.lastSuccessfulAction : undefined,
          lastStatus: state.lastStatus === 'ok' || state.lastStatus === 'failed' ? state.lastStatus : undefined,
          lastAttemptAt: typeof state.lastAttemptAt === 'string' ? state.lastAttemptAt : undefined,
          lastSuccessAt: typeof state.lastSuccessAt === 'string' ? state.lastSuccessAt : undefined,
          lastError: typeof state.lastError === 'string' ? state.lastError : undefined,
        };
      }
      this.state = {
        version: 2,
        devices,
        lastAction: value.lastAction === 'block' || value.lastAction === 'allow' ? value.lastAction : undefined,
        lastStatus: value.lastStatus === 'ok' || value.lastStatus === 'failed' ? value.lastStatus : undefined,
        lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : undefined,
        lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : undefined,
        lastError: typeof value.lastError === 'string' ? value.lastError : undefined,
      };
    } catch (error) {
      logger.warn('ipad-access.state.load_failed', { error: (error as Error).message });
      this.state = { version: 2, devices: {} };
    }
  }

  private migrateV1State(value: Record<string, unknown>): void {
    const config = this.store.get();
    const inferredMac = typeof value.lastSuccessfulMac === 'string'
      ? normalizeMac(value.lastSuccessfulMac)
      : config.devices.length === 1 ? config.devices[0].mac : null;
    const action = value.lastSuccessfulAction === 'block' || value.lastSuccessfulAction === 'allow'
      ? value.lastSuccessfulAction
      : value.lastStatus === 'ok' && (value.lastAction === 'block' || value.lastAction === 'allow')
        ? value.lastAction : undefined;
    const status = value.lastStatus === 'ok' || value.lastStatus === 'failed' ? value.lastStatus : undefined;
    const devices: Record<string, DeviceExecutionState> = {};
    if (inferredMac && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(inferredMac)) {
      const configured = config.devices.find((device) => device.mac === inferredMac);
      devices[inferredMac] = {
        name: configured?.name || inferredMac,
        lastSuccessfulAction: action,
        lastStatus: status,
        lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : undefined,
        lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : undefined,
        lastError: typeof value.lastError === 'string' ? value.lastError : undefined,
      };
    }
    this.state = {
      version: 2,
      devices,
      lastAction: value.lastAction === 'block' || value.lastAction === 'allow' ? value.lastAction : undefined,
      lastStatus: status,
      lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : undefined,
      lastSuccessAt: typeof value.lastSuccessAt === 'string' ? value.lastSuccessAt : undefined,
      lastError: typeof value.lastError === 'string' ? value.lastError : undefined,
    };
    const backup = `${this.stateFile}.v1.bak`;
    if (!existsSync(backup)) copyFileSync(this.stateFile, backup);
    this.persistState();
    logger.info('ipad-access.state.migrated', { version: 2 });
  }

  private persistState(): void {
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      const tmp = `${this.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      renameSync(tmp, this.stateFile);
    } catch (error) {
      logger.warn('ipad-access.state.save_failed', { error: (error as Error).message });
    }
  }
}

let singleton: IpadAccessScheduler | null = null;

export function getIpadAccessScheduler(): IpadAccessScheduler {
  if (!singleton) singleton = new IpadAccessScheduler();
  return singleton;
}
