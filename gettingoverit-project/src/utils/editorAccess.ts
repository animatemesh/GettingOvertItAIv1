export function canUseMapEditor(): boolean {
  return typeof window !== 'undefined';
}

export function stripEditorPath(pathname: string): string {
  const next = pathname.replace(/\/editor\/?$/, '/');
  return next || '/';
}
