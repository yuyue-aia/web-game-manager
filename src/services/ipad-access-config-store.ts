import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { logger } from '../common/logger';

/** 单个禁网时段（HH:mm ~ HH:mm，跨零点视为次日）。 */
export interface AccessWindow {
  blockStartHHmm: string;
  blockEndHHmm: string;
}

export interface ManagedAccessDevice {
  name: string;
  mac: string;
  /**
   * 该设备的禁网时段。当前语义：任一 window 命中即视为需要禁网；
   * 空数组 = 该设备不参与自动调度（仅受"立即禁网/立即恢复"手动按钮控制）。
   * 数组结构预留将来的多段/按星期扩展。
   */
  windows: AccessWindow[];
}

export interface IpadAccessConfig {
  enabled: boolean;
  devices: ManagedAccessDevice[];
  /** 新加设备时前端回填的默认时段；不再是调度依据，仅作 UI 默认值。 */
  defaultWindow: AccessWindow;
}

interface PersistedIpadAccessConfig extends IpadAccessConfig {
  version: 4;
  revision: number;
  pendingAllows: ManagedAccessDevice[];
  updatedAt: string;
}

export interface IpadAccessConfigSnapshot {
  config: IpadAccessConfig;
  revision: number;
  pendingAllows: ManagedAccessDevice[];
}

const DEFAULT_WINDOW: AccessWindow = { blockStartHHmm: '22:00', blockEndHHmm: '09:00' };

const DEFAULT_DEVICES: ManagedAccessDevice[] = [
  { name: 'iPad', mac: '4C:2E:B4:19:9B:11', windows: [{ ...DEFAULT_WINDOW }] },
];

const DEFAULT_CONFIG: IpadAccessConfig = {
  enabled: true,
  devices: DEFAULT_DEVICES,
  defaultWindow: { ...DEFAULT_WINDOW },
};

const SAFE_FALLBACK_CONFIG: IpadAccessConfig = {
  ...DEFAULT_CONFIG,
  enabled: false,
};

function normalizeMac(value: string): string {
  return value.trim().replace(/-/g, ':').toUpperCase();
}

function isHHmm(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function cloneWindow(window: AccessWindow): AccessWindow {
  return { blockStartHHmm: window.blockStartHHmm, blockEndHHmm: window.blockEndHHmm };
}

function cloneWindows(windows: AccessWindow[]): AccessWindow[] {
  return windows.map(cloneWindow);
}

function cloneDevices(devices: ManagedAccessDevice[]): ManagedAccessDevice[] {
  return devices.map((device) => ({
    name: device.name,
    mac: device.mac,
    windows: cloneWindows(device.windows),
  }));
}

function cloneConfig(config: IpadAccessConfig): IpadAccessConfig {
  return {
    enabled: config.enabled,
    devices: cloneDevices(config.devices),
    defaultWindow: cloneWindow(config.defaultWindow),
  };
}

/** 解析并校验单条 window，失败返回错误说明字符串。 */
function parseWindow(input: unknown, label: string): AccessWindow | string {
  if (!input || typeof input !== 'object') return `${label}：时段格式不正确`;
  const value = input as Record<string, unknown>;
  const start = String(value.blockStartHHmm ?? '').trim();
  const end = String(value.blockEndHHmm ?? '').trim();
  if (!isHHmm(start) || !isHHmm(end)) return `${label}：时段需为 HH:mm`;
  if (start === end) return `${label}：禁网开始和恢复时间不能相同`;
  return { blockStartHHmm: start, blockEndHHmm: end };
}

function parseWindows(input: unknown, label: string, max = 4): AccessWindow[] | string {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return `${label}：时段列表格式不正确`;
  if (input.length > max) return `${label}：最多可配置 ${max} 段禁网时间`;
  const out: AccessWindow[] = [];
  for (let i = 0; i < input.length; i++) {
    const parsed = parseWindow(input[i], `${label} 第 ${i + 1} 段`);
    if (typeof parsed === 'string') return parsed;
    out.push(parsed);
  }
  return out;
}

/**
 * 解析设备数组。兼容三种输入形态：
 *   1. v4：每个设备自带 windows；
 *   2. v3 兼容：设备无 windows，此处用 fallbackWindow 回填一条（若提供）；
 *   3. v3 legacy 顶层 { mac, deviceName }：转成单设备数组。
 */
function parseDevices(
  input: unknown,
  options: { max?: number; fallbackWindow?: AccessWindow } = {},
): ManagedAccessDevice[] | string {
  const { max = 32, fallbackWindow } = options;
  if (!Array.isArray(input)) return '设备列表格式不正确';
  if (input.length > max) return `最多可选择 ${max} 台设备`;

  const devices: ManagedAccessDevice[] = [];
  const macs = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') return '设备列表格式不正确';
    const raw = item as Record<string, unknown>;
    const mac = normalizeMac(String(raw.mac ?? ''));
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) return '设备 MAC 地址格式不正确';
    if (macs.has(mac)) return `设备列表包含重复 MAC：${mac}`;
    const name = String(raw.name ?? '').trim() || mac;
    if (name.length > 80) return '设备名称不能超过 80 个字符';

    let windows: AccessWindow[];
    if (raw.windows !== undefined) {
      const parsed = parseWindows(raw.windows, `设备 ${name}`);
      if (typeof parsed === 'string') return parsed;
      windows = parsed;
    } else if (fallbackWindow) {
      windows = [cloneWindow(fallbackWindow)];
    } else {
      windows = [];
    }

    macs.add(mac);
    devices.push({ name, mac, windows });
  }
  return devices;
}

function devicesFromConfigValue(
  value: Record<string, unknown>,
  fallbackWindow?: AccessWindow,
): ManagedAccessDevice[] | string {
  if (Array.isArray(value.devices)) return parseDevices(value.devices, { fallbackWindow });
  if (value.mac !== undefined) {
    return parseDevices([{ name: value.deviceName, mac: value.mac }], { fallbackWindow });
  }
  return [];
}

export function validateIpadAccessConfig(
  input: unknown,
): { ok: true; value: IpadAccessConfig } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: '配置格式不正确' };
  const value = input as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean') return { ok: false, error: '启用状态格式不正确' };

  // defaultWindow：新字段；老 payload 里没有则退回顶层 blockStart/EndHHmm 或内置默认。
  let defaultWindow: AccessWindow;
  if (value.defaultWindow !== undefined) {
    const parsed = parseWindow(value.defaultWindow, '默认时段');
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    defaultWindow = parsed;
  } else if (value.blockStartHHmm !== undefined || value.blockEndHHmm !== undefined) {
    const parsed = parseWindow(
      { blockStartHHmm: value.blockStartHHmm, blockEndHHmm: value.blockEndHHmm },
      '默认时段',
    );
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    defaultWindow = parsed;
  } else {
    defaultWindow = { ...DEFAULT_WINDOW };
  }

  const devices = devicesFromConfigValue(value, defaultWindow);
  if (typeof devices === 'string') return { ok: false, error: devices };
  if (value.enabled && devices.length === 0) return { ok: false, error: '启用时间管理前请至少选择一台设备' };

  return {
    ok: true,
    value: { enabled: value.enabled, devices, defaultWindow },
  };
}

export class IpadAccessConfigStore {
  private readonly file: string;
  private config: IpadAccessConfig;
  private revision = 1;
  private pendingAllows: ManagedAccessDevice[] = [];

  constructor(file = resolve(process.env.IPAD_ACCESS_CONFIG_FILE || '.runtime/ipad-access-config.json')) {
    this.file = file;
    this.config = this.load();
  }

  get(): IpadAccessConfig {
    return cloneConfig(this.config);
  }

  getSnapshot(): IpadAccessConfigSnapshot {
    return {
      config: this.get(),
      revision: this.revision,
      pendingAllows: cloneDevices(this.pendingAllows),
    };
  }

  commit(
    config: IpadAccessConfig,
    expectedRevision: number,
    pendingAllows: ManagedAccessDevice[],
  ): IpadAccessConfigSnapshot {
    if (expectedRevision !== this.revision) throw new Error('ipad_access_revision_conflict');
    const parsedPending = parseDevices(pendingAllows, { max: 64 });
    if (typeof parsedPending === 'string') throw new Error(parsedPending);
    const nextRevision = this.revision + 1;
    this.writeSnapshot(config, nextRevision, parsedPending);
    this.config = cloneConfig(config);
    this.revision = nextRevision;
    this.pendingAllows = cloneDevices(parsedPending);
    return this.getSnapshot();
  }

  addPendingAllows(devices: ManagedAccessDevice[]): void {
    const merged = new Map(this.pendingAllows.map((device) => [device.mac, device]));
    for (const device of devices) {
      merged.set(device.mac, { name: device.name, mac: device.mac, windows: cloneWindows(device.windows) });
    }
    const next = Array.from(merged.values());
    this.writeSnapshot(this.config, this.revision, next);
    this.pendingAllows = next;
  }

  completePendingAllow(mac: string): void {
    const next = this.pendingAllows.filter((device) => device.mac !== mac);
    if (next.length === this.pendingAllows.length) return;
    this.writeSnapshot(this.config, this.revision, next);
    this.pendingAllows = next;
  }

  private load(): IpadAccessConfig {
    try {
      if (!existsSync(this.file)) {
        this.writeSnapshot(DEFAULT_CONFIG, 1, []);
        return cloneConfig(DEFAULT_CONFIG);
      }
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      const parsed = validateIpadAccessConfig(raw);
      if (!parsed.ok) {
        logger.warn('ipad-access.config.invalid', { error: parsed.error });
        return cloneConfig(SAFE_FALLBACK_CONFIG);
      }
      this.revision = Number.isSafeInteger(raw.revision) && Number(raw.revision) > 0
        ? Number(raw.revision) : 1;
      // pendingAllows 里的 windows 不参与调度决策，缺失则空数组即可。
      const parsedPending = (raw.version === 4 || raw.version === 3)
        ? parseDevices(raw.pendingAllows ?? [], { max: 64 })
        : [];
      this.pendingAllows = typeof parsedPending === 'string' ? [] : parsedPending;
      if (raw.version !== 4) {
        this.writeSnapshot(parsed.value, this.revision, this.pendingAllows);
        logger.info('ipad-access.config.migrated', { version: 4, from: raw.version ?? 'unknown' });
      }
      return parsed.value;
    } catch (error) {
      logger.warn('ipad-access.config.load_failed', {
        file: this.file,
        error: (error as Error).message,
      });
      return cloneConfig(SAFE_FALLBACK_CONFIG);
    }
  }

  private writeSnapshot(
    config: IpadAccessConfig,
    revision: number,
    pendingAllows: ManagedAccessDevice[],
  ): void {
    const cloned = cloneConfig(config);
    const snapshot: PersistedIpadAccessConfig = {
      version: 4,
      revision,
      pendingAllows: cloneDevices(pendingAllows),
      updatedAt: new Date().toISOString(),
      enabled: cloned.enabled,
      devices: cloned.devices,
      defaultWindow: cloned.defaultWindow,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    renameSync(tmp, this.file);
  }
}
