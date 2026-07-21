import { isIP } from 'node:net';
import { logger } from '../common/logger';

export type NetgearAccessAction = 'block' | 'allow';

interface NetgearAccessControlConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function isPrivateIpv4(hostname: string): boolean {
  if (isIP(hostname) !== 4) return false;
  const [a, b] = hostname.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export class NetgearAccessControlClient {
  constructor(private readonly config: NetgearAccessControlConfig) {}

  static fromEnv(): NetgearAccessControlClient | null {
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
      logger.warn('netgear.insecure_http', { service: 'access_control', host: url.host });
    }

    const timeout = Number(env('NETGEAR_DEVICE_TIMEOUT_MS'));
    return new NetgearAccessControlClient({
      baseUrl: url.toString().replace(/\/$/, ''),
      username,
      password,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 10_000,
    });
  }

  /**
   * 从 AccessControl_show.htm 页面提取 CSRF token（var ts='...'）。
   * Netgear 固件的 apply.cgi 要求 timestamp 必须与页面里嵌入的 ts 值一致，否则返回 400。
   */
  private async fetchCsrfToken(): Promise<string> {
    const authorization = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const pageUrl = `${this.config.baseUrl}/AccessControl_show.htm?ts=${Date.now()}`;
    const resp = await fetch(pageUrl, {
      headers: { Authorization: `Basic ${authorization}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!resp.ok) throw new Error(`netgear_access_http_${resp.status}`);
    const html = await resp.text();
    const m = html.match(/var\s+ts\s*=\s*'(\d+)'/);
    if (!m) throw new Error('netgear_access_no_csrf_token');
    return m[1];
  }

  async setAccess(mac: string, action: NetgearAccessAction): Promise<void> {
    const normalizedMac = mac.trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalizedMac)) {
      throw new Error('invalid_mac');
    }

    const form = new URLSearchParams({
      submit_flag: action === 'block' ? 'acc_control_block' : 'acc_control_allow',
      hid_able_block_device: '1',
      hid_new_device_status: 'Allow',
      hid_allow_no_connect_sta: '',
      hid_block_no_connect_sta: '',
      hidden_del_list: '',
      hidden_del_num: '0',
      hidden_change_list: `${normalizedMac}#`,
      hidden_change_num: '1',
      select_edit: '',
      enable_acl: '1',
      access_all: 'allow_all',
      checkbox_index3: normalizedMac,
    });
    const authorization = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
    const csrfToken = await this.fetchCsrfToken();
    const target = `${this.config.baseUrl}/apply.cgi?/access_control_plsWait.htm%20timestamp=${csrfToken}`;
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.config.baseUrl,
        Referer: `${this.config.baseUrl}/AccessControl_show.htm`,
      },
      body: form.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const body = await response.text();
    if (response.status >= 300 && response.status < 400) throw new Error('netgear_access_redirected');
    if (!response.ok) throw new Error(`netgear_access_http_${response.status}`);
    if (/\/login(?:\.htm|\.cgi)?/i.test(response.url)
      || /name=["']?(?:password|login_password)["']?/i.test(body)) {
      throw new Error('netgear_access_auth_failed');
    }
    if (/<title>[^<]*(?:error|invalid|failed)[^<]*<\/title>/i.test(body)) {
      throw new Error('netgear_access_rejected');
    }
  }
}
