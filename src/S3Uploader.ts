const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
export enum S3UploadStatus {
  Ready = "Ready",
  Success = "Success",
  Failed = "Fail",
  Uploading = "Uploading",
  Aborted = "Aborted",
}
enum ClientMethod {
  UploadPart = "upload_part",
  PutObject = "put_object",
}
type Part = {
  etag: string;
  partNumber: number;
};
export type S3UploadCallbacks = {
  generatePresignedUrl: GeneratePresignedUrl;
  createMultipartUpload: CreateMultiparUpload;
  completeMultipartUpload: CompleteMultiparUpload;
  onUploadStatusChange?: OnUploadStatusChange;
};

export type OnUploadStatusChange = (input: { status: S3UploadStatus }) => void;

export type GeneratePresignedUrlInput = {
  bucketName: string;
  objectKey: string;
  clientMethod: string;
  uploadId: string | null;
  partNumber: number | null;
};
export type GeneratePresignedUrl = (
  input: GeneratePresignedUrlInput
) => Promise<URL>;


export type CreateMultiparUploadInput = {
  bucketName: string;
  objectKey: string;
  contentType: string;
  filename: string;
};
export type CreateMultiparUpload = (
  input: CreateMultiparUploadInput
) => Promise<string>;
export type CompleteMultiparUploadInput = {
  bucketName: string;
  objectKey: string;
  uploadId: string | null;
  parts: (Part | null)[];
};
export type CompleteMultiparUpload = (
  input: CompleteMultiparUploadInput
) => Promise<void>;

export class S3Uploader {
  public file: File;
  public bucketName: string;
  public objectKey: string;
  private callbacks: S3UploadCallbacks;
  public status: S3UploadStatus = S3UploadStatus.Ready;
  public parts: Part[] = [];
  public uploadId: string | null = null;

  constructor(
    file: File,
    bucketName: string,
    objectKey: string,
    callbacks: S3UploadCallbacks
  ) {
    this.file = file;
    this.bucketName = bucketName;
    this.objectKey = objectKey;
    this.callbacks = callbacks;
  }

  private updateStatus(status: S3UploadStatus) {
    if (this.callbacks.onUploadStatusChange) {
      this.callbacks.onUploadStatusChange({ status: status });
    }
    this.status = status;
  }
  
  
  private async startUploadWorker(start: number, end: number, partNumber: number): Promise<Part> {
    console.log(start, end, partNumber)
    return new Promise(async (resolve) => {
      const url = await this.callbacks.generatePresignedUrl({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        clientMethod: ClientMethod.UploadPart.toString(),
        partNumber: partNumber,
        uploadId: this.uploadId,
      });
      const worker = new Worker(new URL('./worker.js', import.meta.url));
      worker.onmessage = (event: MessageEvent) => {
        const etag = event.data;
        resolve({
          "etag": etag,
          "partNumber": partNumber
        } as Part)
      }
      worker.postMessage({
        "file": this.file,
        "url": url,
        "start": start,
        "end": end,
      })
    });
  }

  /**
   * upload
   */
  public async upload() {
    let number_of_parts = 1; 
    if (this.file.size > CHUNK_SIZE) {
      number_of_parts = Math.floor(this.file.size / CHUNK_SIZE)
    }
    console.log(number_of_parts);
    if (number_of_parts < 2) {
      const presignedUrl = await this.callbacks.generatePresignedUrl({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        clientMethod: ClientMethod.PutObject.toString(),
        partNumber: null,
        uploadId: null,
      });
      await fetch(
        presignedUrl,
        {
          body: this.file,
          method: "PUT",
          headers: {
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Expose-Headers": "ETag",
            "Content-Type": this.file.type,
            "Content-Disposition": `attachment; filename=\"${this.file.name}\"`
          }
        }
      )
      this.updateStatus(S3UploadStatus.Success)
      return;
    }
    const uploadId = await this.callbacks.createMultipartUpload({
      bucketName: this.bucketName,
      objectKey: this.objectKey,
      contentType: this.file.type,
      filename: this.file.name
    });
    this.uploadId = uploadId;
    let partNumber = 1;
    const promises: Promise<any>[] = [];
    for (let start = 0; start < this.file.size; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, this.file.size);
      promises.push(this.startUploadWorker(start, end, partNumber));
      partNumber += 1;
    }
    const parts = await Promise.all(promises);
    console.log(parts);
    try {
      await this.callbacks.completeMultipartUpload({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        parts: parts.filter((part: Part) => part.etag !== undefined),
        uploadId: uploadId,
      });
      this.updateStatus(S3UploadStatus.Success);
    } catch {
      this.updateStatus(S3UploadStatus.Failed);
    }
  }

  /**
   * resume
   */
  // public async resume() {
  //   // if (
  //   //   this.resumableParts.length == 0 ||
  //   //   [
  //   //     S3UploadStatus.Ready,
  //   //     S3UploadStatus.Success,
  //   //     S3UploadStatus.Uploading,
  //   //   ].includes(this.status)
  //   // ) {
  //   //   throw Error;
  //   // }
  //   // const promises = [];
  //   // const size = this.resumableParts.length;
  //   // for (let i = 0; i < size; i++) {
  //   //   const promise = new Promise((resolve) => {
  //   //     const part = this.resumableParts.pop()!;
  //   //     let fileReader = new FileReader();
  //   //     fileReader.onload = async (event: ProgressEvent<FileReader>) => {
  //   //       const presignedUrl = await this.callbacks.generatePresignedUrl!({
  //   //         bucketName: this.bucketName,
  //   //         objectKey: this.objectKey,
  //   //         clientMethod: ClientMethod.UploadPart.toString(),
  //   //         partNumber: part.partNumber,
  //   //         uploadId: this.uploadId,
  //   //       });
  //   //       const data = event.target?.result;
  //   //       let byte = new Uint8Array(data as ArrayBuffer);
  //   //       const etag = await request(presignedUrl.toString(), byte);
  //   //       if (etag === undefined) {
  //   //         this.resumableParts.push({
  //   //           partNumber: part.partNumber,
  //   //           start: part.start,
  //   //           end: part.end,
  //   //         });
  //   //       }
  //   //       resolve({
  //   //         partNumber: part.partNumber,
  //   //         etag: etag,
  //   //       } as Part);
  //   //       fileReader.abort();
  //   //     };
  //   //     read(fileReader, this.file as File, part.start, part.end);
  //   //   });
  //   //   promises.push(promise);
  //   // }
  //   // const parts = await Promise.all(promises);
  //   // try {
  //   //   await this.callbacks.completeMultipartUpload({
  //   //     bucketName: this.bucketName,
  //   //     objectKey: this.objectKey,
  //   //     parts: parts as Part[],
  //   //     uploadId: this.uploadId,
  //   //   });
  //   //   this.updateStatus(S3UploadStatus.Success);
  //   // } catch {
  //   //   this.updateStatus(S3UploadStatus.Failed);
  //   // }
  // }
}
