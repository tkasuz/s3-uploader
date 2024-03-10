#!/bin/bash
export AWS_ENDPOINT_URL=http://s3:9000
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
export AWS_DEFAULT_REGION=ap-northeast-1

if aws s3api head-bucket --bucket test 2>/dev/null; then
    aws s3 rm s3://test --recursive
    aws s3api delete-bucket --bucket test
fi
aws s3api create-bucket --bucket test
aws s3 cp /s3/data s3://test/ --recursive