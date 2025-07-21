export function toQuery<Q extends Record<string, unknown>>(q: Q | undefined): string {
	if (!q) return "";

	// Используем URLSearchParams для базовой кодировки
	const sp = new URLSearchParams();
	Object.entries(q).forEach(([k, v]) => {
		if (v === undefined || v === null) return;

		const value =
			typeof v === "object"
				? JSON.stringify(v)                              // encode objects explicitly
				: typeof v === "string" ||
				  typeof v === "number" ||
				  typeof v === "boolean" ||
				  typeof v === "bigint"
					? String(v)                                      // primitives are safe to stringify
					: undefined;                                     // skip symbols/functions etc.

		if (value !== undefined) sp.append(k, value);
	});

	// Форматируем строку запроса с %20 вместо + для пробелов, как ожидается в тестах
	return sp.toString().replace(/\+/g, "%20");
}