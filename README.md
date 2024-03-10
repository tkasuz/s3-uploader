# s3-signurl-uploader

[![npm version](https://badge.fury.io/js/s3-signurl-uploader.svg)](https://badge.fury.io/js/s3-signurl-uploader)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚀 Simplify file uploads to Amazon S3 with ease! This library provides a seamless interface for handling pre-signed URLs and multipart uploads.

## Features

### Automatic Chunking 📦
Large files are automatically segmented into multiple 10MB chunks, ensuring efficient upload processes and reducing the risk of timeouts or failures.

### Parallel Uploads with Web Workers 🔄
Each upload process runs in a dedicated web worker, allowing for parallel execution. This enhances performance by leveraging the multi-threaded capabilities of web workers, enabling simultaneous uploads of different file segments.

### WebAssembly for Performance Optimization 🚀
The library harnesses the power of WebAssembly to read and process each file slice. This ensures optimal performance, making the most of browser capabilities for efficient data handling.

### Server-Side S3 API Invocation 🔒
The primary use case for this library is when S3 API needs to be invoked from the server side, but you still want to take advantage of multipart upload. By using this library, IAM credentials do not need to be passed to the browser, ensuring a secure and seamless integration.

## Installing

- `npm install s3-signurl-uploader`
- `yarn add s3-signurl-uploader`
- `pnpm add s3-signurl-uploader`

## Getting Started

### Import 
```typescript
import {
  CompleteMultiparUploadInput, 
  CreateMultiparUploadInput, 
  GeneratePresignedUrlInput, 
  S3Uploader, 
  S3UploadStatus,
} from "s3-signurl-uploader";
```

### Create callbacks for S3 Multipart Upload API
```typescript
const completeMultiparUpload = async (input: CompleteMultiparUploadInput) => {
  // call your own backend api
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
  // call your own backend api
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
  // call your own backend api
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
```

### Create a client
```typescript
const uploader = new S3Uploader(
    file, // File
    "bucket", // Bucket name
    "object", // Object Key
    // Callback functions defined above
    {
      generatePresignedUrl: generatePresignedUrl,
      completeMultipartUpload: completeMultiparUpload,
      createMultipartUpload: createMultipartUpload
    }
);
```

### Upload/Resume a file to S3
```typescript
// Upload
await uploader.upload();

// Resume
if (uploader.status == S3UploadStatus.Failed){
    await uploader.resume();
}
```