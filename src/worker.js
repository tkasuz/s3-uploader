import init, {upload, getPartNumberFromPresignedUrl} from './../rust/pkg/s3_multipart_upload.js'

onmessage = async event => {
    await init()
    let partNumber = null;
    console.log(event.data.partNumber)
    console.log(event.data.file)
    console.log(event.data.start)
    console.log(event.data.url)
    if (event.data.partNumber !== undefined){
        partNumber = getPartNumberFromPresignedUrl(event.data.url);
        if (partNumber === undefined){
            postMessage({
                "etag": null,
                "partNumber": null
            })
        }
    }
    let etag = await upload(event.data.file, event.data.url, event.data.start, event.data.end);
    if (etag === undefined){
        postMessage({
            "etag": null,
            "partNumber": partNumber
        })
    } else {
        postMessage({
            "etag": etag,
            "partNumber": partNumber 
        });
    }
};