import {sleep} from './utils'

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_NUMBER_OF_WORKERS = 6; // Chrome has a limit of 6 connections per host name, and a max of 10 connections.
export enum S3UploadStatus {
  Ready = "Ready",
  Success = "Success",
  Failed = "Failed",
  Uploading = "Uploading",
  Aborted = "Aborted",
  Resumable = "Resumable"
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
  abortMultipartUpload?: AbortMultipartUpload; 
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
  uploadId: string;
  parts: Part[];
};
export type CompleteMultiparUpload = (
  input: CompleteMultiparUploadInput
) => Promise<void>;

export type AbortMultipartUploadInput = {
  bucketName: string;
  objectKey: string;
  uploadId: string;
};
export type AbortMultipartUpload = (
  input: AbortMultipartUploadInput
) => Promise<void>

export class S3Uploader {
  public file: File;
  public bucketName: string;
  public objectKey: string;
  private callbacks: S3UploadCallbacks;
  public status: S3UploadStatus = S3UploadStatus.Ready;
  public parts: Part[] = [];
  public resumableParts: Part[] = [];
  public uploadId: string | null = null;
  private numberOfWorkers: number = 0;

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
  
  private async waitForNextWebWorker(): Promise<void> {
      while (true) {
        if (this.numberOfWorkers < MAX_NUMBER_OF_WORKERS){
          break 
        }
        await sleep(10)
      }
      return
  }

  private isUploadAborted() {
    return this.status == S3UploadStatus.Aborted;
  }
  
  public async startUploadWorker(start: number, end: number, partNumber: number): Promise<Part> {
    if (this.isUploadAborted()){
      return {
        "etag": undefined,
        "partNumber": partNumber
      }
    }
    return new Promise(async (resolve) => {
      const presignedUrl = await this.callbacks.generatePresignedUrl({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        clientMethod: ClientMethod.UploadPart.toString(),
        partNumber: partNumber,
        uploadId: this.uploadId,
      });
      if (presignedUrl === undefined || presignedUrl === null){
        throw Error("generatePresignedUrl callback should return valid presigned url")
      }
      await this.waitForNextWebWorker()
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.numberOfWorkers += 1;
      worker.onmessage = (event: MessageEvent) => {
        const etag = event.data;
        worker.terminate()
        this.numberOfWorkers -= 1;
        resolve({
          "etag": etag,
          "partNumber": partNumber
        } as Part)
      }
      worker.postMessage({
        "file": this.file,
        "url": presignedUrl,
        "start": start,
        "end": end,
      })
      while (true) {
        if (this.isUploadAborted()){
          worker.terminate()
        }
        await sleep(1000)
      }
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
    if (number_of_parts < 2) {
      const presignedUrl = await this.callbacks.generatePresignedUrl({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        clientMethod: ClientMethod.PutObject.toString(),
        partNumber: null,
        uploadId: null,
      });
      if (presignedUrl === undefined || presignedUrl === null){
        throw Error("generatePresignedUrl callback should return valid presigned url")
      }
      try {
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
      } catch (err){
        this.updateStatus(S3UploadStatus.Failed)
        throw Error("Failed to upload file")
      }
    }
    if (this.isUploadAborted()) {
      return
    }
    const uploadId = await this.callbacks.createMultipartUpload({
      bucketName: this.bucketName,
      objectKey: this.objectKey,
      contentType: this.file.type,
      filename: this.file.name
    });
    if (uploadId === undefined || uploadId === null){
      throw Error("createMultipartUpload callback should return valid uploadId")
    }
    this.uploadId = uploadId;
    let partNumber = 1;
    const promises: Promise<Part>[] = [];
    if (this.isUploadAborted()) {
      return
    }
    for (let start = 0; start < this.file.size; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, this.file.size);
      promises.push(this.startUploadWorker(start, end, partNumber));
      partNumber += 1;
    }
    const parts = await Promise.all(promises);
    this.resumableParts = parts.filter(part => part.etag === undefined);
    if (this.isUploadAborted()){
      return
    }
    if (this.resumableParts.length === 0 && parts.length === number_of_parts){
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
        throw Error("Failed to complete multipart upload")
      }
    } else {
      this.parts = parts.filter(part => part.etag !== undefined);
      if (parts.length === 0){
        this.updateStatus(S3UploadStatus.Failed)
        throw Error("Failed to upload file")
      }
      this.updateStatus(S3UploadStatus.Resumable)
    }
  }

  /**
   * resume
   */
  public async resume() {
    if (this.status !== S3UploadStatus.Resumable) {
      throw Error("File is not resumable")
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
          uploadId: this.uploadId as string,
        });
        this.updateStatus(S3UploadStatus.Success);
      } catch {
        this.updateStatus(S3UploadStatus.Failed);
        throw Error("Failed to complete multipart upload")
      }
    } else {
      this.parts = this.parts.concat(parts.filter(part => part.etag !== undefined));
      if (parts.length === 0){
        this.updateStatus(S3UploadStatus.Failed)
        throw Error("Failed to resume file")
      }
      this.updateStatus(S3UploadStatus.Resumable)
    }
  }

  /**
   * abort
   */
  public async abort() {
    if (this.callbacks.abortMultipartUpload !== undefined){
      if (this.upload === null){
        throw Error("Multipart Upload has not yet been created.")
      }
      this.updateStatus(S3UploadStatus.Aborted)
      await this.callbacks.abortMultipartUpload({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        uploadId: this.uploadId as string
      });
    } else {
      throw Error("AbortMultipartUpload callback is not defined.")
    }
  }
}
