# `--doctor` 体检

```sh
dsh-purge --doctor          # 人读
dsh-purge --doctor --json   # 机读，退出码 2 表示有 fail
```

体检回答的是「补丁到底有没有真的在跑」，不是「补丁表怎么说」——这两件事在真实机器上经常不一致。

| # | 项 | 判什么 | 典型结论与处置 |
|---|---|---|---|
| 1 | 归档形态 | `app.asar` 是否还在 | 在 = Electron 优先读 asar，解包目录白打 → `--switch` |
| 2 | 落地形态 | 综合结论 `sealed` / `unpacked` / `loaded` | `sealed` 补丁不加载；`unpacked` 说明解包了但进程没从它起 |
| 3 | 解包目录 | `resources/app` 是否存在、文件数是否正常 | 文件数异常偏少 = 解包不完整，重新解包 |
| 4 | 宿主加载源 | 进程命令行读的是 asar 还是 `resources/app` | 与第 2 项交叉验证，避免误判 |
| 5 | 补丁时效 | 进程启动时间 vs 最新补丁文件 mtime | 进程更早 = 改完没重启 |
| 6 | 原文备份 | 带 marker 的文件有多少留了 `.dshpurge.bak` | 覆盖不足 = 「还原」会断 → `--bakfill` |
| 7 | shim 三件套 | `dsh.cmd` / `dsh.ps1` / `dsh` 能否解析到宿主 | 切包后 shim 还指着旧 `app.asar` 就会失效 |
| 8 | 版本对照 | 插件版本 / 宿主版本 / `dshTarget` | 大版本跨过去 → 需要新的适配包 |
| 9 | 适配台账 | 本地适配编号是否仍属当前宿主版本 | 版本一变台账自动作废，需要重新适配 |
| 10 | 注入文件 | `prompt-inject.md` 存在且非空、override 状态 | 过小/缺失 = 提示词层不会注入 |
| 11 | settle 冷却 | 最近是否反复重打重启 | 短时间内反复 = 可能在打环，看日志或删 `settle-restart.guard` 观察一轮 |
| 12 | 补丁总账 | `applied` / `adapted` / `pending` / `skipped` | `pending > 0` 才是真有活没干 |

退出码：`0` 全部通过（允许 info）；`2` 存在 `fail`。

## 为什么单独做这个

补丁体系最容易骗人的地方，是「文件已经改了」和「进程已经在用改了之后的代码」被混为一谈。`patchStatus` 能回答前者，回答不了后者——而 `app.asar` 存在、进程仍从 asar 启动时，面板会显示 62/66 applied，实际一条都没生效。体检把这两层拆开，任何一层不对都能立刻看到。
