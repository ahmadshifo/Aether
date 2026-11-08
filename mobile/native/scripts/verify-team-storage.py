"""Live RustFS/MySQL/HTTP acceptance. Removes only synthetic data created by this run."""
from datetime import UTC, datetime, timedelta
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
from uuid import uuid4

NATIVE = Path(__file__).resolve().parents[1]
sys.pycache_prefix = str(NATIVE / '.runtime/team-integration/pycache')
spec = importlib.util.spec_from_file_location('team_storage_setup', NATIVE / 'scripts/team-storage.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


def main():
    import httpx
    import numpy as np
    import pymysql
    config = setup.configuration()
    assert config['FRAME_STORAGE_BACKEND'] == 's3'
    os.environ.update(setup.environment(config))
    sys.path.insert(0, str(setup.REPO / 'multimedia'))
    from database.connection import Database
    from database.repository import FrameRepository
    from database.retention import cleanup_expired_frames
    from processing.face_blur import FaceBlurrer
    passed, emails, frame_ids = [], [], []
    session_id = uuid4()

    def verify(condition, label):
        if not condition:
            raise AssertionError(label)
        passed.append(label)

    with Database() as database, pymysql.connect(host=config['MYSQL_HOST'], port=int(config['MYSQL_PORT']),
            user=config['MYSQL_USER'], password=config['MYSQL_PASSWORD'], database=config['MYSQL_DATABASE'], autocommit=True) as db:
        database.check()
        repository = FrameRepository.from_database(database)
        store = repository.image_store
        verify(store is not None, 'teammate repository uses real RustFS storage')
        try:
            # Verify migrated objects persisted through the server restart, without exposing image contents.
            with db.cursor() as cursor:
                cursor.execute('SELECT image_path FROM frames')
                old_paths = [row[0] for row in cursor.fetchall()]
            migrated_verified = 0
            for key in old_paths:
                content = store.read(key)
                source = Path(config['FRAME_STORAGE_PATH']) / key
                if source.is_file():
                    verify(hashlib.sha256(content).digest() == hashlib.sha256(source.read_bytes()).digest(), 'migrated frame survives RustFS restart with identical bytes')
                    migrated_verified += 1
                else:
                    verify(bool(content), 'existing RustFS-only frame remains readable')
            with httpx.Client(base_url='http://127.0.0.1:5174', trust_env=False, timeout=20) as owner, httpx.Client(base_url='http://127.0.0.1:5174', trust_env=False, timeout=20) as other:
                for client in (owner, other):
                    email = f'mobile-rustfs-{uuid4().hex}@example.test'
                    emails.append(email)
                    response = client.post('/api/v1/auth/signup', json={'name': 'RustFS acceptance', 'email': email, 'password': secrets.token_urlsafe(24)})
                    verify(response.status_code == 201, 'dashboard proxy signs in a synthetic MySQL account')
                verify(owner.post('/api/v1/streams/start', json={'session_id': str(session_id)}).status_code == 200, 'synthetic camera session is owned by signed-in account')
                y, x = np.indices((240, 320))
                image = np.stack([(x % 256), (y % 256), ((x + y) % 256)], axis=-1).astype(np.uint8)
                blurred, _ = FaceBlurrer().blur(image)
                verify(blurred.shape == image.shape, 'bundled YuNet model loads and processes a synthetic frame')
                frame_id = repository.save_frame(session_id, datetime.now(UTC), blurred, caption='Synthetic RustFS acceptance image')
                frame_ids.append(frame_id)
                record = repository.get_frame(frame_id)
                key = record.image_path
                verify(store.exists(key), 'new frame JPEG is written to RustFS')
                verify(not (Path(config['FRAME_STORAGE_PATH']) / key).exists(), 'new frame does not fall back to the local image folder')
                original = store.read(key)
                try:
                    store.write_new(key, b'not allowed to overwrite')
                except FileExistsError:
                    pass
                else:
                    raise AssertionError('duplicate object overwrote data')
                verify(store.read(key) == original, 'duplicate protection preserves original object')
                quarantine = store.quarantine(key)
                verify(quarantine is not None and not store.exists(key), 'RustFS quarantine copy/delete works')
                store.restore(quarantine, key)
                verify(store.read(key) == original, 'quarantine restore preserves bytes')
                image_route = f'/api/v1/frames/{frame_id}/image'
                direct = owner.get('http://127.0.0.1:8003' + image_route)
                verify(direct.status_code == 200 and direct.content == original, 'authenticated multimedia API returns the RustFS JPEG')
                proxied = owner.get(image_route)
                verify(proxied.status_code == 200 and proxied.content == original, 'dashboard image proxy returns the same RustFS JPEG')
                verify(other.get(image_route).status_code == 404, 'another account cannot read the private image')
                verify(httpx.get('http://127.0.0.1:8003' + image_route, trust_env=False).status_code == 401, 'anonymous multimedia image access is rejected')
                verify(httpx.get(f"{config['S3_ENDPOINT_URL']}/{config['S3_BUCKET']}/{key}", trust_env=False).status_code == 403, 'RustFS bucket does not expose public image URLs')
                report = cleanup_expired_frames(repository, now_utc=datetime.now(UTC) + timedelta(hours=25), dry_run=False, session_id=session_id)
                verify(report.records_deleted == 1 and report.failures == 0, 'teammate retention deletes the scoped synthetic frame')
                verify(not store.exists(key) and repository.get_frame(frame_id) is None, 'retention removes both MySQL row and RustFS object')
                owner.post('/api/v1/streams/stop', json={'session_id': str(session_id)})
            report = {'passed': passed, 'migrated_images_verified': migrated_verified, 'existing_images_verified': len(old_paths), 'backend': 'RustFS 1.0.4 + MySQL 8.4', 'real_cloud_ai_tested': False, 'phone_tested': False}
            (setup.REPORTS / 'live-storage.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
            print(json.dumps(report, indent=2))
        finally:
            for frame_id in frame_ids:
                repository.delete_frame(frame_id)
            with db.cursor() as cursor:
                for email in emails:
                    cursor.execute('SELECT user_id FROM users WHERE email=%s', (email,))
                    row = cursor.fetchone()
                    if row:
                        cursor.execute('DELETE FROM sessions WHERE user_id=%s', (row[0],))
                        cursor.execute('DELETE FROM users WHERE user_id=%s', (row[0],))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, AssertionError) else f'Live storage check failed ({type(error).__name__}); details suppressed.', file=sys.stderr)
        raise SystemExit(1)
