import { expect, test } from 'vitest'
import {CompleteMultiparUploadInput, CreateMultiparUploadInput, GeneratePresignedUrlInput, S3Uploader, S3UploadStatus} from "../src/S3Uploader";
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
      }),
  });
  return await res.json();
};

const generatePresignedUrl = async (input: GeneratePresignedUrlInput) => {
  console.log(input);
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
  console.log("Dummy file is created")
  const uploader = new S3Uploader(
    file,
    "test",
    "test",
    {
      generatePresignedUrl: generatePresignedUrl,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
  );
  try {
    await uploader.upload();
  } catch (e) {
    console.log(e)
  }
  expect(uploader.status).to.equal(S3UploadStatus.Success);
});

// it("Upload 6mb file with multipart upload", async () => {
//   const file = mockFile(6 * 1024 * 1024, "6mb")
//   console.log("Dummy file is created")
//   const uploader = await new S3Uploader(
//     file,
//     "test",
//     "test",
//     {
//       generatePresignedUrl: generatePresignedUrl,
//       completeMultipartUpload: completeMultiparUpload,
//       createMultipartUpload: createMultipartUpload
//     }
//   );
//   try {
//     await uploader.upload();
//   } catch (e) {
//     console.log(e)
//   }
//   expect(uploader.status).to.equal(S3UploadStatus.Success);
// });
