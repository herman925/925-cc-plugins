// src/claude-statusline.mjs
var import_node_child_process = require("node:child_process");
var import_promises2 = require("node:fs/promises");

// src/local/claude-context.mjs
var import_node_crypto = require("node:crypto");
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var count = (value) => Number.isSafeInteger(value) && value >= 0;
var claudeContextFile = (directory, { sessionId, path, paneKey }) => (0, import_node_path.join)(directory, (0, import_node_crypto.createHash)("sha256").update(JSON.stringify([sessionId, path, paneKey])).digest("hex") + ".json");
var claudeBindingFile = (directory, paneKey) => (0, import_node_path.join)(directory, "binding-" + (0, import_node_crypto.createHash)("sha256").update(paneKey).digest("hex") + ".json");
function statuslineSample(payload, paneKey, capturedAt = Date.now()) {
  if (!payload || typeof payload.session_id !== "string" || !payload.session_id || payload.session_id.length > 200 || typeof paneKey !== "string" || !paneKey || paneKey.length > 500 || !(0, import_node_path.isAbsolute)(payload.transcript_path || "") || !payload.transcript_path.endsWith(".jsonl")) return null;
  const cwd = payload.workspace?.current_dir ?? payload.cwd;
  if (!(0, import_node_path.isAbsolute)(cwd || "")) return null;
  const window = payload.context_window;
  if (!window || typeof window !== "object") return null;
  const sample = { schema: 1, sessionId: payload.session_id, path: payload.transcript_path, paneKey, cwd, capturedAt, model: typeof payload.model?.id === "string" ? payload.model.id.slice(0, 256) : null, context: null };
  if (window.current_usage === null) return sample;
  const usage = window.current_usage, parts = [usage?.input_tokens, usage?.cache_creation_input_tokens ?? 0, usage?.cache_read_input_tokens ?? 0];
  const limit = window.context_window_size;
  if (!parts.every(count) || !count(limit) || limit <= 0) return null;
  const used = parts.reduce((sum, value) => sum + value, 0), percent = window.used_percentage;
  if (!count(used)) return null;
  const calculated = 100 * used / limit;
  if (percent !== null && percent !== void 0 && (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || Math.abs(percent - calculated) > 1)) return null;
  sample.context = { used, limit, percent: typeof percent === "number" ? percent : calculated, estimated: false, capturedAt, source: "claude-statusline" };
  return sample;
}
async function readSmallFile(path, limit = 65536) {
  const file = await (0, import_promises.open)(path, import_node_fs.constants.O_RDONLY | import_node_fs.constants.O_NOFOLLOW | import_node_fs.constants.O_NONBLOCK);
  try {
    const stat2 = await file.stat();
    if (!stat2.isFile() || stat2.size > limit) throw Error("Context data is not a bounded regular file.");
    const buffer = Buffer.alloc(limit + 1), { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw Error("Context data exceeded its size limit.");
    return { text: buffer.subarray(0, bytesRead).toString("utf8"), stat: stat2 };
  } finally {
    await file.close();
  }
}
async function atomicFile(path, text, mode = 384) {
  const temporary = path + "." + (0, import_node_crypto.randomUUID)() + ".tmp";
  try {
    const file = await (0, import_promises.open)(temporary, "wx", mode);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await (0, import_promises.rename)(temporary, path);
  } finally {
    await (0, import_promises.unlink)(temporary).catch(() => {
    });
  }
}
async function saveStatuslineSample(directory, sample) {
  if (!sample) return;
  await (0, import_promises.mkdir)(directory, { recursive: true, mode: 448 });
  await atomicFile(claudeContextFile(directory, sample), JSON.stringify(sample) + "\n");
}

// src/claude-statusline.mjs
async function main() {
  const config = JSON.parse((await readSmallFile(process.argv[2], 1024 * 1024)).text);
  if (config.schema !== 1) throw Error("Unsupported statusline bridge configuration.");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const command = config.originalStatusLine?.command;
  const child = command ? (0, import_node_child_process.spawn)("/bin/sh", ["-c", command], { env, stdio: ["pipe", "inherit", "inherit"] }) : null;
  const completion = child ? new Promise((resolve2) => {
    child.once("error", () => resolve2(1));
    child.once("exit", (code) => resolve2(code ?? 1));
    child.stdin.on("error", () => {
    });
  }) : Promise.resolve(0);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    child?.stdin.write(chunk);
    bytes += chunk.length;
    if (bytes <= 1024 * 1024) chunks.push(chunk);
  }
  child?.stdin.end();
  if (config.enabled && !process.env.CLAUDE_JOB_DIR && bytes <= 1024 * 1024) {
    try {
      const sample = statuslineSample(JSON.parse(Buffer.concat(chunks).toString("utf8")), process.env.ORCA_PANE_KEY);
      if (sample) {
        const binding = JSON.parse((await readSmallFile(claudeBindingFile(config.directory, sample.paneKey))).text);
        if (binding.paneKey === sample.paneKey && binding.sessionId === sample.sessionId && binding.path === sample.path) {
          const file = await (0, import_promises2.stat)(sample.path);
          if (file.isFile()) {
            sample.binding = binding;
            sample.transcriptFile = { dev: file.dev, ino: file.ino };
            await saveStatuslineSample(config.directory, sample);
          }
        }
      }
    } catch {
    }
  }
  process.exitCode = await completion;
}
main().catch(() => {
  process.exitCode = 1;
});
