import { expect, test, vi} from 'vitest'
import {
  CompleteMultiparUploadInput, 
  CreateMultiparUploadInput, 
  GeneratePresignedUrlInput, 
  AbortMultipartUploadInput,
  S3Uploader, 
  S3UploadStatus,
} from "../src/S3Uploader";
import {mockFile} from './utils'

const API_BASE_URL = "http://localhost:9402" 

const completeMultiparUpload = async (input: CompleteMultiparUploadInput) => {
  const res = await fetch(`${API_BASE_URL}/complete_multipart_upload`, {
    method: "POST",
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      "bucket": input.bucketName,
      "key": input.objectKey,
      "parts": input.parts.map(part => ({"part_number": part?.partNumber, "etag": part?.etag})),
      "upload_id": input.uploadId
    }),
  });
  if (!res.ok) {
    throw Error
  }
};

const createMultipartUpload = async (input: CreateMultiparUploadInput) => {
  const res = await fetch(`${API_BASE_URL}/create_multipart_upload`, {
      method: "POST",
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "bucket": input.bucketName,
        "key": input.objectKey,
        "filename": input.filename,
        "content_type": input.contentType
      }),
  });
  return await res.json();
};

const generatePresignedUrl = async (input: GeneratePresignedUrlInput) => {
  const res = await fetch(`${API_BASE_URL}/generate_presigned_url`, {
      method: "POST",
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "bucket": input.bucketName,
        "key": input.objectKey,
        "upload_id": input.uploadId,
        "part_number": input.partNumber,
        "client_method": input.clientMethod
      }),
  })
  return await res.json();
};

const abortMultiPresignedUrl = async (input: AbortMultipartUploadInput) => {
  const res = await fetch(`${API_BASE_URL}/abort_multipart_presigned_url`, {
      method: "POST",
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "bucket": input.bucketName,
        "key": input.objectKey,
        "upload_id": input.uploadId,
      }),
  })
  return await res.json();
};


test("Upload 1kb file without multipart upload", async () => {
  const file = mockFile(1 * 1024, "1kb")
  const uploader = new S3Uploader(
    file,
    "test",
    "1mb",
    {
      generatePresignedUrl: generatePresignedUrl,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
  );
  await uploader.upload();
  expect(uploader.status).to.equal(S3UploadStatus.Success);
});

test("Upload 11mb file with multipart upload", async () => {
  const file = mockFile(11 * 1024 * 1024, "11mb")
  const uploader = new S3Uploader(
    file,
    "test",
    "11mb",
    {
      generatePresignedUrl: generatePresignedUrl,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
  );
  await uploader.upload();
  expect(uploader.status).to.equal(S3UploadStatus.Success);
});

test("Resumable upload with 11mb file", async () => {
  const file = mockFile(11 * 1024 * 1024, "11mb_resume")
  vi.spyOn(S3Uploader.prototype, "startUploadWorker").mockResolvedValueOnce({
    "etag": undefined,
    "partNumber": 1
  })
  const uploader = new S3Uploader(
    file,
    "test",
    "11mb_resume",
    {
      generatePresignedUrl: generatePresignedUrl,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
  );
  await uploader.upload();

  expect(uploader.status).to.equal(S3UploadStatus.Resumable);

  await uploader.resume();

  expect(uploader.status).to.equal(S3UploadStatus.Success);

});

test("Abort multipart upload", async () => {
  const file = mockFile(100 * 1024 * 1024, "100mb_resume")
  vi.spyOn(S3Uploader.prototype, "startUploadWorker").mockResolvedValueOnce({
    "etag": undefined,
    "partNumber": 1
  })
  const uploader = new S3Uploader(
    file,
    "test",
    "100mb_abort",
    {
      generatePresignedUrl: generatePresignedUrl,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload,
      abortMultipartUpload: abortMultiPresignedUrl
    }
  );
  uploader.upload();
  await uploader.abort();

  expect(uploader.status).to.equal(S3UploadStatus.Aborted);
});