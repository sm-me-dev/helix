// Minimal YAML-subset parser for evals/tasks/*.yml only.
// Supports: comments, `key: scalar`, `key: >` folded scalars, `key:`
// followed by `- item` lists or indented maps (one level), integers,
// booleans, single/double-quoted strings. Anything else is an error.
export function parseYaml(text) {
  const lines = text.split("\n");
  const root = {};
  // Stack of {indent, container}. Container is object or array.
  const stack = [{ indent: -1, container: root, key: null }];
  let i = 0;

  const coerce = (v) => {
    const t = v.trim();
    if (/^-?\d+$/.test(t)) return Number(t);
    if (t === "true") return true;
    if (t === "false") return false;
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t;
  };

  const peekNext = (from) => {
    for (let j = from; j < lines.length; j++) {
      if (lines[j].trim() && !lines[j].trim().startsWith("#")) return { line: lines[j], index: j };
    }
    return null;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];

    if (trimmed.startsWith("- ")) {
      if (!Array.isArray(top.container)) throw new Error(`list item without a list: ${line}`);
      top.container.push(coerce(trimmed.slice(2)));
      i++;
      continue;
    }

    const m = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) throw new Error(`cannot parse line: ${line}`);
    const [, key, rest] = m;
    if (Array.isArray(top.container)) throw new Error(`mapping key inside a list: ${line}`);

    if (rest === ">" || rest === "|") {
      // Folded/literal block: consume more-indented lines.
      const parts = [];
      i++;
      while (i < lines.length && lines[i].trim() && lines[i].match(/^ */)[0].length > indent) {
        parts.push(lines[i].trim());
        i++;
      }
      top.container[key] = rest === ">" ? parts.join(" ") : parts.join("\n");
      continue;
    }
    if (rest === "") {
      const next = peekNext(i + 1);
      const child = next && next.line.trim().startsWith("- ") ? [] : {};
      top.container[key] = child;
      stack.push({ indent, container: child, key });
      i++;
      continue;
    }
    top.container[key] = coerce(rest);
    i++;
  }
  return root;
}
