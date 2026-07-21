import { isIP } from 'node:net';
import { logger } from '../common/logger';

export interface NetworkDevice {
  ip: string;
  mac: string;
  name: string;
  type: string;
  model: string;
  connectionType: string;
  connectedToName: string;
}

export interface DeviceIpQuery {
  mac?: string;
  name?: string;
  fallbackIp?: string;
}

interface NetgearDeviceRegistryConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  cacheTtlMs: number;
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function normalizeMac(mac: string): string {
  return mac
    .trim()
    .toLowerCase()
    .replace(/-/g, ':')
    .split(':')
    .map((part) => part.padStart(2, '0'))
    .join(':');
}

function isPrivateIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function validFallbackIp(ip: string | undefined): string | null {
  const value = ip?.trim();
  return value && isPrivateIpv4(value) ? value : null;
}

function decodeHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseDeviceResponse(body: string): NetworkDevice[] {
  const line = body.split(/\r?\n/).find((item) => /^\s*device\s*=/.test(item));
  if (!line) throw new Error('netgear_device_list_missing');

  const json = line.replace(/^\s*device\s*=\s*/, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('netgear_device_list_invalid');
  }
  if (!Array.isArray(raw)) throw new Error('netgear_device_list_invalid');

  return raw.flatMap((item): NetworkDevice[] => {
    if (!item || typeof item !== 'object') return [];
    const value = item as Record<string, unknown>;
    const ip = decodeHtml(value.ip).trim();
    const mac = normalizeMac(decodeHtml(value.mac));
    if (!isPrivateIpv4(ip) || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return [];
    return [{
      ip,
      mac,
      name: decodeHtml(value.name).trim(),
      type: decodeHtml(value.devtype_name).trim(),
      model: decodeHtml(value.model).trim(),
      connectionType: decodeHtml(value.contype).trim(),
      connectedToName: decodeHtml(value.conn_orbi_name).trim(),
    }];
  });
}

export class NetgearDeviceRegistry {
  private devices: NetworkDevice[] = [];
  private cachedAt = 0;
  private refreshPromise: Promise<NetworkDevice[]> | null = null;

  constructor(private readonly cfg: NetgearDeviceRegistryConfig) {}

  static fromEnv(): NetgearDeviceRegistry | null {
    const baseUrl = env('NETGEAR_ROUTER_URL');
    const username = env('NETGEAR_ROUTER_USERNAME');
    const password = env('NETGEAR_ROUTER_PASSWORD');
    if (!baseUrl || !username || !password) return null;

    const url = new URL(baseUrl);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !isPrivateIpv4(url.hostname)) {
      throw new Error('NETGEAR_ROUTER_URL must be a private IPv4 HTTP(S) URL');
    }
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('NETGEAR_ROUTER_URL must contain only scheme, private IPv4 host and optional port');
    }
    if (url.protocol === 'http:' && env('NETGEAR_ALLOW_INSECURE_HTTP') !== 'true') {
      throw new Error('HTTP router access requires NETGEAR_ALLOW_INSECURE_HTTP=true');
    }
    if (url.protocol === 'http:') {
      logger.warn('netgear.insecure_http', { service: 'device_registry', host: url.host });
    }
    return new NetgearDeviceRegistry({
      baseUrl: url.toString().replace(/\/$/, ''),
      username,
      password,
      timeoutMs: positiveIntEnv('NETGEAR_DEVICE_TIMEOUT_MS', 10_000),
      cacheTtlMs: positiveIntEnv('NETGEAR_DEVICE_CACHE_SECONDS', 30) * 1000,
    });
  }

  async list(forceRefresh = false): Promise<NetworkDevice[]> {
    if (!forceRefresh && this.cachedAt > 0 && Date.now() - this.cachedAt < this.cfg.cacheTtlMs) {
      return this.devices.map((device) => ({ ...device }));
    }
    if (this.refreshPromise) {
      return (await this.refreshPromise).map((device) => ({ ...device }));
    }

    this.refreshPromise = this.fetchDevices().finally(() => {
      this.refreshPromise = null;
    });
    return (await this.refreshPromise).map((device) => ({ ...device }));
  }

  async findByMac(mac: string, forceRefresh = false): Promise<NetworkDevice | null> {
    const target = normalizeMac(mac);
    return (await this.list(forceRefresh)).find((device) => device.mac === target) ?? null;
  }

  async findByName(name: string, forceRefresh = false): Promise<NetworkDevice | null> {
    const target = name.trim().toLocaleLowerCase();
    const matches = (await this.list(forceRefresh)).filter(
      (device) => device.name.toLocaleLowerCase() === target,
    );
    if (matches.length > 1) throw new Error(`netgear_device_name_ambiguous:${name}`);
    return matches[0] ?? null;
  }

  async resolveIp(query: DeviceIpQuery, forceRefresh = false): Promise<string | null> {
    const devices = await this.list(forceRefresh);
    if (query.mac) {
      const target = normalizeMac(query.mac);
      return devices.find((device) => device.mac === target)?.ip
        ?? validFallbackIp(query.fallbackIp);
    }
    if (query.name) {
      const target = query.name.trim().toLocaleLowerCase();
      const matches = devices.filter((device) => device.name.toLocaleLowerCase() === target);
      if (matches.length > 1) throw new Error(`netgear_device_name_ambiguous:${query.name}`);
      return matches[0]?.ip ?? validFallbackIp(query.fallbackIp);
    }
    return validFallbackIp(query.fallbackIp);
  }

  private async fetchDevices(): Promise<NetworkDevice[]> {
    const url = `${this.cfg.baseUrl}/DEV_device_info.htm?ts=${Date.now()}`;
    const authorization = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64');
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${authorization}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    const body = await response.text();
    if (response.status >= 300 && response.status < 400) {
      throw new Error('netgear_device_list_redirected');
    }
    if (!response.ok) throw new Error(`netgear_device_list_http_${response.status}`);
    if (/name=["']?(?:password|login_password)["']?/i.test(body)) {
      throw new Error('netgear_device_list_auth_failed');
    }

    const devices = parseDeviceResponse(body);
    this.devices = devices;
    this.cachedAt = Date.now();
    return devices;
  }
}

let registry: NetgearDeviceRegistry | null | undefined;

export function getNetgearDeviceRegistry(): NetgearDeviceRegistry | null {
  if (registry === undefined) registry = NetgearDeviceRegistry.fromEnv();
  return registry;
}

export async function resolveNetworkDeviceIp(
  query: DeviceIpQuery,
  forceRefresh = false,
): Promise<string | null> {
  const fallback = validFallbackIp(query.fallbackIp);
  let service: NetgearDeviceRegistry | null;
  try {
    service = getNetgearDeviceRegistry();
  } catch (error) {
    logger.warn('netgear-device-registry.config_failed', { error: (error as Error).message });
    return fallback;
  }
  if (!service) return fallback;

  try {
    return await service.resolveIp(query, forceRefresh);
  } catch (error) {
    logger.warn('netgear-device-registry.resolve_failed', {
      mac: query.mac ? normalizeMac(query.mac) : undefined,
      name: query.name,
      error: (error as Error).message,
    });
    return fallback;
  }
}
