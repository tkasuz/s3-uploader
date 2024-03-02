from typing import List, Literal

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, Json

app = FastAPI()

origins = [
    "http://localhost",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

s3 = boto3.client(
    "s3",
    aws_access_key_id="minioadmin",
    aws_secret_access_key="minioadmin",
    verify=False,
    use_ssl=False,
    endpoint_url="http://localhost:9000",
    config=Config(
        signature_version="s3v4",
        s3={'addressing_style': 'path'}
    )
)


class GeneratePresignedUrl(BaseModel):
    bucket: str
    key: str
    client_method: Literal["put_object", "upload_part"]
    upload_id: str | None = None
    part_number: int | None = None

class CreateMultipartUpload(BaseModel):
    bucket: str
    key: str

class Part(BaseModel):
    part_number: int
    etag: str

class CompleteMultipartUpload(BaseModel):
    bucket: str
    key: str
    upload_id: str
    parts: list[Part]

@app.get("/")
def ping():
    return "pong"


@app.post("/generate_presigned_url")
def generate_presigned_url(input: GeneratePresignedUrl):
    print(input)
    params = {
        "Bucket": input.bucket,
        "Key": input.key,
    }
    if input.part_number and input.upload_id:
       params["UploadId"] = input.upload_id
       params["PartNumber"] = input.part_number
    try:
        response = s3.generate_presigned_url(
            input.client_method,
            Params=params,
            ExpiresIn=60 * 60 * 24,
        )
    except ClientError as e:
        raise e
    return response

@app.post("/create_multipart_upload")
def create_multipart_upload(input: CreateMultipartUpload):
    print(input)
    try:
        response = s3.create_multipart_upload(Bucket=input.bucket,Key=input.key)
    except ClientError as e:
        raise e
    return response['UploadId']

@app.post("/complete_multipart_upload")
def complete_multipart_upload(input: CompleteMultipartUpload):
    print(input)
    try:
        response = s3.complete_multipart_upload(
            Bucket=input.bucket,
            Key=input.key,
            MultipartUpload={'Parts': [{"ETag": part.etag, "PartNumber": part.part_number} for part in input.parts]},
            UploadId=input.upload_id,
        )
    except ClientError as e:
        raise e
    return response