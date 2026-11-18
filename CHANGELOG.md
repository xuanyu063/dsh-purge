# Changelog

## 1.2.0

### 新增：适配补丁包（`--adapters`）

- 新增 `lib/adapters.js`：按宿主版本加载 `$DSH_HOME/dsh-purge/patches.d/*.json`，把「按新版源码重写过的 needle」作为外部数据应用，替代「内置表整片 skipped」。
- 强校验：`expect` 命中次数必须相等才落盘；`marker` 幂等；`tolerateMissing` 支持删除型 edit。
- `--adapters --verify`：拿**官方 asar 里的原文**逐条对 needle，输出 `ok / no_match / count_mismatch`。
- `--apply` 与启动自愈自动串上「内置补丁 → 适配包 → 备份校正」。

### 新增：本地适配台账（`--adapt`）

- `lib/adapted.js` + `$DSH_HOME/dsh-purge/adapted.json`：显式登记「本地已按新版源码改好」的编号。
- `patchStatus` 对这些编号返回 `adapted`，面板与门禁按已应用对待，不再误报 `skipped`。
- 台账带宿主版本戳，升级后自动作废。

### 新增：落地形态闭环（`--landing` / `--switch` / `--restore-sealed`）

- `lib/landing.js`：把「文件已改」与「进程在用改后的代码」拆开，给出 `sealed / unpacked / loaded` 结论。
- `--switch`：校验解包目录完整、确有补丁 marker、asar 未被占用后，把 `app.asar` 改名成 `.bak`。
- `--restore-sealed`：把备份改回 `app.asar`。

### 新增：`--doctor` 体检

- 12 项只读检查，`--json` 可机读，`fail` 时退出码 2。详见 [docs/DOCTOR.md](docs/DOCTOR.md)。

### 新增：`--bakfill` 原文备份校正

- `lib/asar-read.js`：零依赖只读 asar 解析，按路径取回官方原文。
- `lib/bakfill.js`：以「备份必须与官方 asar 逐字节一致」为唯一判据，修复「bak 缺失」与「bak 内容不对」两种情况——后者会让「还原」退回半 patch 状态。

### 修复

- `isTextShim`：`hostFs` 在 CLI shim 路径上抛异常被当成二进制，导致 shim 注入被永久跳过；改用 `node:fs` 探测。
- `gatherState.shim_dir`：桌面版回落到 `findDesktopShimDir()`，面板不再误报「shim 目录未定位」。
- CLI shim 的相对路径少一级（指向 `resources/app/app.asar`），切包后彻底失效；新版改为「从自身目录往上探 0..5 级」，`resources` 与 `resources\app` 两种布局共用一份。

### 文档

- 新增 `docs/ADAPTERS.md`（适配包格式与为新版本写包的流程）、`docs/DOCTOR.md`。
- README 增加 6.4 / 6.5 两节。

---

上游版本历史见 [release-notes.md](release-notes.md)。
