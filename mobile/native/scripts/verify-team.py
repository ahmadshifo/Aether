"""Live acceptance of teammates' unchanged services; only synthetic test rows are removed."""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from uuid import uuid4

NATIVE = Path(__file__).resolve().parents[1]
REPO = NATIVE.parents[1]
RUNTIME = NATIVE / '.runtime' / 'team-integration'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['database', 'backend'])
    args = parser.parse_args()
    config = json.loads((RUNTIME / 'local.json').read_text(encoding='utf-8'))
    env = {**os.environ, **{key: str(config[key]) for key in ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'JWT_SECRET', 'DATABASE_URL', 'FRAME_STORAGE_PATH', 'FRAME_RETENTION_HOURS']}}
    env['PYTHONPYCACHEPREFIX'] = str(RUNTIME / 'pycache')
    if args.mode == 'database':
        env['RUN_MYSQL_TESTS'] = '1'
        for options in [ ['-m', 'database.connection', '--init'], ['-m', 'database.connection', '--check'],
                         ['-m', 'database.repository', '--smoke-test'],
                         ['-m', 'pytest', 'tests/test_database.py', 'tests/test_database_integration.py', '-q', '-p', 'no:cacheprovider', '--basetemp', str(RUNTIME / ('pytest-' + uuid4().hex))] ]:
            subprocess.run([config['python'], *options], cwd=REPO / 'multimedia', env=env, check=True)
        return

    import httpx
    import pymysql
    passed = []
    emails = []
    with pymysql.connect(host=config['MYSQL_HOST'], port=int(config['MYSQL_PORT']), user=config['MYSQL_USER'], password=config['MYSQL_PASSWORD'], database=config['MYSQL_DATABASE'], charset='utf8mb4', autocommit=True) as db:
        def verify(condition, label):
            if not condition:
                raise AssertionError(label)
            passed.append(label)
        try:
            with httpx.Client(base_url='http://127.0.0.1:8002', timeout=10, trust_env=False) as a, httpx.Client(base_url='http://127.0.0.1:8002', timeout=10, trust_env=False) as b:
                verify(a.get('/api/v1/auth/me').status_code == 401, 'anonymous account access denied')
                credentials = []
                for client in [a, b]:
                    email = f'mobile-integration-{uuid4().hex}@example.test'
                    emails.append(email)
                    body = {'email': email, 'password': secrets.token_urlsafe(24), 'name': 'Mobile integration'}
                    credentials.append(body)
                    response = client.post('/api/v1/auth/signup', json=body)
                    verify(response.status_code == 201, 'signup stored in real MySQL')
                user_id = a.get('/api/v1/auth/me').json()['user']['user_id']
                renamed = a.patch('/api/v1/auth/me', json={'name': 'حسن — اختبار'})
                verify(renamed.status_code == 200 and renamed.json()['user']['name'] == 'حسن — اختبار', 'Unicode profile update through HTTP')
                with db.cursor() as cursor:
                    cursor.execute('SELECT name,password_hash FROM users WHERE user_id=%s', (user_id,))
                    name, hashed = cursor.fetchone()
                    verify(name == 'حسن — اختبار' and hashed.startswith('scrypt$'), 'profile and password hash persisted in MySQL')
                verify(a.post('/api/v1/auth/signup', json=credentials[0]).status_code == 409, 'duplicate account rejected')
                session_id = str(uuid4())
                verify(a.post('/api/v1/streams/start', json={'session_id': session_id}).status_code == 200, 'stream session registered')
                verify(a.get('/api/v1/streams/active').json()['session']['session_id'] == session_id, 'dashboard discovers same account session')
                verify(b.get('/api/v1/streams/active').json()['session'] is None, 'other account cannot discover stream')
                verify(b.post('/api/v1/streams/start', json={'session_id': session_id}).status_code == 409, 'other account cannot take stream ownership')
                b.post('/api/v1/streams/stop', json={'session_id': session_id})
                verify(a.get('/api/v1/streams/active').json()['session']['session_id'] == session_id, 'other account cannot stop stream')
                with db.cursor() as cursor:
                    cursor.execute('SELECT user_id,status FROM sessions WHERE session_id=%s', (session_id,))
                    verify(cursor.fetchone() == (user_id, 'live'), 'stream ownership persisted in MySQL')
                verify(a.post('/api/v1/streams/stop', json={'session_id': session_id}).status_code == 204 and a.get('/api/v1/streams/active').json()['session'] is None, 'Stop ends registered session')
                # A second independent server process reads the same persistent account and login.
                with (RUNTIME / 'secondary-backend.log').open('w', encoding='utf-8') as log:
                    child = subprocess.Popen([config['python'], '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '18062'], cwd=REPO / 'web' / 'ai-backend', env=env, stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    try:
                        with httpx.Client(base_url='http://127.0.0.1:18062', cookies=a.cookies, timeout=5, trust_env=False) as restarted:
                            for _ in range(60):
                                try:
                                    response = restarted.get('/api/v1/auth/me')
                                    break
                                except httpx.ConnectError:
                                    if child.poll() is not None: raise RuntimeError('Secondary backend failed to start')
                                    time.sleep(.25)
                            else: raise RuntimeError('Secondary backend timed out')
                            verify(response.status_code == 200 and response.json()['user']['name'] == 'حسن — اختبار', 'account and login survive independent server startup')
                    finally:
                        child.terminate()
                        child.wait(timeout=10)
                verify(a.post('/api/v1/auth/logout').status_code == 204 and a.get('/api/v1/auth/me').status_code == 401, 'logout clears client authentication')
                verify(a.post('/api/v1/auth/login', json={'email': credentials[0]['email'], 'password': credentials[0]['password']}).status_code == 200, 'persistent account can log in again')
                a.post('/api/v1/auth/logout')
                b.post('/api/v1/auth/logout')
                subprocess.run(['node', '--experimental-transform-types', str(NATIVE / 'scripts' / 'verify-native-team.mjs')], input=json.dumps(credentials[0]), text=True, cwd=NATIVE, check=True)
                passed.append('native production clients passed live HTTP acceptance')
                routes = a.get('/openapi.json').json()['paths']
                absent = [path for path in ['/api/v1/ask', '/api/v1/questions', '/api/v1/status'] if path not in routes]
                report = {'passed': passed, 'missing_backend_routes': absent, 'database': 'MySQL 8.4; real HTTP and SQL', 'phone_tested': False}
                (RUNTIME / 'live-backend-results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
                print(json.dumps(report, indent=2, ensure_ascii=True))
        finally:
            # Only accounts generated by this invocation; never clear the database.
            with db.cursor() as cursor:
                for email in emails:
                    cursor.execute('SELECT user_id FROM users WHERE email=%s', (email,))
                    row = cursor.fetchone()
                    if row:
                        cursor.execute('DELETE FROM sessions WHERE user_id=%s', (row[0],))
                        cursor.execute('DELETE FROM users WHERE user_id=%s', (row[0],))


if __name__ == '__main__':
    main()
