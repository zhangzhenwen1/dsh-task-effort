# dsh-task-effort — 根据任务自动调整模型 effort

DSH 插件：每次 LLM 调用前，根据**当前任务**自动决定模型的推理强度
`reasoningEffort`（DeepSeek 支持 `off` / `high` / `max`），不再全局固定一个档位。

## 工作原理

DSH 的 agent 循环在每次模型调用前会走 `agent/request` waterfall（`dsh-agent-loop`
的 `buildRequest`），插件在瀑布的最外层改写 `reasoningEffort`，因此**最终生效**，
优先级高于模型选择器/设置里的默认 effort。

判定时机：`agent/pre-step`（每步执行前）读取本轮最新用户消息并分类，判定结果
缓存到当轮结束；`agent/request` 时应用到请求配置。中途转向（steer / 追加消息）
会触发重新判定。

## 判定规则（优先级从高到低）

1. **显式标记**：消息里带 `[effort=off|high|max]`（也支持 `【effort:…】`、
   `{effort:…}`、`effort=…`；`low`→off，`medium`→high）→ 直接采用
2. **复杂任务关键词**（`maxKeywords`：重构/架构/分析/refactor/design/debug…）→ `max`
3. **继续类指令**（`continuationKeywords`：继续/接着/next/continue…）→ 沿用上一轮
4. **闲聊**（`offKeywords`，先剥离 `politenessPrefixes` 如“好的/收到”）→ `off`
5. **长指令**（≥ `longThreshold` 字符）→ `max`
6. **过短无信号**（≤ `shortThreshold` 字符）→ 沿用上一轮
7. **默认**（`defaultEffort`）→ `high`

额外机制：

- **轮内出错自动升级**（`escalateOnError`）：本轮工具调用报错后，剩余步骤强制 `max`
- **子代理**（`subagents: "auto"`）：子代理按自己的提示词（委托指令）判定，
  通常较长 → `max`；可设 `"off"` 完全不干预
- **能力收敛**：只会把 effort 设置到目标 provider+model 实际支持的档位
  （查 `ctx.llm.resolveModelInfo` 并缓存），不会把 `max` 强加给不支持推理的模型
  （如 qwen 视觉子代理）
- **变化通知**（`notify`）：effort 相对上一轮变化时，向模型注入一行
  `<system-reminder>` 说明，便于观察与调试

## 安装

这是一个 `dsh.bundle` 包（`package.json` 的 `dsh.bundle` + `dsh.client`）。按 bundle 安装后，它会在「插件」面板的「已安装插件」里出现，可以启停、卸载，并可在行内**可视化配置**。

**方式一：本地目录（推荐，开发/自用）**

「插件 → 添加插件 → 安装第三方插件」填入本目录绝对路径（或由 agent 调 `plugin_manager install_bundle`）：

```text
/home/zhang/文档/DSH/plugins/task-effort
```

**方式二：npm / GitHub 包（发布后可用）**

```sh
dsh plugin --profile web add dsh-task-effort
# 或从 GitHub：dsh plugin --profile web add github:zhangzhenwen1/dsh-task-effort
```

**方式三：裸 patch 引用（仅调试，不推荐）**

在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表写 `file://` 行。裸行不会出现在「已安装插件」里，也无法使用可视化配置表单。

> 插件代码（JS 模块代际）改动需重启 `dsh web` 生效；配置项改动经表单保存后立即生效，无需重启。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `providers` | `["deepseek-official", "deepseek-account"]` | 只调整这些 provider 的请求。0.2 有两个 DeepSeek provider：API Key 的 `deepseek-official` 与账号登录的 `deepseek-account`；**必须包含会话实际使用的那个**，否则插件不生效（表现为模型胶囊档位永不变化、通知却显示已切换） |
| `defaultEffort` | `"high"` | 无信号时的默认档位 |
| `maxKeywords` | 见源码 | 复杂任务关键词（命中→max）；**可在面板表单里编辑** |
| `offKeywords` | 见源码 | 闲聊关键词（命中→off）；**可在面板表单里编辑** |
| `politenessPrefixes` | 见源码 | 判定前剥离的礼貌前缀；**可在面板表单里编辑** |
| `continuationKeywords` | 见源码 | 继续类指令（沿用上一轮）；**可在面板表单里编辑** |
| `longThreshold` | `200` | 消息长度超过即 max |
| `shortThreshold` | `4` | 短于此且无信号则沿用上一轮 |
| `escalateOnError` | `true` | 轮内工具报错后升级到 max |
| `costAware` | `true` | 时段感知：高峰时段（北京时间工作日 09-12/14-18）价格更高，自动压档省钱 |
| `peakCap` | `"high"` | 高峰时段的 effort 上限（`max` 被压到该档；可设 `"low"`/`"off"`，填 `"none"` 关闭限档） |
| `periodOverride` | `null` | 测试用：强制时段 `"peak"` / `"offpeak"`（演示限档效果） |
| `subagents` | `"auto"` | 子代理策略：`auto` / `off` |
| `notify` | `true` | effort 变化时注入说明（含时段与距下一时段倒计时） |
| `log` | `true` | 打印判定日志（`task-effort: agent=… effort=… reason=…`） |

## 可视化配置

安装为 bundle 后：

1. 打开「插件」面板 → **已安装插件** → `dsh-task-effort`；
2. 在「包含的组件」里点 `dsh-task-effort` 行的**配置**按钮；
3. 表单分「总开关 / 判定 / 成本与计价时段 / 其他」四组，可保存、放弃、逐字段恢复默认：
   - 总开关、生效 provider、默认档位、长短消息阈值、出错升级；
   - **触发档位的关键词表**（复杂任务 → max、闲聊 → off、礼貌前缀、继续类 → 沿用上一轮）：
     多行文本编辑，每行一个或用逗号分隔；清空 = 恢复内置默认；
   - 高峰限档（`peakCap` 填 `none` 关闭）、强制时段（测试用）；
   - 子代理策略、档位说明注入、判定日志；
   - 关键词表等高级字段不进表单，仍用 patch 配置。
4. 保存写入 profile 的 `cordis.patch.yml`，**下一次请求即生效**（无需重启）。

## 手动控制

- **GUI 模型选择器**：你在界面里手动选过档位后，插件检测到选择偏离会自动**尊重手动选择**并暂停自动判定（界面显示的档位 = 实际请求档位，完全一致）。
- **恢复自动模式**：手动选择记录在运行进程内（Web 的 `selectModel` 状态），**新建会话**或**重启 dsh web** 后自动恢复。注：DeepSeek 模型有默认档位（如 high），所以选择器菜单里没有 "Provider default" 选项。
- **单条消息指定档位**：`[effort=off]`、`[effort=max]` 等（优先级最高，仅当轮生效；手动模式下同样生效）
- **临时关闭**：把配置里 `enabled` 改为 `false`，或移除 patch 条目

## 界面可见性

- **常驻档位徽标（推荐查看方式）**：输入框下方（composer dock）在「活动/用量」小药丸旁显示一个
  彩色档位徽标（● OFF / ● LOW / ● HIGH / ● MAX，灰/黄/蓝/红），档位切换时脉冲一次。
  它读取会话的 `modelSelection` 投影（由 `request/header` 驱动），显示的就是**实际生效档位**。
- 每次 effort 切换，会话里会注入一行 `<system-reminder>` 说明（判定原因 + 档位 + 当前时段 + 距下一时段倒计时）；
  **仅当当前 provider 在 `providers` 白名单内**时才注入（否则插件不会改写请求，通知会与实际档位不符）。
  注意：DSH 0.2 的 Chat 视图会把「普通上下文注入行」从可见聊天行里过滤掉
  （`isVisibleChatNode` 只保留带工具增删的 context），所以这条通知在 Chat 里**不再显示**，
  可在「轨迹（Trajectory）」视图里看到原始事件。
- 输入框旁的模型胶囊也会显示 `模型名 · 档位`：0.2 起胶囊读取同一个 `modelSelection` 投影，
  窄窗口下可能收缩为纯图标（此时文字仍存在但被 CSS 隐藏，以常驻徽标为准）。
- 会话轨迹（request/header 事件）记录每次实际档位变化，可用来核对显示。

## 看不到档位变化时怎么查

1. **看常驻徽标**：输入框下方是否有彩色档位徽标；没有说明客户端半未加载或 `modelSelection` 投影缺失。
2. **核对 provider**：`request/header` 里的 `config.provider` 是否在 `providers` 白名单里。
   0.2 升级到账号登录后 provider 会变成 `deepseek-account`，旧配置只写了 `deepseek-official`，
   插件就完全不生效。
3. **核对请求头**：看 `request/header` 的 `config.reasoningEffort` 是否随任务变化；不变说明请求未被改写。
4. **是否被手动选择固定**：在 GUI 里手动选过档位会进入手动模式（见上节），插件会尊重手动选择；
   新建会话或重启 `dsh web` 恢复自动判定。

## 已知限制

- 判定是启发式的，误判时用 `[effort=…]` 标记兜底，并欢迎调整关键词表。
