export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).error || detail;
    } catch {
      /* non-json */
    }
    throw new Error(detail);
  }
  return res.json();
}
