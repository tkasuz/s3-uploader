import { expect, test, vi} from 'vitest'
import {CompleteMultiparUploadInput, CreateMultiparUploadInput, GeneratePresignedUrlInput, S3Uploader, S3UploadStatus} from "../src/S3Uploader";
import {mockFile} from './utils'

const completeMultiparUpload = async (input: CompleteMultiparUploadInput) => {
  const res = await fetch("http://localhost:9002/complete_multipart_upload", {
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
  const res = await fetch("http://localhost:9002/create_multipart_upload", {
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
  const res = await fetch("http://localhost:9002/generate_presigned_url", {
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

  expect(uploader.status).to.equal(S3UploadStatus.Failed);

  await uploader.resume();

  expect(uploader.status).to.equal(S3UploadStatus.Success);

});