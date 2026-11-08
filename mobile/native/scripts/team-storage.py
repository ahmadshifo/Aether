"""Configure and verify teammates' real RustFS adapter using mobile-owned private settings.

Migration copies existing JPEGs and verifies every byte before enabling S3. It never deletes
source files or changes database rows. Run with the private team Python environment.
"""
import argparse
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from uuid import UUID

NATIVE = Path(__file__).resolve().parents[1]
REPO = NATIVE.parents[1]
PRIVATE = NATIVE / '.runtime/team-integration/local.json'
REPORTS = NATIVE / '.runtime/team-complete'


def configuration():
    return json.loads(PRIVATE.read_text(encoding='utf-8'))


def save(config):
    temporary = PRIVATE.with_suffix('.pending.json')
    temporary.write_text(json.dumps(config, indent=2), encoding='utf-8')
    temporary.replace(PRIVATE)


def environment(config):
    allowed = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD',
               'DATABASE_URL', 'JWT_SECRET', 'FRAME_STORAGE_PATH', 'FRAME_RETENTION_HOURS',
               'FRAME_STORAGE_BACKEND', 'S3_ENDPOINT_URL', 'S3_BUCKET', 'S3_REGION',
               'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']
    return {**os.environ, **{key: str(config[key]) for key in allowed if key in config},
            'PYTHONPYCACHEPREFIX': str(NATIVE / '.runtime/team-integration/pycache')}


def store(config):
    sys.path.insert(0, str(REPO / 'multimedia'))
    from database.object_storage import S3ImageStore, S3Settings
    return S3ImageStore.from_settings(S3Settings(config['S3_ENDPOINT_URL'], config['S3_BUCKET'],
                                                config['S3_ACCESS_KEY_ID'], config['S3_SECRET_ACCESS_KEY'],
                                                config.get('S3_REGION', 'us-east-1')))


def prepare(config, install_dir):
    directory = Path(install_dir).resolve()
    if not (directory / 'rustfs.exe').is_file():
        raise RuntimeError('Install the official RustFS Windows binary first.')
    REPORTS.mkdir(parents=True, exist_ok=True)
    backup = PRIVATE.with_name('local-before-rustfs.json')
    if not backup.exists():
        backup.write_bytes(PRIVATE.read_bytes())
    config.setdefault('rustfsDir', str(directory))
    config.setdefault('S3_ENDPOINT_URL', 'http://127.0.0.1:9000')
    config.setdefault('S3_BUCKET', 'aether-frames')
    config.setdefault('S3_REGION', 'us-east-1')
    config.setdefault('S3_ACCESS_KEY_ID', 'aether-' + secrets.token_hex(12))
    config.setdefault('S3_SECRET_ACCESS_KEY', secrets.token_urlsafe(48))
    config.setdefault('FRAME_STORAGE_BACKEND', 'local')
    (directory / 'data').mkdir(exist_ok=True)
    save(config)
    print('Private RustFS configuration prepared. Existing storage mode preserved until migration passes.')


def serve(config):
    directory = Path(config['rustfsDir']).resolve()
    env = {**os.environ, 'RUSTFS_ADDRESS': '127.0.0.1:9000', 'RUSTFS_CONSOLE_ADDRESS': '127.0.0.1:9001',
           'RUSTFS_CONSOLE_ENABLE': 'true', 'RUSTFS_ACCESS_KEY': config['S3_ACCESS_KEY_ID'],
           'RUSTFS_SECRET_KEY': config['S3_SECRET_ACCESS_KEY']}
    return subprocess.call([str(directory / 'rustfs.exe'), 'server', str(directory / 'data')], cwd=directory, env=env)


def migrate(config):
    import pymysql
    import httpx
    # The frame writer must be stopped, otherwise it could append a local image after the copy.
    try:
        httpx.get('http://127.0.0.1:8003/health', timeout=5, trust_env=False)
    except httpx.ConnectError:
        pass
    else:
        raise RuntimeError('Stop the multimedia API before migrating image storage.')
    backup = REPORTS / 'database-before-rustfs.sql'
    if not backup.exists():
        dump = Path(config['mysqlDir']) / 'mysql-8.4.13-winx64/bin/mysqldump.exe'
        pending_backup = backup.with_suffix('.pending.sql')
        with pending_backup.open('wb') as output:
            result = subprocess.run([str(dump), '--single-transaction', '--no-tablespaces', '--set-gtid-purged=OFF',
                                     '--host=' + config['MYSQL_HOST'], '--port=' + str(config['MYSQL_PORT']),
                                     '--user=' + config['MYSQL_USER'], config['MYSQL_DATABASE']],
                                    env={**os.environ, 'MYSQL_PWD': config['MYSQL_PASSWORD']}, stdout=output, stderr=subprocess.PIPE)
        if result.returncode != 0:
            raise RuntimeError('Database backup failed; migration was not started.')
        pending_backup.replace(backup)
    storage = store(config)
    storage.ensure_bucket()
    root = Path(config['FRAME_STORAGE_PATH']).resolve()
    report = {'database': config['MYSQL_DATABASE'], 'bucket': config['S3_BUCKET'],
              'copied': 0, 'already_present': 0, 'verified': 0, 'source_files_preserved': True}
    with pymysql.connect(host=config['MYSQL_HOST'], port=int(config['MYSQL_PORT']), user=config['MYSQL_USER'],
                         password=config['MYSQL_PASSWORD'], database=config['MYSQL_DATABASE']) as db:
        with db.cursor() as cursor:
            cursor.execute('SELECT session_id, frame_id, image_path FROM frames ORDER BY frame_id')
            rows = cursor.fetchall()
        for session_id, frame_id, image_path in rows:
            expected = f'{UUID(session_id)}/{UUID(frame_id)}.jpg'
            if image_path != expected:
                raise RuntimeError('Non-canonical frame path; migration stopped without changing storage mode.')
            source = (root / image_path).resolve()
            if not source.is_relative_to(root) or not source.is_file():
                raise RuntimeError('An existing frame file is missing; migration stopped without changing storage mode.')
            content = source.read_bytes()
            if storage.exists(image_path):
                report['already_present'] += 1
            else:
                storage.write_new(image_path, content)
                report['copied'] += 1
            if hashlib.sha256(storage.read(image_path)).digest() != hashlib.sha256(content).digest():
                raise RuntimeError('RustFS verification mismatch; existing files and storage mode preserved.')
            report['verified'] += 1
    config['FRAME_STORAGE_BACKEND'] = 's3'
    save(config)
    report['enabled'] = True
    report['verified_at'] = datetime.now(UTC).isoformat()
    (REPORTS / 'rustfs-migration.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'serve', 'migrate', 'check'])
    parser.add_argument('--install-dir', default=str(Path.home() / 'rustfs'))
    args = parser.parse_args()
    config = configuration()
    if args.mode == 'prepare':
        prepare(config, args.install_dir)
    elif args.mode == 'serve':
        return serve(config)
    elif args.mode == 'migrate':
        migrate(config)
    else:
        storage = store(config)
        storage.client.head_bucket(Bucket=config['S3_BUCKET'])
        print(json.dumps({'backend': config.get('FRAME_STORAGE_BACKEND'), 'bucket': config['S3_BUCKET'], 'authenticated_access': True}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # SDK/SQL exceptions can carry credentials; expose only controlled RuntimeErrors.
        print(str(error) if isinstance(error, RuntimeError) else f'Storage setup failed ({type(error).__name__}); private details suppressed.', file=sys.stderr)
        raise SystemExit(1)
