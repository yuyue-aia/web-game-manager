import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import path from 'node:path';

type LogMeta = Record<string, unknown>;

/**
 * 文件日志：
 * - 结构化 JSON 行写入 logs/app-YYYY-MM-DD.log，按本地日期分割。
 * - 不再写入 stdout，避免和"对话内容"混在控制台。
 *
 * 控制台输出（[wake]/[asr-final]/[agent]/[state] 等）由 voice-service.ts 自行处理。
 *
 * 目录可通过 LOG_DIR 环境变量覆盖，默认 ./logs（相对于启动 cwd）。
 */
const LOG_DIR = path.resolve(process.env.LOG_DIR || 'logs');

let currentDay = '';
let currentStream: WriteStream | undefined;

function ensureStream(): WriteStream {
  const day = formatDay(nowCST());
  if (day === currentDay && currentStream && !currentStream.destroyed) {
    return currentStream;
  }
  // 切换到新一天 → 关旧的，开新的
  if (currentStream) {
    try { currentStream.end(); } catch { /* ignore */ }
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `app-${day}.log`);
  currentStream = createWriteStream(file, { flags: 'a' });
  currentStream.on('error', (err) => {
    // 写日志失败不能再调 logger，否则递归；fallback 到 stderr。
    process.stderr.write(`[logger] write error: ${(err as Error).message}\n`);
  });
  currentDay = day;
  return currentStream;
}

/** 返回 +8 时区的 Date（Asia/Shanghai）。 */
function nowCST(): Date {
  const d = new Date();
  // UTC 偏移转本地：先加 8 小时，再手动构造
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600_000;
  return new Date(utcMs);
}

function formatDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 格式化为 +8 时区的 ISO 字符串（替换 Z 为 +08:00）。 */
function toISOStringCST(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${day}T${h}:${mi}:${s}.${ms}+08:00`;
}

/** 把单个 meta 值格式化为日志字段：对象/数组走 JSON，含空格的字符串加引号。 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return /\s/.test(s) ? JSON.stringify(s) : s;
}

/**
 * 标准文本日志行：
 *   2026-07-18T01:42:06.920Z INFO  web.request method=GET path=/api/... status=200
 * 时间(ISO) + 级别(右补齐5位) + 消息 + 扁平化的 key=value 字段。
 */
function log(level: string, message: string, meta?: LogMeta): void {
  const time = toISOStringCST(nowCST());
  const lvl = level.toUpperCase().padEnd(5);
  let line = `${time} ${lvl} ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    const parts = Object.entries(meta).map(([k, v]) => `${k}=${formatValue(v)}`);
    line += ' ' + parts.join(' ');
  }
  line += '\n';
  try {
    ensureStream().write(line);
  } catch (err) {
    process.stderr.write(`[logger] ${(err as Error).message}\n`);
  }
}

export const logger = {
  info(message: string, meta?: LogMeta) {
    log('info', message, meta);
  },
  warn(message: string, meta?: LogMeta) {
    log('warn', message, meta);
  },
  error(message: string, meta?: LogMeta) {
    log('error', message, meta);
  },
};
