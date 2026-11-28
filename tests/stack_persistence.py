"""Opt-in fresh Compose deployment and restart test. Existing stack/data untouched.
Run through scripts/with-env.mjs using multimedia's environment. Model caches are
reused, but MySQL/RustFS get new named volumes. Test data volumes remain afterward.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote
import boto3
import pymysql

root = Path(__file__).resolve().parents[1]
project = 'aether-qa-' + secrets.token_hex(4)
for port in [13308,19000,19001,18001,18004]:
    with socket.socket() as probe:
        assert probe.connect_ex(('127.0.0.1',port)) != 0, f'QA port {port} is occupied'
overlay = '''services:
  mysql:
    ports: !override ["127.0.0.1:13308:3306"]
  rustfs:
    ports: !override ["127.0.0.1:19000:9000", "127.0.0.1:19001:9001"]
  voice-tts:
    ports: !override ["127.0.0.1:18001:8001"]
  ocr:
    ports: !override ["127.0.0.1:18004:8004"]
volumes:
  voice_models:
    external: true
    name: aether-local_voice_models
  ocr_models:
    external: true
    name: aether-local_ocr_models
'''
with tempfile.NamedTemporaryFile(mode='w',suffix='.yml',prefix='aether-qa-',delete=False) as out:
    out.write(overlay); overlay_path=Path(out.name)
base=['docker','compose','-p',project,'-f',str(root/'docker-compose.yml'),'-f',str(overlay_path)]
def compose(*args):
    return subprocess.run(base+list(args),cwd=root,check=True,capture_output=True,text=True).stdout
def healthy():
    deadline=time.monotonic()+240
    while time.monotonic()<deadline:
        raw=compose('ps','--all','--format','json').strip()
        rows=json.loads(raw) if raw.startswith('[') else [json.loads(x) for x in raw.splitlines() if x]
        states={r['Service']:r for r in rows}
        if all(states.get(s,{}).get('Health')=='healthy' for s in ['mysql','rustfs','voice-tts','voice-stt','ocr']) and states.get('storage-init',{}).get('ExitCode')==0:
            print('All five workers healthy and storage initializer exited 0.',flush=True);return
        time.sleep(2)
    raise AssertionError('Fresh stack did not become healthy')
def connect():
    return pymysql.connect(host='127.0.0.1',port=13308,user=os.environ['MYSQL_USER'],password=os.environ['MYSQL_PASSWORD'],database=os.environ['MYSQL_DATABASE'],charset='utf8mb4',autocommit=True)
try:
    compose('up','-d','--no-build'); healthy()
    env=dict(os.environ,MYSQL_HOST='127.0.0.1',MYSQL_PORT='13308',S3_ENDPOINT_URL='http://127.0.0.1:19000')
    env['DATABASE_URL']='mysql+pymysql://'+quote(env['MYSQL_USER'],safe='')+':'+quote(env['MYSQL_PASSWORD'],safe='')+'@127.0.0.1:13308/'+env['MYSQL_DATABASE']
    subprocess.run([sys.executable,'-m','database.connection','--init'],cwd=root/'multimedia',env=env,check=True)
    value='Hello — Bonjour — مرحبا'
    with connect() as conn,conn.cursor() as cur:
        cur.execute('CREATE TABLE qa_persistence (value TEXT CHARACTER SET utf8mb4)')
        cur.execute('INSERT INTO qa_persistence VALUES (%s)',(value,))
    s3=boto3.client('s3',endpoint_url='http://127.0.0.1:19000',region_name='us-east-1',aws_access_key_id=env['S3_ACCESS_KEY_ID'],aws_secret_access_key=env['S3_SECRET_ACCESS_KEY'])
    s3.put_object(Bucket=env['S3_BUCKET'],Key='qa-persistence.txt',Body=value.encode())
    compose('stop'); compose('start'); healthy()
    with connect() as conn,conn.cursor() as cur:
        cur.execute('SELECT value FROM qa_persistence'); assert cur.fetchone()[0]==value
    assert s3.get_object(Bucket=env['S3_BUCKET'],Key='qa-persistence.txt')['Body'].read()==value.encode()
    print('Fresh schema initialization and MySQL/RustFS restart persistence passed.',flush=True)
finally:
    compose('down')  # No -v: original and new data/model volumes are retained.
    overlay_path.unlink()
    print('Isolated containers stopped. Retained test volumes: '+project+'_mysql_data, '+project+'_rustfs_data',flush=True)
