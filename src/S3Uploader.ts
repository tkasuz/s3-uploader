const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
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
  etag: string | undefined;
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
  public resumableParts: Part[] = [];
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
  
  
  public async startUploadWorker(start: number, end: number, partNumber: number): Promise<Part> {
    return new Promise(async (resolve) => {
      const url = await this.callbacks.generatePresignedUrl({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        clientMethod: ClientMethod.UploadPart.toString(),
        partNumber: partNumber,
        uploadId: this.uploadId,
      });
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
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
      number_of_parts = Math.ceil(this.file.size / CHUNK_SIZE)
    }
    console.log("Number of parts: ", number_of_parts);
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
    const promises: Promise<Part>[] = [];
    for (let start = 0; start < this.file.size; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, this.file.size);
      promises.push(this.startUploadWorker(start, end, partNumber));
      partNumber += 1;
    }
    const parts = await Promise.all(promises);
    this.resumableParts = parts.filter(part => part.etag === undefined);
    if (this.resumableParts.length == 0){
      try {
        await this.callbacks.completeMultipartUpload({
          bucketName: this.bucketName,
          objectKey: this.objectKey,
          parts: parts,
          uploadId: uploadId,
        });
        this.updateStatus(S3UploadStatus.Success);
      } catch {
        this.updateStatus(S3UploadStatus.Failed);
      }
    } else {
      this.parts = parts.filter(part => part.etag !== undefined);
      this.updateStatus(S3UploadStatus.Failed)
    }
  }

  /**
   * resume
   */
  public async resume() {
    if (
      this.parts.length == 0 ||
      [
        S3UploadStatus.Ready,
        S3UploadStatus.Success,
        S3UploadStatus.Uploading,
      ].includes(this.status)
    ) {
      throw Error;
    }
    const promises: Promise<any>[] = [];
    for (let part of this.parts) {
      if (part.etag === undefined){
        const start = CHUNK_SIZE * (part.partNumber - 1);
        const end = Math.min(CHUNK_SIZE * part.partNumber, this.file.size);
        promises.push(this.startUploadWorker(start, end, part.partNumber));
      }
    }
    const parts = await Promise.all(promises);
    this.resumableParts = parts.filter(part => part.etag === undefined);
    if (this.resumableParts.length == 0){
      try {
        await this.callbacks.completeMultipartUpload({
          bucketName: this.bucketName,
          objectKey: this.objectKey,
          parts: this.parts.concat(parts),
          uploadId: this.uploadId,
        });
        this.updateStatus(S3UploadStatus.Success);
      } catch {
        this.updateStatus(S3UploadStatus.Failed);
      }
    } else {
      this.parts = this.parts.concat(parts.filter(part => part.etag !== undefined));
    }
  }
}
