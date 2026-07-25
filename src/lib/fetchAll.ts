/**
 * Fetch EVERY row of a query, paging past PostgREST's silent 1000-row response
 * cap (which otherwise truncates results — and any client-side math on them —
 * without an error).
 *
 * `build` receives the range bounds and must apply `.range(from, to)` last.
 * Always give the query a deterministic `.order(...)` (with a unique
 * tiebreaker like `id`) or rows can shuffle between pages.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunk = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += chunk) {
    const { data, error } = await build(from, from + chunk - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < chunk) break;
  }
  return out;
}
