export default async function handler(req,res){

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

    if(req.method==="OPTIONS"){
        return res.status(200).end();
    }

    if(req.method!=="POST"){
        return res.status(405).json({
            success:false,
            error:"METHOD_NOT_ALLOWED"
        });
    }

    try{

        const body=req.body||{};

        if(!Array.isArray(body.urls)){
            return res.status(400).json({
                success:false,
                error:"URL_LIST_EMPTY"
            });
        }

        const urls=[
            ...new Set(
                body.urls
                .filter(
                    url=>
                        typeof url==="string" &&
                        /^https?:\/\//i.test(url)
                )
            )
        ].slice(0,5000);

        if(!urls.length){
            return res.status(400).json({
                success:false,
                error:"URL_LIST_EMPTY"
            });
        }

        const MAX_WORKERS=50;
        const TIMEOUT=1200;

        const results=
            new Array(urls.length);

        let cursor=0;

        async function check(url){

            const controller=
                new AbortController();

            const timer=
                setTimeout(
                    ()=>controller.abort(),
                    TIMEOUT
                );

            try{

                let response;

                try{

                    response=
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

                    response=
                        await fetch(
                            url,
                            {
                                method:"GET",
                                redirect:"follow",
                                signal:
                                    controller.signal,
                                headers:{
                                    Range:"bytes=0-0"
                                }
                            }
                        );
                }

                return {
                    url,
                    found:response.ok,
                    status:response.status
                };

            }catch(error){

                return {
                    url,
                    found:false,
                    status:0,
                    error:
                        error?.name==="AbortError"
                            ?"TIMEOUT"
                            :"REQUEST_FAILED"
                };

            }finally{

                clearTimeout(timer);

            }
        }


        async function worker(){

            while(true){

                const index=cursor++;

                if(index>=urls.length){
                    return;
                }

                results[index]=
                    await check(
                        urls[index]
                    );
            }
        }


        const workerCount=
            Math.min(
                MAX_WORKERS,
                urls.length
            );

        await Promise.all(
            Array.from(
                {length:workerCount},
                worker
            )
        );


        const found=
            results.filter(
                x=>x&&x.found
            );

        return res.status(200).json({

            success:true,

            total:urls.length,

            found:found.length,

            failed:
                urls.length-found.length,

            workers:workerCount,

            timeout:TIMEOUT,

            results:found

        });

    }catch(error){

        console.error(
            "SCAN ERROR",
            error
        );

        return res.status(500).json({

            success:false,

            error:"SCAN_FAILED",

            message:
                error?.message||
                "Unknown error"

        });
    }
}
