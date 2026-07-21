import 'dotenv/config';

/**
 * Web 游戏时间管理服务配置（精简版）。
 *
 * 仅包含 Web 服务与游戏设备控制相关的环境变量，不引入 LLM/ASR/TTS/唤醒词等语音链路配置。
 */

export interface AppConfig {
  /** 凌晨自动给游戏机充电 */
  autoChargeEnabled: boolean;
  autoChargeStartHHmm: string;
  autoChargeEndHHmm: string;
  autoChargeStateFile: string;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw : fallback;
}

/** 解析 "HH:mm" 字符串。错误格式直接抛——配置错误快失败。 */
function parseHHmm(name: string, raw: string): string {
  const m = raw.trim().match(/^([0-2]\d):([0-5]\d)$/);
  if (!m) {
    throw new Error(`Invalid ${name}="${raw}", expected HH:mm`);
  }
  const h = Number(m[1]);
  if (h > 23) throw new Error(`Invalid ${name}="${raw}", hour must be 00-23`);
  return `${m[1]}:${m[2]}`;
}

/** 解析"开关"型环境变量：未设置 → 默认值；显式设 0|false|off|no → false；其他 → true。 */
function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '') return fallback;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return true;
}

export function loadConfig(): AppConfig {
  return {
    autoChargeEnabled: boolEnv('AUTO_CHARGE_ENABLED', true),
    autoChargeStartHHmm: parseHHmm(
      'AUTO_CHARGE_START',
      strEnv('AUTO_CHARGE_START', '03:00'),
    ),
    autoChargeEndHHmm: parseHHmm(
      'AUTO_CHARGE_END',
      strEnv('AUTO_CHARGE_END', '05:00'),
    ),
    autoChargeStateFile: strEnv(
      'AUTO_CHARGE_STATE_FILE',
      '.runtime/auto-charge-state.json',
    ),
  };
}