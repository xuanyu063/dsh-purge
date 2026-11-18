/**
 * 落地形态（landing）：补丁写进了哪个目录、宿主又从哪个目录读代码。
 *
 * 三种形态：
 *   sealed      app.asar 在位。Electron 优先读 asar，resources/app 里的补丁一条都不会加载。
 *   unpacked    解包目录在，但检测不到宿主进程从它启动（未启动 / 起错 / 刚重启）。
 *   loaded      宿主进程确实从 resources/app 起，补丁在内存里跑着。
 *
 * 这是「补丁打上了 ≠ 补丁生效了」这件事唯一的判断依据：
 * patchStatus 说的是文件内容，landing 说的是运行态。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { detectSurface } from "./surface.js";
import * as desktop from "./desktop.js";
import { renameAsarAside } from "./extract-asar.js";

const MARKER = "[dsh-purge";
const PRUNE_DIRS = new Set(["node_modules", "docs", "assets", ".bin", ".cache", "files"]);

/** 宿主进程快照：win32 走 CIM，posix 读 /proc。读不到返回 null（不等于失败）。 */
export function hostProcesses() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | " +
            "Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", timeout: 8000, windowsHide: true },
      );
      const parsed = JSON.parse(out || "[]");
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.filter(Boolean).map((p) => ({
        pid: Number(p.ProcessId),
        cmd: String(p.CommandLine || ""),
        startedAt: parseCimDate(p.CreationDate),
      }));
    }
    const out = [];
    for (const dir of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(dir)) continue;
      try {
        const cmd = fs.readFileSync(path.join("/proc", dir, "cmdline"), "utf8").replace(/\0/g, " ").trim();
        if (!/DeepSeek Harness|dsh-desktop-host/.test(cmd)) continue;
        out.push({ pid: Number(dir), cmd, startedAt: fs.statSync(path.join("/proc", dir)).birthtime });
      } catch {
        /* 进程已退出 */
      }
    }
    return out;
  } catch {
    return null;
  }
}

function parseCimDate(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^\/Date\((\d+)\)\/$/);
  if (m) return new Date(Number(m[1]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function classify(cmd) {
  if (!cmd) return "unknown";
  if (/app\.asar/.test(cmd)) return "asar";
  if (/[\\/]resources[\\/]app[\\/]/.test(cmd)) return "unpacked";
  return "unknown";
}

function countMarkedFiles(appDir) {
  if (!appDir) return 0;
  // 只扫补丁真正会碰的两处：@deepseek-ai 下各包 与 桌面壳 lib。
  const roots = [
    path.join(appDir, "dsh", "node_modules", "@deepseek-ai"),
    path.join(appDir, "lib"),
  ].filter((r) => fs.existsSync(r));
  let n = 0;
  const stack = [...roots];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 嵌套 node_modules / 文档 / 资源目录里不会有补丁，跳过省时间
        if (PRUNE_DIRS.has(e.name)) continue;
        stack.push(fp);
        continue;
      }
      if (!/\.(js|mjs|cjs|yml|yaml|json)$/.test(e.name)) continue;
      try {
        if (fs.statSync(fp).size > 4 * 1024 * 1024) continue;
        if (fs.readFileSync(fp, "utf8").includes(MARKER)) n += 1;
      } catch {
        /* 读不了就算了 */
      }
    }
  }
  return n;
}

let memo = { at: 0, value: null };
const MEMO_MS = 60000;

/** 只读快照：不需要任何参数，自己按 surface 探测。60 秒内复用（doctor/landing 会连着调）。 */
export function landingSnapshot({ fresh = false } = {}) {
  if (!fresh && memo.value && Date.now() - memo.at < MEMO_MS) return memo.value;
  memo = { at: Date.now(), value: buildSnapshot() };
  return memo.value;
}

function buildSnapshot() {
  const surface = detectSurface();
  const exe = desktop.findDesktopAppExecutable();
  const asarPath = exe ? desktop.appAsarPath(exe) : "";
  const appDir = exe ? desktop.appDirForExecutable(exe) : "";
  const asarPresent = Boolean(asarPath) && fs.existsSync(asarPath);
  const appDirReady = Boolean(appDir) && fs.existsSync(path.join(appDir, "dsh")) && fs.existsSync(path.join(appDir, "lib", "main.js"));
  const procs = hostProcesses();
  const hosts = (procs || []).filter((p) => /dsh-desktop-host|dsh-app-boot|subprocess-local|lib[\\/]main\.js/.test(p.cmd));
  const sources = hosts.map((p) => classify(p.cmd));
  const asarProcs = sources.filter((s) => s === "asar").length;
  const unpackedProcs = sources.filter((s) => s === "unpacked").length;

  let landing = "unknown";
  if (asarProcs > 0) landing = "sealed";
  else if (unpackedProcs > 0) landing = "loaded";
  else if (asarPresent) landing = "sealed";
  else if (appDirReady) landing = "unpacked";

  return {
    surface,
    exe,
    asarPath,
    asarPresent,
    appDir,
    appDirReady,
    markerFiles: appDirReady ? countMarkedFiles(appDir) : 0,
    processes: procs,
    hostProcessCount: hosts.length,
    asarProcs,
    unpackedProcs,
    landing,
    // 可以执行的修复动作
    canSwitch: asarPresent && appDirReady,
    canRollback: !asarPresent && appDirReady && Boolean(findSealedBackup(path.dirname(asarPath || ""))),
  };
}

function findSealedBackup(resourcesDir) {
  if (!resourcesDir) return "";
  const candidates = [`${path.join(resourcesDir, "app.asar")}.bak`];
  try {
    for (const name of fs.readdirSync(resourcesDir)) {
      if (/^app\.asar\.(sealed-|bak)/.test(name)) candidates.push(path.join(resourcesDir, name));
    }
  } catch {
    /* ignore */
  }
  return candidates.find((fp) => {
    try {
      return fs.existsSync(fp) && fs.statSync(fp).size > 1024;
    } catch {
      return false;
    }
  }) || "";
}

/**
 * 切到解包目录：把 app.asar 改名成 app.asar.bak，让 Electron 落到 resources/app。
 * 需要完全退出 Harness 后重启才生效（由调用方负责）。
 */
export function switchToUnpacked({ dryRun = false } = {}) {
  const snap = landingSnapshot();
  if (!snap.asarPath) return { ok: false, reason: "找不到 app.asar 路径（不是桌面安装？）", snapshot: snap };
  if (!snap.asarPresent) return { ok: true, renamed: false, reason: "app.asar 已经不在，无需切换", snapshot: snap };
  if (!snap.appDirReady) return { ok: false, reason: `解包目录不完整：${snap.appDir}`, snapshot: snap };
  if (snap.markerFiles === 0) {
    return { ok: false, reason: "解包目录里没有补丁 marker，切过去等于跑原版", snapshot: snap };
  }
  if (dryRun) {
    return { ok: true, dryRun: true, renamed: false, reason: `会改名 ${snap.asarPath} → ${snap.asarPath}.bak`, snapshot: snap };
  }
  const r = renameAsarAside(snap.asarPath);
  return {
    ok: Boolean(r.renamed),
    renamed: Boolean(r.renamed),
    bak: r.bak,
    busy: Boolean(r.busy),
    reason: r.renamed
      ? "已改名，完全退出 Harness 后重启即加载解包目录"
      : r.busy
        ? "asar 被占用（宿主还在跑），先完全退出再试"
        : "改名失败",
    snapshot: snap,
  };
}

/** 回滚到官方密封包：把备份改回 app.asar。 */
export function restoreSealed({ dryRun = false } = {}) {
  const snap = landingSnapshot();
  if (snap.asarPresent) return { ok: true, reason: "app.asar 已在位，无需回滚", snapshot: snap };
  const backup = findSealedBackup(path.dirname(snap.asarPath || ""));
  if (!backup) return { ok: false, reason: "找不到 app.asar 备份（.bak / .sealed-*）", snapshot: snap };
  const target = path.join(path.dirname(backup), "app.asar");
  if (dryRun) return { ok: true, dryRun: true, reason: `会改名 ${backup} → ${target}`, snapshot: snap };
  try {
    if (fs.existsSync(target)) return { ok: false, reason: `${target} 已存在，拒绝覆盖`, snapshot: snap };
    fs.renameSync(backup, target);
    return { ok: true, renamed: true, reason: "已改回 app.asar，重启后走官方原版", snapshot: snap };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e), snapshot: snap };
  }
}
