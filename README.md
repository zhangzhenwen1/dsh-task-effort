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

**方式一：npm / GitHub 包（推荐）**

```sh
dsh plugin --profile web add dsh-task-effort
# 或从 GitHub：dsh plugin --profile web add github:zhangzhenwen1/dsh-task-effort
```

安装后重启 `dsh web`。可通过 profile 的 `cordis.patch.yml` 覆盖配置。

**方式二：本地 patch（开发用）**

在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表追加：

```yaml
    - id: task-effort
      name: 'file:///home/zhang/文档/DSH/plugins/task-effort/index.js'
      config:
        providers:
          - deepseek-official
        defaultEffort: high
```

保存后 user patch 层热更新；若未生效，重启 `dsh web`。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `providers` | `["deepseek-official"]` | 只调整这些 provider 的请求 |
| `defaultEffort` | `"high"` | 无信号时的默认档位 |
| `maxKeywords` | 见源码 | 复杂任务关键词（命中→max） |
| `offKeywords` | 见源码 | 闲聊关键词（命中→off） |
| `politenessPrefixes` | 见源码 | 判定前剥离的礼貌前缀 |
| `continuationKeywords` | 见源码 | 继续类指令（沿用上一轮） |
| `longThreshold` | `200` | 消息长度超过即 max |
| `shortThreshold` | `4` | 短于此且无信号则沿用上一轮 |
| `escalateOnError` | `true` | 轮内工具报错后升级到 max |
| `costAware` | `true` | 时段感知：高峰时段（北京时间工作日 09-12/14-18）价格更高，自动压档省钱 |
| `peakCap` | `"high"` | 高峰时段的 effort 上限（`max` 被压到该档；可设 `"low"`/`"off"`，`null` 关闭限档） |
| `periodOverride` | `null` | 测试用：强制时段 `"peak"` / `"offpeak"`（演示限档效果） |
| `subagents` | `"auto"` | 子代理策略：`auto` / `off` |
| `notify` | `true` | effort 变化时注入说明（含时段与距下一时段倒计时） |
| `log` | `true` | 打印判定日志（`task-effort: agent=… effort=… reason=…`） |

## 手动控制

- **GUI 模型选择器**：你在界面里手动选过档位后，插件检测到选择偏离会自动**尊重手动选择**并暂停自动判定（界面显示的档位 = 实际请求档位，完全一致）。
- **恢复自动模式**：手动选择记录在运行进程内（Web 的 `selectModel` 状态），**新建会话**或**重启 dsh web** 后自动恢复。注：DeepSeek 模型有默认档位（如 high），所以选择器菜单里没有 "Provider default" 选项。
- **单条消息指定档位**：`[effort=off]`、`[effort=max]` 等（优先级最高，仅当轮生效；手动模式下同样生效）
- **临时关闭**：把配置里 `enabled` 改为 `false`，或移除 patch 条目

## 界面可见性

- 每次 effort 切换，会话里会注入一行 `<system-reminder>` 说明（判定原因 + 档位 + 当前时段 + 距下一时段倒计时）
- 插件应用档位后会自动通知界面刷新（`llm/adapters-updated` → 模型选择器重新拉取），
  输入框旁的模型胶囊会显示**实际生效的档位**（Off / Low / High / Max）
- 会话轨迹（request/header 事件）记录每次实际档位变化

## 已知限制

- 判定是启发式的，误判时用 `[effort=…]` 标记兜底，并欢迎调整关键词表。
