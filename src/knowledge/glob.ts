import path from "node:path";

/** Match normalized repository-relative paths with Node's POSIX glob semantics. */
export function matchPathGlob(filePath: string, glob: string): boolean {
  const normalize = (value: string): string => {
    const slashPath = value.replace(/\\/g, "/").replace(/^\.\//, "");
    return path.posix.normalize(slashPath).replace(/^\.\//, "");
  };
  return path.posix.matchesGlob(normalize(filePath), normalize(glob));
}
