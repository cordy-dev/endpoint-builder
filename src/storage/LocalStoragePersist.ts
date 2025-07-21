import type { PersistStorage } from "./PersistStorage";

export class LocalStoragePersist implements PersistStorage {
	get<T>(k: string): Promise<T | undefined> {              // JSON.parse might throw, we need to catch it
		const value = localStorage.getItem(k);
		if (value === null) return Promise.resolve(undefined);
		try {
			return Promise.resolve(JSON.parse(value) as T);
		} catch {
			return Promise.resolve(undefined);
		}
	}

	set<T>(k: string, v: T): Promise<void> {
		localStorage.setItem(k, JSON.stringify(v));
		return Promise.resolve();
	}

	delete(k: string): Promise<void> {
		localStorage.removeItem(k);
		return Promise.resolve();
	}
}