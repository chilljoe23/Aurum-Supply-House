// Registers the "@/" path-alias resolver (tsalias.mjs) for the test process.
// Loaded via `node --import ./tests/setup-aliases.mjs` from the `test` script.
import { register } from "node:module";
register("./tsalias.mjs", import.meta.url);
