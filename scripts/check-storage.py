"""Check real local MySQL and private S3 without modifying existing records/objects."""
import os
import uuid
from urllib.error import HTTPError
from urllib.request import urlopen
import boto3
import pymysql

with pymysql.connect(host=os.environ['MYSQL_HOST'], port=int(os.environ['MYSQL_PORT']),
    user=os.environ['MYSQL_USER'], password=os.environ['MYSQL_PASSWORD'],
    database=os.environ['MYSQL_DATABASE'], charset='utf8mb4') as connection:
    with connection.cursor() as cursor:
        cursor.execute('CREATE TEMPORARY TABLE voice_storage_check (text_value TEXT CHARACTER SET utf8mb4)')
        text = 'مرحبا — Bonjour — Hello'
        cursor.execute('INSERT INTO voice_storage_check VALUES (%s)', (text,))
        cursor.execute('SELECT text_value FROM voice_storage_check')
        assert cursor.fetchone()[0] == text
print('MySQL real UTF-8 roundtrip passed; temporary table removed on connection close.')

s3 = boto3.client('s3', endpoint_url=os.environ['S3_ENDPOINT_URL'], region_name='us-east-1',
    aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY'])
bucket = os.environ['S3_BUCKET']
key = 'verification/' + str(uuid.uuid4()) + '.txt'
try:
    s3.put_object(Bucket=bucket, Key=key, Body=b'Aether private storage test', ContentType='text/plain')
    assert s3.get_object(Bucket=bucket, Key=key)['Body'].read() == b'Aether private storage test'
    try:
        with urlopen(os.environ['S3_ENDPOINT_URL'].rstrip('/') + '/' + bucket + '/' + key, timeout=5):
            raise AssertionError('Anonymous object access must not succeed')
    except HTTPError as error:
        assert error.code in (401, 403), error.code
    print('RustFS signed read/write passed; anonymous access denied.')
finally:
    s3.delete_object(Bucket=bucket, Key=key)
