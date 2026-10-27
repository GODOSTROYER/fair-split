import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** True when the module at `url` is the process entry point (works for tsx and compiled JS). */
export function isMain(url: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(url)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
