export async function loadCatalog(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  return resp.arrayBuffer();
}
