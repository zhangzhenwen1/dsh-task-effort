// 任务分类器：把用户消息文本映射到 effort 档位
// @module task-effort/classify
import { normalizeEffort } from "./effort.js";

// ── 判定规则（可配置；index.js 会与用户配置合并）─────────────────────
export const DEFAULTS = {
	// 总开关
	enabled: true,
	// 只对命中这些 provider 的请求生效；其他 provider 原样放行
	providers: ["deepseek-official"],
	// 判定不出明确倾向时的默认 effort
	defaultEffort: "high",
	// 命中任一关键词 → max（先于 politeness/off 判定）
	maxKeywords: [
		// 中文
		"重构", "架构", "设计", "审计", "优化", "调试", "疑难", "复杂",
		"大型", "多文件", "性能", "安全", "迁移", "集成", "并发", "分布式",
		"分析", "方案", "规划", "评审", "排查", "故障", "设计文档",
		"架构设计", "性能优化", "系统设计", "代码审查", "压测", "单元测试", "集成测试",
		// 英文
		"refactor", "architecture", "audit", "debug", "complex", "complicated",
		"performance", "security", "migrate", "migration", "integrate", "integration",
		"concurrent", "concurrency", "distributed", "analyze", "analysis", "plan",
		"planning", "review", "troubleshoot", "investigate", "optimize", "optimization",
		"workflow", "multi-file", "design"
	],
	// 命中任一关键词 → off（仅当剥离礼貌前缀后仍命中，且没有命中 max）
	offKeywords: [
		"谢谢", "感谢", "再见", "拜拜", "没问题", "明白了", "了解",
		"hello", "hi", "thanks", "thank you", "bye", "ok", "okay", "got it"
	],
	// 开头的礼貌前缀，判定前剥离（避免 "好的，帮我重构" 被误判为 off）
	politenessPrefixes: ["好的", "好嘞", "好哒", "收到", "嗯", "ok", "okay", "行", "可以"],
	// 命中任一关键词 → 沿用上一轮 effort（继续类指令，不算新任务）
	continuationKeywords: [
		"继续", "接着", "接下来", "下一步", "然后", "再来", "往下",
		"continue", "next", "go on", "keep going", "proceed"
	],
	// 用户消息超过该长度（字符数）→ max（长指令通常意味着复杂任务）
	longThreshold: 200,
	// 短于该长度且不是新任务 → 沿用上一轮 effort
	shortThreshold: 4,
	// 本轮工具调用出错后，把剩余步骤升级为 max
	escalateOnError: true,
	// 时段感知（成本感知）：高峰时段（北京时间工作日 09-12/14-18）价格更高，
	// 自动把 effort 上限压到 peakCap 省钱
	costAware: true,
	// 高峰时段的 effort 上限（"high" 表示高峰时 max 降为 high；null 关闭限档）
	peakCap: "high",
	// 测试/演示用：强制时段 "peak" | "offpeak" | null（null = 按真实时钟）
	periodOverride: null,
	// 子代理策略：auto（按子代理自己的提示词判定）| off（不干预子代理）
	subagents: "auto",
	// effort 发生变化时向模型注入一行说明（便于观察与调试）
	notify: true,
	// 是否输出判定日志
	log: true,
	// 调试：非空时把插件运行痕迹追加到该文件（便于排查，生产可留空）
	debugFile: null
};

/** 从用户消息文本中提取显式 effort 标记。支持 [effort=off]、【effort:max】、{effort:high}、effort=low。 */
export function parseMarker(text) {
	const match = String(text ?? "").match(
		/(?:[\[【{]\s*effort\s*[:=]\s*([a-z]+)\s*[\]】}]|\beffort\s*[:=]\s*([a-z]+)\b)/i
	);
	const raw = match?.[1] ?? match?.[2];
	return raw ? normalizeEffort(raw) : null;
}

function stripPolitenessPrefix(text, prefixes) {
	let stripped = String(text ?? "").trim();
	let changed = true;
	while (changed) {
		changed = false;
		for (const prefix of prefixes) {
			if (stripped.toLowerCase().startsWith(prefix.toLowerCase())) {
				stripped = stripped.slice(prefix.length).replace(/^[,，。!！.、\s]+/, "");
				changed = true;
				break;
			}
		}
	}
	return stripped;
}

/**
 * 任务难度判定（纯函数）。
 * @param text 最新用户消息全文
 * @param previous 该 agent 上一轮的决定（{ effort, reason } | null）
 * @param config 已合并默认值的配置（缺省用内置 DEFAULTS）
 * @returns { effort, reason }
 */
export function classify(text, previous, config = DEFAULTS) {
	const original = String(text ?? "").trim();
	// 1. 显式标记优先
	const marker = parseMarker(original);
	if (marker) return { effort: marker, reason: "marker" };
	if (!original) return { effort: previous?.effort ?? config.defaultEffort, reason: "no-text" };
	const prevEffort = previous?.effort ?? config.defaultEffort;

	// 2. 复杂任务关键词 → max
	const lower = original.toLowerCase();
	if (config.maxKeywords.some((keyword) => lower.includes(String(keyword).toLowerCase()))) {
		return { effort: "max", reason: "keyword:max" };
	}
	// 3. 继续类指令 → 沿用上一轮
	if (config.continuationKeywords.some((keyword) => lower.includes(String(keyword).toLowerCase()))) {
		return { effort: prevEffort, reason: "continuation" };
	}
	// 4. 剥离礼貌前缀后检查闲聊关键词 → off
	const stripped = stripPolitenessPrefix(original, config.politenessPrefixes ?? []);
	const strippedLower = stripped.toLowerCase();
	if (!stripped) return { effort: "off", reason: "politeness-only" };
	if ((config.offKeywords ?? []).some((keyword) => strippedLower.includes(String(keyword).toLowerCase()))) {
		return { effort: "off", reason: "keyword:off" };
	}
	// 5. 长指令 → max
	if (stripped.length >= config.longThreshold) return { effort: "max", reason: "long" };
	// 6. 过短且无信号 → 沿用上一轮
	if (stripped.length <= config.shortThreshold) return { effort: prevEffort, reason: "short" };
	// 7. 默认
	return { effort: config.defaultEffort, reason: "default" };
}
