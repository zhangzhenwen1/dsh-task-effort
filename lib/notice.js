// 档位切换通知消息构建（GUI notice 渲染）
// @module task-effort/notice
import { randomUUID } from "node:crypto";
import { PERIOD_LABELS, formatDuration } from "./period.js";

/** 档位对应的醒目 emoji 与短标签（用于界面通知行）。 */
const EFFORT_BADGES = {
	off: { emoji: "⚪", label: "OFF" },
	low: { emoji: "🟡", label: "LOW" },
	high: { emoji: "🔵", label: "HIGH" },
	max: { emoji: "🔴", label: "MAX" }
};

/** 插件名（通知 source 标记）。 */
const PLUGIN_NAME = "task-effort";

/** 构建档位切换通知消息：GUI 以 notice 形式渲染（折叠时显示 summary 一行）。
 * @param current 判定结果 { effort, reason }
 * @param period 当前时段 "peak" | "offpeak"
 * @param remainingMinutes 距下一时段边界的剩余分钟数（null = 不显示倒计时）
 */
export function buildNotice(current, period = "offpeak", remainingMinutes = null) {
	const badge = EFFORT_BADGES[current.effort] ?? { emoji: "⚙️", label: String(current.effort).toUpperCase() };
	const periodBadge = PERIOD_LABELS[period] ?? PERIOD_LABELS.offpeak;
	const capped = typeof current.reason === "string" && current.reason.includes("+peak-cap");
	const baseReason = capped ? current.reason.replace("+peak-cap", "") : current.reason;
	const stateText = capped
		? `高峰时段限档：原判定（${baseReason}）→ 上限 ${badge.label}，省钱模式`
		: current.effort === "off"
			? "简单任务，已关闭深度思考（响应更快）"
			: current.effort === "low"
				? "轻度任务，浅层思考（省时省成本）"
				: current.effort === "max"
					? "复杂任务，已启用最大深度思考（更慢但更深入）"
					: "普通任务，默认思考强度";
	// 倒计时：剩余分钟数（null = 不显示，如 periodOverride 演示模式）
	const nextPeriod = period === "peak" ? "offpeak" : "peak";
	const nextLabel = PERIOD_LABELS[nextPeriod] ?? PERIOD_LABELS.offpeak;
	const hasCountdown = remainingMinutes !== null && remainingMinutes !== void 0;
	// 折叠行（summary）的紧凑倒计时：直接跟在时段词后面，不展开即可见
	const summaryCountdown = hasCountdown ? `（距${nextLabel.emoji}${nextLabel.text} ${formatDuration(remainingMinutes)}）` : "";
	const summary = capped
		? `${periodBadge.emoji} 高峰限档${summaryCountdown}：${badge.label}（当前价高，省钱模式）`
		: `${periodBadge.emoji}${periodBadge.text}${summaryCountdown} · ${badge.emoji} 档位已切换为 ${badge.label}（${baseReason}）`;
	const countdown = hasCountdown
		? `（距下一时段 ${nextLabel.emoji}${nextLabel.text} 还有 ${formatDuration(remainingMinutes)}）`
		: "";
	return {
		id: randomUUID(),
		role: "user",
		content: [{
			type: "text",
			text: `<system-reminder>\n当前时段：${periodBadge.emoji} ${periodBadge.text}${countdown}（北京时间 工作日 09:00-12:00 / 14:00-18:00 为高峰）\n任务难度自动评估：本轮任务被判定为「${baseReason}」→ ${stateText}。\n模型档位：${badge.emoji} ${badge.label}（reasoningEffort=${current.effort}）\n如需手动指定，请在消息中加入 [effort=off|low|high|max] 标记。\n</system-reminder>`
		}],
		source: {
			kind: "plugin",
			plugin: PLUGIN_NAME,
			form: "notice",
			summary
		}
	};
}
