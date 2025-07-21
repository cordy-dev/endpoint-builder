import type { PersistStorage } from "./PersistStorage";

export class MemoryStoragePersist implements PersistStorage {
	private storage = new Map<string, string>();

	get<T>(k: string): Promise<T | undefined> {
		const value = this.storage.get(k);
		if (value === undefined) return Promise.resolve(undefined);
		try {
			return Promise.resolve(JSON.parse(value) as T);
		} catch {
			return Promise.resolve(undefined);
		}
	}

	set<T>(k: string, v: T): Promise<void> {
		this.storage.set(k, JSON.stringify(v));
		return Promise.resolve();
	}

	delete(k: string): Promise<void> {
		this.storage.delete(k);
		return Promise.resolve();
	}
}