// task-effort — 根据任务自动调整模型 reasoning effort 的插件
//
// 原理：DSH 每次 LLM 调用前都会走 `agent/request` waterfall（见
// dsh-agent-loop 的 buildRequest），插件可以在其中改写 `reasoningEffort`
//（DeepSeek 支持 off / low / high / max）。插件在 `agent/pre-step` 时读取
// 本轮最新用户消息，用启发式规则判定任务难度，把决定存起来，随后在
// `agent/request` 中应用到该步的请求配置上。
//
// 特性：
// - 每轮（每个新用户消息）重新判定：简单闲聊 → off，普通任务 → high，
//   复杂任务 → max；长消息与命中关键词 → max
// - 消息内显式标记 [effort=off|low|high|max] 可覆盖任何判定
// - 轮内出错自动升级：本轮工具调用报错后，后续步骤强制 max
// - 时段感知（成本感知）：高峰时段（北京时间工作日 09-12/14-18）自动把
//   effort 压到 peakCap 上限省钱，通知含距下一时段倒计时
// - 子代理默认同样生效（代理提示词通常较长 → max）；可配置关闭
// - 只影响配置的 provider 白名单（默认 deepseek-official），且会按模型
//   实际支持的 effort 列表收敛，不会把不支持的 effort 强加给其他模型
// - GUI 手动选择档位后插件自动尊重（手动优先），重启/新会话恢复自动
import { appendFileSync } from "node:fs";
import { DEFAULTS, classify } from "./lib/classify.js";
import { normalizeEffort, EFFORTS } from "./lib/effort.js";
import { pricingPeriod, applyPeakCap, nextPeriodMinutes } from "./lib/period.js";
import { buildNotice } from "./lib/notice.js";
import { latestUserMessage, turnHasErrors } from "./lib/session.js";

export const name = "task-effort";

// 保持对旧入口的导出兼容（test.js / 外部工具可直接从 index.js import）
export { DEFAULTS, classify, parseMarker } from "./lib/classify.js";
export { EFFORTS, normalizeEffort } from "./lib/effort.js";
export { PERIOD_LABELS, pricingPeriod, applyPeakCap, nextPeriodMinutes, formatDuration } from "./lib/period.js";
export { buildNotice } from "./lib/notice.js";
export { latestUserMessage, turnHasErrors } from "./lib/session.js";

// ── 插件主体 ────────────────────────────────────────────────────────
export function apply(ctx, config = {}) {
	const cfg = { ...DEFAULTS, ...config };
	cfg.maxKeywords = cfg.maxKeywords ?? DEFAULTS.maxKeywords;
	cfg.offKeywords = cfg.offKeywords ?? DEFAULTS.offKeywords;
	cfg.politenessPrefixes = cfg.politenessPrefixes ?? DEFAULTS.politenessPrefixes;
	cfg.continuationKeywords = cfg.continuationKeywords ?? DEFAULTS.continuationKeywords;
	const defaultEffort = normalizeEffort(cfg.defaultEffort) ?? "high";
	cfg.defaultEffort = defaultEffort;
	if (!cfg.enabled) return;

	const debug = cfg.debugFile ? (line) => {
		try {
			appendFileSync(cfg.debugFile, `[${new Date().toISOString()}] ${line}\n`);
		} catch {
			/* 调试日志失败不影响插件 */
		}
	} : null;
	debug?.("apply() ok — listeners registering");

	/** agent → 最近一次判定 { messageId, turn, effort, reason } */
	const decisions = new WeakMap();
	/** agent → 插件上次实际应用的 effort（仅自动应用时更新） */
	const lastAutoApplied = new WeakMap();
	/** agent → 是否处于"尊重 GUI 手动选择"模式 */
	const manualMode = new WeakMap();
	/** 已应用 effort 变更、待通知客户端刷新界面（模型选择器显示实际档位）的 agent */
	const pendingUiRefresh = new Set();
	/** registration → Map(model → { efforts, defaultEffort })：能力缓存，按适配器实例隔离 */
	const capabilityCache = new WeakMap();

	async function modelEfforts(provider, model, signal) {
		// 注意：cordis 中服务不能直接 ctx.llm 访问，必须 ctx.get("llm")
		const llm = ctx.get("llm");
		if (!llm) {
			debug?.(`modelEfforts: llm 服务不可用`);
			return null;
		}
		try {
			let registration;
			try {
				registration = llm.registration(provider);
				debug?.(`modelEfforts: registration=${registration ? "ok" : "missing"}`);
			} catch (error) {
				debug?.(`modelEfforts: registration threw: ${error?.code ?? error?.message}`);
				return null;
			}
			if (!registration) return null;
			let byModel = capabilityCache.get(registration);
			if (!byModel) {
				byModel = new Map();
				capabilityCache.set(registration, byModel);
			}
			if (byModel.has(model)) return byModel.get(model);
			const info = await llm.resolveModelInfoFor(registration, model, signal);
			debug?.(`modelEfforts: info.ok reasoning=${JSON.stringify(info.reasoning ?? null)}`);
			const result = {
				efforts: (info.reasoning?.efforts ?? []).map((entry) => entry.id),
				defaultEffort: info.reasoning?.defaultEffort
			};
			byModel.set(model, result);
			return result;
		} catch (error) {
			debug?.(`modelEfforts: 查询失败: ${error?.code ?? error?.message}`);
			ctx.logger?.warn("task-effort: 查询模型能力失败（跳过本次调整）: %o", error);
			return null;
		}
	}

	/** 把期望 effort 收敛到模型支持的范围内；不支持则回退模型默认，仍不支持则放弃调整。 */
	function clamp(effort, capabilities) {
		if (!capabilities || capabilities.efforts.length === 0) return null;
		if (capabilities.efforts.includes(effort)) return effort;
		if (capabilities.defaultEffort && capabilities.efforts.includes(capabilities.defaultEffort)) {
			return capabilities.defaultEffort;
		}
		return null;
	}

	const isApplicable = (agent, provider) => {
		if (!cfg.providers.includes(provider)) return false;
		if (cfg.subagents === "off" && agent.options?.subagentDepth !== undefined) return false;
		return true;
	};

	// agent/pre-step：每步执行前判定/沿用/升级 effort，并可选注入说明。
	// prepend 保证在 qmd-autosearch 等插件之前拿到原始 claimed 消息。
	ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
		// 上一步已应用 effort 变更且 header 已落库 → 通知客户端刷新（模型选择器显示实际档位）
		if (agent !== void 0 && pendingUiRefresh.delete(agent)) {
			ctx.emit("llm/adapters-updated");
			debug?.(`pre-step: 已通知 UI 刷新（effort 已变更）`);
		}
		debug?.(`pre-step: agent=${agent?.id} turn=${turn} step=${step} claimed=${Array.isArray(messages) ? messages.length : "?"} kinds=${Array.isArray(messages) ? messages.map((m) => `${m?.role}:${m?.source?.kind}`).join(",") : "?"}`);
		const decision = await next();
		if (agent === void 0 || !Array.isArray(messages)) return decision;
		const previous = decisions.get(agent);
		const user = latestUserMessage(messages);
		let current = previous;
		const period = cfg.periodOverride ?? pricingPeriod();
		const remainingMinutes = cfg.periodOverride ? null : nextPeriodMinutes();

		// 有新的真实用户消息 → 重新判定（覆盖新任务/中途转向）
		if (user && user.id !== previous?.messageId) {
			const judged = classify(user.text, previous, cfg);
			let effort = judged.effort;
			let reason = judged.reason;
			if (cfg.costAware) {
				const capped = applyPeakCap(effort, period, cfg.peakCap);
				if (capped !== effort) {
					effort = capped;
					reason = `${reason}+peak-cap`;
				}
			}
			current = { messageId: user.id, turn, effort, reason };
			decisions.set(agent, current);
			debug?.(`pre-step: 判定 → effort=${effort} reason=${reason} text=${JSON.stringify(user.text)} period=${period}`);
			if (cfg.log) {
				ctx.logger.info(
					"task-effort: agent=%s turn=%d effort=%s reason=%s period=%s",
					agent.id, turn, effort, reason, period
				);
			}
		} else if (current && cfg.escalateOnError && turnHasErrors(agent, turn) && current.effort !== "max") {
			// 本轮工具已报错 → 剩余步骤升级到 max（应急纠错不受高峰限档约束）
			current = { ...current, effort: "max", reason: "escalate:tool-error" };
			decisions.set(agent, current);
			if (cfg.log) ctx.logger.info("task-effort: agent=%s turn=%d effort=max reason=escalate:tool-error", agent.id, turn);
		}

		// 注入说明：effort 相对上一轮发生了变化时才提醒
		if (cfg.notify && current && current.effort !== previous?.effort &&
				decision.kind !== "reject" && Array.isArray(decision.messages)) {
			const reminder = buildNotice(current, period, remainingMinutes);
			const lastClaimedIndex = decision.messages.findLastIndex((message) => messages.includes(message));
			return {
				...decision,
				messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, reminder)
			};
		}
		return decision;
	}, { prepend: true });

	// agent/request：把判定结果应用到本次请求的 reasoningEffort。
	// prepend 保证本插件的改写是 waterfall 最外层（最终生效）。
	// 手动选择检测：GUI 手动选档位后，selectionFor 的 picked 优先于 logged
	// header，base 的 effort 会偏离插件上次自动应用的值 → 进入 manualMode，
	// 尊重手动选择并暂停自动判定；用户在 GUI 选回 "Provider default"（picked
	// 不再携带 effort）后 base 回到插件上次自动值 → 自动恢复。
	ctx.on("agent/request", async ({ agent, signal }, next) => {
		const base = await next();
		debug?.(`request: agent=${agent?.id} base.effort=${base?.reasoningEffort} base.provider=${base?.provider} base.model=${base?.model}`);
		if (agent === void 0 || typeof base !== "object" || base === null) return base;
		const decided = decisions.get(agent);
		const auto = lastAutoApplied.get(agent);
		const manual = manualMode.get(agent) === true;

		if (manual) {
			// 手动模式：base 回到插件上次自动值 → 用户已选回 Provider default，恢复自动
			if (base.reasoningEffort === auto) {
				debug?.(`request: 手动选择已清除（base=${base.reasoningEffort} 回到自动值），恢复自动模式`);
				manualMode.delete(agent);
			} else {
				debug?.(`request: 手动模式，尊重 GUI 选择 effort=${base.reasoningEffort}`);
				return base;
			}
		} else if (decided && auto !== void 0 && base.reasoningEffort !== auto) {
			// 非手动模式但 base 偏离自动值 → GUI 手动选择了档位
			debug?.(`request: 检测到 GUI 手动选择 effort=${base.reasoningEffort}（自动值=${auto}），进入手动模式`);
			manualMode.set(agent, true);
			decisions.delete(agent);
			return base;
		}

		if (!decided) return base;
		if (!isApplicable(agent, base.provider)) return base;
		const capabilities = await modelEfforts(base.provider, base.model, signal);
		debug?.(`request: decided=${decided.effort} (${decided.reason}) capabilities=${JSON.stringify(capabilities)}`);
		// 能力查询失败时兜底：allowlist 已限定 provider，直接应用判定（prepareCall 仍会校验）
		const effort = clamp(decided.effort, capabilities) ?? (capabilities === null ? decided.effort : null);
		if (!effort || effort === base.reasoningEffort) {
			lastAutoApplied.set(agent, base.reasoningEffort);
			return base;
		}
		debug?.(`request: 应用 effort=${effort}`);
		lastAutoApplied.set(agent, effort);
		pendingUiRefresh.add(agent);
		return { ...base, reasoningEffort: effort };
	}, { prepend: true });

	// turn 结束（agent 进入 idle）时兜底刷新：覆盖"最后一轮最后一步"没有下一次
	// pre-step 的情况
	ctx.on("agent/status", ({ agent, status }) => {
		if (status !== "idle") return;
		if (agent !== void 0 && pendingUiRefresh.delete(agent)) {
			ctx.emit("llm/adapters-updated");
			debug?.(`status: 已通知 UI 刷新（idle 兜底）`);
		}
	});
}
