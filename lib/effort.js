// 档位常量与归一化
// @module task-effort/effort

/** 合法档位（与 DeepSeek 适配器能力一致：off | low | high | max）。 */
export const EFFORTS = ["off", "low", "high", "max"];

/**
 * 同义 effort 归一化：medium→high，其余原样（low 现在是独立档位，不再映射为 off）。
 * @param value 原始档位字符串
 * @returns 归一化后的档位，非法输入返回 null
 */
export function normalizeEffort(value) {
	const lower = String(value ?? "").trim().toLowerCase();
	if (lower === "medium" || lower === "normal") return "high";
	if (EFFORTS.includes(lower)) return lower;
	return null;
}
