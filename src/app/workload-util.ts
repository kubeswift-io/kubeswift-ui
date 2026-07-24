type Obj = Record<string, unknown>;

/** defaultPodSpec is the create-mode starting point (one empty container). */
export function defaultPodSpec(): Obj {
  return { containers: [{ name: 'main', image: '' }] };
}

/** extractPodTemplate reads the pod spec from a Deployment-family / Job object. */
export function extractPodTemplate(obj: Obj): Obj {
  const spec = (obj['spec'] ?? {}) as Obj;
  const tmpl = (spec['template'] ?? {}) as Obj;
  return ((tmpl['spec'] ?? {}) as Obj) || {};
}

/**
 * applyDeployTemplate writes the pod spec into spec.template.spec and ensures a
 * matching label + selector. spec.selector is IMMUTABLE on an existing object,
 * so it (and the template labels) are only set when absent — preserving them on
 * edit and stamping `app: <name>` on create.
 */
export function applyDeployTemplate(base: Obj, podSpec: Obj, name: string, wantSelector = true): void {
  const spec = (base['spec'] = (base['spec'] ?? {}) as Obj) as Obj;
  const tmpl = (spec['template'] = (spec['template'] ?? {}) as Obj) as Obj;
  const meta = (tmpl['metadata'] = (tmpl['metadata'] ?? {}) as Obj) as Obj;
  if (!meta['labels'] || Object.keys(meta['labels'] as Obj).length === 0) {
    meta['labels'] = { app: name };
  }
  tmpl['spec'] = podSpec;
  if (wantSelector && !spec['selector']) {
    spec['selector'] = { matchLabels: meta['labels'] };
  }
}

/** intOrUndef returns a trimmed numeric value or undefined (for optional int fields). */
export function intOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
