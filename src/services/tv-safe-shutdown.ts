import { logger } from '../common/logger';
import { resolveNetworkDeviceIp } from './netgear-device-registry';
import { TuyaIrClient } from './tuya-ir-client';

export interface TvSafeShutdownResult {
  ok: boolean;
  error?: string;
}

export interface TvPowerOnResult {
  ok: boolean;
  /** 发送了 IR Power 键（true）还是探测到电视已在线、无需发送（false） */
  irSent: boolean;
  error?: string;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TvSafeShutdown {
  private readonly tvMac = process.env.HISENSE_TV_MAC?.trim();
  private readonly tvName = process.env.HISENSE_TV_NAME?.trim();
  private readonly fallbackTvIp = process.env.HISENSE_TV_IP?.trim();
  private readonly upnpPort = positiveIntEnv('HISENSE_TV_UPNP_PORT', 38400);
  private readonly standbyTimeoutMs = positiveIntEnv('TV_STANDBY_TIMEOUT_SECONDS', 90) * 1000;
  private readonly powerCutDelayMs = positiveIntEnv('TV_POWER_CUT_DELAY_SECONDS', 30) * 1000;
  private readonly probeTimeoutMs = positiveIntEnv('TV_STANDBY_PROBE_TIMEOUT_MS', 2000);
  private readonly pollIntervalMs = positiveIntEnv('TV_STANDBY_POLL_INTERVAL_MS', 2000);

  async prepareForPowerCut(): Promise<TvSafeShutdownResult> {
    let ir: TuyaIrClient | null;
    try {
      ir = TuyaIrClient.fromEnv();
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    if (!ir) return { ok: false, error: 'tuya_ir_not_configured' };

    // Power 是切换键。只有确认电视当前在线时才发送，避免误把已待机的电视打开。
    const tvIp = await this.resolveOnlineTvIp();
    if (!tvIp) {
      // 电视不可达 = 已关机/待机，无需发红外，直接允许断电。
      logger.info('tv-safe-shutdown.tv_already_off', {});
      return { ok: true };
    }

    try {
      await ir.sendPower();
      logger.info('tv-safe-shutdown.ir_power_sent', { tvIp });
    } catch (error) {
      const message = (error as Error).message;
      logger.warn('tv-safe-shutdown.ir_power_failed', { error: message });
      return { ok: false, error: message };
    }

    const standby = await this.waitForStandby(tvIp);
    if (!standby) {
      logger.warn('tv-safe-shutdown.standby_timeout', {
        tvIp,
        timeoutMs: this.standbyTimeoutMs,
      });
      return { ok: false, error: 'tv_standby_timeout' };
    }

    logger.info('tv-safe-shutdown.standby_confirmed', {
      tvIp,
      powerCutDelayMs: this.powerCutDelayMs,
    });
    await sleep(this.powerCutDelayMs);
    return { ok: true };
  }

  /**
   * 通电后打开电视：先探测是否已在线，只有当前"不在线（=待机/未启动）"时才发 Power。
   * Power 是切换键，若电视其实是开机状态，再发一次会把它关掉——所以必须先探测。
   * 会话启动是耗时敏感的，本方法**不等待**电视进入"UPnP 在线"（那可能要 ~30 秒），
   * 只保证 Power 键发出去，让电视自己去启动即可。
   */
  async ensurePoweredOn(): Promise<TvPowerOnResult> {
    let ir: TuyaIrClient | null;
    try {
      ir = TuyaIrClient.fromEnv();
    } catch (error) {
      return { ok: false, irSent: false, error: (error as Error).message };
    }
    if (!ir) return { ok: false, irSent: false, error: 'tuya_ir_not_configured' };

    // 电视刚通电通常处于待机模式（UPnP 不响应）→ 视为"未开机"→ 需要发 Power。
    // 若探测到已在线（例如上一次关机流程失败、或用户手动开过电视），跳过发送，避免把它关掉。
    if (await this.isCurrentlyOnline()) {
      logger.info('tv-safe-shutdown.tv_already_on', {});
      return { ok: true, irSent: false };
    }

    try {
      await ir.sendPower();
      logger.info('tv-safe-shutdown.ir_power_on_sent', {});
      return { ok: true, irSent: true };
    } catch (error) {
      const message = (error as Error).message;
      logger.warn('tv-safe-shutdown.ir_power_on_failed', { error: message });
      return { ok: false, irSent: false, error: message };
    }
  }

  /** 快速探测电视是否处于 UPnP 可达状态（不做重试，只用于开机前预判）。 */
  private async isCurrentlyOnline(): Promise<boolean> {
    const query = {
      mac: this.tvMac,
      name: this.tvName,
      fallbackIp: this.fallbackTvIp,
    };
    const cachedIp = await resolveNetworkDeviceIp(query);
    if (cachedIp && await this.isUpnpOnline(cachedIp)) return true;
    // 网关缓存里没有 / 探测失败 → 不再强制刷新（会拉长开机链路耗时），
    // 一律视为"当前不在线"。最坏情况：电视其实开着，被 Power 关掉；
    // 此时用户在 Web 端能看到会话已开始，可手动按遥控器重开——比阻塞开机 3~5 秒更划算。
    return false;
  }

  private async resolveOnlineTvIp(): Promise<string | null> {
    const query = {
      mac: this.tvMac,
      name: this.tvName,
      fallbackIp: this.fallbackTvIp,
    };
    const cachedIp = await resolveNetworkDeviceIp(query);
    if (cachedIp && await this.isUpnpOnline(cachedIp)) return cachedIp;

    const refreshedIp = await resolveNetworkDeviceIp(query, true);
    if (refreshedIp && await this.isUpnpOnline(refreshedIp)) return refreshedIp;
    return null;
  }

  private async waitForStandby(tvIp: string): Promise<boolean> {
    const deadline = Date.now() + this.standbyTimeoutMs;
    let consecutiveOffline = 0;
    while (Date.now() < deadline) {
      if (await this.isUpnpOnline(tvIp)) {
        consecutiveOffline = 0;
      } else {
        consecutiveOffline += 1;
        // 连续三次不可达才判定待机，避免一次 Wi-Fi 抖动导致过早断电。
        if (consecutiveOffline >= 3) return true;
      }
      await sleep(this.pollIntervalMs);
    }
    return false;
  }

  private async isUpnpOnline(tvIp: string): Promise<boolean> {
    const url = `http://${tvIp}:${this.upnpPort}/MediaServer/rendererdevicedesc.xml`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.probeTimeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
