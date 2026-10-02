export default async function handler(req, res) {

    /*
     * CORS
     */

    res.setHeader(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.setHeader(
        "Access-Control-Allow-Methods",
        "POST, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    /*
     * OPTIONS
     */

    if(req.method === "OPTIONS"){
        return res.status(200).end();
    }

    /*
     * Only POST
     */

    if(req.method !== "POST"){

        return res.status(405).json({
            success:false,
            error:"METHOD_NOT_ALLOWED"
        });

    }

    try{

        const body =
            req.body || {};

        const urls =
            Array.isArray(body.urls)
                ? body.urls
                : [];

        /*
         * Validate
         */

        if(!urls.length){

            return res.status(400).json({
                success:false,
                error:"URL_LIST_EMPTY",
                message:"No URLs supplied"
            });

        }

        /*
         * Limit URL count
         *
         * This prevents an accidental
         * extremely large request.
         */

        const MAX_URLS = 5000;

        const scanUrls =
            urls
            .slice(0, MAX_URLS)
            .filter(
                url =>
                    typeof url === "string" &&
                    /^https?:\/\//i.test(url)
            );

        /*
         * 50 concurrent workers
         */

        const MAX_WORKERS = 50;

        /*
         * 1.2 seconds timeout
         */

        const TIMEOUT = 1200;

        const results =
            new Array(
                scanUrls.length
            );

        let cursor = 0;


        /*
         * Check one URL
         */

        async function checkURL(url){

            const controller =
                new AbortController();

            const timer =
                setTimeout(
                    () => {
                        controller.abort();
                    },
                    TIMEOUT
                );

            const started =
                Date.now();

            try{

                let response;

                /*
                 * HEAD is much cheaper than
                 * downloading the image.
                 */

                try{

                    response =
                        await fetch(
                            url,
                            {
                                method:"HEAD",
                                redirect:"follow",
                                signal:
                                    controller.signal
                            }
                        );

                }catch{

                    /*
                     * Some CDNs don't support
                     * HEAD correctly.
                     *
                     * Fall back to GET while
                     * requesting no body.
                     */

                    response =
                        await fetch(
                            url,
                            {
                                method:"GET",
                                redirect:"follow",
                                signal:
                                    controller.signal,
                                headers:{
                                    "Range":
                                        "bytes=0-0"
                                }
                            }
                        );

                }

                const elapsed =
                    Date.now() -
                    started;

                return {

                    url,

                    found:
                        response.ok,

                    status:
                        response.status,

                    elapsed

                };

            }catch(error){

                const elapsed =
                    Date.now() -
                    started;

                return {

                    url,

                    found:false,

                    status:0,

                    elapsed,

                    error:
                        error?.name ===
                        "AbortError"
                            ? "TIMEOUT"
                            : "REQUEST_FAILED"

                };

            }finally{

                clearTimeout(
                    timer
                );

            }

        }


        /*
         * Worker
         */

        async function worker(){

            while(true){

                const index =
                    cursor++;

                if(
                    index >=
                    scanUrls.length
                ){
                    return;
                }

                results[index] =
                    await checkURL(
                        scanUrls[index]
                    );

            }

        }


        /*
         * Start 50 workers
         */

        const workerCount =
            Math.min(
                MAX_WORKERS,
                scanUrls.length
            );

        const workers =
            Array.from(
                {
                    length:
                        workerCount
                },
                () => worker()
            );

        await Promise.all(
            workers
        );


        /*
         * Only return found assets
         */

        const found =
            results.filter(
                item =>
                    item &&
                    item.found
            );

        /*
         * Statistics
         */

        const successCount =
            found.length;

        const failedCount =
            results.length -
            successCount;


        /*
         * Response
         */

        return res.status(200).json({

            success:true,

            total:
                scanUrls.length,

            found:
                successCount,

            failed:
                failedCount,

            workers:
                workerCount,

            timeout:
                TIMEOUT,

            results:
                found

        });

    }catch(error){

        console.error(
            "SCAN API ERROR:",
            error
        );

        return res.status(500).json({

            success:false,

            error:
                "SCAN_FAILED",

            message:
                error?.message ||
                "Unknown scan error"

        });

    }

}
