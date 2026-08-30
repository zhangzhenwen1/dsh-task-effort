// DeepSeek 计价时段逻辑（北京时间）
// @module task-effort/period
import { normalizeEffort } from "./effort.js";

/** 高峰/闲时段落的展示信息。 */
export const PERIOD_LABELS = {
	peak: { emoji: "🔴", text: "高峰" },
	offpeak: { emoji: "🟢", text: "闲时" }
};

/**
 * DeepSeek 计价时段（北京时间 Asia/Shanghai = UTC+8，无夏令时）。
 * 官方现行规则：高峰 = 周一至周五 09:00-12:00、14:00-18:00；其余（含周末全天）为闲时。
 * @param date 任意时区的 Date（默认当前时间）
 * @returns "peak" | "offpeak"
 */
export function pricingPeriod(date = new Date()) {
	const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
	const day = bj.getUTCDay(); // 0=周日 … 6=周六
	const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes();
	if (day === 0 || day === 6) return "offpeak";
	if ((minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)) {
		return "peak";
	}
	return "offpeak";
}

/**
 * 应用高峰限档：高峰时段把 effort 压到上限。
 * @param effort 判定出的档位
 * @param period 当前时段
 * @param cap 高峰上限（null 关闭）
 * @returns 限档后的档位（未变化则原样返回）
 */
export function applyPeakCap(effort, period, cap) {
	if (period !== "peak" || cap === null || cap === void 0) return effort;
	const normalized = normalizeEffort(cap);
	if (!normalized || normalized === "max") return effort;
	if (effort === "max") return normalized;
	return effort;
}

/**
 * 距下一时段边界还有多少分钟（向上取整）。基于北京时间（UTC+8）。
 * 边界：周一至周五 09:00（高峰开始）、12:00（结束）、14:00（开始）、18:00（结束），
 * 以及下周一 09:00（周末后回到高峰）。
 * @param date 任意时区的 Date（默认当前时间）
 * @returns 剩余分钟数（正整数）
 */
export function nextPeriodMinutes(date = new Date()) {
	const bj = new Date(date.getTime() + 8 * 60 * 60 * 1000);
	const day = bj.getUTCDay(); // 0=周日 … 6=周六
	const dayIndex = day === 0 ? 7 : day; // 1=周一 … 7=周日
	const current = dayIndex * 1440 + bj.getUTCHours() * 60 + bj.getUTCMinutes() + bj.getUTCSeconds() / 60;
	const boundaries = [];
	for (let d = 1; d <= 5; d++) {
		boundaries.push(d * 1440 + 9 * 60); // 09:00 高峰开始
		boundaries.push(d * 1440 + 12 * 60); // 12:00 高峰结束
		boundaries.push(d * 1440 + 14 * 60); // 14:00 高峰开始
		boundaries.push(d * 1440 + 18 * 60); // 18:00 高峰结束
	}
	boundaries.push(8 * 1440 + 9 * 60); // 下周一 09:00
	for (const boundary of boundaries) {
		if (boundary > current) return Math.ceil(boundary - current);
	}
	return Math.ceil(8 * 1440 + 9 * 60 - current);
}

/** 分钟数 → 中文时长描述（如 "1 小时 25 分钟"）。 */
export function formatDuration(minutes) {
	if (minutes < 60) return `${minutes} 分钟`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}
