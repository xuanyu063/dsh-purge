#!/usr/bin/env node

import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";
import * as adaptedLedger from "../lib/adapted.js";
import * as desktop from "../lib/desktop.js";
import path from "node:path";

const pathDirname = (p) => path.dirname(p);
const pathDirname3 = (p) => path.resolve(p, "..", "..", "..");

// 从普通终端跑 CLI 时，surface 默认是 web，会认错宿主根（甚至认到 npx 缓存）。
// 桌面版存在就按 desktop 走，和面板看到的一致。
try {
  if (!String(process.env.DSH_SURFACE || "").trim() && desktop.findDesktopAppExecutable()) {
    process.env.DSH_SURFACE = "desktop";
  }
} catch {
  /* 探测失败就按默认走 */
}
try {
  core.applyRuntimeEnv();
} catch {
  /* 非致命 */
}

const args = process.argv.slice(2);

function printStatus(state) {
  const out = [];
  out.push("dsh-purge 状态 / Status");
  out.push("  宿主 / surface " + (state.surface || "web"));
  out.push("  DSH_HOME      " + state.dsh_home);
  if (state.desktop_install) out.push("  桌面安装       " + state.desktop_install);
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  " + core.missingAiBaseMessage());
  }
  out.push(`  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  out.push(`  归档形态       ${state.asar_still_sealed ? "app.asar 密封（补丁不会加载）" : "解包目录"}`);
  out.push("");
  out.push(
    `  补丁 ${state.patches_applied} 已清洗 + ${state.patches_adapted || 0} 本地适配 / ${core.ALL_PATCHES.length}，` +
      `${state.patches_pending} 待清洗，${state.patches_skipped} 跳过`,
  );
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    // ◆ = 本地按新版源码适配过（台账登记），文件已改但内置 needle 对不上
    const mark = s === "applied" ? "✓" : s === "adapted" ? "◆" : s === "pending" ? "✗" : "·";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  return out.join("\n");
}

async function main() {
  const mode = args.find((a) =>
    ["--apply", "--revert", "--uninstall", "--status", "--edit", "--doctor", "--adapt", "--bakfill", "--landing", "--switch", "--restore-sealed", "--adapters", "--help"].includes(a),
  );

  if (mode === "--help" || args.includes("-h")) {
    console.log(`dsh-purge 用法:
  dsh-purge --status             显示状态
  dsh-purge --apply              应用全部清洗（提示词+代码+shim+override）
  dsh-purge --revert             回滚还原
  dsh-purge --doctor             体检：落地形态/备份/shim/版本/时效/适配台账
  dsh-purge --doctor --json      体检结果输出 JSON
  dsh-purge --adapt 14,17,32     登记本地适配过的补丁编号（宿主版本变了自动失效）
  dsh-purge --uninstall          卸载插件（已应用则先还原）
  dsh-purge --edit               编辑注入文件 prompt-inject.md
  dsh-purge --help               帮助`);
    return;
  }

  if (mode === "--doctor") {
    // 只读体检：落地形态 / 备份覆盖 / shim / 版本 / 时效 / 适配台账
    const { doctorReport, formatDoctor } = await import("../lib/doctor.js");
    const report = await doctorReport();
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else console.log(formatDoctor(report));
    if (report.summary.fail > 0) process.exitCode = 2;
    return;
  }

  if (mode === "--landing") {
    const landing = await import("../lib/landing.js");
    const snap = landing.landingSnapshot();
    console.log("落地形态 / landing");
    console.log(`  结论        ${snap.landing}`);
    console.log(`  app.asar    ${snap.asarPresent ? "在位（会压过解包目录）" : "不在"}  ${snap.asarPath || ""}`);
    console.log(`  解包目录    ${snap.appDirReady ? "可用" : "不完整"}  ${snap.appDir || ""}`);
    console.log(`  补丁 marker ${snap.markerFiles} 个文件`);
    console.log(`  宿主进程    ${snap.hostProcessCount} 个（asar ${snap.asarProcs} / app 目录 ${snap.unpackedProcs}）`);
    console.log(`  可切换      ${snap.canSwitch ? "是（--switch）" : "否"}`);
    console.log(`  可回滚      ${snap.canRollback ? "是（--restore-sealed）" : "否"}`);
    return;
  }

  if (mode === "--switch" || mode === "--restore-sealed") {
    const landing = await import("../lib/landing.js");
    const dry = args.includes("--dry-run");
    const r = mode === "--switch"
      ? landing.switchToUnpacked({ dryRun: dry })
      : landing.restoreSealed({ dryRun: dry });
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.reason}`);
    if (r.bak) console.log(`  备份      ${r.bak}`);
    if (r.snapshot) {
      console.log(`  当前形态  ${r.snapshot.landing}（asar 进程 ${r.snapshot.asarProcs} / app 进程 ${r.snapshot.unpackedProcs}）`);
    }
    if (r.ok && !dry) {
      console.log("  下一步    完全退出 Harness（托盘退出，确认无残留进程）再重新打开");
    }
    if (!r.ok) process.exitCode = 2;
    return;
  }

  if (mode === "--adapt") {
    // 把本地按新版源码重写过 needle 的补丁编号记进台账，面板就不再误报 skipped
    const list = args
      .filter((a) => a !== "--adapt" && !a.startsWith("--"))
      .flatMap((a) => String(a).split(","))
      .map((s) => Number(String(s).replace(/^#/, "").trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (list.length === 0) {
      console.log("用法: dsh-purge --adapt 14,17,32   （编号见 --status）");
      process.exitCode = 1;
      return;
    }
    const st = await core.gatherState();
    const host = adaptedLedger.hostVersionAt(st.ai_base);
    const named = list.map((id) => {
      const p = core.ALL_PATCHES.find((x) => x.id === id);
      return { id, name: p ? p.name : "" };
    });
    const entries = adaptedLedger.recordAdapted(st.dsh_home, named, { host, note: "local adaptation" });
    console.log(`已记录 ${list.length} 条适配（宿主 ${host || "?"}，台账共 ${entries.length} 条）`);
    console.log("注：台账按宿主版本生效，宿主升级后需重新 --adapt。");
    return;
  }

  if (mode === "--adapters") {
    // 适配补丁包：按宿主版本加载 $DSH_HOME/dsh-purge/patches.d/*.json
    const adapters = await import("../lib/adapters.js");
    const aiBase = core.findAiBase();
    if (!aiBase) {
      console.log("[ERROR] 没定位到插件根");
      process.exitCode = 1;
      return;
    }
    const appDir = path.resolve(aiBase, "..", "..", "..");
    const dshHome = core.findDshHome();
    const hostVersion = adaptedLedger.hostVersionAt(aiBase);
    const verify = args.includes("--verify");
    const dry = args.includes("--dry-run");

    if (verify) {
      const r = adapters.verifyPacks({ dshHome, appDir, hostVersion });
      console.log(`适配包校验 / verify  （宿主 ${hostVersion || "?"}，目录 ${r.dir}）`);
      for (const row of r.rows) {
        const mark = row.status === "ok" ? "✓" : "✗";
        const extra = row.hits !== undefined ? ` hits=${row.hits}/want=${row.want}` : "";
        console.log(`  ${mark} ${row.tag.padEnd(28)} ${row.status}${extra}  ${row.file || ""}`);
      }
      for (const s of r.skipped) console.log(`  · 跳过 ${s.name}：${s.error || `hosts=${(s.hosts || []).join(",")}`}`);
      const bad = r.rows.filter((x) => x.status !== "ok").length;
      console.log(`  合计：${r.rows.length - bad}/${r.rows.length} 可命中，${r.packs} 个包生效于当前宿主`);
      if (bad) process.exitCode = 2;
      return;
    }

    const r = adapters.applyPacks({ dshHome, appDir, hostVersion, dryRun: dry });
    console.log(`适配包 / adapters  （宿主 ${hostVersion || "?"}，${r.packs} 个包，目录 ${r.dir}）`);
    for (const row of r.rows) {
      const mark = row.status === "applied" ? "✓" : row.status === "already" ? "-" : "✗";
      console.log(`  ${mark} ${row.tag.padEnd(28)} ${row.status}  ${row.file || ""}`);
    }
    console.log(`  已打 ${r.applied} · 已是最新 ${r.already} · 未命中 ${r.missed}`);
    if (r.adaptedIds.length) console.log(`  台账已登记：[${r.adaptedIds.sort((a, b) => a - b).join(", ")}]`);
    if (dry) console.log("  - --dry-run：未写入任何文件、未登记台账");
    return;
  }

  const state = await core.gatherState();
  console.log(printStatus(state));
  console.log("");

  if (mode === "--bakfill") {
    // 用官方 asar 补齐缺失的 .dshpurge.bak，让「还原」永远有原文可退
    if (!state.ai_base) {
      console.log("[ERROR] 没定位到插件根，无法补齐备份");
      process.exitCode = 1;
      return;
    }
    const { fillMissingBackups } = await import("../lib/bakfill.js");
    const appDir = pathDirname3(state.ai_base);
    const resourcesDir = pathDirname(appDir);
    const dry = args.includes("--dry-run");
    if (dry) {
      console.log("  - --dry-run 模式：只检查，不写文件");
    }
    const r = fillMissingBackups({ resourcesDir, appDir, files: state.files, dryRun: dry });
    console.log(`  原文来源 ${r.archive || "(未找到)"}`);
    console.log(`  新补 ${r.filled} 个 · 重构 ${r.rebuilt} 个 · 已有 ${r.skipped} 个 · 原文缺失 ${r.missingOriginal} 个`);
    for (const e of r.entries.slice(0, 20)) console.log(`    ✓ ${e}`);
    if (r.entries.length > 20) console.log(`    … 其余 ${r.entries.length - 20} 个省略`);
    for (const e of r.errors) console.log(`    ⚠ ${e}`);
    if (dry) console.log("  - 预演结束，未写入任何文件");
    return;
  }

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      console.log("  fix: 把 DSH_BASE 指到含 dsh-agent-instructions/lib 的 @deepseek-ai 目录");
      process.exit(1);
    }
    const inject = rules.resolveInjectText(state.dsh_home);
    if (!inject.text) {
      console.log("[ERROR] 提示词和规则集都是空的，必须先添加提示词");
      process.exit(1);
    }
    const { hosts, report } = await core.applyPatchesAllHosts(core.ALL_PATCHES, {
      preserveClientBundles: false,
      forApply: true,
    });
    for (const h of hosts) console.log(`  宿主 / host → ${h.aiBase}`);
    for (const r of report) {
      const m =
        r.status === "applied" ? "✓ 已清洗"
        : r.status === "already" ? "- 已是最新"
        : r.status === "missing_file" ? "⚠ 文件缺失"
        : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    const flashHost = hosts[0]?.aiBase || state.ai_base;
    const flash = core.silenceCmdFlash(flashHost);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    if (hosts.length > 1) {
      console.log(`  多宿主 / multi-host: ${hosts.length} 份 @deepseek-ai 已清洗`);
    }
    console.log(inject.source === "rule" ? "  - 使用当前规则集，不改写提示词文件" : "  - 使用已有提示词文件");

    // 适配补丁包：内置表对不上当前宿主原文时，用 patches.d 里按本版重写过的 needle 补上
    try {
      const adapters = await import("../lib/adapters.js");
      const appDir = path.resolve(state.ai_base, "..", "..", "..");
      const hostVersion = adaptedLedger.hostVersionAt(state.ai_base);
      const r = adapters.applyPacks({ dshHome: state.dsh_home, appDir, hostVersion });
      if (r.packs > 0) {
        console.log("  适配包 " + r.packs + " 个：已打 " + r.applied + " · 已是最新 " + r.already + " · 未命中 " + r.missed);
        if (r.adaptedIds.length) console.log("    台账登记 [" + r.adaptedIds.sort((a, b) => a - b).join(", ") + "]");
        for (const row of r.rows.filter((x) => x.status !== "applied" && x.status !== "already")) {
          console.log("    ⚠ " + row.tag + " " + row.status + " " + (row.file || ""));
        }
      }
    } catch (e) {
      console.log("  ⚠ 适配包应用失败：" + String(e && e.message ? e.message : e));
    }

    // 收尾：用官方 asar 补齐缺失/被污染的原文备份，保证「还原」永远有原文可退
    try {
      const bakfill = await import("../lib/bakfill.js");
      const appDir2 = path.resolve(state.ai_base, "..", "..", "..");
      const r2 = bakfill.fillMissingBackups({ resourcesDir: path.dirname(appDir2), appDir: appDir2, files: state.files });
      console.log("  原文备份：新补 " + r2.filled + " · 重构 " + r2.rebuilt + " · 已有 " + r2.skipped);
    } catch (e) {
      console.log("  ⚠ 备份补齐失败：" + String(e && e.message ? e.message : e));
    }

    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else {
      console.log("  ⚠ 未定位 shim 目录，跳过注入");
    }
    console.log("");
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
    if (state.asar_still_sealed) {
      console.log("⚠ app.asar 仍密封：这次补丁只写进解包目录，宿主不会加载。先跑 --doctor 看落地形态。");
    }
  } else if (mode === "--revert") {
    if (state.ai_base || core.enumeratePatchAiBases().length) {
      const { reverted, errors } = await core.revertAllHosts();
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
      if (reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--uninstall") {
    const { uninstallPurge } = await import("../lib/uninstall.js");
    const result = await uninstallPurge();
    if (result.applied) console.log("  已检测到补丁，已还原回原版。");
    else console.log("  未检测到已应用补丁，仍会清除插件文件。");
    if (result.override?.removed) console.log(`  已删除 ${result.override.path}`);
    if (result.stripped?.length) console.log(`  已从 profile 移除: ${result.stripped.join(", ")}`);
    for (const e of result.errors || []) console.log(`  ⚠ ${e}`);
    if (!result.ok) {
      console.log("  卸载中止：还原失败，插件文件未删除。");
      process.exit(1);
    }
    console.log("");
    console.log("卸载完成。请重启 dsh。");
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件：${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件：${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。");
  } else {
    console.log("默认不清洗，使用 --apply 应用清洗。");
  }
}

main().catch((e) => {
  console.error("[dsh-purge] error:", e);
  process.exit(1);
});
