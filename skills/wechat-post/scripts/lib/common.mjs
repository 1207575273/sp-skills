// 通用工具:日志与参数解析
export function log(level, ...args) {
  console.log(`[${level}] ${new Date().toISOString()}`, ...args);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) { out[key.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}
