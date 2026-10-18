// task-effort 分类器单元测试
// 运行：node plugins/task-effort/test.js
// 注意：直接 import lib/*.js（纯逻辑，不依赖 @deepseek-ai/schemastery），
// 单测因此可以脱离 dsh 运行环境执行；index.js 加载时需要从 dsh 安装目录
// 解析 schemastery，只有 dsh 进程内（process.argv[1] 锚点）才拿得到。
import { classify, parseMarker } from "./lib/classify.js";
import { normalizeEffort, EFFORTS } from "./lib/effort.js";
import { pricingPeriod, applyPeakCap, nextPeriodMinutes, formatDuration } from "./lib/period.js";
import { buildNotice } from "./lib/notice.js";
import { latestUserMessage, providerApplicable, turnHasErrors } from "./lib/session.js";

let failed = 0;
function check(label, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) {
		failed++;
		console.log(`✗ ${label}\n    期望 ${JSON.stringify(expected)}\n    实际 ${JSON.stringify(actual)}`);
	} else {
		console.log(`✓ ${label}`);
	}
}

// normalizeEffort
check("normalize low→low（独立档位）", normalizeEffort("low"), "low");
check("normalize medium→high", normalizeEffort("medium"), "high");
check("normalize max", normalizeEffort("max"), "max");
check("normalize invalid", normalizeEffort("ultra"), null);

// parseMarker
check("marker [effort=off]", parseMarker("随便聊聊 [effort=off]"), "off");
check("marker 【effort:max】", parseMarker("重构这个模块【effort:max】"), "max");
check("marker {effort:high}", parseMarker("{effort:high} 帮我改下"), "high");
check("marker bare effort=low", parseMarker("effort=low 简短回答"), "low");
check("marker none", parseMarker("帮我重构一下"), null);

const cfg = {
	defaultEffort: "high",
	maxKeywords: ["重构", "架构", "分析", "refactor", "design", "debug"],
	offKeywords: ["谢谢", "你好", "ok", "thanks"],
	politenessPrefixes: ["好的", "收到", "嗯"],
	continuationKeywords: ["继续", "接着", "next", "continue"],
	longThreshold: 200,
	shortThreshold: 4
};

// classify 各分支
check("关键词→max", classify("帮我重构一下这个模块", null, cfg), { effort: "max", reason: "keyword:max" });
check("英文关键词→max", classify("please refactor the auth module", null, cfg), { effort: "max", reason: "keyword:max" });
check("纯闲聊→off", classify("谢谢！", null, cfg), { effort: "off", reason: "keyword:off" });
check("你好→off", classify("你好", null, cfg), { effort: "off", reason: "keyword:off" });
check("礼貌前缀+任务→high(默认)", classify("好的，帮我看看这个文件", null, cfg), { effort: "high", reason: "default" });
check("礼貌前缀+复杂词→max", classify("好的，帮我重构一下", null, cfg), { effort: "max", reason: "keyword:max" });
check("纯礼貌前缀→off", classify("好的", null, cfg), { effort: "off", reason: "politeness-only" });
check("继续→沿用上一轮", classify("继续", { effort: "max" }, cfg), { effort: "max", reason: "continuation" });
check("长指令→max", classify("请帮我完成一个很长的任务说明".repeat(30), null, cfg), { effort: "max", reason: "long" });
check("无信号默认→high", classify("帮我看看这个文件的内容", null, cfg), { effort: "high", reason: "default" });
check("标记优先于关键词", classify("帮我重构 [effort=off]", null, cfg), { effort: "off", reason: "marker" });
check("空文本→沿用", classify("", { effort: "off" }, cfg), { effort: "off", reason: "no-text" });

// ── pricingPeriod：北京时间时段边界（UTC+8 无夏令时） ──
// 辅助：构造北京时间某时刻 → 传入对应 UTC Date（2026-08-10 是周一）
function bjTime(day, hour, minute) {
	// day: 0=周日 … 6=周六（北京时间星期）；UTC = 北京 - 8h
	return new Date(Date.UTC(2026, 7, 10 + day - 1, hour - 8, minute));
}
check("周一 08:59 闲时", pricingPeriod(bjTime(1, 8, 59)), "offpeak");
check("周一 09:00 高峰开始", pricingPeriod(bjTime(1, 9, 0)), "peak");
check("周一 11:59 高峰", pricingPeriod(bjTime(1, 11, 59)), "peak");
check("周一 12:00 高峰结束", pricingPeriod(bjTime(1, 12, 0)), "offpeak");
check("周一 13:59 闲时", pricingPeriod(bjTime(1, 13, 59)), "offpeak");
check("周一 14:00 下午高峰开始", pricingPeriod(bjTime(1, 14, 0)), "peak");
check("周一 17:59 下午高峰", pricingPeriod(bjTime(1, 17, 59)), "peak");
check("周一 18:00 下午高峰结束", pricingPeriod(bjTime(1, 18, 0)), "offpeak");
check("周五 10:00 高峰", pricingPeriod(bjTime(5, 10, 0)), "peak");
check("周六 10:00 周末闲时", pricingPeriod(bjTime(6, 10, 0)), "offpeak");
check("周日 15:00 周末闲时", pricingPeriod(bjTime(0, 15, 0)), "offpeak");

// ── applyPeakCap：高峰限档 ──
check("高峰 max→high", applyPeakCap("max", "peak", "high"), "high");
check("高峰 max→off", applyPeakCap("max", "peak", "off"), "off");
check("高峰 high 不变", applyPeakCap("high", "peak", "high"), "high");
check("高峰 off 不变", applyPeakCap("off", "peak", "high"), "off");
check("闲时 max 不压", applyPeakCap("max", "offpeak", "high"), "max");
check("cap=null 不压", applyPeakCap("max", "peak", null), "max");
check("cap=max 不压", applyPeakCap("max", "peak", "max"), "max");

// ── buildNotice：时段与限档标注 ──
{
	const normal = buildNotice({ effort: "high", reason: "default" }, "offpeak");
	check("闲时通知 summary 带时段", normal.source.summary.startsWith("🟢闲时"), true);
	const capped = buildNotice({ effort: "high", reason: "keyword:max+peak-cap" }, "peak");
	check("限档通知 summary", capped.source.summary, "🔴 高峰限档：HIGH（当前价高，省钱模式）");
	check("限档通知内容含时段", capped.content[0].text.includes("当前时段：🔴 高峰"), true);
	check("限档通知内容含省钱", capped.content[0].text.includes("省钱模式"), true);
	const countdown = buildNotice({ effort: "high", reason: "default" }, "offpeak", 85);
	check("倒计时通知含下一时段", countdown.content[0].text.includes("距下一时段 🔴高峰 还有 1 小时 25 分钟"), true);
	const noCountdown = buildNotice({ effort: "high", reason: "default" }, "offpeak", null);
	check("无倒计时参数不显示", noCountdown.content[0].text.includes("距下一时段"), false);
}

// ── nextPeriodMinutes / formatDuration ──
function bjInstant(day, hour, minute, second = 0) {
	// day: 0=周日 … 6=周六（北京时间）；返回 UTC Date
	return new Date(Date.UTC(2026, 7, 10 + day - 1, hour - 8, minute, second));
}
check("周一 08:00 → 距 09:00 高峰 60 分钟", nextPeriodMinutes(bjInstant(1, 8, 0)), 60);
check("周一 09:30 → 距 12:00 结束 150 分钟", nextPeriodMinutes(bjInstant(1, 9, 30)), 150);
check("周一 11:59:30 → 距 12:00 向上取整 1 分钟", nextPeriodMinutes(bjInstant(1, 11, 59, 30)), 1);
check("周一 12:30 → 距 14:00 高峰 90 分钟", nextPeriodMinutes(bjInstant(1, 12, 30)), 90);
check("周一 18:30 → 距周二 09:00 高峰 870 分钟", nextPeriodMinutes(bjInstant(1, 18, 30)), 870);
check("周五 18:30 → 距周一 09:00 高峰 3750 分钟", nextPeriodMinutes(bjInstant(5, 18, 30)), 3750);
check("周六 10:00 → 距周一 09:00 高峰 2820 分钟", nextPeriodMinutes(bjInstant(6, 10, 0)), 2820);
check("周日 15:00 → 距周一 09:00 高峰 1080 分钟", nextPeriodMinutes(bjInstant(0, 15, 0)), 1080);
check("format 45 分钟", formatDuration(45), "45 分钟");
check("format 60 分钟", formatDuration(60), "1 小时");
check("format 85 分钟", formatDuration(85), "1 小时 25 分钟");

// 会话格式 v4 兼容：0.2 起 source.kind 禁止 "plugin"，必须使用 producer-owned kind
check("notice source kind 兼容 v4", buildNotice({ effort: "high", reason: "test" }).source.kind, "plugin:task-effort");
check("notice source 不再携带 plugin 字段", Object.hasOwn(buildNotice({ effort: "high", reason: "test" }).source, "plugin"), false);

// 注入消息排除：0.2 的 producer-owned kind "plugin:*" 不能被当成真实用户消息
check("latestUserMessage 排除 plugin:* 注入", latestUserMessage([
	{ id: "u1", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "真实任务" }] },
	{ id: "p1", role: "user", source: { kind: "plugin:qmd-autosearch" }, content: [{ type: "text", text: "检索补充" }] }
]), { id: "u1", text: "真实任务" });
check("latestUserMessage 排除旧式 plugin 注入", latestUserMessage([
	{ id: "p0", role: "user", source: { kind: "plugin", plugin: "x" }, content: [{ type: "text", text: "旧注入" }] }
]), null);

// provider 白名单判定：决定插件是否真的会改写请求（也决定要不要发档位通知）
check("provider 在白名单→生效", providerApplicable("deepseek-account", ["deepseek-official", "deepseek-account"]), true);
check("provider 不在白名单→不生效", providerApplicable("qwen-token-plan-cn", ["deepseek-official", "deepseek-account"]), false);
check("provider 未知→乐观放行", providerApplicable(void 0, ["deepseek-official"]), true);
check("白名单缺失→乐观放行", providerApplicable("deepseek-account", void 0), true);

// 轮内出错升级：0.2 的 Session 用 snapshotEvents()，tool/result 的失败标记在 message.isError，
// 非零退出码只出现在 text 里（isError=false）
const sessionOf = (events) => ({ session: { snapshotEvents: () => events } });
check("turnHasErrors: 0.2 message.isError", turnHasErrors(sessionOf([
	{ type: "turn/start", data: { turn: 2 } },
	{ type: "tool/result", data: { turn: 2, message: { isError: true, content: [{ type: "text", text: "boom" }] } } }
]), 2), true);
check("turnHasErrors: 0.2 非零退出码文本", turnHasErrors(sessionOf([
	{ type: "turn/start", data: { turn: 2 } },
	{ type: "tool/result", data: { turn: 2, message: { isError: false, content: [{ type: "text", text: "Error: boom\n[exit code: 1]" }] } } }
]), 2), true);
check("turnHasErrors: 正常输出不升级", turnHasErrors(sessionOf([
	{ type: "turn/start", data: { turn: 2 } },
	{ type: "tool/result", data: { turn: 2, message: { isError: false, content: [{ type: "text", text: "all good" }] } } }
]), 2), false);
check("turnHasErrors: 上个 turn 的错误不算", turnHasErrors(sessionOf([
	{ type: "turn/start", data: { turn: 1 } },
	{ type: "tool/result", data: { turn: 1, message: { isError: true, content: [] } } },
	{ type: "turn/start", data: { turn: 2 } },
	{ type: "tool/result", data: { turn: 2, message: { isError: false, content: [{ type: "text", text: "ok" }] } } }
]), 2), false);
check("turnHasErrors: 0.1 events 数组兼容", turnHasErrors({ session: { events: [
	{ type: "turn/start", data: { turn: 2 } },
	{ type: "tool/result", data: { turn: 2, message: { content: [{ type: "tool-result", isError: true, content: [] }] } } }
] } }, 2), true);
check("turnHasErrors: 无 session", turnHasErrors({}, 2), false);

if (failed > 0) {
	console.log(`\n${failed} 项失败`);
	process.exit(1);
}
console.log("\n全部通过");
