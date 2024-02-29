import { expect } from "@esm-bundle/chai";
import {CompleteMultiparUploadInput, CreateMultiparUploadInput, GeneratePresignedUrlsInput, S3Uploader, S3UploadStatus} from "../src/S3Uploader";
import {mockFile} from './utils'

const completeMultiparUpload = async (input: CompleteMultiparUploadInput) => {
  console.log(input)
  const res = await fetch("http://localhost:9002/complete_multipart_upload", {
    method: "POST",
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      "bucket": input.bucketName,
      "key": input.objectKey,
      "parts": input.parts,
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
      }),
  });
  return await res.json();
};

const generatePresignedUrls = async (input: GeneratePresignedUrlsInput) => {
  console.log(input);
  const res = await fetch("http://localhost:9002/genereate_presigned_urls", {
      method: "POST",
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "bucket": input.bucketName,
        "key": input.objectKey,
        "upload_id": input.uploadId,
        "part_numbers": input.partNumbers,
        "client_method": input.clientMethod
      }),
  })
  return await res.json();
};


it("Upload 1kb file without multipart upload", async () => {
  const file = mockFile(1 * 1024, "1kb")
  console.log("Dummy file is created")
  const uploader = await S3Uploader.build(
    "test",
    "test",
    {
      generatePresignedUrls: generatePresignedUrls,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
  );
  try {
    await uploader.upload(file);
  } catch (e) {
    console.log(e)
  }
  expect(uploader.status).to.equal(S3UploadStatus.Success);
});

it("Upload 6mb file with multipart upload", async () => {
  const file = mockFile(6 * 1024 * 1024, "6mb")
  console.log("Dummy file is created")
  const uploader = await S3Uploader.build(
    "test",
    "test",
    {
      generatePresignedUrls: generatePresignedUrls,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
  );
  try {
    await uploader.upload(file);
  } catch (e) {
    console.log(e)
  }
  expect(uploader.status).to.equal(S3UploadStatus.Success);
});
