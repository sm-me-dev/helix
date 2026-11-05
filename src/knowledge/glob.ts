/** Small path-glob matcher used only for repository-relative route filters. */
export function matchPathGlob(filePath: string, glob: string): boolean {
  const file = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const pattern = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  source += "$";
  return new RegExp(source).test(file);
}
