const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

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
	onProgress?: OnProgress;
};

export type OnUploadStatusChange = (input: { status: S3UploadStatus }) => void;

export type GeneratePresignedUrlInput = {
	bucketName: string;
	objectKey: string;
	clientMethod: string;
	uploadId?: string;
	partNumber?: number;
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
) => Promise<void>;

export type OnProgress = (
	input: { "loaded": number, "total": number }
) => void | Promise<void>;

interface SingleUploader {
	filename?: string | undefined;
	contentType?: string | undefined;
	upload(presignedUrl: URL, blob: Blob, onProgress: OnProgress): Promise<string>
}

class StreamUploader implements SingleUploader {
	filename?: string | undefined;
	constructor(filename: string) {
		this.filename = filename
	}
	async upload(presignedUrl: URL, blob: Blob, onProgress: OnProgress): Promise<string> {
		let loads = 0;
		const progressTrackingStream = new TransformStream<Uint8Array, Uint8Array>({
			transform: async (chunk, controller) => {
				controller.enqueue(chunk);
				loads += chunk.length
				await onProgress({
					loaded: loads,
					total: blob.size 
				})
			}
		});
		try {
			const headers: HeadersInit = new Headers();
			headers.set("Access-Control-Allow-Credentials", "true")
			headers.set("Access-Control-Expose-Headers", "ETag")
			headers.set("Content-Type", "application/octet-stream")
			headers.set("duplex", "half")
			if (this.filename){
				headers.set("Content-Disposition", `attachment; filename=\"${this.filename}\"`)
			}
			const res = await fetch(
				presignedUrl,
				{
					body: blob.stream().pipeThrough(progressTrackingStream),
					method: "PUT",
					headers: headers
				}
			)
			const etag = res.headers.get("ETag")
			if (etag) {
				return etag
			}
			throw Error("Failed to upload file")
		} catch (err) {
			throw Error("Failed to upload file")
		}
	}
}

class LegacyUploader implements SingleUploader {
	filename?: string | undefined;
	contentType?: string | undefined;
	constructor(filename: string, contentType: string) {
		this.filename = filename
		this.contentType = contentType
	}
	async upload(presignedUrl: URL, blob: Blob, onProgress: OnProgress): Promise<string> {
		return await new Promise<string>((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.upload.addEventListener("progress", async (event) => {
				if (event.lengthComputable) {
				  await onProgress({
					loaded: event.loaded,
					total: event.total	
				  })
				}
			});
			xhr.addEventListener("loadend", () => {
				if (xhr.readyState === 4 && xhr.status === 200){
					const etag = xhr.getResponseHeader("ETag")
					if (etag) {
						resolve(etag)
					}
					reject(new Error("Failed to upload file"))
				}
			});
			xhr.open("PUT", presignedUrl, true)
			xhr.setRequestHeader("Access-Control-Allow-Credentials", "true")
			xhr.setRequestHeader("Access-Control-Expose-Headers", "ETag")
			if (this.contentType) {
				xhr.setRequestHeader("Content-Type", this.contentType)
			}
			if (this.filename) {
				xhr.setRequestHeader("Content-Disposition", `attachment; filename=\"${file.name}\"`)
			}
			xhr.send(blob)
		})
	}
}

export class S3Uploader {
	private bucketName: string;
	private objectKey: string;
	private callbacks: S3UploadCallbacks;
	public status: S3UploadStatus = S3UploadStatus.Ready;
	private parts: Part[] = [];
	private resumableParts: Part[] = [];
	private uploadId: string | null = null;

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
		if (this.callbacks.onUploadStatusChange && this.status != status) {
			this.callbacks.onUploadStatusChange({ status: status });
		}
		this.status = status;
	}


	private progressTrackingStream(): TransformStream {
		return new TransformStream({
			transform: (chunk, controller) => {
				controller.enqueue(chunk);
			},
		})
	}

	private async single_upload(file: File) {
		try {
			const presignedUrl = await this.callbacks.generatePresignedUrl({
				bucketName: this.bucketName,
				objectKey: this.objectKey,
				clientMethod: ClientMethod.PutObject.toString(),
			});
			if (presignedUrl === undefined || presignedUrl === null) {
				throw Error("generatePresignedUrl callback should return valid presigned url")
			}
			await fetch(
				presignedUrl,
				{
					body: file.stream().pipeThrough(this.progressTrackingStream()),
					method: "PUT",
					headers: {
						"Access-Control-Allow-Credentials": "true",
						"Access-Control-Expose-Headers": "ETag",
						// "Content-Type": file.type,
						"Content-Type": "application/octet-stream",
						"Content-Disposition": `attachment; filename=\"${file.name}\"`,
						"duplex": 'half',
					}
				}
			)
			this.updateStatus(S3UploadStatus.Success)
		} catch (err) {
			this.updateStatus(S3UploadStatus.Failed)
			throw Error("Failed to upload file")
		}
	}

	private async multipart_upload(file: File) {
		const uploadId = await this.callbacks.createMultipartUpload({
			bucketName: this.bucketName,
			objectKey: this.objectKey,
			contentType: file.type,
			filename: file.name
		});
		if (uploadId === undefined || uploadId === null) {
			throw Error("createMultipartUpload callback should return valid uploadId")
		}
		const promises = []
		for (let start = 0; start < file.size; start += CHUNK_SIZE) {
			const end = Math.min(start + CHUNK_SIZE, file.size);
			promises.push(file.slice(start, end, file.type))
		}
		const results = await Promise.all(promises)
	}


	public async upload(file: File) {
		const promises: Promise<Part>[] = [];
		if (this.isUploadAborted()) {
			return
		}
		this.resumableParts = parts.filter(part => part.etag === undefined);
		if (this.isUploadAborted()) {
			return
		}
		if (this.resumableParts.length === 0 && parts.length === number_of_parts) {
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
			if (parts.length === 0) {
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
			if (part.etag === undefined) {
				const start = CHUNK_SIZE * (part.partNumber - 1);
				const end = Math.min(CHUNK_SIZE * part.partNumber, this.file.size);
				promises.push(this.startUploadWorker(start, end, part.partNumber));
			}
		}
		const parts = await Promise.all(promises);
		this.resumableParts = parts.filter(part => part.etag === undefined);
		if (this.resumableParts.length == 0) {
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
			if (parts.length === 0) {
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
		if (this.callbacks.abortMultipartUpload !== undefined) {
			if (this.upload === null) {
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
