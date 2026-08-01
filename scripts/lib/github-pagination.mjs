export function collectPaginated({
  fetchPage,
  unwrap = (payload) => payload,
  pageSize = 100,
  maxPages = 100,
  label = "collection",
} = {}) {
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage must be a function");
  }

  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = fetchPage(page);
    if (!response?.ok) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: response?.error || `${label} request failed`,
      };
    }

    let payload = response.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return {
          readable: false,
          complete: false,
          pages: page - 1,
          rows,
          error: `${label} returned invalid JSON`,
        };
      }
    }

    const chunk = unwrap(payload);
    if (!Array.isArray(chunk)) {
      return {
        readable: false,
        complete: false,
        pages: page - 1,
        rows,
        error: `${label} returned an unexpected payload`,
      };
    }

    rows.push(...chunk);
    const total = Number(payload?.total_count);
    if (
      chunk.length < pageSize ||
      (Number.isInteger(total) && rows.length >= total)
    ) {
      return {
        readable: true,
        complete: true,
        pages: page,
        rows,
        error: null,
      };
    }
  }

  return {
    readable: true,
    complete: false,
    pages: maxPages,
    rows,
    error: `${label} exceeded pagination safety limit`,
  };
}
