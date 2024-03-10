import init, {upload} from './../rust/pkg/s3_multipart_upload.js'

onmessage = async event => {
    await init()
    let etag = await upload(event.data.file, event.data.url, event.data.start, event.data.end);
    postMessage(etag)
};