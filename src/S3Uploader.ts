import init, {get_number_of_parts, get_part_number_from_presigned_url, request, read} from "@s3-signurl-uploader/rust";

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
  generatePresignedUrl?: GeneratePresignedUrl;
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

export type GeneratePresignedUrlsInput = {
  bucketName: string;
  objectKey: string;
  clientMethod: string;
  uploadId: string | null;
  partNumbers: number[] | null;
};
export type GeneratePresignedUrls = (
  input: GeneratePresignedUrlsInput
) => Promise<URL[]>;

export type CreateMultiparUploadInput = {
  bucketName: string;
  objectKey: string;
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
type ResumablePart = {
  partNumber: number;
  start: number;
  end: number;
};

export class S3Uploader {
  public bucketName: string;
  public objectKey: string;
  private callbacks: S3UploadCallbacks;
  public status: S3UploadStatus = S3UploadStatus.Ready;
  public parts: Part[] = [];
  public resumableParts: ResumablePart[] = [];
  public uploadId: string | null = null;
  public file: File | null = null;
  constructor(
    bucketName: string,
    objectKey: string,
    callbacks: S3UploadCallbacks
  ) {
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

  private upload_part(partNumber: number, uploadId: string, start: number, end: number): Promise <Part | void>{
      return new Promise((resolve) => {
        let fileReader = new FileReader();
        fileReader.onload = async (event: ProgressEvent<FileReader>) => {
          const presignedUrl = await this.callbacks.generatePresignedUrl!({
            bucketName: this.bucketName,
            objectKey: this.objectKey,
            clientMethod: ClientMethod.UploadPart.toString(),
            partNumber: partNumber,
            uploadId: uploadId,
          });
          const data = event.target?.result;
          let byte = new Uint8Array(data as ArrayBuffer);
          const etag = await request(presignedUrl.toString(), byte);
          if (etag == undefined) {
            this.resumableParts.push({
              partNumber: partNumber,
              start: start,
              end: end,
            });
            resolve();
          } else {
            resolve({
              etag: etag,
              partNumber: partNumber,
            } as Part);
          }
          fileReader.abort();
        };
        read(fileReader, this.file!, start, end);
      });
  }

  /**
   * upload
   */
  public async upload(file: File) {
    await init() 
    this.file = file;
    const number_of_parts: number = get_number_of_parts(file.size);
    console.log(number_of_parts)
    if (number_of_parts < 2) {
      const presignedUrl = await this.callbacks.generatePresignedUrl!({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        clientMethod: ClientMethod.PutObject.toString(),
        partNumber: null,
        uploadId: null,
      });
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const etag = await request(presignedUrl.toString(), bytes);
      if (etag === undefined) {
        this.updateStatus(S3UploadStatus.Failed);
      } else {
        this.updateStatus(S3UploadStatus.Success);
      }
      return;
    }
    const uploadId = await this.callbacks.createMultipartUpload({
      bucketName: this.bucketName,
      objectKey: this.objectKey,
    });
    this.uploadId = uploadId;
    const promises = [];
    let partNumber = 1;
    for (let start = 0; start < file.size; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const promise = this.upload_part(partNumber, uploadId, start, end)
      promises.push(promise);
      partNumber += 1;
    }
    const parts = (await Promise.all(promises)) as Part[];
    if (parts.length != number_of_parts) {
      throw Error;
    }
    try {
      await this.callbacks.completeMultipartUpload({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        parts: parts.filter((part) => part !== null),
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
  public async resume() {
    if (
      this.resumableParts.length == 0 ||
      [
        S3UploadStatus.Ready,
        S3UploadStatus.Success,
        S3UploadStatus.Uploading,
      ].includes(this.status)
    ) {
      throw Error;
    }
    const promises = [];
    const size = this.resumableParts.length;
    for (let i = 0; i < size; i++) {
      const promise = new Promise((resolve) => {
        const part = this.resumableParts.pop()!;
        let fileReader = new FileReader();
        fileReader.onload = async (event: ProgressEvent<FileReader>) => {
          const presignedUrl = await this.callbacks.generatePresignedUrl!({
            bucketName: this.bucketName,
            objectKey: this.objectKey,
            clientMethod: ClientMethod.UploadPart.toString(),
            partNumber: part.partNumber,
            uploadId: this.uploadId,
          });
          const data = event.target?.result;
          let byte = new Uint8Array(data as ArrayBuffer);
          const etag = await request(presignedUrl.toString(), byte);
          if (etag === undefined) {
            this.resumableParts.push({
              partNumber: part.partNumber,
              start: part.start,
              end: part.end,
            });
          }
          resolve({
            partNumber: part.partNumber,
            etag: etag,
          } as Part);
          fileReader.abort();
        };
        read(fileReader, this.file as File, part.start, part.end);
      });
      promises.push(promise);
    }
    const parts = await Promise.all(promises);
    try {
      await this.callbacks.completeMultipartUpload({
        bucketName: this.bucketName,
        objectKey: this.objectKey,
        parts: parts as Part[],
        uploadId: this.uploadId,
      });
      this.updateStatus(S3UploadStatus.Success);
    } catch {
      this.updateStatus(S3UploadStatus.Failed);
    }
  }
}
