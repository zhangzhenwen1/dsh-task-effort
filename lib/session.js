// 会话侧工具：从消息/事件提取判定所需信号
// @module task-effort/session

/** 从本轮 claimed 消息里取最新的真实用户消息（排除插件/指令注入）。 */
export function latestUserMessage(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "user") continue;
		const source = message.source;
		// 0.2 起插件消息使用 producer-owned kind（形如 "plugin:<name>"），
		// 旧版是 kind:"plugin" + plugin 字段；两者都必须排除，否则注入的
		// 通知/检索补充会被当成真实用户消息重新判定任务。
		const kind = source?.kind;
		if (kind === "plugin" || kind === "agent-instructions" ||
			(typeof kind === "string" && kind.startsWith("plugin:"))) continue;
		const text = (message.content ?? [])
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join(" ")
			.trim();
		if (text) return { id: message.id, text };
	}
	return null;
}

/** provider 是否在插件的生效白名单内（provider/白名单未知时乐观放行，避免漏发档位通知）。 */
export function providerApplicable(provider, providers) {
	return provider === void 0 || provider === null ||
		!Array.isArray(providers) || providers.includes(provider);
}

/** 取会话事件：0.2 的 Session 用 snapshotEvents()，旧版直接暴露 events 数组。 */
function sessionEvents(session) {
	if (session === null || session === void 0) return void 0;
	if (typeof session.snapshotEvents === "function") {
		try {
			return session.snapshotEvents();
		} catch {
			/* 退回到旧式属性 */
		}
	}
	return session.events;
}

/** 工具结果是否代表一次失败：错误标记，或非零退出码等错误文本（0.2 的退出码不会置 isError）。 */
function toolResultFailed(message) {
	if (message?.isError === true) return true;
	for (const block of message?.content ?? []) {
		// 0.1 形状：tool-result 块 + isError；0.2 是普通 text 块 + message.isError
		if (block?.type === "tool-result" && block.isError === true) return true;
		const inner = block?.type === "tool-result" ? (block.content ?? []) : [block];
		for (const item of inner) {
			if (item?.type !== "text") continue;
			if (/error|failed|failure|exception|报错|失败|错误|异常|exit code:? [1-9]/i.test(item.text)) return true;
		}
	}
	return false;
}

/** 本轮（turn）内是否已有工具调用出错：error 元数据、isError 标记或非零退出码等错误文本。 */
export function turnHasErrors(agent, turn) {
	const events = sessionEvents(agent?.session);
	if (!Array.isArray(events)) return false;
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event?.type === "turn/start" && event.data?.turn === turn) break;
		if (event?.type !== "tool/result") continue;
		if (event.data?.turn !== turn) continue;
		if (event.data?.error) return true;
		if (toolResultFailed(event.data?.message)) return true;
	}
	return false;
}
