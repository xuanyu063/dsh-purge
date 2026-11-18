# 适配包示例

`0.2.2-rc.1.json` 是宿主 **0.2.2-rc.1** 的真实适配包，可以直接当模板：

```sh
# 复制到宿主，按版本自动加载
mkdir -p "$DSH_HOME/dsh-purge/patches.d"
cp examples/patches.d/0.2.2-rc.1.json "$DSH_HOME/dsh-purge/patches.d/"

dsh-purge --adapters --verify   # 应为「15/15 可命中，1 个包生效于当前宿主」
dsh-purge --adapters            # 应用 + 登记 adapted 台账
dsh-purge --doctor              # pending 应为 0
```

它覆盖 10 个补丁编号（15 条 edit）：

| 编号 | 这版为什么失配 | 适配手段 |
|---|---|---|
| #14 | `approval.approver.request({...})` 参数里多了 `displayReason`，且没有审批服务时会 throw | 加 `approval?.approver`/`agent` 判空，缺失则直接 `"allowed-once"` |
| #17 | `editIntent` 被抽成公共 `requirePresent(...)` | 整个方法体改为 `return void 0` |
| #32 / #53 | Web 面提示词文案改写（`… Web GUI whose URL the runtime context names`） | 逐条替换 new + legacy 两种前缀 |
| #54 | 文案挪到 `dsh-deliverable-file-references` 包 | 删除禁令句 + 给文档注释打 marker（删除型 edit 用 `tolerateMissing`） |
| #60 | run_code 文本迁到 `dsh-tool-executor-ptc` | 4 条文案逐条中性化 |
| #62 | 审批判定挪进 `dsh-tools/lib/pipeline.js` 的 `serviceAsk()` | 两处 fail-open（无服务 / 通道不可用） |
| #67 | 同样的两行判断，缩进从 4 tab 变 5 tab | 按新缩进重写 |
| #74 | `assemble` 调用从位置参数改成对象参数 | 在调用前插入 `prepareAssemble` 钩子并改用其返回值 |
| #82 | 桌面壳入口 import 顺序变化 | 在 import 之后追加 `DSH_PROFILE` 兜底 |

写自己那份时注意：**`find` 必须是「未打补丁的干净文件」里的原文**——`--adapters --verify` 用的是官方 asar 里的原文，所以它能帮你确认这一点。
