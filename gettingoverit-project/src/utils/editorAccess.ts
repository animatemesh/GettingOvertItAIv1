export function isLocalEditorHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

export function canUseMapEditor(): boolean {
  return typeof window !== 'undefined' && isLocalEditorHost(window.location.hostname);
}

export function stripEditorPath(pathname: string): string {
  const next = pathname.replace(/\/editor\/?$/, '/');
  return next || '/';
}
