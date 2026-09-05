import { afterEach, describe, expect, it, vi } from "vitest";

import type { FileEntry, FileTree } from "$lib/types/index.js";
import type { Registry } from "$lib/server/registries/types.js";
import { loadFileContents } from "$lib/server/diff/load-file-contents";
import * as extractor from "$lib/server/archive/extractor";

function entry(path: string, content: string | null, overrides: Partial<FileEntry> = {}): FileEntry {
	return {
		path,
		content,
		isBinary: false,
		isMinified: false,
		size: content?.length ?? 0,
		...overrides,
	};
}

function tree(...entries: FileEntry[]): FileTree {
	return { files: new Map(entries.map((file) => [file.path, file])) };
}

function registry(): Registry {
	return {
		getVersions: async () => ["2.0.0", "1.0.0"],
		getDownloadUrl: async (packageName: string, version: string) =>
			`https://example.test/${packageName}-${version}.tgz`,
	};
}

function load(path: string, keySuffix: string) {
	return loadFileContents({
		registry: registry(),
		packageType: "npm",
		packageName: `pkg-${keySuffix}`,
		fromVersion: "1.0.0",
		toVersion: "2.0.0",
		archiveFormat: "tgz",
		path,
	});
}

describe("loadFileContents integration", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns both sides of a changed file in full", async () => {
		vi.when(vi.spyOn(extractor, "fetchAndExtract"), { onUnmatched: "throw" })
			.calledWith("https://example.test/pkg-changed-1.0.0.tgz", "tgz")
			.thenResolve(tree(entry("src/index.js", "const a = 1;\n")))
			.calledWith("https://example.test/pkg-changed-2.0.0.tgz", "tgz")
			.thenResolve(tree(entry("src/index.js", "const a = 2;\n")));

		const result = await load("src/index.js", "changed");

		expect(result).toEqual({ oldContents: "const a = 1;\n", newContents: "const a = 2;\n" });
	});

	it("returns an empty side for files that only exist in one version", async () => {
		vi.when(vi.spyOn(extractor, "fetchAndExtract"), { onUnmatched: "throw" })
			.calledWith("https://example.test/pkg-added-1.0.0.tgz", "tgz")
			.thenResolve(tree())
			.calledWith("https://example.test/pkg-added-2.0.0.tgz", "tgz")
			.thenResolve(tree(entry("added.js", "new\n")));

		const result = await load("added.js", "added");

		expect(result).toEqual({ oldContents: "", newContents: "new\n" });
	});

	it("returns null when the path is absent from both versions", async () => {
		vi.spyOn(extractor, "fetchAndExtract").mockResolvedValue(tree(entry("other.js", "x\n")));

		expect(await load("missing.js", "missing")).toBeNull();
	});

	it("returns null for binary files, which cannot be expanded", async () => {
		vi.spyOn(extractor, "fetchAndExtract").mockResolvedValue(
			tree(entry("logo.png", null, { isBinary: true, size: 100 })),
		);

		expect(await load("logo.png", "binary")).toBeNull();
	});

	it("extracts both archives only once per comparison", async () => {
		const fetchAndExtract = vi.spyOn(extractor, "fetchAndExtract").mockResolvedValue(tree(entry("a.js", "same\n")));

		await load("a.js", "counted");

		expect(fetchAndExtract).toHaveBeenCalledTimes(2);
	});
});
