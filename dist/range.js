/* Shared by the service worker and Node tests. No dependencies. */
(function (root) {
  root.parseByteRange = function (header, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (!match[1] && !match[2]) || size <= 0) return null;
    let start, end;
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
      end = Math.min(end, size - 1);
    }
    return {start, end};
  };
  root.cachedMediaResponse = async function (response, rangeHeader) {
    if (!rangeHeader) return response;
    const blob = await response.blob();
    const range = root.parseByteRange(rangeHeader, blob.size);
    if (!range) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${blob.size}`, 'Accept-Ranges': 'bytes'}});
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${blob.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(blob.slice(range.start, range.end + 1, blob.type), {status: 206, headers});
  };
})(globalThis);
