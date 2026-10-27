// @fairsplit/eval: the labelled extraction eval (S4.8). Replay by default; live behind --mode live
// with a US$ cap. Writes packages/eval/report/latest.json, which the API serves to the waffle.
export * from "./baseline/ppocr.js";
export * from "./cases.js";
export * from "./labels.js";
export * from "./pipeline.js";
export * from "./report.js";
export { defaultOptions, type EvalOptions, type EvalOutcome, parseArgs, runEval } from "./run.js";
export * from "./score.js";
