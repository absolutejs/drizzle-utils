#!/usr/bin/env bun
import { writeFileSync } from "fs";
import { parseArgs } from "node:util";
import { resolve } from "path";
import { argv, cwd, exit } from "process";
import { pathToFileURL } from "url";
import { stdout, stderr } from "bun";
import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

type TableParam = Parameters<typeof getTableConfig>[0];
type SchemaShape = Record<string, TableParam>;

const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const hasKey = <K extends PropertyKey>(
	obj: unknown,
	key: K
): obj is Record<K, unknown> => isObject(obj) && key in obj;

const isPgTable = (value: unknown): value is TableParam => isTable(value);

const isSchema = (value: unknown): value is SchemaShape => {
	if (!isObject(value)) return false;
	const tableValues = Object.values(value);
	if (tableValues.length === 0) return false;
	for (const candidate of tableValues)
		if (!isPgTable(candidate)) return false;
	return true;
};

const usage = () => {
	stderr.write(
		[
			"Usage:",
			"  bun drizzleToDBML.ts <schema-file> [--export name] [--output file]",
			"  bunx @absolutejs/drizzle-utils drizzle-dbml <schema-file> [--export name] [--output file]",
			"",
			"Options:",
			"  -h, --help           Show this help",
			"  -e, --export <name>  Named export to use from the schema module",
			"  -o, --output <file>  Write DBML to a file (overwrites if exists)",
			""
		].join("\n")
	);
};

const looksLikePath = (token: string) =>
	token.includes("/") ||
	token.includes("\\") ||
	token.startsWith("file:") ||
	token.endsWith(".ts") ||
	token.endsWith(".js") ||
	token.endsWith(".mjs") ||
	token.endsWith(".cjs");

const toFileUrl = (pathInput: string) =>
	pathToFileURL(resolve(cwd(), pathInput)).href;

const parsed = parseArgs({
	allowPositionals: true,
	args: argv.slice(2),
	options: {
		export: { short: "e", type: "string" },
		help: { short: "h", type: "boolean" },
		output: { short: "o", type: "string" }
	},
	strict: false
});

if (parsed.values.help === true) {
	usage();
	exit(0);
}

let schemaPath: string | undefined;
for (const positional of parsed.positionals) {
	if (isString(positional) && looksLikePath(positional)) {
		schemaPath = positional;
		break;
	}
}

if (!isString(schemaPath)) {
	stderr.write("Error: missing <schema-file>\n");
	usage();
	exit(1);
}

const exportName =
	isString(parsed.values.export) && parsed.values.export.length > 0
		? parsed.values.export
		: undefined;

const outputPath =
	isString(parsed.values.output) && parsed.values.output.length > 0
		? parsed.values.output
		: undefined;

const pickExport = (mod: unknown, name: string | undefined) => {
	if (typeof name === "string" && hasKey(mod, name)) return mod[name];
	if (hasKey(mod, "schema")) return mod["schema"];
	if (hasKey(mod, "default")) return mod["default"];
	return undefined;
};

const fileUrl = toFileUrl(schemaPath);

let loadedModule: unknown;
try {
	loadedModule = await import(fileUrl);
} catch {
	stderr.write("Error: failed to import schema module\n");
	exit(1);
}

const maybeSchema = pickExport(loadedModule, exportName);
if (!isSchema(maybeSchema)) {
	stderr.write(
		"Error: could not find a valid schema export. Use --export <name> or export `schema` or default.\n"
	);
	exit(1);
}

const schema = maybeSchema;

const dbmlOutputLines: string[] = [];
const seenReferences = new Set<string>();

for (const tableDefinition of Object.values(schema)) {
	const tableConfiguration = getTableConfig(tableDefinition);

	dbmlOutputLines.push(`Table ${tableConfiguration.name} {`);
	for (const columnDefinition of tableConfiguration.columns) {
		const modifiers: string[] = [];
		if (columnDefinition.primary) modifiers.push("pk");
		if (columnDefinition.notNull) modifiers.push("not null");

		const defaultValueRaw = columnDefinition.default;
		if (defaultValueRaw !== undefined && defaultValueRaw !== null) {
			const defaultValueFormatted =
				typeof defaultValueRaw === "object"
					? "`now()`"
					: defaultValueRaw;
			modifiers.push(`default: ${defaultValueFormatted}`);
		}

		const modifiersString =
			modifiers.length > 0 ? ` [${modifiers.join(", ")}]` : "";

		dbmlOutputLines.push(
			`  ${columnDefinition.name} ${columnDefinition.dataType.toLowerCase()}${modifiersString}`
		);
	}
	dbmlOutputLines.push("}\n");

	for (const foreignKeyDefinition of tableConfiguration.foreignKeys) {
		const foreignKeyReference = foreignKeyDefinition.reference();
		const localColumnNames = foreignKeyReference.columns.map(
			(columnItem) => columnItem.name
		);
		const foreignColumnNames = foreignKeyReference.foreignColumns.map(
			(columnItem) => columnItem.name
		);
		const foreignTableName = getTableConfig(
			foreignKeyReference.foreignTable
		).name;

		const signature =
			`${tableConfiguration.name}.(${localColumnNames.join(",")})>` +
			`${foreignTableName}.(${foreignColumnNames.join(",")})`;
		if (seenReferences.has(signature)) continue;
		seenReferences.add(signature);

		const referenceAlias = `${tableConfiguration.name}_${localColumnNames.join(
			"_"
		)}`;
		dbmlOutputLines.push(
			`Ref ${referenceAlias}: ${tableConfiguration.name}.(${localColumnNames.join(
				", "
			)}) > ${foreignTableName}.(${foreignColumnNames.join(", ")})`
		);
	}
	dbmlOutputLines.push("");
}

const outputContent = dbmlOutputLines.join("\n");

const absoluteOutputPath = isString(outputPath)
	? resolve(cwd(), outputPath)
	: undefined;

if (absoluteOutputPath) {
	try {
		writeFileSync(absoluteOutputPath, outputContent, { encoding: "utf8" });
	} catch {
		stderr.write(
			`Error: failed to write output file '${absoluteOutputPath}'\n`
		);
		exit(1);
	}
	exit(0);
}

stdout.write(outputContent);
exit(0);
