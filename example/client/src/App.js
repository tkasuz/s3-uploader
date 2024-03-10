import {S3Uploader} from "s3-signurl-uploader"
import React from 'react'

const completeMultiparUpload = async (input) => {
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

const createMultipartUpload = async (input) => {
  console.log(input)
  const res = await fetch("http://localhost:9002/create_multipart_upload", {
      method: "POST",
      headers: {
          'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        "bucket": input.bucketName,
        "key": input.objectKey,
        "content_type": input.contentType,
        "filename": input.filename,
      }),
  });
  return await res.json();
};

const generatePresignedUrl = async (input) => {
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

function App() {
  const onChangeFile = (e) => {
    const files = e.target.files
    if (files && files[0]) {
      const s3Uploader = new S3Uploader(files[0], "test", "test", {
        createMultipartUpload: createMultipartUpload,
        generatePresignedUrl: generatePresignedUrl,
        completeMultipartUpload: completeMultiparUpload
      })
      s3Uploader.upload()
    }
  }
 
  return (
    <div className="App">
        <input
          name="file"
          type="file"
          onChange={onChangeFile}
        />
        <input type="button" value="Upload" />
    </div>
  );
}

export default App;
