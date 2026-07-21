import { createHash, createHmac } from 'node:crypto';
import { logger } from '../common/logger';

const REGION_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  cn: 'openapi.tuyacn.com',
  us: 'openapi.tuyaus.com',
  'us-e': 'openapi-ueaz.tuyaus.com',
  eu: 'openapi.tuyaeu.com',
  'eu-w': 'openapi-weaz.tuyaeu.com',
  in: 'openapi.tuyain.com',
});

interface TuyaIrConfig {
  host: string;
  apiKey: string;
  apiSecret: string;
  infraredDeviceId: string;
  remoteId: string;
  categoryId: number;
  timeoutMs: number;
}

interface TuyaResponse<T = unknown> {
  success?: boolean;
  result?: T;
  code?: number | string;
  msg?: string;
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function loadConfig(): TuyaIrConfig | null {
  const region = (env('TUYA_API_REGION') || 'cn').toLowerCase();
  const host = REGION_HOSTS[region];
  if (!host) throw new Error(`Unsupported TUYA_API_REGION: ${region}`);

  const apiKey = env('TUYA_API_KEY');
  const apiSecret = env('TUYA_API_SECRET');
  const infraredDeviceId = env('TUYA_IR_DEVICE_ID');
  const remoteId = env('TUYA_IR_REMOTE_ID');
  if (!apiKey || !apiSecret || !infraredDeviceId || !remoteId) return null;

  const categoryId = Number(env('TUYA_IR_CATEGORY_ID') || 2);
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error('TUYA_IR_CATEGORY_ID must be a positive integer');
  }

  const timeoutMs = Number(env('TUYA_API_TIMEOUT_MS') || 10_000);
  return {
    host,
    apiKey,
    apiSecret,
    infraredDeviceId,
    remoteId,
    categoryId,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000,
  };
}

export class TuyaIrClient {
  private readonly cfg: TuyaIrConfig;
  private accessToken: string | null = null;

  constructor(cfg: TuyaIrConfig) {
    this.cfg = cfg;
  }

  static fromEnv(): TuyaIrClient | null {
    const cfg = loadConfig();
    return cfg ? new TuyaIrClient(cfg) : null;
  }

  async sendPower(): Promise<void> {
    if (!this.accessToken) this.accessToken = await this.getToken();
    const path = `/v2.0/infrareds/${encodeURIComponent(this.cfg.infraredDeviceId)}/remotes/${encodeURIComponent(this.cfg.remoteId)}/command`;
    const response = await this.request<boolean>(
      'POST',
      path,
      { key: 'Power', categoryId: this.cfg.categoryId },
      this.accessToken,
    );
    if (!response.success || response.result !== true) {
      const errMsg = `Tuya IR Power failed: ${response.code ?? 'unknown'} ${response.msg ?? ''}`.trim();
      logger.warn('device.audit', {
        device: 'tuya_ir', target: 'tv', action: 'power_toggle',
        ok: false, error: errMsg,
      });
      throw new Error(errMsg);
    }
    logger.info('device.audit', {
      device: 'tuya_ir', target: 'tv', action: 'power_toggle',
      ok: true,
    });
  }

  private async getToken(): Promise<string> {
    const response = await this.request<{ access_token?: string }>(
      'GET',
      '/v1.0/token?grant_type=1',
      undefined,
      null,
    );
    const token = response.result?.access_token;
    if (!response.success || !token) {
      throw new Error(`Tuya token failed: ${response.code ?? 'unknown'} ${response.msg ?? ''}`.trim());
    }
    return token;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    bodyValue: unknown,
    token: string | null,
  ): Promise<TuyaResponse<T>> {
    const body = bodyValue === undefined ? '' : JSON.stringify(bodyValue);
    const timestamp = String(Date.now());
    const contentHash = createHash('sha256').update(body).digest('hex');
    const stringToSign = `${method}\n${contentHash}\n\n${path}`;
    const payload = `${this.cfg.apiKey}${token ?? ''}${timestamp}${stringToSign}`;
    const sign = createHmac('sha256', this.cfg.apiSecret).update(payload).digest('hex').toUpperCase();
    const headers: Record<string, string> = {
      client_id: this.cfg.apiKey,
      sign,
      t: timestamp,
      sign_method: 'HMAC-SHA256',
    };
    if (token) headers.access_token = token;
    if (body) headers['Content-Type'] = 'application/json';

    const response = await fetch(`https://${this.cfg.host}${path}`, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Tuya HTTP ${response.status}: ${text.slice(0, 120)}`);
    try {
      return JSON.parse(text) as TuyaResponse<T>;
    } catch {
      throw new Error('Tuya returned invalid JSON');
    }
  }
}
