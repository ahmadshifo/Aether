"""Create missing team feature tables with compatible account foreign keys.

The current backend DDL leaves user_id in the database default collation, while
the multimedia account schema uses ascii_bin. Existing tables are never altered.
Reads the team's declarations rather than maintaining a separate schema.
Remove this bootstrap after the backend owner qualifies its user_id columns.
"""
import ast
import os
from pathlib import Path
import re
import pymysql


DECLARATIONS = {
    'history.py': ('QUESTION_TABLE',),
    'safety.py': ('SETTINGS_TABLE', 'SOS_TABLE', 'CAMERA_TABLE'),
    'caregiver.py': ('DEVICE_TABLE', 'NOTES_TABLE'),
}


def team_declarations(repo):
    for filename, names in DECLARATIONS.items():
        tree = ast.parse((repo / 'web/ai-backend/app' / filename).read_text(encoding='utf-8'))
        for name in names:
            declaration = next(node for node in tree.body if isinstance(node, ast.Assign)
                               and any(isinstance(target, ast.Name) and target.id == name for target in node.targets))
            sql = ast.literal_eval(declaration.value)
            if not isinstance(sql, str) or not re.match(r'CREATE TABLE IF NOT EXISTS\s', sql):
                raise RuntimeError(f'Unexpected team table declaration: {name}')
            yield sql


def compatible_table(sql, charset, collation):
    if not all(re.fullmatch(r'[a-zA-Z0-9_]+', part or '') for part in (charset, collation)):
        raise RuntimeError('Unsupported account identifier character set.')
    # Only user_id adopts the parent key's charset. Text/answers stay Unicode.
    return re.sub(r'(\buser_id\s+CHAR\(36\))(?=\s+NOT NULL)',
                  lambda match: f'{match[1]} CHARACTER SET {charset} COLLATE {collation}', sql, count=1)


def main():
    repo = Path(__file__).resolve().parents[3]
    statements = list(team_declarations(repo))
    with pymysql.connect(host=os.environ['MYSQL_HOST'], port=int(os.environ['MYSQL_PORT']),
                         user=os.environ['MYSQL_USER'], password=os.environ['MYSQL_PASSWORD'],
                         database=os.environ['MYSQL_DATABASE'], charset='utf8mb4', autocommit=True) as db:
        with db.cursor() as cursor:
            cursor.execute('SELECT CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS '
                           'WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s', ('users', 'user_id'))
            parent = cursor.fetchone()
            if not parent:
                raise RuntimeError('Create the shared users table before preparing feature tables.')
            charset, collation = parent
            for sql in statements:
                cursor.execute(compatible_table(sql, charset, collation))
    print('Team History, safety and caregiver tables are available; existing data was preserved.')


if __name__ == '__main__':
    main()
