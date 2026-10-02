const DEFAULT_TIMEOUT = 1200;
const DEFAULT_CONCURRENCY = 100;

function withTimeout(promise, timeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("TIMEOUT"));
      }, timeout);
    })
  ]);
}

async function scanUrl(url, timeout) {
  const started = Date.now();

  try {
    const response = await withTimeout(
      fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": "FFVN-TGM-Scanner/1.0"
        }
      }),
      timeout
    );

    return {
      url,
      status: response.ok
        ? "ONLINE"
        : `HTTP ${response.status}`,
      code: response.status,
      time: Date.now() - started
    };

  } catch (error) {
    return {
      url,
      status: error.message === "TIMEOUT"
        ? "TIMEOUT"
        : "ERROR",
      code: 0,
      time: Date.now() - started
    };
  }
}

async function runConcurrent(urls, concurrency, timeout) {
  const results = new Array(urls.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= urls.length) {
        return;
      }

      results[index] = await scanUrl(
        urls[index],
        timeout
      );
    }
  }

  const workers = Math.min(concurrency, urls.length);

  await Promise.all(
    Array.from(
      { length: workers },
      () => worker()
    )
  );

  return results;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  try {
    const body = req.body || {};

    const timeout = Math.min(
      Math.max(
        Number(body.timeout) || DEFAULT_TIMEOUT,
        100
      ),
      5000
    );

    const concurrency = Math.min(
      Math.max(
        Number(body.concurrency) || DEFAULT_CONCURRENCY,
        1
      ),
      100
    );

    /*
     * Danh sách URL có thể truyền từ frontend:
     *
     * {
     *   "urls": [
     *      "https://example.com",
     *      "https://example.org"
     *   ]
     * }
     *
     * Nếu không truyền urls thì trả về mảng rỗng.
     */
    const urls = Array.isArray(body.urls)
      ? body.urls
          .filter(
            url =>
              typeof url === "string" &&
              /^https?:\/\//i.test(url)
          )
          .slice(0, 10000)
      : [];

    const results = await runConcurrent(
      urls,
      concurrency,
      timeout
    );

    return res.status(200).json({
      success: true,
      total: urls.length,
      concurrency,
      timeout,
      results
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: "SCAN_FAILED",
      message: error.message
    });
  }
}
