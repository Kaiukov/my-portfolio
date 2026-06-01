export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function putKvValueViaApi(opts: {
  accountId: string;
  namespaceId: string;
  key: string;
  value: string;
  apiToken: string;
  fetchImpl?: FetchLike;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/storage/kv/namespaces/${opts.namespaceId}/values/${encodeURIComponent(opts.key)}`;

  try {
    const res = await fetchFn(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        "Content-Type": "text/plain",
      },
      body: opts.value,
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `KV API put failed (status ${res.status}): ${await res.text()}`,
      };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
