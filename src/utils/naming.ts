export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function pluralize(s: string): string {
  if (s.endsWith('s')) return s;
  if (s.endsWith('y') && !s.endsWith('ay') && !s.endsWith('ey') && !s.endsWith('oy') && !s.endsWith('uy')) {
    return s.slice(0, -1) + 'ies';
  }
  if (s.endsWith('ch') || s.endsWith('sh') || s.endsWith('x') || s.endsWith('z')) {
    return s + 'es';
  }
  return s + 's';
}

export function singularize(s: string): string {
  if (s.endsWith('ies') && s.length > 4) return s.slice(0, -3) + 'y';
  if (s.endsWith('ses') || s.endsWith('xes') || s.endsWith('zes') || s.endsWith('ches') || s.endsWith('shes')) {
    return s.slice(0, -2);
  }
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

export function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
