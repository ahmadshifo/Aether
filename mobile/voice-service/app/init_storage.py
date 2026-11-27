"""Create the private bucket without touching existing objects or policies."""
import os
import boto3
from botocore.exceptions import ClientError

s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT_URL"], region_name="us-east-1",
                  aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
                  aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"])
bucket = os.getenv("S3_BUCKET", "aether-frames")
try:
    s3.head_bucket(Bucket=bucket)
except ClientError as error:
    if error.response["ResponseMetadata"]["HTTPStatusCode"] != 404:
        raise RuntimeError("Storage access failed; check the private .env credentials.") from None
    s3.create_bucket(Bucket=bucket)
try:
    s3.get_bucket_policy(Bucket=bucket)
except ClientError as error:
    if error.response["Error"]["Code"] not in ("NoSuchBucketPolicy", "NoSuchKey", "404"):
        raise RuntimeError("Cannot verify the bucket privacy policy.") from None
else:
    raise RuntimeError("The bucket has an existing policy. Review it before using private frame storage.")
print("Private frame bucket ready.")
