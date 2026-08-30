// 会话侧工具：从消息/事件提取判定所需信号
// @module task-effort/session

/** 从本轮 claimed 消息里取最新的真实用户消息（排除插件/指令注入）。 */
export function latestUserMessage(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "user") continue;
		const source = message.source;
		if (source?.kind === "plugin" || source?.kind === "agent-instructions") continue;
		const text = (message.content ?? [])
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join(" ")
			.trim();
		if (text) return { id: message.id, text };
	}
	return null;
}

/** 本轮（turn）内是否已有工具调用出错：error 元数据、isError 块或文本错误特征。 */
export function turnHasErrors(agent, turn) {
	const events = agent.session?.events;
	if (!Array.isArray(events)) return false;
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event?.type === "turn/start" && event.data?.turn === turn) break;
		if (event?.type !== "tool/result") continue;
		if (event.data?.turn !== turn) continue;
		if (event.data?.error) return true;
		const blocks = event.data?.message?.content ?? [];
		for (const block of blocks) {
			if (block?.type !== "tool-result") continue;
			if (block.isError) return true;
			for (const inner of block.content ?? []) {
				if (inner?.type === "text" && /error|failed|failure|exception|报错|失败|错误|异常|exit code [1-9]/i.test(inner.text)) {
					return true;
				}
			}
		}
	}
	return false;
}
