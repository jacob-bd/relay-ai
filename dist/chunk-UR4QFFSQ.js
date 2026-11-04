#!/usr/bin/env node

// src/tool-schema.ts
var GOOGLE_NPM = /* @__PURE__ */ new Set(["@ai-sdk/google", "@ai-sdk/google-vertex"]);
function collapseSchemaUnionTypes(value) {
  if (Array.isArray(value)) return value.map(collapseSchemaUnionTypes);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "type" && Array.isArray(child)) {
      const nonNull = child.filter((entry) => entry !== "null");
      if (nonNull.length === 1) {
        out.type = nonNull[0];
        if (nonNull.length < child.length) out.nullable = true;
        continue;
      }
    }
    out[key] = collapseSchemaUnionTypes(child);
  }
  return out;
}
function isDigit(ch) {
  return ch !== void 0 && ch >= "0" && ch <= "9";
}
function rewriteNulEscapesInPattern(pattern) {
  let out = "";
  let escaped = false;
  let changed = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (escaped) {
      escaped = false;
      if (ch === "0" && !isDigit(pattern[i + 1])) {
        out += "x00";
        changed = true;
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === "\\") escaped = true;
    out += ch;
  }
  return changed ? out : null;
}
function rewriteNulPatternEscapes(value) {
  if (Array.isArray(value)) {
    let changed2 = false;
    const out2 = value.map((entry) => {
      const next = rewriteNulPatternEscapes(entry);
      if (next !== entry) changed2 = true;
      return next;
    });
    return changed2 ? out2 : value;
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const next = key === "pattern" && typeof child === "string" ? rewriteNulEscapesInPattern(child) ?? child : rewriteNulPatternEscapes(child);
    if (next !== child) changed = true;
    out[key] = next;
  }
  return changed ? out : value;
}
function synthesizeGoogleItems(prefixItems) {
  if (Array.isArray(prefixItems) && prefixItems.length > 0) {
    const types = new Set(
      prefixItems.map((entry) => entry && typeof entry === "object" ? entry.type : void 0).filter((t) => typeof t === "string")
    );
    if (types.size === 1) return { type: [...types][0] };
  }
  return { type: "string" };
}
function fixGoogleArraySchemas(value) {
  if (Array.isArray(value)) return value.map(fixGoogleArraySchemas);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = fixGoogleArraySchemas(child);
  }
  if (out.type === "array") {
    if (out.items === void 0) out.items = synthesizeGoogleItems(out.prefixItems);
    delete out.prefixItems;
  }
  return out;
}
var RECURSION_SAFE_NPM = /* @__PURE__ */ new Set(["@ai-sdk/openai", "@ai-sdk/azure"]);
function breakRecursiveSchemaRefs(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const defs = schema.$defs;
  if (!defs || typeof defs !== "object" || Array.isArray(defs)) return schema;
  const definitions = defs;
  let looped = false;
  const walk = (node, resolving) => {
    if (Array.isArray(node)) return node.map((child) => walk(child, resolving));
    if (!node || typeof node !== "object") return node;
    const { $ref, ...rest } = node;
    if (typeof $ref === "string" && $ref.startsWith("#/$defs/")) {
      const name = $ref.slice("#/$defs/".length);
      if (name in definitions) {
        if (resolving.has(name)) {
          looped = true;
          return {};
        }
        const target = walk(definitions[name], /* @__PURE__ */ new Set([...resolving, name]));
        return { ...target, ...walk(rest, resolving) };
      }
    }
    const out = {};
    for (const [key, child] of Object.entries(node)) {
      if (key === "$defs" && resolving.size === 0 && node === schema) continue;
      out[key] = walk(child, resolving);
    }
    return out;
  };
  const inlined = walk(schema, /* @__PURE__ */ new Set());
  return looped ? inlined : schema;
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function resolveLocalDefRef(value, defs) {
  let current = value;
  const seen = /* @__PURE__ */ new Set();
  while (isPlainObject(current) && typeof current.$ref === "string" && current.$ref.startsWith("#/$defs/")) {
    const name = current.$ref.slice("#/$defs/".length);
    const target = defs?.[name];
    if (!isPlainObject(target) || seen.has(name)) return void 0;
    seen.add(name);
    const sibling = { ...current };
    delete sibling.$ref;
    current = { ...target, ...sibling };
  }
  return isPlainObject(current) ? current : void 0;
}
function allowedEnumValues(schema, defs) {
  const resolved = resolveLocalDefRef(schema, defs);
  if (!resolved) return void 0;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum;
  if (resolved.const !== void 0) return [resolved.const];
  return void 0;
}
function mergePropertySchemas(first, second, defs) {
  const firstValues = allowedEnumValues(first, defs);
  const secondValues = allowedEnumValues(second, defs);
  if (firstValues && secondValues) {
    const seen = /* @__PURE__ */ new Set();
    const union = [];
    for (const val of [...firstValues, ...secondValues]) {
      const key = JSON.stringify(val);
      if (!seen.has(key)) {
        seen.add(key);
        union.push(val);
      }
    }
    const base = { ...resolveLocalDefRef(first, defs) ?? {} };
    delete base.const;
    return { ...base, enum: union };
  }
  if (JSON.stringify(first) === JSON.stringify(second)) return first;
  const firstResolved = resolveLocalDefRef(first, defs) ?? first;
  const secondResolved = resolveLocalDefRef(second, defs) ?? second;
  const existingBranches = isPlainObject(firstResolved) && Array.isArray(firstResolved.anyOf) ? firstResolved.anyOf : [firstResolved];
  return { anyOf: [...existingBranches, secondResolved] };
}
function mergeBranchProperties(target, source, defs) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = key in target ? mergePropertySchemas(target[key], value, defs) : value;
  }
}
function collectBranchInfo(branches, mode, defs) {
  const properties = {};
  let sawObjectBranch = false;
  let allBranchesFalseAdditionalProps = true;
  let hasExplicitFalseAdditionalProps = false;
  const branchRequiredSets = [];
  const allOfRequiredSets = [];
  for (const branch of branches) {
    const resolved = resolveLocalDefRef(branch, defs);
    if (!resolved) continue;
    const nestedUnion = Array.isArray(resolved.oneOf) ? resolved.oneOf : Array.isArray(resolved.anyOf) ? resolved.anyOf : void 0;
    const nestedAll = Array.isArray(resolved.allOf) ? resolved.allOf : void 0;
    let branchIsObject = resolved.type === "object" || isPlainObject(resolved.properties);
    const branchRequired = /* @__PURE__ */ new Set();
    if (isPlainObject(resolved.properties)) {
      mergeBranchProperties(properties, resolved.properties, defs);
      sawObjectBranch = true;
    }
    if (resolved.additionalProperties === false) {
      hasExplicitFalseAdditionalProps = true;
    } else if (isPlainObject(resolved.properties) || !nestedUnion && !nestedAll) {
      if (branchIsObject) allBranchesFalseAdditionalProps = false;
    }
    if (Array.isArray(resolved.required)) {
      for (const k of resolved.required) {
        if (typeof k === "string") branchRequired.add(k);
      }
    }
    if (nestedUnion) {
      const inner = collectBranchInfo(nestedUnion, "union", defs);
      if (inner.sawObjectBranch) {
        mergeBranchProperties(properties, inner.properties, defs);
        sawObjectBranch = true;
        branchIsObject = true;
        if (inner.hasExplicitFalseAdditionalProps) hasExplicitFalseAdditionalProps = true;
        if (!inner.allBranchesFalseAdditionalProps) allBranchesFalseAdditionalProps = false;
        for (const r of inner.required) branchRequired.add(r);
      }
    }
    if (nestedAll) {
      const inner = collectBranchInfo(nestedAll, "all", defs);
      if (inner.sawObjectBranch) {
        mergeBranchProperties(properties, inner.properties, defs);
        sawObjectBranch = true;
        branchIsObject = true;
        if (inner.hasExplicitFalseAdditionalProps) hasExplicitFalseAdditionalProps = true;
        if (!inner.allBranchesFalseAdditionalProps) allBranchesFalseAdditionalProps = false;
        for (const r of inner.required) branchRequired.add(r);
      }
    }
    if (branchIsObject) {
      if (mode === "all") allOfRequiredSets.push(branchRequired);
      else branchRequiredSets.push(branchRequired);
    }
  }
  let finalRequired = [];
  if (mode === "union") {
    if (branchRequiredSets.length > 0) {
      const [first, ...rest] = branchRequiredSets;
      finalRequired = [...first].filter((key) => rest.every((s) => s.has(key)));
    }
  } else {
    const union = /* @__PURE__ */ new Set();
    for (const set of allOfRequiredSets) {
      for (const k of set) union.add(k);
    }
    finalRequired = [...union];
  }
  return {
    properties,
    required: finalRequired,
    allBranchesFalseAdditionalProps: sawObjectBranch ? allBranchesFalseAdditionalProps : false,
    hasExplicitFalseAdditionalProps,
    sawObjectBranch
  };
}
function flattenRootUnionSchema(schema) {
  if (!isPlainObject(schema)) return schema;
  const defs = isPlainObject(schema.$defs) ? schema.$defs : void 0;
  let root = schema;
  if (typeof root.$ref === "string" && root.$ref.startsWith("#/$defs/")) {
    const resolved = resolveLocalDefRef(root, defs);
    if (resolved) root = { ...resolved, ...defs ? { $defs: defs } : {} };
  }
  const unionBranches = [
    ...Array.isArray(root.oneOf) ? root.oneOf : [],
    ...Array.isArray(root.anyOf) ? root.anyOf : []
  ];
  const allBranches = Array.isArray(root.allOf) ? root.allOf : [];
  if (unionBranches.length === 0 && allBranches.length === 0) return schema;
  const mergedProperties = isPlainObject(root.properties) ? { ...root.properties } : {};
  const requiredSet = /* @__PURE__ */ new Set();
  if (Array.isArray(root.required)) {
    for (const r of root.required) if (typeof r === "string") requiredSet.add(r);
  }
  let sawObject = isPlainObject(root.properties);
  const allowsAdditional = root.additionalProperties === true;
  let hasExplicitFalse = root.additionalProperties === false;
  let allBranchesClosed = root.additionalProperties === false || root.additionalProperties === void 0;
  if (unionBranches.length > 0) {
    const res = collectBranchInfo(unionBranches, "union", defs);
    if (res.sawObjectBranch) {
      mergeBranchProperties(mergedProperties, res.properties, defs);
      for (const r of res.required) requiredSet.add(r);
      sawObject = true;
      if (res.hasExplicitFalseAdditionalProps) hasExplicitFalse = true;
      if (!res.allBranchesFalseAdditionalProps) allBranchesClosed = false;
    }
  }
  if (allBranches.length > 0) {
    const res = collectBranchInfo(allBranches, "all", defs);
    if (res.sawObjectBranch) {
      mergeBranchProperties(mergedProperties, res.properties, defs);
      for (const r of res.required) requiredSet.add(r);
      sawObject = true;
      if (res.hasExplicitFalseAdditionalProps) hasExplicitFalse = true;
      if (!res.allBranchesFalseAdditionalProps) allBranchesClosed = false;
    }
  }
  if (!sawObject) return schema;
  const isClosed = hasExplicitFalse && allBranchesClosed && !allowsAdditional;
  const out = {
    type: "object",
    properties: mergedProperties,
    additionalProperties: isClosed ? false : true
  };
  if (requiredSet.size > 0) out.required = [...requiredSet];
  if (defs) out.$defs = defs;
  if (typeof root.description === "string") out.description = root.description;
  return out;
}
function normalizeToolSchemaForNpm(schema, npm) {
  const acyclic = npm && RECURSION_SAFE_NPM.has(npm) ? schema : breakRecursiveSchemaRefs(schema);
  const portable = rewriteNulPatternEscapes(acyclic);
  if (!npm || !RECURSION_SAFE_NPM.has(npm)) {
    const flattened = flattenRootUnionSchema(portable);
    if (!npm || !GOOGLE_NPM.has(npm)) return flattened;
    return fixGoogleArraySchemas(collapseSchemaUnionTypes(flattened));
  }
  return portable;
}

export {
  normalizeToolSchemaForNpm
};
//# sourceMappingURL=chunk-UR4QFFSQ.js.map