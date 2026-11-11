import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOpenApiDocument } from "../openapi.js";

const out = resolve(process.argv[2] ?? "openapi.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
process.stdout.write(`OpenAPI written to ${out}\n`);
