/**
 * `dsh-purge --doctor` 的实现。
 *
 * 体检的是「补丁到底有没有真的在跑」，而不是「补丁表怎么说」。逐项：
 *   1. 归档形态      app.asar 是否还在（还在 = Electron 优先读 asar，解包目录白打）
 *   2. 解包目录      存在性 / 文件数 / 与 asar 的 size+mtime 戳是否一致
 *   3. 宿主加载源    进程命令行实际读的是 asar 还是 resources\app
 *   4. 是否需重启    进程启动时间 vs 最新补丁文件 mtime
 *   5. 原文备份      带 dsh-purge marker 的文件有多少留了 .dshpurge.bak（决定「还原」能不能用）
 *   6. shim 三件套   dsh.cmd / dsh.ps1 / dsh
 *   7. 版本对照      宿主版本 vs 插件 dshTarget，以及适配台账是否过期
 *   8. 注入文件      prompt-inject.md 是否存在且非空、override 状态
 *   9. settle 冷却   最近是否反复重打/重启（settle-restart.guard）
 *  10. 补丁总账      applied / adapted / pending / skipped
 *
 * 每行给 { id, label, status: ok|warn|fail|info, detail, hint }。
 * 只读，不改任何文件。
 */
import fs from "node:fs";
import path from "node:path";
import * as landing from "./landing.js";
import * as core from "./core.js";
import * as adapted from "./adapted.js";

const MARKER = "[dsh-purge";

function row(id, label, status, detail, hint = "") {
  return { id, label, status, detail, hint };
}

function human(bytes) {
  const n = Number(bytes) || 0;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function readJsonSafe(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function classifySource(cmd) {
  if (!cmd) return "unknown";
  if (/app\.asar/.test(cmd)) return "asar";
  if (/[\\/]resources[\\/]app[\\/]/.test(cmd)) return "unpacked";
  return "unknown";
}

function newestMtime(files) {
  let newest = 0;
  for (const fp of files) {
    try {
      const t = fs.statSync(fp).mtimeMs;
      if (t > newest) newest = t;
    } catch {
      /* 缺文件 */
    }
  }
  return newest;
}

export async function doctorReport() {
  const rows = [];
  const dshHome = core.findDshHome();
  const aiBase = core.findAiBase();
  // CI / 无宿主环境下 gatherState 可能抛，体检本身不应该因此失败
  let state = {};
  try {
    state = await core.gatherState();
  } catch (e) {
    rows.push(row("env", "宿主探测", "info", "gatherState 失败：" + String(e && e.message ? e.message : e)));
    state = { files: {}, patch_status: {}, override_status: "unknown", shim_cmd: "missing", shim_ps1: "missing", shim_bin: "missing" };
  }

  // 1. 归档形态
  let asarSealed = false;
  try {
    asarSealed = core.desktopAsarStillSealed();
  } catch {
    asarSealed = false;
  }
  if (asarSealed) {
    rows.push(row("asar", "归档形态", "fail", "app.asar 仍在：Electron 优先读 asar，解包目录里的补丁不会加载",
      "退出 Harness 后跑 dsh-purge --switch，把 asar 改名成 .bak 再重启"));
  } else {
    rows.push(row("asar", "归档形态", "ok", "app.asar 不在，宿主会落到 resources/app"));
  }

  // 落地形态：把「文件内容」和「运行态」两件事分开报
  try {
    const snap = landing.landingSnapshot();
    const label = { sealed: "密封（补丁不加载）", loaded: "已加载", unpacked: "已解包但未加载", unknown: "无法判定" }[snap.landing];
    rows.push(row("landing", "落地形态",
      snap.landing === "loaded" ? "ok" : snap.landing === "unknown" ? "info" : "fail",
      `${label} · marker 文件 ${snap.markerFiles} · asar 进程 ${snap.asarProcs} / app 进程 ${snap.unpackedProcs}`,
      snap.canSwitch ? "退出后跑 dsh-purge --switch 切到解包目录" : snap.canRollback ? "需要回滚时跑 dsh-purge --restore-sealed" : ""));
  } catch (e) {
    rows.push(row("landing", "落地形态", "info", `探测失败：${String(e && e.message ? e.message : e)}`));
  }

  // 2. 解包目录
  const appDir = aiBase ? path.resolve(aiBase, "..", "..", "..") : "";
  let appFiles = 0;
  if (appDir && fs.existsSync(appDir)) {
    try {
      appFiles = fs.readdirSync(appDir).length ? countFiles(appDir) : 0;
    } catch {
      appFiles = 0;
    }
    rows.push(row("app_dir", "解包目录", appFiles > 1000 ? "ok" : "warn",
      `${appDir}（${appFiles} 个文件）`,
      appFiles > 1000 ? "" : "文件数异常偏少，可能解包不完整"));
  } else {
    rows.push(row("app_dir", "解包目录", "fail", "找不到 resources/app", "重新解包 asar 或重装插件"));
  }

  // 3. 宿主加载源
  const procs = landing.hostProcesses();
  let landingVerdict = "unknown";
  if (procs === null) {
    rows.push(row("host", "宿主加载源", "info", "无法读取进程信息（权限或平台限制），跳过"));
  } else if (procs.length === 0) {
    rows.push(row("host", "宿主加载源", "warn", "没有检测到 DeepSeek Harness 进程", "先启动 Harness 再体检"));
  } else {
    const sources = procs.filter((p) => /dsh-desktop-host|dsh-app-boot|subprocess-local|lib[\\/]main\.js/.test(p.cmd));
    const hostSrc = sources.map((p) => classifySource(p.cmd));
    const asarCount = hostSrc.filter((s) => s === "asar").length;
    const unpackedCount = hostSrc.filter((s) => s === "unpacked").length;
    landingVerdict = unpackedCount > 0 && asarCount === 0 ? "loaded" : asarCount > 0 ? "asar" : "unknown";
    if (landingVerdict === "loaded") {
      rows.push(row("host", "宿主加载源", "ok", `${unpackedCount} 个宿主进程从 resources/app 加载（补丁生效）`));
    } else if (landingVerdict === "asar") {
      rows.push(row("host", "宿主加载源", "fail", `${asarCount} 个宿主进程仍从 app.asar 加载（补丁未生效）`,
        "完全退出 Harness，把 app.asar 改名后重启"));
    } else {
      rows.push(row("host", "宿主加载源", "warn", "无法判定（进程命令行不含可识别路径）"));
    }
  }

  // 4. 进程 vs 补丁时间戳
  const patchFiles = aiBase ? core.ALL_PATCHES.flatMap((p) => resolvedFilesOf(state, p)) : [];
  const newest = newestMtime([...patchFiles, appDir ? path.join(appDir, "lib", "main.js") : ""].filter(Boolean));
  const running = procs && procs.length ? procs.reduce((a, b) => (a.startedAt && b.startedAt ? (a.startedAt <= b.startedAt ? a : b) : a)) : null;
  if (!newest) {
    rows.push(row("stale", "补丁时效", "info", "没有可stat的补丁文件"));
  } else if (!running || !running.startedAt) {
    rows.push(row("stale", "补丁时效", "info", `最新补丁 ${new Date(newest).toLocaleString()}；无进程时间可对比`));
  } else if (running.startedAt.getTime() < newest) {
    rows.push(row("stale", "补丁时效", "warn",
      `进程启动 ${running.startedAt.toLocaleString()} 早于最新补丁 ${new Date(newest).toLocaleString()}`,
      "完全退出并重开 Harness 才能加载这批补丁"));
  } else {
    rows.push(row("stale", "补丁时效", "ok", "进程晚于最新补丁，已加载"));
  }

  // 5. 原文备份覆盖
  const marked = patchFiles.filter((fp) => {
    try {
      return fs.readFileSync(fp, "utf8").includes(MARKER);
    } catch {
      return false;
    }
  });
  const backed = marked.filter((fp) => fs.existsSync(`${fp}.dshpurge.bak`) || fs.existsSync(`${fp}.dsh-purge.bak`));
  const bakTotal = new Set(marked).size;
  const bakHave = new Set(backed).size;
  if (bakTotal === 0) {
    rows.push(row("bak", "原文备份", "info", "没有带 marker 的文件，无需备份"));
  } else if (bakHave === bakTotal) {
    rows.push(row("bak", "原文备份", "ok", `${bakHave}/${bakTotal} 覆盖，还原可用`));
  } else {
    rows.push(row("bak", "原文备份", "warn", `${bakHave}/${bakTotal} 覆盖`,
      "缺备份的文件回滚时会从解包 asar 重新取原文；建议重新应用一次补齐"));
  }

  // 6. shim：真正要判的是「shim 能不能解析到宿主」，而不是插件能不能注入
  const shimDir = (() => {
    try {
      return core.findDesktopShimDir() || state.shim_dir || "";
    } catch {
      return state.shim_dir || "";
    }
  })();
  const shimNames = ["dsh.cmd", "dsh.ps1", "dsh"];
  const shimPresent = shimNames
    .map((n) => ({ name: n, fp: shimDir ? path.join(shimDir, n) : "" }))
    .filter((x) => x.fp && fs.existsSync(x.fp));
  if (shimPresent.length === 0) {
    rows.push(row("shim", "shim 三件套", "info", "未找到 CLI shim（" + (shimDir || "目录未知") + "）", "纯 GUI 使用无影响"));
  } else {
    // 从 shim 目录往上找 0..5 级，看哪一级能同时摸到 exe 与 cli.js（兼容 resources 与 resources\\app 两种布局）
    const resolveFrom = (fp2) => {
      let dir = path.dirname(fp2);
      for (let i = 0; i <= 5; i += 1) {
        const cands = [
          path.join(dir, "resources", "app", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js"),
          path.join(dir, "app", "dsh", "node_modules", "@deepseek-ai", "dsh-desktop-host", "lib", "cli.js"),
          path.join(dir, "resources", "app.asar"),
        ];
        for (const c of cands) {
          if (fs.existsSync(c)) return c;
        }
        dir = path.dirname(dir);
      }
      return "";
    };
    const resolvable = shimPresent.filter((x) => resolveFrom(x.fp));
    const detail = shimPresent.map((x) => x.name).join(", ") + "（" + shimPresent.length + "/3）" +
      (resolvable.length ? "" : "；指向的宿主路径不存在") ;
    rows.push(row("shim", "shim 三件套", resolvable.length ? "ok" : "warn", detail,
      resolvable.length ? "" : "切包后 shim 里的路径会指向旧的 app.asar，需要同步成 resources\\app"));
  }

  // 7. 版本 & 适配台账
  let pluginVersion = "";
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "package.json");
    pluginVersion = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "";
  } catch {
    pluginVersion = "";
  }
  const hostVersion = adapted.hostVersionAt(aiBase);
  const target = (() => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "package.json"), "utf8"));
      return String(pkg?.dsh?.dshTarget || pkg?.dshTarget || "");
    } catch {
      return "";
    }
  })();
  rows.push(row("version", "版本对照", "info",
    `插件 ${pluginVersion || "?"}  宿主 ${hostVersion || "?"}  插件声明 dshTarget ${target || "?"}`));

  const adaptedIds = adapted.readAdaptedIds(dshHome, hostVersion);
  const staleAdapted = adapted.readAdaptedStale(dshHome, hostVersion);
  if (adaptedIds.size > 0) {
    rows.push(row("adapted", "适配台账", "ok", `${adaptedIds.size} 条本地适配补丁生效：[${[...adaptedIds].sort((a, b) => a - b).join(", ")}]`));
  } else if (staleAdapted.length > 0) {
    rows.push(row("adapted", "适配台账", "warn",
      `${staleAdapted.length} 条适配记录属于旧宿主版本（${staleAdapted[0].host}），已失效`,
      "宿主升级后需要按新版源码重新适配，否则这些补丁会退回 skipped"));
  } else {
    rows.push(row("adapted", "适配台账", "info", "没有本地适配记录（全部走内置补丁表）"));
  }

  // 8. 注入文件
  const injectPath = state.override_path || path.join(dshHome, "prompt-inject.md");
  if (fs.existsSync(injectPath)) {
    const size = fs.statSync(injectPath).size;
    rows.push(row("inject", "注入文件", size > 200 ? "ok" : "warn",
      `${injectPath}（${human(size)}，override=${state.override_status}）`,
      size > 200 ? "" : "文件过小，可能没写内容"));
  } else {
    rows.push(row("inject", "注入文件", "warn", `不存在：${injectPath}`, "提示词层不会注入"));
  }

  // 9. settle 冷却
  const guardPath = path.join(dshHome, "dsh-purge", "settle-restart.guard");
  const guard = readJsonSafe(guardPath);
  if (guard && guard.at) {
    const ageMin = Math.round((Date.now() - Date.parse(guard.at)) / 60000);
    const looping = ageMin >= 0 && ageMin < 10;
    rows.push(row("settle", "settle 冷却", looping ? "warn" : "info",
      `最近一次重打重启 ${ageMin} 分钟前${looping ? "（短时间内反复重启，可能在打环）" : ""}`,
      looping ? "看日志里是否反复 revertAll/apply；必要时删掉 guard 文件观察一轮" : ""));
  } else {
    rows.push(row("settle", "settle 冷却", "ok", "没有重打重启记录"));
  }

  // 10. 补丁总账
  const st = state.patch_status || {};
  const tally = { applied: 0, adapted: 0, pending: 0, skipped: 0, other: 0 };
  for (const id of Object.keys(st)) {
    const s = st[id];
    if (s === "applied") tally.applied += 1;
    else if (s === "adapted") tally.adapted += 1;
    else if (s === "pending") tally.pending += 1;
    else if (s === "skipped" || s === "unmatched" || s === "missing_file") tally.skipped += 1;
    else tally.other += 1;
  }
  const fail = tally.pending > 0;
  rows.push(row("patches", "补丁总账", fail ? "warn" : "ok",
    `applied ${tally.applied}  adapted ${tally.adapted}  pending ${tally.pending}  skipped ${tally.skipped}  na/info ${tally.other}`,
    fail ? "还有 pending：这些是真有活没干，跑一次 --apply" : ""));

  const summary = { ok: 0, warn: 0, fail: 0, info: 0 };
  for (const r of rows) summary[r.status] += 1;
  return { at: new Date().toISOString(), dshHome, aiBase, landing, rows, summary };
}

function countFiles(root, limit = 200000) {
  let n = 0;
  const stack = [root];
  while (stack.length && n < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(dir, e.name));
      else n += 1;
      if (n >= limit) break;
    }
  }
  return n;
}

/** 用 gatherState().files（key → 路径）把补丁解析成真实文件列表。 */
function resolvedFilesOf(state, patch) {
  const keys = Array.isArray(patch.file) ? patch.file : [patch.file];
  const out = [];
  for (const key of keys) {
    const hit = state.files?.[key];
    if (!hit) continue;
    if (Array.isArray(hit)) out.push(...hit.filter(Boolean));
    else out.push(hit);
  }
  return out;
}

export function formatDoctor(report) {
  const icon = { ok: "✓", warn: "!", fail: "✗", info: "·" };
  const lines = [];
  lines.push("dsh-purge 体检 / doctor");
  lines.push(`  DSH_HOME  ${report.dshHome}`);
  if (report.aiBase) lines.push(`  宿主根    ${report.aiBase}`);
  lines.push("");
  for (const r of report.rows) {
    lines.push(`  ${icon[r.status] || "·"} ${String(r.label).padEnd(12)} ${r.detail}`);
    if (r.hint) lines.push(`    ${" ".repeat(12)} → ${r.hint}`);
  }
  lines.push("");
  lines.push(`  合计：ok ${report.summary.ok}  warn ${report.summary.warn}  fail ${report.summary.fail}  info ${report.summary.info}`);
  return lines.join("\n");
}
