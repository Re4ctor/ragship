// ponytail: force line-buffered output so background logs show progress immediately
if ((process.stdout as unknown as { _handle?: { setBlocking?: (v: boolean) => void } })._handle?.setBlocking) {
  (process.stdout as unknown as { _handle: { setBlocking: (v: boolean) => void } })._handle.setBlocking(true);
}

function write(level: string, message: string, meta?: unknown) {
  const line = meta === undefined ? `[${level}] ${message}` : `[${level}] ${message} ${JSON.stringify(meta)}`;
  process.stdout.write(line + "\n");
}

export const logger = {
  info(message: string, meta?: unknown) {
    write("info", message, meta);
  },
  warn(message: string, meta?: unknown) {
    write("warn", message, meta);
  },
  error(message: string, meta?: unknown) {
    write("error", message, meta);
  }
};
