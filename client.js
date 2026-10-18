// dsh-task-effort — 客户端半：在「插件 → dsh-task-effort → 组件配置」里提供可视化配置。
//
// 与 qmd-autosearch 相同的机制：表单模型来自宿主插件面板的 @deepseek-ai/dsh-client-ui-primitives
// （SettingsFormModel / SettingsForm / SettingsValueField），读写的命名空间
// "dsh-task-effort" 就是本插件在 profile 里的行 id；保存经 settings/config-editor
// 写回 profile 的 cordis.patch.yml，volatile 字段即时生效（无需重启）。
window.__ModuleLoader__.load({
	id: "dsh-task-effort",
	factory(require) {
		const React = require("react");
		const h = React.createElement;
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const {
			SettingsForm,
			SettingsFormModel,
			SettingsValueField,
			settingsNumberField
		} = primitives;

		/** 本插件在插件面板与设置命名空间里的行 id。 */
		const ENTRY_ID = "dsh-task-effort";
		/** 行配置槽的键：`<bundle 包名>#<行 id>`。 */
		const ROW_KEY = "dsh-task-effort#dsh-task-effort";
		/** 本客户端贡献的文案命名空间。 */
		const NS = "taskEffort";

		const EFFORT_VALUES = ["off", "low", "high", "max"];

		const en = {
			summary: "Configure effort auto-tuning, peak pricing and notices",
			note: "Changes take effect immediately (written into the profile patch). Use [effort=off|low|high|max] in a message to override one turn.",
			enabled: "Enabled",
			enabledHint: "Master switch. When off, requests pass through unchanged.",
			providers: "Providers",
			providersHint: "Comma-separated provider ids this plugin may adjust, e.g. deepseek-official, deepseek-account. The session's actual provider must be included or the plugin makes no changes.",
			judgeSection: "Decision",
			defaultEffort: "Default effort",
			defaultEffortHint: "Used when a message carries no signal: off / low / high / max (medium and normal mean high).",
			longThreshold: "Long-message threshold (chars)",
			longThresholdHint: "Messages at least this long are treated as complex (max).",
			shortThreshold: "Short-message threshold (chars)",
			shortThresholdHint: "Shorter messages without signal keep the previous effort.",
			keywordSection: "Trigger keywords",
			maxKeywords: "Complex keywords (→ max)",
			maxKeywordsHint: "One per line or comma-separated. Any hit raises the effort to max.",
			offKeywords: "Casual keywords (→ off)",
			offKeywordsHint: "Any hit turns deep thinking off, unless a complexity keyword also matches.",
			politenessPrefixes: "Politeness prefixes",
			politenessPrefixesHint: "Stripped before judging, so \"好的，帮我重构\" is still complex.",
			continuationKeywords: "Continuation keywords",
			continuationKeywordsHint: "A hit keeps the previous turn's effort (continue / next / 继续 …).",
			escalateOnError: "Escalate on tool error",
			escalateOnErrorHint: "After a failed tool call in a turn, remaining steps use max.",
			costSection: "Cost and pricing period",
			costAware: "Peak-period capping",
			costAwareHint: "Cap effort during Beijing weekday peak hours (09-12 / 14-18).",
			peakCap: "Peak cap",
			peakCapHint: "Effort cap while capping applies: off / low / high; none disables the cap.",
			periodOverride: "Period override",
			periodOverrideHint: "Testing only: peak / offpeak force a pricing period; empty follows the real clock.",
			otherSection: "Other",
			subagents: "Subagents",
			subagentsHint: "auto adjusts a subagent by its own prompt; off leaves subagents alone.",
			notify: "Inject effort notice",
			notifyHint: "Write a system-reminder line when the effort changes.",
			log: "Log decisions",
			logHint: "Print one line per decision to the host log.",
			overridden: "Overridden",
			reset: "Reset",
			invalidText: "Unsupported value.",
			unavailable: "Configuration is unavailable",
			readOnly: "Settings are read-only in this deployment.",
			saveFailed: "The deployment rejected these values; they were left for you to fix.",
			save: "Save",
			saving: "Saving…"
		};

		const zh = {
			summary: "配置 effort 自动调度、高峰限档与提示注入",
			note: "保存后立即生效（写入 profile 的 patch 文件）。单轮可用消息内的 [effort=off|low|high|max] 覆盖。",
			enabled: "总开关",
			enabledHint: "关闭后请求原样放行，不做任何调整。",
			providers: "生效 provider",
			providersHint: "逗号分隔的 provider id，例如 deepseek-official、deepseek-account。必须包含会话实际使用的 provider，否则插件不生效。",
			judgeSection: "判定",
			defaultEffort: "默认档位",
			defaultEffortHint: "消息无明确信号时使用：off / low / high / max（medium、normal 视为 high）。",
			longThreshold: "长消息阈值（字符）",
			longThresholdHint: "消息不短于该长度视为复杂任务（max）。",
			shortThreshold: "短消息阈值（字符）",
			shortThresholdHint: "无信号的过短消息沿用上一轮档位。",
			keywordSection: "触发关键词",
			maxKeywords: "复杂任务关键词（→ max）",
			maxKeywordsHint: "每行一个或用逗号分隔；命中任意一个即升到 max。",
			offKeywords: "闲聊关键词（→ off）",
			offKeywordsHint: "命中任意一个即关闭深度思考（同时命中复杂关键词时以后者为准）。",
			politenessPrefixes: "礼貌前缀",
			politenessPrefixesHint: "判定前剥离，避免「好的，帮我重构」被误判为闲聊。",
			continuationKeywords: "继续类关键词",
			continuationKeywordsHint: "命中则沿用上一轮档位（继续 / 接着 / next …）。",
			escalateOnError: "出错自动升级",
			escalateOnErrorHint: "本轮工具调用报错后，剩余步骤升级为 max。",
			costSection: "成本与计价时段",
			costAware: "高峰限档",
			costAwareHint: "北京时间工作日高峰时段（09-12 / 14-18）自动压低 effort 省钱。",
			peakCap: "高峰上限",
			peakCapHint: "限档时的 effort 上限：off / low / high；填 none 关闭限档。",
			periodOverride: "强制时段",
			periodOverrideHint: "仅测试用：peak / offpeak 强制时段；留空按真实时钟。",
			otherSection: "其他",
			subagents: "子代理策略",
			subagentsHint: "auto 按子代理自己的提示词判定；off 完全不干预子代理。",
			notify: "注入档位说明",
			notifyHint: "effort 变化时向模型注入一行 system-reminder 说明。",
			log: "输出判定日志",
			logHint: "每次判定在宿主日志打印一行。",
			overridden: "已覆盖",
			reset: "恢复默认",
			invalidText: "不支持的值。",
			unavailable: "配置暂不可用",
			readOnly: "本部署的设置为只读。",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			save: "保存",
			saving: "保存中…"
		};

		/** 逗号 / 顿号 / 换行分隔的字符串列表。 */
		const listField = (field) => ({
			field,
			format: (value) => (Array.isArray(value) ? value.join(", ") : ""),
			parse: (text) => {
				const trimmed = text.trim();
				if (trimmed === "") return { kind: "clear" };
				const items = trimmed
					.split(/[,，\n]/)
					.map((item) => item.trim())
					.filter((item) => item !== "");
				return items.length > 0 ? { kind: "set", value: items } : { kind: "clear" };
			}
		});

		/** 布尔字段：表单里用勾选框，模型侧值仍是 true/false。 */
		const boolField = (field) => ({
			field,
			format: (value) => (value === true ? "true" : "false"),
			parse: (text) => {
				const lowered = text.trim().toLowerCase();
				if (lowered === "true") return { kind: "set", value: true };
				if (lowered === "false") return { kind: "set", value: false };
				return undefined;
			}
		});

		/** effort 档位字段（允许 medium/normal 归一化成 high）。 */
		const effortField = (field, { allowNone = false } = {}) => ({
			field,
			format: (value) => (value === null || value === void 0 ? "" : String(value)),
			parse: (text) => {
				const trimmed = text.trim().toLowerCase();
				if (trimmed === "") return { kind: "clear" };
				if (trimmed === "medium" || trimmed === "normal") return { kind: "set", value: "high" };
				if (allowNone && trimmed === "none") return { kind: "set", value: "none" };
				return EFFORT_VALUES.includes(trimmed) ? { kind: "set", value: trimmed } : undefined;
			}
		});

		/** 计价时段字段（peak / offpeak / 空 = 真实时钟）。 */
		const periodField = (field) => ({
			field,
			format: (value) => (value === null || value === void 0 ? "" : String(value)),
			parse: (text) => {
				const trimmed = text.trim().toLowerCase();
				if (trimmed === "") return { kind: "clear" };
				return trimmed === "peak" || trimmed === "offpeak" ? { kind: "set", value: trimmed } : undefined;
			}
		});

		/** 子代理策略字段（auto / off）。 */
		const subagentField = (field) => ({
			field,
			format: (value) => (value === null || value === void 0 ? "" : String(value)),
			parse: (text) => {
				const trimmed = text.trim().toLowerCase();
				if (trimmed === "") return { kind: "clear" };
				return trimmed === "auto" || trimmed === "off" ? { kind: "set", value: trimmed } : undefined;
			}
		});

		/** 关键词表：多行文本 ↔ 字符串数组（换行 / 逗号 / 顿号分隔；清空 = 恢复默认）。 */
		const keywordListField = (field) => ({
			field,
			format: (value) => (Array.isArray(value) ? value.join("\n") : ""),
			parse: (text) => {
				const items = text
					.split(/[\n,，、]/)
					.map((item) => item.trim())
					.filter((item) => item !== "");
				return items.length > 0 ? { kind: "set", value: items } : { kind: "clear" };
			}
		});

		const FIELD_SPECS = [
			boolField("enabled"),
			listField("providers"),
			effortField("defaultEffort"),
			settingsNumberField("longThreshold"),
			settingsNumberField("shortThreshold"),
			keywordListField("maxKeywords"),
			keywordListField("offKeywords"),
			keywordListField("politenessPrefixes"),
			keywordListField("continuationKeywords"),
			boolField("escalateOnError"),
			boolField("costAware"),
			effortField("peakCap", { allowNone: true }),
			periodField("periodOverride"),
			subagentField("subagents"),
			boolField("notify"),
			boolField("log")
		];

		/** 勾选框字段：视觉上区分开文本/数字字段。 */
		function BoolField(props) {
			const checked = props.text === "true";
			return h(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: "4px", padding: "6px 0" } },
				[
					h(
						"div",
						{ key: "row", style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
						[
							h("input", {
								key: "checkbox",
								id: props.id,
								type: "checkbox",
								checked,
								disabled: props.disabled,
								onChange: (event) => props.onEdit(event.target.checked ? "true" : "false")
							}),
							h("label", { key: "label", htmlFor: props.id }, props.label),
							props.overridden
								? h(
									"span",
									{ key: "overridden", style: { display: "inline-flex", gap: "6px", alignItems: "center", opacity: 0.75 } },
									[
										h("span", { key: "badge" }, props.overriddenLabel),
										h(
											"button",
											{ key: "reset", type: "button", disabled: props.disabled, onClick: props.onReset },
											props.resetLabel
										)
									]
								)
								: null
						]
					),
					props.hint
						? h("p", { key: "hint", style: { margin: 0, opacity: 0.7, fontSize: "12px" } }, props.hint)
						: null
				]
			);
		}

		/** 多行关键词表字段：textarea + 覆盖标记 / 恢复默认。 */
		function ListArea(props) {
			return h(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: "4px", padding: "6px 0" } },
				[
					h(
						"div",
						{ key: "head", style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
						[
							h("label", { key: "label", htmlFor: props.id }, props.label),
							props.overridden
								? h(
									"span",
									{ key: "overridden", style: { display: "inline-flex", gap: "6px", alignItems: "center", opacity: 0.75 } },
									[
										h("span", { key: "badge" }, props.overriddenLabel),
										h(
											"button",
											{ key: "reset", type: "button", disabled: props.disabled, onClick: props.onReset },
											props.resetLabel
										)
									]
								)
								: null
						]
					),
					h("textarea", {
						key: "input",
						id: props.id,
						value: props.text,
						rows: 4,
						disabled: props.disabled,
						onChange: (event) => props.onEdit(event.target.value),
						style: {
							width: "100%",
							minHeight: "88px",
							padding: "8px 10px",
							font: "inherit",
							lineHeight: 1.5,
							color: "inherit",
							background: "transparent",
							border: "1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.45))",
							borderRadius: "6px",
							resize: "vertical",
							boxSizing: "border-box"
						}
					}),
					props.hint
						? h("p", { key: "hint", style: { margin: 0, opacity: 0.7, fontSize: "12px" } }, props.hint)
						: null
				]
			);
		}

		/** 行配置页：`summary` 渲染一行摘要，`page` 渲染可保存的表单。 */
		function TaskEffortSettings(props) {
			const { t } = props;
			const state = props.useTaskEffortForm((value) => value);
			const uid = React.useId();
			if (props.view === "summary") return h("span", null, t("summary"));
			const disabled = !state.writable || state.saving;
			const textField = (name, label, hint) =>
				h(SettingsValueField, {
					key: name,
					id: `${uid}-${name}`,
					label,
					hint,
					...state[name],
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					invalidLabel: t("invalidText"),
					disabled,
					onEdit: (text) => props.edit(name, text),
					onReset: () => props.resetField(name)
				});
			const toggleField = (name, label, hint) =>
				h(BoolField, {
					key: name,
					id: `${uid}-${name}`,
					label,
					hint,
					text: state[name]?.text,
					overridden: state[name]?.overridden,
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					disabled,
					onEdit: (text) => props.edit(name, text),
					onReset: () => props.resetField(name)
				});
			const areaField = (name, label, hint) =>
				h(ListArea, {
					key: name,
					id: `${uid}-${name}`,
					label,
					hint,
					text: state[name]?.text,
					overridden: state[name]?.overridden,
					invalid: state[name]?.invalid,
					overriddenLabel: t("overridden"),
					resetLabel: t("reset"),
					invalidLabel: t("invalidText"),
					disabled,
					onEdit: (text) => props.edit(name, text),
					onReset: () => props.resetField(name)
				});
			return h(
				SettingsForm,
				{
					labels: {
						unavailable: t("unavailable"),
						readOnly: t("readOnly"),
						saveFailed: t("saveFailed"),
						save: t("save"),
						saving: t("saving")
					},
					state,
					onSave: props.save,
					onDiscard: props.discard
				},
				[
					h("p", { key: "note" }, t("note")),
					h("h3", { key: "rootTitle" }, t("enabled")),
					toggleField("enabled", t("enabled"), t("enabledHint")),
					textField("providers", t("providers"), t("providersHint")),
					h("h3", { key: "judgeTitle" }, t("judgeSection")),
					textField("defaultEffort", t("defaultEffort"), t("defaultEffortHint")),
					textField("longThreshold", t("longThreshold"), t("longThresholdHint")),
					textField("shortThreshold", t("shortThreshold"), t("shortThresholdHint")),
					toggleField("escalateOnError", t("escalateOnError"), t("escalateOnErrorHint")),
					h("h3", { key: "keywordTitle" }, t("keywordSection")),
					areaField("maxKeywords", t("maxKeywords"), t("maxKeywordsHint")),
					areaField("offKeywords", t("offKeywords"), t("offKeywordsHint")),
					areaField("politenessPrefixes", t("politenessPrefixes"), t("politenessPrefixesHint")),
					areaField("continuationKeywords", t("continuationKeywords"), t("continuationKeywordsHint")),
					h("h3", { key: "costTitle" }, t("costSection")),
					toggleField("costAware", t("costAware"), t("costAwareHint")),
					textField("peakCap", t("peakCap"), t("peakCapHint")),
					textField("periodOverride", t("periodOverride"), t("periodOverrideHint")),
					h("h3", { key: "otherTitle" }, t("otherSection")),
					textField("subagents", t("subagents"), t("subagentsHint")),
					toggleField("notify", t("notify"), t("notifyHint")),
					toggleField("log", t("log"), t("logHint"))
				]
			);
		}

		// ── 常驻档位徽标 ────────────────────────────────────────────────
		// DSH 0.2 的 Chat 视图会过滤掉「普通上下文注入行」（isVisibleChatNode 只保留
		// 带工具变更的 context），插件注入的档位 notice 因此不再显示在聊天里。这里用
		// 输入框下方的常驻徽标把实际生效档位显性化，档位切换时脉冲一次。
		const BADGES = {
			off: { color: "#9ca3af", label: "OFF" },
			low: { color: "#eab308", label: "LOW" },
			high: { color: "#3b82f6", label: "HIGH" },
			max: { color: "#ef4444", label: "MAX" }
		};
		const BADGE_STYLE_ID = "task-effort-badge-style";
		const BADGE_CSS = [
			".task-effort-badge{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-secondary,inherit);font-size:11px;font-weight:600;line-height:1;letter-spacing:.02em;user-select:none;animation:task-effort-badge-pulse .55s ease-out}",
			".task-effort-badge-dot{width:7px;height:7px;border-radius:50%;flex:none}",
			"@keyframes task-effort-badge-pulse{0%{transform:scale(1)}35%{transform:scale(1.22)}100%{transform:scale(1)}}"
		].join("\n");

		function ensureBadgeStyle() {
			if (typeof document === "undefined" || document.getElementById(BADGE_STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = BADGE_STYLE_ID;
			style.setAttribute("data-plugin", "dsh-task-effort");
			style.textContent = BADGE_CSS;
			document.head.append(style);
		}

		/** 常驻档位徽标：跟随 modelSelection 投影里的实际档位，切换时脉冲一次。 */
		function EffortBadge(props) {
			try {
				if (typeof props.useProjection !== "function") return null;
				const selection = props.useProjection("modelSelection");
				const effort = selection?.next?.reasoningEffort ?? selection?.lastUsed?.reasoningEffort;
				const badge = effort === null || effort === void 0 ? void 0 : BADGES[effort];
				if (badge === void 0) return null;
				return h("span", {
					key: effort,
					className: "task-effort-badge",
					"data-task-effort-badge": effort,
					title: `task-effort: reasoningEffort=${effort}`,
					style: { alignSelf: "center" }
				}, [
					h("span", { key: "dot", className: "task-effort-badge-dot", style: { background: badge.color } }),
					h("span", { key: "label" }, badge.label)
				]);
			} catch (error) {
				console.warn("[task-effort] 档位徽标渲染失败：", error);
				return null;
			}
		}

		return {
			inject: ["slots", "locale", "configForms"],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { en, zh }));
				const scope = ctx.configForms.get(ENTRY_ID);
				const model = new SettingsFormModel(scope, FIELD_SPECS);
				const state = model.bind(() => ({
					...model.shell(),
					enabled: model.field("enabled"),
					providers: model.field("providers"),
					defaultEffort: model.field("defaultEffort"),
					longThreshold: model.field("longThreshold"),
					shortThreshold: model.field("shortThreshold"),
					maxKeywords: model.field("maxKeywords"),
					offKeywords: model.field("offKeywords"),
					politenessPrefixes: model.field("politenessPrefixes"),
					continuationKeywords: model.field("continuationKeywords"),
					escalateOnError: model.field("escalateOnError"),
					costAware: model.field("costAware"),
					peakCap: model.field("peakCap"),
					periodOverride: model.field("periodOverride"),
					subagents: model.field("subagents"),
					notify: model.field("notify"),
					log: model.field("log")
				}));
				ctx.effect(() => () => model.dispose());
				ctx.slots.inject("plugins.row.config", () =>
					ctx.slots.register(
						{
							name: "plugins.row.config",
							key: ROW_KEY,
							locale: NS,
							inject: () => ({ hooks: { taskEffortForm: state }, ...model.actions() })
						},
						TaskEffortSettings
					)
				);
				// 活体信号：不渲染内容，让 Slots 检查可以确认客户端模块已装载。
				ctx.slots.inject("shell.overlay", () =>
					ctx.slots.register(
						{ name: "shell.overlay", id: "task-effort.presence", order: 912 },
						() => null
					)
				);
				// 常驻档位徽标：0.2 Chat 视图不再显示普通上下文注入行，档位变化靠它可见。
				try {
					ensureBadgeStyle();
					ctx.slots.inject("conversation.composer.dock", () =>
						ctx.slots.register(
							{ name: "conversation.composer.dock", id: "task-effort.badge", order: 2 },
							EffortBadge
						)
					);
				} catch (error) {
					console.warn("[task-effort] 档位徽标注册失败：", error);
				}
			}
		};
	}
});
