import init, {read, request, get_number_of_parts, Part} from 'rust';

const FIVE_MB = 1024 * 1024 * 5; // 5MB
export enum S3UploadStatus {
    Ready = "Ready",
    Success = "Success",
    Failed = "Fail",
    Uploading = "Uploading",
    Aborted = "Aborted",
}
enum ClientMethod {
    UploadPart = "upload_part",
    PutObject = "put_object"
}
export type S3UploadCallbacks = {
    generatePresignedUrls: GeneratePresignedUrls,
    createMultipartUpload: CreateMultiparUpload,
    completeMultipartUpload: CompleteMultiparUpload,  
    onUploadStatusChange?: OnUploadStatusChange
}

export type OnUploadStatusChange = (input: {status: S3UploadStatus}) => void;

export type GeneratePresignedUrlsInput = {
    bucketName: string,
    objectKey: string,
    clientMethod: string,
    uploadId: string | null,
    partNumbers: number[] | null    
}
export type GeneratePresignedUrls = (input: GeneratePresignedUrlsInput) => Promise<URL[]>;

export type CreateMultiparUploadInput = {
    bucketName: string,
    objectKey: string,
}
export type CreateMultiparUpload = (input: CreateMultiparUploadInput) => Promise<string>;
export type CompleteMultiparUploadInput = {
    bucketName: string,
    objectKey: string,
    uploadId: string | null,
    parts: Part[]
}
export type CompleteMultiparUpload = (input: CompleteMultiparUploadInput) => Promise<void>;

export class S3Uploader {
    public bucketName: string
    public objectKey: string
    private callbacks: S3UploadCallbacks
    public status: S3UploadStatus = S3UploadStatus.Ready
    public parts: Part[] = []
    public resumableParts: number[] = []
    protected constructor(bucketName: string, objectKey: string, callbacks: S3UploadCallbacks){
        this.bucketName = bucketName
        this.objectKey = objectKey
        this.callbacks = callbacks 
	}
    private updateStatus(status: S3UploadStatus) {
        if (this.callbacks.onUploadStatusChange){
            this.callbacks.onUploadStatusChange({status: status})
        }
        this.status = status
    }
    /**
     * name
     */
    public static async build(bucketName: string, objectKey: string, callbacks: S3UploadCallbacks) {
        await init();
        const uploader = new S3Uploader(bucketName, objectKey, callbacks);
        return uploader;
    }


    /**
     * upload
     */
    public async upload(file: File) {
        if (file.size == 0){
            throw Error
        };
        const number_of_parts: number = get_number_of_parts(file.size)
        if (number_of_parts < 2){
            const presignedUrls = await this.callbacks.generatePresignedUrls({
                bucketName: this.bucketName,
                objectKey: this.objectKey,
                clientMethod: ClientMethod.PutObject.toString(),
                partNumbers: null, 
                uploadId: null,
            });
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer) 
            try {
                await request(presignedUrls[0].toString(), bytes)
                this.updateStatus(S3UploadStatus.Success)
            } catch (err){
                console.log(err)
                this.updateStatus(S3UploadStatus.Failed)
            }
            return
        }
        const uploadId = await this.callbacks.createMultipartUpload({
            bucketName: this.bucketName,
            objectKey: this.objectKey
        });
        const presignedUrls = await this.callbacks.generatePresignedUrls({
            bucketName: this.bucketName,
            objectKey: this.objectKey,
            clientMethod: ClientMethod.UploadPart.toString(),
            partNumbers: Array.from({length: number_of_parts}, (_, i) => i + 1),
            uploadId: uploadId,
        });
        const promises = [];
        let rangeStart = 0;
        for (let presignedUrl of presignedUrls) {
            const end = Math.min(rangeStart + FIVE_MB, file.size);
            const promise = new Promise((resolve)=>{
                let fileReader =  new FileReader();
                fileReader.onload = (event: ProgressEvent<FileReader>)=>{
                    const data = event.target?.result;
                    let byte = new Uint8Array(data as ArrayBuffer);
                    request(presignedUrl.toString(), byte).then(part => {
                        resolve(part)
                    }).catch((partNumber) => {
                       this.resumableParts.push(partNumber);
                    });
                    fileReader.abort();
                };
                read(fileReader, file, rangeStart, end)
            })
            promises.push(promise);
        }
        const parts = await Promise.all(promises) as Part[];
        if (parts.length != number_of_parts){
            throw Error
        }
        try {
            await this.callbacks.completeMultipartUpload({
                bucketName: this.bucketName,
                objectKey: this.objectKey,
                parts: parts,
                uploadId: uploadId
            });
            this.updateStatus(S3UploadStatus.Success)
        } catch {
            this.updateStatus(S3UploadStatus.Failed)
        }
    }

    /**
     * resume
     */
    public resume() {
        
    }
}