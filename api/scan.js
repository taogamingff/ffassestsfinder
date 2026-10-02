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
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method Not Allowed"
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const tasks = Array.isArray(body.tasks)
      ? body.tasks
      : [];

    const timeout = Math.min(
      Math.max(
        Number(body.timeout) || 1200,
        300
      ),
      3000
    );

    // 50 worker đồng thời
    const concurrency = Math.min(
      Math.max(
        Number(body.concurrency) || 50,
        1
      ),
      50
    );

    if (!tasks.length) {
      return res.status(400).json({
        success: false,
        error: "No scan tasks supplied",
        assets: []
      });
    }

    /*
      Frontend gửi 100 task mỗi request.
      API xử lý tối đa 50 request đồng thời.
    */
    const cleanTasks = tasks
      .filter(
        t =>
          t &&
          typeof t.url === "string" &&
          /^https?:\/\//i.test(t.url)
      )
      .slice(0, 100);

    const assets = [];

    let cursor = 0;

    async function scanOne(task) {
      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () => controller.abort(),
          timeout
        );

      try {

        const response =
          await fetch(
            task.url,
            {
              method: "GET",
              redirect: "follow",
              signal:
                controller.signal,

              headers: {
                "User-Agent":
                  "FFVN-TGM-Scanner/1.0",

                "Accept":
                  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
              }
            }
          );

        if (response.ok) {

          assets.push({
            url: task.url,
            fname: task.fname || "",
            grp: task.grp || "",
            type: task.type || "",
            pre: task.pre || "",
            status: response.status
          });

        }

      } catch (_) {

        // Resource không tồn tại / timeout
        // sẽ không được trả về.

      } finally {

        clearTimeout(timer);

      }
    }

    async function worker() {

      while (true) {

        const index =
          cursor++;

        if (
          index >=
          cleanTasks.length
        ) {
          return;
        }

        await scanOne(
          cleanTasks[index]
        );
      }
    }

    await Promise.all(
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              cleanTasks.length
            )
        },
        () => worker()
      )
    );

    return res.status(200).json({
      success: true,

      total:
        cleanTasks.length,

      scanned:
        cleanTasks.length,

      found:
        assets.length,

      concurrency,

      timeout,

      assets
    });

  } catch (error) {

    return res.status(500).json({
      success: false,

      error:
        "Scan API failed",

      message:
        error?.message ||
        "Unknown error",

      assets: []
    });

  }
}
